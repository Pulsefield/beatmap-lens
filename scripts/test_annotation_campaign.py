"""Regression checks for consuming concrete human assessments in campaign acceptance."""
import importlib.util
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "campaign", Path(__file__).with_name("run-annotation-campaign.py"))
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)


class HumanAssessmentAcceptanceTest(unittest.TestCase):
    def review(self, presence, modified=False, question=False):
        assessment = {"presence": presence}
        if presence == "present":
            assessment["salience"] = "supporting"
        row = {"handoffId": "handoff", "claimId": "tech",
               "status": "modified" if modified else "accepted",
               "summary": {"assessment": {"presence": "unresolved"}}}
        if modified:
            row["modifiedClaim"] = {"assessment": assessment}
        else:
            row["summary"]["assessment"] = assessment
        chart = {"coverageReview": {"outcome": "supported"}, "questions": []}
        handoff = {"handoffId": "handoff", "proposals": [{"id": "tech"}], "questions": []}
        if question:
            chart["questions"] = [{"questionId": "tech-question", "disposition": "needs-expert"}]
            handoff["questions"] = [{"id": "tech-question", "claimIds": ["tech"]}]
        feedback = {"agentReviews": [row],
                    "handoffs": [{"handoffId": "handoff", "baseStatus": "current"}]}
        return campaign.chart_acceptance(chart, feedback, handoff)

    def test_accepting_uncertainty_does_not_settle_the_label(self):
        self.assertEqual(self.review("unresolved"), "needs-expert")
        self.assertEqual(self.review("unresolved", question=True), "needs-expert")

    def test_explicit_human_assessment_settles_the_scoped_question(self):
        self.assertEqual(self.review("present", question=True), "accepted-reviewed")
        self.assertEqual(self.review("absent", modified=True, question=True), "accepted-reviewed")


class CampaignStopTest(unittest.TestCase):
    def test_user_stop_blocks_run_before_setup_and_keeps_status_available(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "controller").mkdir()
            (root / "controller/user-stop.json").write_text(json.dumps({"reason": "Revise semantics"}))
            assignments = root / "agent/assignments"
            assignments.mkdir(parents=True)
            (assignments / "next.json").write_text(json.dumps({
                "assignmentId": "next", "durationMs": 1000, "charts": []}))
            job = root / "workers/retained-labeler"
            job.mkdir(parents=True)
            retained_run = {"assignmentId": "retained", "role": "labeler", "status": "stopped-by-user"}
            (job / "run.json").write_text(json.dumps(retained_run))
            (job / "output.json").write_text('{"retained": true}\n')
            original = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            command = [sys.executable, str(Path(__file__).with_name("run-annotation-campaign.py"))]

            result = subprocess.run(command + ["run", "--campaign", str(root)], capture_output=True, text=True)

            self.assertEqual(result.returncode, 2)
            self.assertIn("stopped by user request", result.stderr)
            self.assertIn("user-stop.json", result.stderr)
            self.assertFalse((root / "controller/dispatcher.lock").exists())
            self.assertEqual(original, {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()})

            result = subprocess.run(command + ["status", "--campaign", str(root)], capture_output=True, text=True)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["runs"], [retained_run])
            for path, content in original.items():
                self.assertEqual((root / path).read_bytes(), content)
            self.assertFalse((root / "controller/dispatcher.lock").exists())


class CampaignResumeTest(unittest.TestCase):
    def test_resumed_auditor_counts_before_a_new_launch(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            campaign.write(root / "controller/config.json", {"concurrency": 1})
            jobs = {}
            for index, state in enumerate(("running", "prepared")):
                assignment = {"assignmentId": str(index), "durationMs": index + 1,
                              "charts": [{"sourceSha256": str(index)}]}
                campaign.write(root / "agent/assignments" / f"{index}.json", assignment)
                for role in ("labeler", "auditor"):
                    job = root / "workers" / f"{index}-{role}"
                    campaign.write(job / "assignment.json", assignment)
                    campaign.write(job / "run.json", {"role": role, "status": "submitted" if role == "labeler" else state,
                                                       "pid": 12345})
                    jobs[(str(index), role)] = job
            events = []

            def finish(root, job, process):
                events.append(f"finished:{job.name}")
                run = campaign.read(job / "run.json")
                run["status"] = "submitted"
                campaign.write(job / "run.json", run)

            def launch(root, job):
                events.append(f"launched:{job.name}")
                return Mock(poll=Mock(return_value=0)), None, None

            with patch.object(sys, "argv", ["runner", "run", "--campaign", str(root)]), \
                    patch.object(campaign, "setup_job", side_effect=lambda root, assignment, role, label_job=None: jobs[(assignment["assignmentId"], role)]), \
                    patch.object(campaign, "AdoptedWorker", return_value=Mock(poll=Mock(return_value=0))), \
                    patch.object(campaign, "launch", side_effect=launch), \
                    patch.object(campaign, "complete", side_effect=finish), \
                    patch.object(campaign, "status", return_value={"acceptedCharts": 2}), \
                    patch.object(campaign, "refresh_completed"), patch.object(campaign.time, "sleep"):
                campaign.main()
            self.assertEqual(events, ["finished:0-auditor", "launched:1-auditor", "finished:1-auditor"])


class QueryFirstJobTest(unittest.TestCase):
    def setUp(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.common = self.root / "worker-common"
        (self.common / "skill/references").mkdir(parents=True)
        (self.common / "roles").mkdir()
        for name in ("SKILL.md", "references/judgment-guide.md"):
            (self.common / "skill" / name).write_text("Frozen test skill: facts require judgment.\n")
        manifest = {"files": [{"path": name, "sha256": hashlib.sha256((self.common / "skill" / name).read_bytes()).hexdigest()}
                              for name in ("SKILL.md", "references/judgment-guide.md")]}
        campaign.write(self.common / "skill/manifest.json", manifest)
        self.skill = {"name": "fixture-skill", "version": "frozen-test",
                      "sha256": hashlib.sha256((self.common / "skill/manifest.json").read_bytes()).hexdigest()}
        campaign.write(self.common / "skill-provenance.json", self.skill)
        campaign.write(self.common / "foundation.json", {"tags": [{"id": "drill"}]})
        for role in ("labeler", "auditor"):
            (self.common / "roles" / f"{role}.md").write_text(f"Frozen {role} for current targets.\n")
        for name in campaign.QUERY_TOOLS:
            (self.common / name).write_bytes((campaign.REPO / "scripts" / name).read_bytes())
        case = json.loads((campaign.REPO / "scripts/fixtures/pattern-queries-reviewed.json").read_text())["cases"][0]
        self.sha = case["source"]["sha256"]
        source = self.root / "input.parquet"
        table = pa.Table.from_pylist(case["notes"]).replace_schema_metadata({
            b"beatmap_lens": json.dumps({"source": case["source"], "range": case["availableRange"]}).encode(),
        })
        pq.write_table(table, source)
        duration = case["availableRange"]["endMs"] - case["availableRange"]["startMs"]
        self.assignment = {"assignmentId": "opaque", "durationMs": duration,
                           "charts": [{"sourceSha256": self.sha, "durationMs": duration,
                                       "parquetPath": str(source),
                                       "parquetSha256": hashlib.sha256(source.read_bytes()).hexdigest()}]}
        self.config = {"skill": self.skill, "foundationSha256": "f" * 64,
                       "maxDurationMs": 2400000, "queryFirst": True,
                       "lnCoordinationRequiresTwoColumns": True,
                       "models": {"labeler": "gpt-5.4-mini", "auditor": "gpt-5.6-sol"},
                       "reasoningEfforts": {"labeler": "high", "auditor": "high"}}
        campaign.write(self.root / "controller/config.json", self.config)
        summary = {"tagId": "tech", "scope": {"startMs": 259802, "endMs": 260766},
                   "reviewContext": case["availableRange"],
                   "assessment": {"presence": "present", "salience": "prominent"},
                   "rationale": "Old machine conclusion must not anchor a new run."}
        self.decision = {"id": "human-rejection", "humanId": "expert", "disposition": "rejected",
                         "rationale": "Typical drill; retain this exact human correction."}
        self.direct = {"id": "direct-expert", "foundationSha256": "a" * 64,
                       "humanId": "expert", "confirmedAt": "2026-09-05T01:00:00Z",
                       "origin": {"kind": "direct-human"}, "summary": summary}
        feedback = {"sourceSha256": self.sha, "documentVersion": {"revision": 3, "sha256": "b" * 64},
                    "reviewBase": {"revision": 2, "sha256": "c" * 64},
                    "handoffs": [{"handoffId": "old", "foundationSha256": "a" * 64},
                                 {"handoffId": "later", "foundationSha256": "a" * 64}],
                    "agentReviews": [
                        {"handoffId": "old", "claimId": "m1", "status": "agent-reviewed", "summary": summary},
                        {"handoffId": "later", "claimId": "m2", "status": "agent-reviewed", "summary": summary},
                        {"handoffId": "old", "claimId": "rejected", "status": "rejected", "summary": summary,
                         "decision": self.decision}],
                    "directObservations": [self.direct]}
        path = self.root / "controller/prior-feedback" / f"{self.sha}.json.gz"
        path.parent.mkdir()
        path.write_bytes(gzip.compress(json.dumps(feedback).encode(), mtime=0))

    def setup(self, role="labeler"):
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test\n"):
            return campaign.setup_job(self.root, self.assignment, role)

    def test_frozen_queries_and_separate_historical_inputs_are_reproducible(self):
        original_assignment = json.dumps(self.assignment, sort_keys=True)
        job = self.setup()
        self.assertEqual(json.dumps(self.assignment, sort_keys=True), original_assignment)
        run = campaign.read(job / "run.json")
        self.assertEqual(run["requestedModel"], "gpt-5.4-mini")
        self.assertEqual(run["requestedReasoningEffort"], "high")
        self.assertEqual((job / "ROLE.md").read_text(), "Frozen labeler for current targets.\n")
        self.assertNotIn("four-dimensional", (job / "prompt.txt").read_text())
        index = campaign.read(job / "query-index.json")
        self.assertEqual(index["foundationSha256"], self.config["foundationSha256"])
        self.assertEqual(index["charts"][0]["queryCounts"]["alternation"], 1)
        # A reviewed excerpt is not a complete source, even if all its visible notes are dry.
        self.assertEqual(index["charts"][0]["ruleLabels"], [])
        self.assertEqual(index["charts"][0]["ruleAbstentions"][0]["outcome"], "abstain")
        evidence = job / index["charts"][0]["evidencePath"]
        original = evidence.read_bytes()
        with (job / "query-preparation.log").open("a") as log:
            subprocess.run([str(campaign.PYTHON), str(job / "prepare-query-evidence.py"), str(job),
                            "--foundation-sha", self.config["foundationSha256"],
                            "--ln-coordination-requires-two-columns"], stdout=log, stderr=log, check=True)
        self.assertEqual(evidence.read_bytes(), original)
        self.assertEqual(campaign.read(job / "query-index.json"), index)
        human = campaign.read(job / "prior-human-feedback.json")["charts"][0]
        self.assertEqual(human["agentReviews"][0]["decision"], self.decision)
        self.assertEqual(human["directObservations"], [self.direct])
        self.assertEqual(human["handoffs"][0]["foundationSha256"], "a" * 64)
        candidates = campaign.read(job / "prior-machine-candidates.json")["candidates"]
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["originalClaimId"], "m2")
        self.assertNotIn("assessment", candidates[0])
        self.assertNotIn("rationale", candidates[0])
        for name in (*campaign.QUERY_TOOLS, "query-index.json", "prior-human-feedback.json", "prior-machine-candidates.json", str(evidence.relative_to(job))):
            self.assertEqual(run["inputHashes"][name], hashlib.sha256((job / name).read_bytes()).hexdigest())
        auditor = self.setup("auditor")
        self.assertEqual(campaign.read(auditor / "run.json")["requestedModel"], "gpt-5.6-sol")
        self.assertEqual((auditor / index["charts"][0]["evidencePath"]).read_bytes(), original)

    def test_launch_uses_frozen_role_model_and_effort_with_legacy_defaults(self):
        job = self.setup()
        campaign.write(job / "bindings.json", [])
        self.config["models"]["labeler"] = "changed-after-preparation"
        self.config["reasoningEfforts"]["labeler"] = "ultra"
        campaign.write(self.root / "controller/config.json", self.config)
        process = Mock(pid=12345)
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test"), patch.object(campaign.subprocess, "Popen", return_value=process) as launch:
            _, out, err = campaign.launch(self.root, job)
            out.close()
            err.close()
        command = launch.call_args.args[0]
        self.assertEqual(command[command.index("--model") + 1], "gpt-5.4-mini")
        self.assertIn('model_reasoning_effort="high"', command)
        self.assertEqual(campaign.read(job / "run.json")["command"], command)
        self.config.pop("queryFirst")
        self.config.pop("models")
        self.config.pop("reasoningEfforts")
        campaign.write(self.root / "controller/config.json", self.config)
        legacy = {**self.assignment, "assignmentId": "legacy"}
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test"):
            old_job = campaign.setup_job(self.root, legacy, "labeler")
        campaign.write(old_job / "bindings.json", [])
        old_run = campaign.read(old_job / "run.json")
        self.assertEqual(old_run["modelSource"], "cli-default")
        self.assertNotIn("requestedModel", old_run)
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test"), patch.object(campaign.subprocess, "Popen", return_value=process) as launch:
            _, out, err = campaign.launch(self.root, old_job)
            out.close()
            err.close()
        self.assertNotIn("--model", launch.call_args.args[0])
        self.assertFalse(any("model_reasoning_effort=" in arg for arg in launch.call_args.args[0]))

    def test_changed_query_input_blocks_launch_and_runtime_failure_is_retained(self):
        job = self.setup()
        campaign.write(job / "bindings.json", [])
        (job / "annotation-queries.py").write_text("changed\n")
        with patch.object(campaign.subprocess, "Popen") as launch:
            with self.assertRaisesRegex(ValueError, "input changed"):
                campaign.launch(self.root, job)
        launch.assert_not_called()
        (job / "events.jsonl").write_text('{"type":"turn.failed"}\n')
        process = Mock(returncode=1)
        with patch.object(campaign, "exchange") as exchange:
            campaign.complete(self.root, job, process)
        self.assertEqual(campaign.read(job / "run.json")["status"], "execution-failed")
        exchange.assert_not_called()

    def test_duration_and_concurrency_caps_apply_to_new_campaign(self):
        self.config["maxDurationMs"] = 3000000
        campaign.write(self.root / "controller/config.json", self.config)
        oversized = {**self.assignment, "durationMs": 2400001,
                     "charts": [{**self.assignment["charts"][0], "durationMs": 2400001}]}
        with self.assertRaisesRegex(ValueError, "40 minutes"):
            campaign.setup_job(self.root, oversized, "labeler")
        result = subprocess.run([sys.executable, str(campaign.REPO / "scripts/run-annotation-campaign.py"),
                                 "run", "--campaign", str(self.root), "--concurrency", "6"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("five concurrent workers", result.stderr)
        campaign.write(self.root / "controller/user-stop.json", {"reason": "Keep test read-only"})
        for arguments in (["--concurrency", "5"], []):
            self.config["concurrency"] = 5
            campaign.write(self.root / "controller/config.json", self.config)
            result = subprocess.run([sys.executable, str(campaign.REPO / "scripts/run-annotation-campaign.py"),
                                     "run", "--campaign", str(self.root), *arguments],
                                    capture_output=True, text=True)
            self.assertIn("stopped by user request", result.stderr)
            self.assertNotIn("five concurrent workers", result.stderr)
        self.config["concurrency"] = 6
        campaign.write(self.root / "controller/config.json", self.config)
        result = subprocess.run([sys.executable, str(campaign.REPO / "scripts/run-annotation-campaign.py"),
                                 "run", "--campaign", str(self.root)], capture_output=True, text=True)
        self.assertIn("five concurrent workers", result.stderr)

    def prepare_labeler_submission(self):
        job = self.setup()
        note = json.loads((campaign.REPO / "scripts/fixtures/pattern-queries-reviewed.json").read_text())["cases"][0]["notes"][0]
        reference = {"column": note["column"], "startMs": note["start_ms"], "endMs": note["end_ms"],
                     "sourceLine": note["source_line"], "kind": note["kind"]}
        claim = {"id": "drill", "sectionId": "alternation", "tagId": "drill-organization",
                 "scope": {"startMs": 259802, "endMs": 260766},
                 "reviewContext": {"startMs": 259802, "endMs": 260766},
                 "assessment": {"presence": "present", "salience": "prominent"},
                 "noteLines": [reference["sourceLine"]], "contextLines": [],
                 "rationale": "Submitted crossed-pair alternation; selected witness, not a complete row inventory."}
        campaign.write(job / "result.json", {"skill": self.skill, "charts": [{
            "sourceSha256": self.sha, "inspectedRanges": [claim["scope"]],
            "discoverySummary": "Labeler inspected the assigned excerpt; this is its retained coverage declaration.",
            "claims": [claim], "questions": []}]})
        proposal = {key: claim[key] for key in ("id", "sectionId", "tagId", "scope", "reviewContext", "assessment")}
        proposal["evidence"] = {"noteRefs": [reference], "contextNoteRefs": [], "rationale": claim["rationale"]}
        campaign.write(job / "packets" / f"{self.sha}.json", {
            "handoffId": "original-handoff", "sourceSha256": self.sha,
            "foundationSha256": self.config["foundationSha256"], "proposals": [proposal], "questions": []})
        campaign.write(job / "bindings.json", [{"sourceSha256": self.sha, "taskId": "frozen-task",
            "taskSha256": "t" * 64, "foundationSha256": self.config["foundationSha256"],
            "base": {"revision": 1, "sha256": "b" * 64},
            "existingReviews": [{"status": "agent-reviewed", "claim": claim},
                                {"status": "rejected", "claim": claim, "decision": self.decision}],
            "humanObservations": [self.direct]}])
        return job

    def test_evidence_only_auditor_retains_submissions_and_expert_judgments_without_source_inputs(self):
        labeler = self.prepare_labeler_submission()
        self.config.update(auditorContextMode="labeler-evidence", models={"labeler": "gpt-6-astra", "auditor": "gpt-6-astra"},
                           reasoningEfforts={"labeler": "medium", "auditor": "high"})
        campaign.write(self.root / "controller/config.json", self.config)
        # Auditor setup must not need the chart at all, nor execute query preparation.
        Path(self.assignment["charts"][0]["parquetPath"]).unlink()
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test"), patch.object(campaign.subprocess, "run") as process:
            job = campaign.setup_job(self.root, self.assignment, "auditor", labeler)
        process.assert_not_called()
        run = campaign.read(job / "run.json")
        self.assertEqual(run["reviewContextMode"], "labeler-evidence")
        self.assertEqual(run["requestedModel"], "gpt-6-astra")
        self.assertEqual(run["requestedReasoningEffort"], "high")
        for name in ("charts", "query-index.json", "query-evidence", "foundation.json", "prior-machine-candidates.json", "prior-review.json", *campaign.QUERY_TOOLS):
            self.assertFalse((job / name).exists(), name)
        self.assertEqual(campaign.read(job / "assignment.json")["charts"],
                         [{key: self.assignment["charts"][0][key] for key in
                           ("sourceSha256", "durationMs", "parquetSha256")}])
        self.assertEqual((job / "labeler-result.json").read_bytes(), (labeler / "result.json").read_bytes())
        self.assertEqual((job / "handoffs" / f"{self.sha}.json").read_bytes(),
                         (labeler / "packets" / f"{self.sha}.json").read_bytes())
        package = campaign.read(job / "review-package.json")
        self.assertEqual(package["discovery"], [{key: campaign.read(labeler / "result.json")["charts"][0][key]
                                                for key in ("sourceSha256", "inspectedRanges", "discoverySummary")}])
        current = package["expertJudgments"]["current"][0]
        self.assertEqual(len(current["existingReviews"]), 1)
        self.assertEqual(current["existingReviews"][0]["decision"], self.decision)
        self.assertEqual(current["humanObservations"], [self.direct])
        self.assertEqual(package["expertJudgments"]["prior"], campaign.read(labeler / "prior-human-feedback.json"))
        self.assertEqual(package["labelerBindingsSha256"], hashlib.sha256((labeler / "bindings.json").read_bytes()).hexdigest())
        self.assertNotIn("existingReviews", campaign.read(job / "bindings.json")[0])
        prompt = (job / "prompt.txt").read_text()
        self.assertIn("NOT independently traversed", prompt)
        self.assertNotIn("query-index.json", prompt)
        self.assertNotIn("foundation.json", prompt)
        for name, sha in run["inputHashes"].items():
            self.assertEqual(hashlib.sha256((job / name).read_bytes()).hexdigest(), sha)
        (job / "events.jsonl").write_text('{"type":"turn.completed"}\n')
        result = {"skill": self.skill, "charts": [{"sourceSha256": self.sha,
            "coverageReview": {"outcome": "needs-revision", "rationale": "Submitted declaration lacks sufficient representative evidence."},
            "claims": [{"claimId": "drill", "outcome": "needs-revision", "rationale": "Provide the other alternating rows."}], "questions": []}]}
        campaign.write(job / "result.json", result)
        with patch.object(campaign, "exchange") as exchange:
            campaign.complete(self.root, job, Mock(returncode=0))
        exchange.assert_called_once_with(self.root, job, "audit")
        self.assertEqual(campaign.read(job / "run.json")["status"], "submitted")
        self.assertEqual(campaign.read(job / "result.json"), result)

    def test_evidence_only_assignment_can_prepare_a_revision_without_auditor_parquet(self):
        self.assignment.update(assignmentId="a" * 20, kind="corpus-assignment")
        labeler = self.prepare_labeler_submission()
        binding = campaign.read(labeler / "bindings.json")[0]
        label_run = campaign.read(labeler / "run.json")
        label_run["status"] = "submitted"
        campaign.write(labeler / "run.json", label_run)
        handoff_path = labeler / "packets" / f"{self.sha}.json"
        handoff = campaign.read(handoff_path)
        handoff.update({key: binding[key] for key in
                        ("sourceSha256", "taskId", "taskSha256", "foundationSha256", "base")})
        handoff["agent"] = {"role": "labeler", "producerId": label_run["producerId"]}
        campaign.write(handoff_path, handoff)
        self.config["auditorContextMode"] = "labeler-evidence"
        campaign.write(self.root / "controller/config.json", self.config)
        with patch.object(campaign.subprocess, "check_output", return_value="codex-test"):
            auditor = campaign.setup_job(self.root, self.assignment, "auditor", labeler)
        run = campaign.read(auditor / "run.json")
        run["status"] = "submitted"
        campaign.write(auditor / "run.json", run)
        chart_result = {"sourceSha256": self.sha,
                        "coverageReview": {"outcome": "supported", "rationale": "Submitted coverage reviewed."},
                        "claims": [{"claimId": "drill", "outcome": "needs-revision", "rationale": "Add decisive rows."}],
                        "questions": []}
        campaign.write(auditor / "result.json", {"skill": self.skill, "charts": [chart_result]})
        spec = importlib.util.spec_from_file_location("revision", campaign.REPO / "scripts/prepare-annotation-revision.py")
        revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(revision)
        handoff_sha = revision.canonical_hashes([handoff])[0]
        audit = {key: binding[key] for key in ("sourceSha256", "taskId", "taskSha256", "foundationSha256", "base")}
        audit.update(auditId="independent-audit", handoffId=handoff["handoffId"], handoffSha256=handoff_sha,
                     agent={"role": "auditor", "producerId": run["producerId"]},
                     claims=chart_result["claims"], questions=[])
        audit_sha = revision.canonical_hashes([audit])[0]
        campaign.write(auditor / "packets" / f"{self.sha}.json", audit)
        feedback = {"sourceSha256": self.sha, "reviewBase": binding["base"], "agentReviews": [],
                    "handoffs": [{"handoffId": handoff["handoffId"], "handoffSha256": handoff_sha}],
                    "audits": [{"auditId": audit["auditId"], "auditSha256": audit_sha}]}
        (auditor / "feedback").mkdir()
        (auditor / "feedback" / f"{self.sha}.json.gz").write_bytes(gzip.compress(json.dumps(feedback).encode()))
        tasks = self.root / "controller/tasks"
        tasks.mkdir()
        task = gzip.compress(json.dumps({"taskId": binding["taskId"], "taskSha256": binding["taskSha256"]}).encode())
        (tasks / f"{self.assignment['assignmentId']}-{self.sha}.json.gz").write_bytes(task)
        original = {p: p.read_bytes() for job in (labeler, auditor) for p in job.rglob("*") if p.is_file()}
        prepared = revision.prepare(self.root, self.assignment["assignmentId"], [self.sha])
        self.assertEqual(prepared["status"], "prepared-not-run")
        self.assertEqual(prepared["supersedes"][0]["auditSha256"], audit_sha)
        self.assertEqual(campaign.read(prepared["assignmentPath"])["charts"][0]["parquetPath"],
                         campaign.read(labeler / "assignment.json")["charts"][0]["parquetPath"])
        self.assertFalse((auditor / "charts").exists())
        self.assertEqual((tasks / f"{prepared['assignmentId']}-{self.sha}.json.gz").read_bytes(), task)
        self.assertTrue(all(path.read_bytes() == content for path, content in original.items()))

    def test_mode_change_never_rewrites_existing_auditor_inputs_or_history(self):
        job = self.setup("auditor")
        self.config["auditorContextMode"] = "labeler-evidence"
        campaign.write(self.root / "controller/config.json", self.config)
        for state in ("prepared", "running", "submitted"):
            run = campaign.read(job / "run.json")
            run["status"] = state
            campaign.write(job / "run.json", run)
            before = {p.relative_to(job): p.read_bytes() for p in job.rglob("*") if p.is_file()}
            with patch.object(campaign.subprocess, "check_output") as process:
                self.assertEqual(campaign.setup_job(self.root, self.assignment, "auditor"), job)
            process.assert_not_called()
            self.assertEqual(before, {p.relative_to(job): p.read_bytes() for p in job.rglob("*") if p.is_file()})
            self.assertEqual(campaign.read(job / "run.json")["reviewContextMode"], "full-source")

    def test_new_common_snapshot_checks_result_before_exchange(self):
        import shutil
        snapshot = self.root / "worker-common-checked"
        shutil.copytree(self.common, snapshot)
        (snapshot / "check-annotation-result.py").write_bytes(
            (campaign.REPO / "scripts/check-annotation-result.py").read_bytes())
        campaign.write(snapshot / "foundation.json", {"tags": [{"id": tag} for tag in
            ("jack-organization", "stream-organization", "drill-organization", "tech", "ln-coordination")]})
        self.config["workerCommonPath"] = snapshot.name
        campaign.write(self.root / "controller/config.json", self.config)
        job = self.setup()
        run = campaign.read(job / "run.json")
        self.assertEqual(run["workerCommonPath"], str(snapshot))
        self.assertIn("check-annotation-result.py", run["inputHashes"])
        self.assertFalse((self.common / "check-annotation-result.py").exists())
        (job / "events.jsonl").write_text('{"type":"turn.completed"}\n')
        campaign.write(job / "result.json", {
            "skill": self.skill, "charts": [{"sourceSha256": self.sha,
                "inspectedRanges": [], "discoverySummary": "Missing discovery coverage.",
                "claims": [{"id": "ln", "sectionId": "chart", "tagId": "ln-coordination",
                    "scope": {"startMs": 0, "endMs": 300000},
                    "reviewContext": {"startMs": 0, "endMs": 300000},
                    "assessment": {"presence": "absent"}, "noteLines": [], "contextLines": [],
                    "rationale": "Fixture negative for a mechanical coverage check."}], "questions": []}]})
        original = (job / "result.json").read_bytes()
        with patch.object(campaign, "exchange") as exchange:
            campaign.complete(self.root, job, Mock(returncode=0))
        exchange.assert_not_called()
        self.assertEqual(campaign.read(job / "run.json")["status"], "acceptance-failed")
        self.assertEqual((job / "result.json").read_bytes(), original)
        self.assertTrue((job / "result-check.json").exists())
        self.assertEqual([e["code"] for e in campaign.read(job / "result-check.json")["errors"]],
                         ["inspected-ranges-required"])


class NecessaryConditionRuleTest(unittest.TestCase):
    def test_complete_source_and_half_open_distinct_column_occupancy(self):
        spec = importlib.util.spec_from_file_location("query_evidence", Path(__file__).with_name("prepare-query-evidence.py"))
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        notes = [{"kind": "long", "column": 0, "start_ms": 100, "end_ms": 200},
                 {"kind": "long", "column": 1, "start_ms": 200, "end_ms": 300}]
        meta = {"source": {"noteCount": 2}, "range": {"startMs": 0, "endMs": 301}}
        rule = helper.ln_rule(notes, meta, meta["range"], "foundation-pin", "code-pin")
        self.assertEqual(rule["maximumSimultaneousLnColumns"], 1)
        self.assertEqual(rule["assessment"], {"presence": "absent"})
        self.assertEqual(rule["origin"], "deterministic-query")
        self.assertEqual(rule["foundationSha256"], "foundation-pin")
        self.assertEqual(rule["codeSha256"], "code-pin")
        self.assertNotIn("salience", rule["assessment"])
        self.assertEqual(helper.ln_rule(notes[:1], meta, meta["range"], "f", "c")["outcome"], "abstain")
        self.assertEqual(helper.ln_rule(notes, meta, {"startMs": 100, "endMs": 200}, "f", "c")["outcome"], "abstain")
        overlapping = [notes[0], {**notes[1], "start_ms": 199}]
        rule = helper.ln_rule(overlapping, meta, meta["range"], "f", "c")
        self.assertEqual(rule["maximumSimultaneousLnColumns"], 2)
        self.assertEqual(rule["outcome"], "abstain")
        self.assertNotIn("assessment", rule)


if __name__ == "__main__":
    unittest.main()
