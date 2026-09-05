"""Regression checks for consuming concrete human assessments in campaign acceptance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


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


if __name__ == "__main__":
    unittest.main()
