"""Regression checks for consuming concrete human assessments in campaign acceptance."""
import importlib.util
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
