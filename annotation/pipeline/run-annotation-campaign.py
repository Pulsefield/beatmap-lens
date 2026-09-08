"""Dispatch isolated annotation and audit workers; persist every run for main-agent acceptance."""
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from annotation_runtime import REPO, load_module

public_example = load_module(REPO / 'harness/harness_examples.py').public_example


PYTHON = Path(os.environ.get("ANNOTATION_PYTHON", sys.executable))
QUERY_TOOLS = ("annotation-facts.py", "annotation-queries.py", "prepare-query-evidence.py")
HUMAN_STATES = {"accepted", "modified", "rejected", "deferred"}
BINDING_KEYS = ("sourceSha256", "taskId", "taskSha256", "foundationSha256", "base")

spec = importlib.util.spec_from_file_location(
    "annotation_revision", Path(__file__).with_name("prepare-annotation-revision.py"))
revision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(revision)


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


def public_decision(record):
    result = public_example({**record, "assessment": record.get("assessment", {})})
    result.pop("assessment")
    return {**result, "disposition": record["disposition"]}


def public_feedback(view):
    """Project canonical feedback, legacy bindings, or an earlier human-only view."""
    sha = view["sourceSha256"]
    judgments = [public_example(row) for row in view.get("humanJudgments", [])]
    decisions = [public_decision(row) for row in view.get("humanDecisions", [])]
    for row in view.get("agentReviews", view.get("existingReviews", [])):
        if row["status"] not in HUMAN_STATES or not row.get("decision"):
            continue
        claim = (row["claim"] if "claim" in row else
                 row["modifiedClaim"] if row["status"] == "modified" else row["summary"])
        decision = row["decision"]
        record = public_example({**claim, "id": decision["id"], "sourceSha256": sha,
                                 "humanComment": decision.get("rationale")})
        if row["status"] in ("accepted", "modified") and record["assessment"]["presence"] in ("present", "absent"):
            judgments.append(record)
        else:
            decisions.append(public_decision({**record, "disposition": row["status"]}))
    for observation in view.get("directObservations", view.get("humanObservations", [])):
        claim = observation.get("claim", observation.get("summary"))
        if claim["assessment"]["presence"] not in ("present", "absent"):
            continue
        comment = claim["evidence"].get("rationale") if "evidence" in claim else claim.get("rationale")
        judgments.append(public_example({**claim, "id": observation["id"], "sourceSha256": sha,
                                         "humanComment": comment}))
    result = {"sourceSha256": sha, "humanJudgments": judgments, "humanDecisions": decisions}
    if "snapshotAvailable" in view:
        result["snapshotAvailable"] = view["snapshotAvailable"]
    return result


def public_binding(binding):
    return {**{key: binding[key] for key in BINDING_KEYS}, **public_feedback(binding)}


def project_worker_bindings(root, job):
    path = job / "bindings.json"
    if not path.exists():
        return
    bindings = read(path)
    if not any("existingReviews" in row or "humanObservations" in row for row in bindings):
        return
    original = root / "controller/worker-bindings" / f"{job.name}.json"
    if not original.exists():
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, original)
    write(path, [public_binding(row) for row in bindings])


def public_prior_review(value):
    """Keep actual revision proposals/audits; project their separate human feedback."""
    result = copy.deepcopy(value)
    for chart in result["charts"]:
        decisions = []
        for entry in (chart, chart.get("currentTask", {})):
            if "feedback" in entry:
                entry["feedback"] = public_feedback(entry["feedback"])
                decisions.extend(entry["feedback"]["humanDecisions"])
            if "taskBinding" in entry:
                entry["taskBinding"] = public_binding(entry["taskBinding"])
        for reason in chart.get("reasons", []):
            if reason.get("kind") == "human-rejection":
                decision = (reason["humanDecision"] if "humanDecision" in reason else
                            next(row for row in decisions if row["id"] == reason["decision"]["id"]))
                reason.pop("decision", None)
                reason["humanDecision"] = public_decision(decision)
    return result


def verify_public_worker_inputs(job, bindings_pinned):
    """Refuse legacy frozen golden inputs; never rewrite them during launch."""
    message = "Frozen legacy human inputs require a fresh worker; original inputs remain unchanged"
    if (job / "foundation.json").exists() and "calibrationExamples" in read(job / "foundation.json"):
        raise ValueError(message)
    views = read(job / "bindings.json") if bindings_pinned else []
    if (job / "prior-human-feedback.json").exists():
        views += read(job / "prior-human-feedback.json")["charts"]
    if (job / "review-package.json").exists():
        expert = read(job / "review-package.json")["expertJudgments"]
        views += expert["current"] + expert["prior"]["charts"]
    if (job / "prior-review.json").exists():
        for chart in read(job / "prior-review.json")["charts"]:
            for entry in (chart, chart.get("currentTask", {})):
                views += [entry[key] for key in ("feedback", "taskBinding") if key in entry]
            if any(row.get("kind") == "human-rejection" and "decision" in row for row in chart.get("reasons", [])):
                raise ValueError(message)
    for view in views:
        if (any(key in view for key in ("agentReviews", "directObservations", "existingReviews", "humanObservations"))
                or any(public_example(row) != row for row in view.get("humanJudgments", []))
                or any(public_decision(row) != row for row in view.get("humanDecisions", []))):
            raise ValueError(message)


def prior_feedback(root, job, assignment):
    human, machine = [], []
    for chart in assignment["charts"]:
        sha = chart["sourceSha256"]
        path = root / "controller/prior-feedback" / f"{sha}.json.gz"
        if not path.exists():
            human.append({"sourceSha256": sha, "snapshotAvailable": False})
            continue
        raw = path.read_bytes()
        view = json.loads(gzip.decompress(raw))
        if view["sourceSha256"] != sha:
            raise ValueError("Prior feedback source differs from the assignment")
        headers = {h["handoffId"]: h for h in view["handoffs"]}
        hints = {}
        for row in view["agentReviews"]:
            if not row.get("decision") and row["status"] not in HUMAN_STATES:
                claim = row["summary"]
                key = (claim["tagId"], claim["scope"]["startMs"], claim["scope"]["endMs"])
                hints[key] = {
                    "sourceSha256": sha, "originalHandoffId": row["handoffId"],
                    "originalFoundationSha256": headers[row["handoffId"]]["foundationSha256"],
                    "originalClaimId": row["claimId"], "originalStatus": row["status"],
                    **{key: claim[key] for key in ("tagId", "scope", "reviewContext")},
                }
        human.append({**public_feedback(view), "snapshotAvailable": True})
        machine.extend(hints.values())
    write(job / "prior-human-feedback.json", {"charts": human})
    write(job / "prior-machine-candidates.json", {
        "kind": "historical-location-hints-not-current-labels",
        "selectionPolicy": "Last listed location per source/tag/scope; no supersession lineage inferred.",
        "candidates": machine,
    })


def prepare_review_package(job, label_job, assignment):
    """Retain submitted evidence and exact expert feedback, without source-discovery inputs."""
    shutil.copyfile(label_job / "result.json", job / "labeler-result.json")
    (job / "handoffs").mkdir()
    handoffs = []
    for chart in assignment["charts"]:
        name = f"handoffs/{chart['sourceSha256']}.json"
        shutil.copyfile(label_job / "packets" / f"{chart['sourceSha256']}.json", job / name)
        handoffs.append({"sourceSha256": chart["sourceSha256"], "path": name,
                         "sha256": hashlib.sha256((job / name).read_bytes()).hexdigest()})
    bindings = read(label_job / "bindings.json")
    human = [public_feedback(binding) for binding in bindings]
    write(job / "bindings.json", [
        {key: binding[key] for key in BINDING_KEYS}
        for binding in bindings
    ])
    label_run = read(label_job / "run.json")
    label_result = read(label_job / "result.json")
    prior_path = label_job / "prior-human-feedback.json"
    write(job / "review-package.json", {
        "reviewContextMode": "labeler-evidence",
        "evidenceLimit": "Submitted witnesses and coverage declarations only; no independent full-source inspection.",
        "labeler": {key: label_run[key] for key in
                    ("producerId", "skill", "requestedModel", "requestedReasoningEffort") if key in label_run},
        "labelerResult": {"path": "labeler-result.json",
                          "sha256": hashlib.sha256((job / "labeler-result.json").read_bytes()).hexdigest()},
        "labelerBindingsSha256": hashlib.sha256((label_job / "bindings.json").read_bytes()).hexdigest(),
        "discovery": [{key: chart[key] for key in ("sourceSha256", "inspectedRanges", "discoverySummary")}
                      for chart in label_result["charts"]],
        "handoffs": handoffs,
        "expertJudgments": {"current": human,
                            "prior": {"charts": [public_feedback(chart) for chart in read(prior_path)["charts"]]}
                            if prior_path.exists() else {"charts": []}},
    })


def setup_job(root, assignment, role, label_job=None):
    job = root / "workers" / f"{assignment['assignmentId']}-{role}"
    if (job / "run.json").exists():
        return job
    job.mkdir(parents=True, exist_ok=True)
    config = read(root / "controller/config.json")
    assignment = copy.deepcopy(assignment)
    total = sum(chart["durationMs"] for chart in assignment["charts"])
    if total != assignment["durationMs"] or total > min(config["maxDurationMs"], 2400000):
        raise ValueError("Assigned source duration exceeds 40 minutes or has a wrong total")
    common = root / config.get("workerCommonPath", "worker-common")
    review_mode = config.get("auditorContextMode", "full-source") if role == "auditor" else "full-source"
    evidence_only = review_mode == "labeler-evidence"
    if evidence_only:
        shutil.copytree(common / "skill", job / "skill")
        shutil.copyfile(common / "skill-provenance.json", job / "skill-provenance.json")
        shutil.copyfile(common / "roles/auditor.md", job / "ROLE.md")
        verify_skill(job, config["skill"])
        prepare_review_package(job, label_job, assignment)
        assignment["charts"] = [{key: chart[key] for key in ("sourceSha256", "durationMs", "parquetSha256")}
                                for chart in assignment["charts"]]
    else:
        shutil.copytree(common, job, dirs_exist_ok=True)
        foundation = read(common / "foundation.json")
        write(job / "foundation.json", {key: value for key, value in foundation.items() if key != "calibrationExamples"})
        (job / "charts").mkdir(exist_ok=True)
        for chart in assignment["charts"]:
            source = Path(chart["parquetPath"])
            target = job / "charts" / source.name
            shutil.copyfile(source, target)
            if hashlib.sha256(target.read_bytes()).hexdigest() != chart["parquetSha256"]:
                raise ValueError("Parquet changed after assignment")
            chart["parquetPath"] = str(target)
    write(job / "assignment.json", assignment)
    query_first = config.get("queryFirst", False)
    if query_first and not evidence_only:
        shutil.copyfile(job / "roles" / f"{role}.md", job / "ROLE.md")
        verify_skill(job, config["skill"])
        command = [str(PYTHON), str(job / "prepare-query-evidence.py"), str(job),
                   "--foundation-sha", config["foundationSha256"]]
        if config.get("lnCoordinationRequiresTwoColumns", False):
            command.append("--ln-coordination-requires-two-columns")
        with (job / "query-preparation.log").open("w") as log:
            subprocess.run(command, cwd=job, stdout=log, stderr=log, check=True)
        prior_feedback(root, job, assignment)
    elif not evidence_only:
        shutil.copyfile(REPO / "harness/annotation-facts.py", job / "annotation-facts.py")
        shutil.copyfile(REPO / f"annotation/roles/corpus-{role}.md", job / "ROLE.md")
    if label_job and not evidence_only:
        shutil.copyfile(label_job / "bindings.json", job / "bindings.json")
        shutil.copytree(label_job / "packets", job / "handoffs", dirs_exist_ok=True)
        label_result = read(label_job / "result.json")
        write(job / "discovery.json", [{"sourceSha256": c["sourceSha256"], "inspectedRanges": c["inspectedRanges"], "discoverySummary": c["discoverySummary"]} for c in label_result["charts"]])
    if assignment.get("revisionOf") and not evidence_only:
        prior = read(root / "controller/revision-inputs" / assignment["assignmentId"] / "prior-review.json")
        write(job / "prior-review.json", public_prior_review(prior))
    project_worker_bindings(root, job)
    run = {
        "producerId": f"corpus-500-{role}-{uuid.uuid4()}", "role": role,
        "assignmentId": assignment["assignmentId"], "durationMs": total,
        "chartCount": len(assignment["charts"]), "skill": config["skill"],
        "toolVersion": subprocess.check_output([config.get("codexCommand", "codex"), "--version"], text=True).strip(),
        "status": "prepared", "preparedAt": now(),
        "modelSource": "campaign-role-config" if config.get("models", {}).get(role) else "cli-default",
    }
    if role == "auditor":
        run["reviewContextMode"] = review_mode
    if not evidence_only:
        run["foundationInput"] = {"view": "definitions-only",
                                   "sourceSha256": hashlib.sha256((common / "foundation.json").read_bytes()).hexdigest()}
    if config.get("models", {}).get(role):
        run["requestedModel"] = config["models"][role]
    if config.get("reasoningEfforts", {}).get(role):
        run["requestedReasoningEffort"] = config["reasoningEfforts"][role]
    if query_first:
        run["queryFirst"] = True
        run["workerCommonPath"] = str(common)
    if assignment.get("revisionOf"):
        run["revisionOf"] = assignment["revisionOf"]
    write(job / "run.json", run)
    prompt = f"""Complete your assigned osu!mania {role} task. Read ROLE.md, skill/SKILL.md and its referenced judgment guide, foundation.json, skill-provenance.json, assignment.json and bindings.json before judging. Use only this job's supplied inputs and write only here. Do not inspect selection/admin directories or other jobs, and do not spawn agents. Python with PyArrow is {PYTHON}. The annotation-facts.py helper provides factual overview and precise row inspection; it does not assign labels. Work through every assigned chart. Use the already approved four-dimensional Foundation, preserve uncertainty and source-time evidence, and write result.json exactly as ROLE.md specifies. The controller handles sealing, provenance and delivery. This assignment contains {total} ms of chart data (maximum 2,400,000 ms); that limit is dataset duration, NOT your wall time. Finish all assigned work, validate your JSON and references, then report completion. No final commentary can substitute for writing result.json."""
    if query_first and not evidence_only:
        prompt = prompt.replace("already approved four-dimensional Foundation", "supplied pinned approved Foundation and its current targets")
        prompt += " Start with query-index.json and the compact gzip NDJSON files it references. These contain deterministic source facts, not machine or human review. Read prior-human-feedback.json for final humanJudgments with source/scope identity and optional exact humanComment. Separate humanDecisions retain rejection/deferral without inherited assessments; missing comments do not authorize machine reasoning as a human explanation. Read prior-machine-candidates.json only as old location hints: it deliberately omits old machine judgments and rationales. Reinspect under the current Foundation rather than inheriting old labels. Cover the complete source, unhinted regions, and newly introduced targets including Trill. The frozen annotation-queries.py supports precise follow-up queries; repeated-subset requires explicit --columns and never skips intervening rows. Use --skill-file skill/SKILL.md and --skill-file skill/references/judgment-guide.md when calling it. Distinguish selected witnesses, incidental notes, and candidate-local entering holds. Query ruleLabels, when present, are explicitly identified necessary-condition negatives under the pinned Foundation; retain their deterministic-query origin in your rationale and analysis sidecar. Abstentions require agent judgment. No query supplies positive salience or independent audit. Verify the full arrangement and explain uncertainty honestly; do not invent conclusions to fill a quota."
    if evidence_only:
        prompt = f"""Review the assigned labeler's submitted judgments as an independent auditor. Read ROLE.md, skill/SKILL.md and its referenced judgment guide, skill-provenance.json, and review-package.json. Read the package's discovery declarations and sealed handoff files for every judgment, rationale, exact submitted noteRefs/contextNoteRefs and question. The unchanged labeler-result.json is an administrative original; its claims duplicate the handoffs and do not need to be read again. Read its final expertJudgments with source/scope identity and optional exact humanComment. HumanDecisions retain rejection/deferral without inherited assessments. Submitted agent reasoning remains in the separate handoffs being audited. Administrative bindings.json and assignment.json preserve exchange identities, not additional semantic evidence. Use only these supplied inputs and write only here; do not inspect other jobs, controller/selection directories or recover original chart data, and do not spawn agents. This run's reviewContextMode is labeler-evidence: you have NOT independently traversed the original chart. Selected references are not the complete contents of a scope. Assess the submitted reasoning, calculations, evidence sufficiency and consistency with expert guidance. Review coverage declarations for supported explanation and visible gaps, without claiming independent full-source coverage. Return concrete missing evidence, unsupported inference or coverage explanation as needs-revision for the labeler to fix; use needs-expert only for a genuine semantic question that remains despite sufficient supplied evidence. Do not invent ambiguity or infer absence from unprovided notes. Follow ROLE.md's unchanged audit result contract, covering every original claim and question, and write result.json with exact skill provenance. The controller seals and delivers it against the original handoffs and frozen tasks. This assignment represents {total} ms of chart duration (maximum 2,400,000 ms), not a wall-time limit. No final commentary substitutes for result.json."""
    if assignment.get("revisionOf") and role == "labeler":
        prompt += " This is a new revision attempt. Read prior-review.json. Correct the concrete source, scope, coverage or reasoning defects using the supplied chart data. Keep already supported content accurate, address every revision finding, and return a complete replacement proposal collection for these charts. Preserve explicit human decisions in bindings.json. Do not overwrite or present the prior agent's work as your own execution. The new handoff supersedes the listed old handoff only in this campaign's acceptance record; original history remains intact."
    elif assignment.get("revisionOf") and not evidence_only:
        prompt += " This is an independent audit of a new revision handoff. Read prior-review.json for the earlier defects, then verify the new handoff against the actual chart data. Follow the auditor result schema and independently check every new claim and discovery coverage; the earlier verdict is not evidence that the revision is correct."
    (job / "prompt.txt").write_text(prompt)
    names = ["assignment.json", "prompt.txt", "ROLE.md"]
    if evidence_only:
        names += ["skill-provenance.json", "review-package.json", "labeler-result.json", "bindings.json"]
        names += [str(path.relative_to(job)) for path in sorted((job / "handoffs").glob("*.json"))]
    else:
        names += ["foundation.json", "annotation-facts.py"]
    run["inputHashes"] = {name: hashlib.sha256((job / name).read_bytes()).hexdigest() for name in names}
    if query_first and not evidence_only:
        paths = [*(job / name for name in QUERY_TOOLS), job / "query-index.json",
                 job / "prior-human-feedback.json", job / "prior-machine-candidates.json",
                 *sorted((job / "query-evidence").glob("*.ndjson.gz"))]
        run["inputHashes"].update({str(path.relative_to(job)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})
        if (job / "check-annotation-result.py").exists():
            run["inputHashes"]["check-annotation-result.py"] = hashlib.sha256((job / "check-annotation-result.py").read_bytes()).hexdigest()
    if (job / "prior-review.json").exists():
        run["inputHashes"]["prior-review.json"] = hashlib.sha256((job / "prior-review.json").read_bytes()).hexdigest()
    write(job / "run.json", run)
    write(job / "final-schema.json", {"type": "object", "properties": {"resultPath": {"type": "string"}, "summary": {"type": "string"}}, "required": ["resultPath", "summary"], "additionalProperties": False})
    return job


def exchange(root, job, operation):
    with (job / f"exchange-{operation}.log").open("a") as log:
        subprocess.run(["node", str(REPO / "annotation/pipeline/campaign-exchange.mjs"), operation, str(root), str(job)], cwd=REPO, stdout=log, stderr=log, check=True)


def launch(root, job):
    run = read(job / "run.json")
    verify_skill(job, run["skill"])
    if run["role"] == "labeler" and not (job / "bindings.json").exists():
        exchange(root, job, "prepare")
    for name, expected in run["inputHashes"].items():
        if hashlib.sha256((job / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Worker input changed after preparation: {name}")
    verify_public_worker_inputs(job, "bindings.json" in run["inputHashes"])
    if "bindings.json" not in run["inputHashes"]:
        project_worker_bindings(root, job)
    run["inputHashes"]["bindings.json"] = hashlib.sha256((job / "bindings.json").read_bytes()).hexdigest()
    run.update(status="running", startedAt=now())
    out = (job / "events.jsonl").open("w")
    err = (job / "stderr.log").open("w")
    codex = read(root / "controller/config.json").get("codexCommand", "codex")
    run["toolVersion"] = subprocess.check_output([codex, "--version"], text=True).strip()
    command = [codex, "-a", "never", "exec", "-C", str(job), "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral", "--json", "--output-schema", str(job / "final-schema.json"), "-o", str(job / "last-message.json"), "-"]
    overrides = []
    if run.get("requestedModel"):
        overrides.extend(["--model", run["requestedModel"]])
    if run.get("requestedReasoningEffort"):
        overrides.extend(["-c", f"model_reasoning_effort={json.dumps(run['requestedReasoningEffort'])}"])
    command[-1:-1] = overrides
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
    with (job / "events.jsonl").open() as events:
        for line in events:
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
            if run.get("queryFirst") or run.get("reviewContextMode") == "labeler-evidence":
                for name, expected in run["inputHashes"].items():
                    if hashlib.sha256((job / name).read_bytes()).hexdigest() != expected:
                        raise ValueError(f"Worker input changed during execution: {name}")
            result = read(job / "result.json")
            if result["skill"] != run["skill"]:
                raise ValueError("Result skill provenance differs from the actual frozen skill")
            run["resultSha256"] = hashlib.sha256((job / "result.json").read_bytes()).hexdigest()
            write(job / "run.json", run)
            if run["role"] == "labeler" and "check-annotation-result.py" in run["inputHashes"]:
                with (job / "result-check.json").open("w") as report:
                    subprocess.run([str(PYTHON), str(job / "check-annotation-result.py"), str(job)],
                                   cwd=job, stdout=report, check=True)
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
    by_key = {(r["handoffId"], r["claimId"]): r for r in feedback["agentReviews"]}
    effective = []
    for original in reviews:
        review = original
        while review["status"] == "superseded":
            link = review["supersededBy"]
            review = by_key[(link["handoffId"], link["claimId"])]
        effective.append((original, review))
    states = {r["status"] for _, r in effective}
    questions = {q["id"]: q for q in handoff["questions"]}
    human = {original["claimId"] for original, r in effective if r["status"] in ("accepted", "modified")
             and r.get("modifiedClaim", r["summary"])["assessment"]["presence"] in ("present", "absent")}
    settled = human | {original["claimId"] for original, r in effective
                       if original["status"] == "superseded" and r["status"] == "agent-reviewed"
                       and r["summary"]["assessment"]["presence"] in ("present", "absent")}
    uncertain_human = any(r["status"] in ("accepted", "modified") and original["claimId"] not in human
                          for original, r in effective)
    all_claims = [c["id"] for c in handoff["proposals"]]
    dispositions = {
        q["disposition"] for q in chart["questions"]
        if not ((affected := questions[q["questionId"]]["claimIds"] or all_claims) and set(affected) <= settled)
    }
    headers = {h["handoffId"]: h for h in feedback["handoffs"]}
    if any(original["claimId"] not in human and headers[r["handoffId"]]["baseStatus"] == "stale"
           for original, r in effective):
        return "stale"
    if chart.get("coverageReview", {}).get("outcome") != "supported" or states & {"needs-revision", "rejected"} or "needs-revision" in dispositions:
        return "needs-revision"
    if uncertain_human or states & {"needs-expert", "deferred"} or "needs-expert" in dispositions:
        return "needs-expert"
    if states - {"agent-reviewed", "accepted", "modified"}:
        return "awaiting-review"
    return "accepted-reviewed"


def pinned_correction_result(path, expected):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError(f"Coverage correction artifact changed: {path}")
    return json.loads(raw)


def corrected_coverage_acceptance(root, job, run, chart, feedback, handoff, correction):
    sha, handoff_id = chart["sourceSha256"], handoff["handoffId"]
    headers = {h["handoffId"]: h for h in feedback["handoffs"]}
    original_header = headers[handoff_id]
    if (correction["sourceSha256"] != sha or feedback["sourceSha256"] != sha
            or handoff["sourceSha256"] != sha or correction["handoffId"] != handoff_id
            or correction["handoffSha256"] != original_header["handoffSha256"]
            or revision.canonical_hashes([handoff])[0] != correction["handoffSha256"]
            or original_header["foundationSha256"] != handoff["foundationSha256"]
            or correction["originalAuditorResultSha256"] != run["resultSha256"]):
        raise ValueError("Coverage correction differs from its original source, handoff or audit pins")
    pinned_correction_result(job / "result.json", run["resultSha256"])
    label_job = root / "workers" / f"{run['assignmentId']}-labeler"
    label_run = read(label_job / "run.json")
    pinned_correction_result(label_job / "result.json", label_run["resultSha256"])
    labeler, auditor = [pinned_correction_result(root / correction[key]["path"], correction[key]["sha256"])
                        for key in ("labelerResult", "auditorResult")]
    if (labeler["agent"]["producerId"] == auditor["agent"]["producerId"]
            or auditor["agent"]["reasoningEffort"] != "high"
            or auditor["inputProvenance"]["labelerResultSha256"] != correction["labelerResult"]["sha256"]
            or labeler["skill"] != auditor["skill"]):
        raise ValueError("Coverage correction requires an independent high-effort audit of the pinned labeler result")
    for result, role in ((labeler, "labeler"), (auditor, "auditor")):
        if (result["agent"]["role"] != role or not result["agent"]["producerId"].strip()
                or not result["agent"]["model"].strip()
                or result["foundationSha256"] != handoff["foundationSha256"]):
            raise ValueError("Coverage correction worker provenance differs from its role or Foundation")
        manifest = result["inputProvenance"]["skillManifest"]
        if manifest["sha256"] != result["skill"]["sha256"]:
            raise ValueError("Coverage correction skill differs from its frozen manifest")
        verify_skill((root / manifest["path"]).parent.parent, result["skill"])
    labeled, audited = [revision.one(result["charts"], "sourceSha256", sha) for result in (labeler, auditor)]
    if labeled["coverageOrigin"] != {
            "handoffId": handoff_id, "handoffSha256": correction["handoffSha256"],
            "auditorResultSha256": run["resultSha256"], "labelerResultSha256": label_run["resultSha256"]}:
        raise ValueError("Coverage correction does not identify the unchanged original survey and audit")
    if (not labeled["discoverySummary"].strip() or not labeled["inspectedRanges"]
            or any(r["endMs"] <= r["startMs"] for r in labeled["inspectedRanges"])
            or audited["coverageReview"]["outcome"] not in ("supported", "needs-revision")
            or not audited["coverageReview"]["rationale"].strip()):
        raise ValueError("Coverage correction requires inspected ranges, discovery explanation and coverage review")
    claims = {c["id"]: c for c in labeled["claims"]}
    claim_audits = {c["claimId"]: c for c in audited["claims"]}
    questions = {q["id"]: q for q in labeled["questions"]}
    question_audits = {q["questionId"]: q for q in audited["questions"]}
    links = correction["addedClaims"]
    if (len(claims) != len(labeled["claims"]) or len(claim_audits) != len(audited["claims"])
            or set(claims) != set(claim_audits) or len(links) != len(claims)
            or {link["claimId"] for link in links} != set(claims)
            or len(questions) != len(labeled["questions"]) or len(question_audits) != len(audited["questions"])
            or set(questions) != set(question_audits)):
        raise ValueError("Coverage correction must audit and link every new claim and question exactly once")
    coverage = audited["coverageReview"]
    states = [chart_acceptance({**chart, "coverageReview": coverage}, feedback, handoff)]
    linked_questions = set()
    for added_id in dict.fromkeys(link["handoffId"] for link in links):
        header = headers[added_id]
        added = [link for link in links if link["handoffId"] == added_id]
        claim_ids = {link["claimId"] for link in added}
        if (added_id == handoff_id or header["foundationSha256"] != handoff["foundationSha256"]
                or header["agent"]["producerId"] != labeler["agent"]["producerId"]
                or header["agent"]["role"] != "labeler" or header["agent"]["skill"] != labeler["skill"]
                or any(link["handoffSha256"] != header["handoffSha256"] for link in added)):
            raise ValueError("Coverage correction added handoff differs from its canonical identity or producer")
        for question in header["questions"]:
            if questions.get(question["id"]) != question:
                raise ValueError("Coverage correction question differs from its canonical handoff")
            linked_questions.add(question["id"])
        audit_questions = [question_audits[q["id"]] for q in header["questions"]]
        audits = {a["auditId"] for a in feedback["audits"]
                  if a["handoffId"] == added_id and a["handoffSha256"] == header["handoffSha256"]
                  and a["foundationSha256"] == handoff["foundationSha256"]
                  and a["agent"]["producerId"] == auditor["agent"]["producerId"]
                  and a["agent"]["role"] == "auditor" and a["agent"]["skill"] == auditor["skill"]
                  and a["questions"] == audit_questions}
        reviews = [r for r in feedback["agentReviews"] if r["handoffId"] == added_id]
        if {r["claimId"] for r in reviews} != claim_ids:
            states.append("awaiting-review")
            continue
        for review in reviews:
            claim = claims[review["claimId"]]
            if (any(review["summary"][key] != claim[key]
                    for key in ("tagId", "scope", "reviewContext", "assessment"))
                    or review["summary"]["rationale"] != claim["evidence"]["rationale"]):
                raise ValueError("Coverage correction claim differs from its canonical summary")
        if any(not any(a["auditId"] in audits and a["result"] == claim_audits[r["claimId"]]
                       for a in r["audits"]) for r in reviews):
            states.append("awaiting-review")
            continue
        states.append(chart_acceptance(
            {"coverageReview": coverage, "questions": audit_questions}, feedback,
            {"handoffId": added_id, "proposals": [{"id": claim_id} for claim_id in claim_ids],
             "questions": header["questions"]}))
    if links and linked_questions != set(questions):
        raise ValueError("Coverage correction questions are missing from its canonical handoffs")
    if not links:
        states.append(chart_acceptance(audited, {"agentReviews": [], "handoffs": []},
                                       {"handoffId": "", "proposals": [], "questions": labeled["questions"]}))
    return next(state for state in ("stale", "needs-revision", "needs-expert", "awaiting-review", "accepted-reviewed")
                if state in states)


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
            correction_path = root / "controller/coverage-corrections" / f"{handoff['handoffId']}.json"
            if correction_path.exists():
                state = corrected_coverage_acceptance(root, job, run, chart, feedback, handoff, read(correction_path))
            else:
                state = chart_acceptance(chart, feedback, handoff)
            entry = {"sourceSha256": sha, "status": state, "handoffId": handoff["handoffId"], "auditor": run["producerId"], "feedbackDocumentVersion": feedback["documentVersion"]}
            if correction_path.exists():
                entry["coverageCorrection"] = {"path": str(correction_path.relative_to(root)),
                                               "sha256": hashlib.sha256(correction_path.read_bytes()).hexdigest()}
            chart_statuses.append(entry)
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
    parser.add_argument("--concurrency", type=int, help="Active labeler/auditor limit (config concurrency, otherwise 3; maximum 5)")
    parser.add_argument("--label-limit", type=int)
    parser.add_argument("--refresh", action="store_true", help="Refresh canonical feedback before reporting status")
    args = parser.parse_args()
    root = Path(args.campaign).resolve()
    if args.command == "status":
        if args.refresh:
            refresh_completed(root)
        print(json.dumps(status(root), ensure_ascii=False, indent=2))
        return
    if args.concurrency is None:
        config_path = root / "controller/config.json"
        args.concurrency = read(config_path).get("concurrency", 3) if config_path.exists() else 3
    if not 1 <= args.concurrency <= 5:
        parser.error("Use between one and five concurrent workers.")
    if args.label_limit is not None and args.label_limit < 1:
        parser.error("--label-limit must select at least one assignment.")
    stop = root / "controller/user-stop.json"
    if stop.exists():
        parser.error(f"Campaign is stopped by user request ({stop}); existing tasks and outputs are preserved.")
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
        # Submitted labelers may have inserted already-running auditors above.
        # Count all of them before launching any prepared job after a restart.
        for job in list(queue):
            run = read(job / "run.json")
            if run["status"] == "running":
                queue.remove(job)
                active[job] = (AdoptedWorker(job, run["pid"]), None, None)
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
