"""Dispatch isolated annotation and audit workers; persist every run for main-agent acceptance."""
import argparse
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid


REPO = Path(__file__).resolve().parents[1]
PYTHON = REPO.parent / "Pulsefield-model/.venv/bin/python"


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.writing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def verify_skill(job, expected):
    manifest = job / "skill/manifest.json"
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != expected["sha256"]:
        raise ValueError("Worker skill manifest differs from pinned provenance")
    for entry in read(manifest)["files"]:
        if hashlib.sha256((job / "skill" / entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Worker skill file changed: {entry['path']}")


def setup_job(root, assignment, role, label_job=None):
    job = root / "workers" / f"{assignment['assignmentId']}-{role}"
    if (job / "run.json").exists():
        return job
    job.mkdir(parents=True, exist_ok=True)
    config = read(root / "controller/config.json")
    total = sum(chart["durationMs"] for chart in assignment["charts"])
    if total != assignment["durationMs"] or total > config["maxDurationMs"]:
        raise ValueError("Assigned source duration exceeds 40 minutes or has a wrong total")
    shutil.copytree(root / "worker-common", job, dirs_exist_ok=True)
    (job / "charts").mkdir(exist_ok=True)
    for chart in assignment["charts"]:
        source = Path(chart["parquetPath"])
        target = job / "charts" / source.name
        shutil.copyfile(source, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != chart["parquetSha256"]:
            raise ValueError("Parquet changed after assignment")
        chart["parquetPath"] = str(target)
    write(job / "assignment.json", assignment)
    shutil.copyfile(REPO / "scripts/annotation-facts.py", job / "annotation-facts.py")
    shutil.copyfile(REPO / f"docs/agent-roles/corpus-{role}.md", job / "ROLE.md")
    if label_job:
        shutil.copyfile(label_job / "bindings.json", job / "bindings.json")
        shutil.copytree(label_job / "packets", job / "handoffs", dirs_exist_ok=True)
        label_result = read(label_job / "result.json")
        write(job / "discovery.json", [{"sourceSha256": c["sourceSha256"], "inspectedRanges": c["inspectedRanges"], "discoverySummary": c["discoverySummary"]} for c in label_result["charts"]])
    if assignment.get("revisionOf"):
        shutil.copyfile(root / "controller/revision-inputs" / assignment["assignmentId"] / "prior-review.json", job / "prior-review.json")
    run = {
        "producerId": f"corpus-500-{role}-{uuid.uuid4()}", "role": role,
        "assignmentId": assignment["assignmentId"], "durationMs": total,
        "chartCount": len(assignment["charts"]), "skill": config["skill"],
        "toolVersion": subprocess.check_output([config.get("codexCommand", "codex"), "--version"], text=True).strip(),
        "status": "prepared", "preparedAt": now(),
    }
    if assignment.get("revisionOf"):
        run["revisionOf"] = assignment["revisionOf"]
    write(job / "run.json", run)
    prompt = f"""Complete your assigned osu!mania {role} task. Read ROLE.md, skill/SKILL.md and its referenced judgment guide, foundation.json, skill-provenance.json, assignment.json and bindings.json before judging. Use only this job's supplied inputs and write only here. Do not inspect selection/admin directories or other jobs, and do not spawn agents. Python with PyArrow is {PYTHON}. The annotation-facts.py helper provides factual overview and precise row inspection; it does not assign labels. Work through every assigned chart. Use the already approved four-dimensional Foundation, preserve uncertainty and source-time evidence, and write result.json exactly as ROLE.md specifies. The controller handles sealing, provenance and delivery. This assignment contains {total} ms of chart data (maximum 2,400,000 ms); that limit is dataset duration, NOT your wall time. Finish all assigned work, validate your JSON and references, then report completion. No final commentary can substitute for writing result.json."""
    if assignment.get("revisionOf") and role == "labeler":
        prompt += " This is a new revision attempt. Read prior-review.json. Correct the concrete source, scope, coverage or reasoning defects using the supplied chart data. Keep already supported content accurate, address every revision finding, and return a complete replacement proposal collection for these charts. Preserve explicit human decisions in bindings.json. Do not overwrite or present the prior agent's work as your own execution. The new handoff supersedes the listed old handoff only in this campaign's acceptance record; original history remains intact."
    elif assignment.get("revisionOf"):
        prompt += " This is an independent audit of a new revision handoff. Read prior-review.json for the earlier defects, then verify the new handoff against the actual chart data. Follow the auditor result schema and independently check every new claim and discovery coverage; the earlier verdict is not evidence that the revision is correct."
    (job / "prompt.txt").write_text(prompt)
    run["inputHashes"] = {name: hashlib.sha256((job / name).read_bytes()).hexdigest() for name in ["assignment.json", "prompt.txt", "ROLE.md", "foundation.json", "annotation-facts.py"]}
    if (job / "prior-review.json").exists():
        run["inputHashes"]["prior-review.json"] = hashlib.sha256((job / "prior-review.json").read_bytes()).hexdigest()
    write(job / "run.json", run)
    write(job / "final-schema.json", {"type": "object", "properties": {"resultPath": {"type": "string"}, "summary": {"type": "string"}}, "required": ["resultPath", "summary"], "additionalProperties": False})
    return job


def exchange(root, job, operation):
    with (job / f"exchange-{operation}.log").open("a") as log:
        subprocess.run(["node", str(REPO / "scripts/campaign-exchange.mjs"), operation, str(root), str(job)], cwd=REPO, stdout=log, stderr=log, check=True)


def launch(root, job):
    run = read(job / "run.json")
    verify_skill(job, run["skill"])
    if run["role"] == "labeler" and not (job / "bindings.json").exists():
        exchange(root, job, "prepare")
    for name, expected in run["inputHashes"].items():
        if hashlib.sha256((job / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Worker input changed after preparation: {name}")
    run["inputHashes"]["bindings.json"] = hashlib.sha256((job / "bindings.json").read_bytes()).hexdigest()
    run.update(status="running", startedAt=now())
    out = (job / "events.jsonl").open("w")
    err = (job / "stderr.log").open("w")
    codex = read(root / "controller/config.json").get("codexCommand", "codex")
    run["toolVersion"] = subprocess.check_output([codex, "--version"], text=True).strip()
    command = [codex, "-a", "never", "exec", "-C", str(job), "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral", "--json", "--output-schema", str(job / "final-schema.json"), "-o", str(job / "last-message.json"), "-"]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=out, stderr=err, text=True)
    process.stdin.write((job / "prompt.txt").read_text())
    process.stdin.close()
    run["pid"] = process.pid
    run["command"] = command
    write(job / "run.json", run)
    print(json.dumps({"event": "launched", "role": run["role"], "job": job.name, "charts": run["chartCount"], "durationMs": run["durationMs"], "pid": process.pid}), flush=True)
    return process, out, err


class AdoptedWorker:
    """Observe a worker left running by an interrupted dispatcher, without relaunching it."""
    def __init__(self, job, pid):
        self.job, self.pid, self.returncode = job, pid, None

    def poll(self):
        try:
            os.kill(self.pid, 0)
            return None
        except ProcessLookupError:
            terminal = None
            for line in (self.job / "events.jsonl").open():
                event = json.loads(line)
                if event.get("type") in ("turn.completed", "turn.failed"):
                    terminal = event["type"]
            self.returncode = 0 if terminal == "turn.completed" else 1
            return self.returncode


def complete(root, job, process):
    run = read(job / "run.json")
    run.update(exitCode=None if isinstance(process, AdoptedWorker) else process.returncode, finishedAt=now())
    if isinstance(process, AdoptedWorker):
        run["completionEvidence"] = "Process exited; terminal agent event used because its parent exit status is unavailable."
    run["threadIds"], run["usage"] = [], []
    for line in (job / "events.jsonl").open():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "thread.started":
            run["threadIds"].append(event["thread_id"])
        if event.get("type") == "turn.completed" and "usage" in event:
            run["usage"].append(event["usage"])
    write(job / "run.json", run)
    if process.returncode != 0 or not (job / "result.json").exists():
        run.update(status="execution-failed", error="Worker failed or did not write result.json; inspect its execution log.")
    else:
        try:
            verify_skill(job, run["skill"])
            result = read(job / "result.json")
            if result["skill"] != run["skill"]:
                raise ValueError("Result skill provenance differs from the actual frozen skill")
            run["resultSha256"] = hashlib.sha256((job / "result.json").read_bytes()).hexdigest()
            write(job / "run.json", run)
            exchange(root, job, "label" if run["role"] == "labeler" else "audit")
            run["status"] = "submitted"
        except (ValueError, KeyError, subprocess.CalledProcessError) as error:
            run.update(status="acceptance-failed", error=str(error))
    write(job / "run.json", run)
    print(json.dumps({"event": "finished", "job": job.name, "status": run["status"], "exitCode": process.returncode}), flush=True)


def chart_acceptance(chart, feedback, handoff):
    reviews = [r for r in feedback["agentReviews"] if r["handoffId"] == handoff["handoffId"]]
    if {r["claimId"] for r in reviews} != {c["id"] for c in handoff["proposals"]}:
        return "awaiting-review"
    states = {r["status"] for r in reviews}
    questions = {q["id"]: q for q in handoff["questions"]}
    human = {r["claimId"] for r in reviews if r["status"] in ("accepted", "modified")}
    all_claims = [c["id"] for c in handoff["proposals"]]
    dispositions = {
        q["disposition"] for q in chart["questions"]
        if not ((affected := questions[q["questionId"]]["claimIds"] or all_claims) and set(affected) <= human)
    }
    header = next(h for h in feedback["handoffs"] if h["handoffId"] == handoff["handoffId"])
    if header["baseStatus"] == "stale":
        return "stale"
    if chart.get("coverageReview", {}).get("outcome") != "supported" or states & {"needs-revision", "rejected"} or "needs-revision" in dispositions:
        return "needs-revision"
    if states & {"needs-expert", "deferred"} or "needs-expert" in dispositions:
        return "needs-expert"
    if states - {"agent-reviewed", "accepted", "modified"}:
        return "awaiting-review"
    return "accepted-reviewed"


def status(root):
    runs = [read(p) for p in sorted((root / "workers").glob("*/run.json"))]
    chart_statuses = []
    superseded = set()
    for run in runs:
        if run["role"] != "auditor" or run["status"] != "submitted":
            continue
        job = root / "workers" / f"{run['assignmentId']}-auditor"
        superseded.update(s["handoffId"] for s in read(job / "assignment.json").get("supersedes", []))
        for chart in read(job / "result.json")["charts"]:
            sha = chart["sourceSha256"]
            feedback = json.loads(gzip.decompress((job / "feedback" / f"{sha}.json.gz").read_bytes()))
            handoff = read(job / "handoffs" / f"{sha}.json")
            state = chart_acceptance(chart, feedback, handoff)
            chart_statuses.append({"sourceSha256": sha, "status": state, "handoffId": handoff["handoffId"], "auditor": run["producerId"], "feedbackDocumentVersion": feedback["documentVersion"]})
    chart_statuses = [c for c in chart_statuses if c["handoffId"] not in superseded]
    if len({c["sourceSha256"] for c in chart_statuses}) != len(chart_statuses):
        raise ValueError("Campaign has competing attempts without an explicit supersession chain")
    def submitted_charts(role):
        return len({c["sourceSha256"] for r in runs if r["role"] == role and r["status"] == "submitted" for c in read(root / "workers" / f"{r['assignmentId']}-{role}" / "assignment.json")["charts"]})
    value = {"updatedAt": now(), "runs": runs, "charts": chart_statuses,
             "acceptedCharts": sum(c["status"] == "accepted-reviewed" for c in chart_statuses),
             "needsRevisionCharts": sum(c["status"] == "needs-revision" for c in chart_statuses),
             "needsExpertCharts": sum(c["status"] == "needs-expert" for c in chart_statuses),
             "submittedLabelCharts": submitted_charts("labeler"),
             "submittedAuditCharts": submitted_charts("auditor")}
    write(root / "controller/progress.json", value)
    return value


def refresh_completed(root):
    for path in (root / "workers").glob("*-auditor/run.json"):
        if read(path)["status"] == "submitted":
            exchange(root, path.parent, "refresh")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run", "status"])
    parser.add_argument("--campaign", default=str(REPO / ".local/corpus-500"))
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--label-limit", type=int)
    parser.add_argument("--refresh", action="store_true", help="Refresh canonical feedback before reporting status")
    args = parser.parse_args()
    root = Path(args.campaign).resolve()
    if args.command == "status":
        if args.refresh:
            refresh_completed(root)
        print(json.dumps(status(root), ensure_ascii=False, indent=2))
        return
    lock = (root / "controller/dispatcher.lock").open("a+")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()))
    lock.flush()
    assignments = [read(p) for p in (root / "agent/assignments").glob("*.json")]
    assignments.sort(key=lambda a: (a["durationMs"], a["assignmentId"]))
    if args.label_limit:
        assignments = assignments[:args.label_limit]
    queue = [setup_job(root, a, "labeler") for a in assignments]
    known_assignments = {a["assignmentId"] for a in assignments}
    active = {}
    audited = set()
    while queue or active:
        for path in sorted((root / "controller/revisions").glob("*.json")):
            revision = read(path)
            if revision["assignmentId"] not in known_assignments:
                known_assignments.add(revision["assignmentId"])
                queue.insert(0, setup_job(root, revision, "labeler"))
        # Persisted successful label jobs can acquire an audit after a restart.
        for label_job in list(queue):
            run = read(label_job / "run.json")
            if run["status"] == "submitted":
                queue.remove(label_job)
                if run["role"] == "labeler" and label_job.name not in audited:
                    audited.add(label_job.name)
                    queue.insert(0, setup_job(root, read(label_job / "assignment.json"), "auditor", label_job))
            elif run["status"] == "running":
                queue.remove(label_job)
                active[label_job] = (AdoptedWorker(label_job, run["pid"]), None, None)
            elif run["status"] in ("execution-failed", "acceptance-failed"):
                queue.remove(label_job)  # Main agent inspects failures; do not silently retry changed work.
        while queue and len(active) < args.concurrency:
            job = queue.pop(0)
            run = read(job / "run.json")
            if run["status"] == "running":
                active[job] = (AdoptedWorker(job, run["pid"]), None, None)
            elif run["status"] == "prepared":
                active[job] = launch(root, job)
        for job, (process, out, err) in list(active.items()):
            if process.poll() is None:
                continue
            if out: out.close()
            if err: err.close()
            complete(root, job, process)
            del active[job]
            run = read(job / "run.json")
            if run["role"] == "labeler" and run["status"] == "submitted":
                audited.add(job.name)
                queue.insert(0, setup_job(root, read(job / "assignment.json"), "auditor", job))
        status(root)
        if queue or active:
            time.sleep(5)
    refresh_completed(root)
    progress = status(root)
    expected = sum(len(a["charts"]) for a in assignments)
    if progress["acceptedCharts"] < expected:
        print(json.dumps({"event": "requires-main-agent-acceptance", "expectedCharts": expected, "acceptedCharts": progress["acceptedCharts"], "needsRevisionCharts": progress["needsRevisionCharts"], "needsExpertCharts": progress["needsExpertCharts"]}), flush=True)


if __name__ == "__main__":
    main()
