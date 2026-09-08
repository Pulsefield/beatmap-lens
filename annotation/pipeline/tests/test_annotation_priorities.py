"""Coverage and selection checks using service-shaped human feedback and prepared charts."""
from collections import Counter
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

import pyarrow as pa
import pyarrow.parquet as pq


SCRIPT = Path(__file__).resolve().parent.parent.joinpath("annotation-priorities.py")
spec = importlib.util.spec_from_file_location("annotation_priorities", SCRIPT)
priorities = importlib.util.module_from_spec(spec)
spec.loader.exec_module(priorities)


def claim(identity, tag="tech", start=0, end=1000, presence="present", salience="supporting"):
    assessment = {"presence": presence}
    if presence == "present":
        assessment["salience"] = salience
    return {"id": identity, "tagId": tag, "scope": {"startMs": start, "endMs": end},
            "assessment": assessment, "reviewContext": {"startMs": 0, "endMs": 10000}}


def review(value, status="agent-reviewed", base="current", **extra):
    return {"handoffId": "fixture-handoff", "claimId": value["id"], "summary": value,
            "status": status, "baseStatus": base, **extra}


def candidate(sha, start, end, value=0, group=None, kind='discovery'):
    return {"sourceSha256": sha, "scope": {"startMs": start, "endMs": end},
            "candidateKind": kind, "issueIds": [f'{sha}/handoff/{start}'] if kind == 'repair' else [],
            "selectionGroup": group or sha, "stratum": sha,
            "features": {key: value for key in priorities.FEATURES},
            "components": {"openReview": 0, "dimensionGap": 1, "chartGap": 1}}


class CoverageTest(unittest.TestCase):
    def test_interval_union_clipping_and_human_subtraction(self):
        ranges = [(0, 400), (200, 500), (500, 800), (900, 1000)]
        original = deepcopy(ranges)
        self.assertEqual(priorities.union(ranges), [[0, 800], [900, 1000]])
        self.assertEqual(priorities.intersect(ranges, [(250, 950)]), [[250, 800], [900, 950]])
        self.assertEqual(priorities.length(ranges), 900)
        self.assertEqual(priorities.union(priorities.subtract(ranges, [(100, 200), (700, 950)])),
                         [[0, 100], [200, 700], [950, 1000]])
        self.assertEqual(priorities.intersect([(0, 100)], [(100, 200)]), [])
        self.assertEqual(ranges, original)

    def test_all_dimensions_intersect_while_note_counts_keep_chord_heads(self):
        tags = priorities.TAGS
        claims = [claim("jack-a", tags[0], 0, 600), claim("jack-b", tags[0], 400, 1000),
                  claim("stream", tags[1], 100, 900, "absent"),
                  claim("trill", tags[2], 0, 800), claim("tech", tags[3], 200, 1200),
                  claim("ln-a", tags[4], 250, 750), claim("ln-b", tags[4], 700, 900)]
        metrics, ranges = priorities.coverage(claims, (0, 1000), [0, 100, 100, 250, 500, 750, 999])
        self.assertEqual(ranges[tags[3]], [[200, 1000]])
        self.assertEqual(ranges[tags[4]], [[250, 900]])
        self.assertEqual(metrics["anyDimension"], {"ms": 1000, "timeRate": 1, "noteStarts": 7, "noteRate": 1})
        self.assertEqual(metrics["allDimensions"], {"ms": 550, "timeRate": .55, "noteStarts": 3, "noteRate": 3 / 7})
        self.assertEqual(metrics["dimensions"][tags[1]]["noteStarts"], 5)
        self.assertEqual(metrics["dimensions"][tags[4]]["ms"], 650)  # Review context contributes no coverage.

    def test_feedback_uses_current_settled_judgments_and_exact_modified_scope(self):
        accepted = claim("accepted", start=10, end=20)
        modified = claim("replacement", start=30, end=50, presence="absent")
        machine = claim("machine", start=50, end=60)
        direct = claim("direct", start=100, end=110, presence="absent")
        feedback = {"agentReviews": [
            review(accepted, "accepted", base="stale"),
            review(claim("original", start=0, end=100), "modified", modifiedClaim=modified,
                   decision={"disposition": "modified"}),
            review(machine),
            review(claim("stale-base"), base="stale"),
            review(claim("stale-status"), "stale"),
            review(claim("rejected", start=80, end=90), "rejected", decision={"disposition": "rejected"}),
            review(claim("old"), "superseded", decision={"disposition": "modified"}),
            review(claim("accepted-unresolved", presence="unresolved"), "accepted"),
            review(claim("machine-unresolved", presence="unresolved")),
            review(claim("expert", presence="unresolved"), "needs-expert"),
            review(claim("revision"), "needs-revision"),
        ], "directObservations": [
            {"id": "observation", "summary": direct},
            {"id": "pending-observation", "summary": claim("direct-unresolved", presence="unresolved")},
        ]}
        original = deepcopy(feedback)
        human, machines, signals = priorities.feedback_labels(feedback)
        self.assertEqual(human, [accepted, modified, direct])
        self.assertEqual(machines, [machine])
        self.assertEqual([(s["kind"], s["claimId"]) for s in signals],
                         [("correction", "original"), ("correction", "rejected"),
                          ("openReview", "expert"), ("openReview", "revision")])
        self.assertEqual(signals[0]["claim"]["scope"], {"startMs": 30, "endMs": 50})
        self.assertEqual(feedback, original)

    def test_conflicts_use_exact_target_overlap_and_assessment(self):
        a = claim("present", start=0, end=100)
        b = claim("absent", start=50, end=150, presence="absent")
        conflict, = priorities.human_conflicts([a, b])
        self.assertEqual(conflict, {"tagId": "tech", "ranges": [[50, 100]],
                                    "claimIds": ["present", "absent"],
                                    "assessments": [a["assessment"], b["assessment"]]})
        self.assertEqual(priorities.human_conflicts([a, {**b, "tagId": "trill-organization"}]), [])
        self.assertEqual(priorities.human_conflicts([a, {**b, "scope": {"startMs": 100, "endMs": 150}}]), [])
        self.assertEqual(priorities.human_conflicts([a, {**b, "assessment": a["assessment"]}]), [])
        salient, = priorities.human_conflicts([a, claim("prominent", start=25, end=75, salience="prominent")])
        self.assertEqual(salient["ranges"], [[25, 75]])

    def test_conflicting_audit_repair_keeps_both_explanations(self):
        audits = [
            {"auditId": "support", "result": {"outcome": "supported", "rationale": "The repeated group supports the claim."}},
            {"auditId": "revision", "result": {"outcome": "needs-revision", "rationale": "The crop misses a structural change."}},
        ]
        feedback = {"agentReviews": [review(claim("conflict"), "needs-expert", audits=audits,
                                           expertReason="conflicting-audits",
                                           question="Which judgment applies to the complete episode?")]}
        _, _, signals = priorities.feedback_labels(feedback)
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["audits"], audits)
        self.assertEqual(signals[0]["expertReason"], "conflicting-audits")


class SelectionTest(unittest.TestCase):
    def test_repair_scopes_merge_overlap_once_and_keep_full_long_claims(self):
        issues = [{"issueId": identity, "scope": {"startMs": start, "endMs": end},
                   "reviewContext": {"startMs": start - 3000, "endMs": end + 4000}}
                  for identity, start, end in [('stream', 5000, 16000), ('inside', 7000, 9000),
                                                ('overlap', 15000, 35000), ('adjacent', 35000, 36000)]]
        self.assertEqual(priorities.repair_ranges(issues), [
            {"scope": {"startMs": 5000, "endMs": 35000}, "issueIds": ['stream', 'inside', 'overlap'],
             "reviewContext": {"startMs": 2000, "endMs": 39000}},
            {"scope": {"startMs": 35000, "endMs": 36000}, "issueIds": ['adjacent'],
             "reviewContext": {"startMs": 32000, "endMs": 40000}},
        ])

    def test_candidates_keep_exact_review_scopes_and_short_final_window(self):
        scopes = priorities.candidate_ranges((0, 5000), [claim("review", start=1250, end=1750),
                                                       claim("whole-chart", end=5000)], 2000, 2000)
        self.assertEqual(scopes, [(0, 2000), (1250, 1750), (2000, 4000), (4000, 5000)])

    def test_grid_omits_tails_below_half_window_but_keeps_reviewed_scopes_and_short_charts(self):
        scopes = priorities.candidate_ranges((0, 4999), [claim('reviewed-tail', start=4550, end=4999)],
                                             2000, 2000)
        self.assertEqual(scopes, [(0, 2000), (2000, 4000), (4550, 4999)])
        self.assertEqual(priorities.candidate_ranges((100, 1099), [], 2000, 100), [(100, 1099)])

    def test_correction_similarity_retrieves_matching_structure(self):
        candidates = [candidate("low", 0, 1000, 1), candidate("same", 0, 1000, 5),
                      candidate("high", 0, 1000, 9)]
        correction = {"sourceSha256": "human-source", "claimId": "changed", "tagId": "tech",
                      "handoffId": "human-handoff", "decisionId": "human-decision",
                      "scope": {"startMs": 2000, "endMs": 3000},
                      "features": {key: 5 for key in priorities.FEATURES}}
        ranked = priorities.rank_candidates(deepcopy(candidates), [correction])
        by_source = {c["sourceSha256"]: c for c in ranked}
        self.assertEqual(ranked[0]["sourceSha256"], "same")
        self.assertEqual(by_source["same"]["components"]["feedbackSimilarity"], 1)
        self.assertEqual(by_source["low"]["components"]["feedbackSimilarity"], 0)
        self.assertEqual(by_source["high"]["components"]["feedbackSimilarity"], 0)
        self.assertEqual(by_source["same"]["feedbackExample"],
                         {k: correction[k] for k in ("sourceSha256", "claimId", "scope", "tagId", "handoffId", "decisionId")})
        plain = priorities.rank_candidates(deepcopy(candidates), [])
        self.assertTrue(all(c["components"]["feedbackSimilarity"] == 0 and c["feedbackExample"] is None for c in plain))
        self.assertEqual(ranked, priorities.rank_candidates(list(reversed(deepcopy(candidates))), [correction]))

    def test_correction_retrieval_excludes_all_same_source_examples(self):
        candidates = [candidate('corrected-source', 0, 1000, 5), candidate('new-source', 0, 1000, 5)]
        correction = {"sourceSha256": 'corrected-source', "claimId": 'settled', "tagId": 'tech',
                      "handoffId": 'human-handoff', "decisionId": 'human-decision',
                      "scope": {"startMs": 0, "endMs": 1000}, "features": candidates[0]['features']}
        by_source = {c['sourceSha256']: c for c in priorities.rank_candidates(candidates, [correction])}
        self.assertEqual(by_source['corrected-source']['components']['feedbackSimilarity'], 0)
        self.assertIsNone(by_source['corrected-source']['feedbackExample'])
        self.assertEqual(by_source['corrected-source']['components']['dimensionGap'], 1)
        self.assertEqual(by_source['new-source']['components']['feedbackSimilarity'], 1)

    def test_repairs_bypass_discovery_caps_but_preserve_five_exploration_slots(self):
        repairs = [candidate('repair-source', i * 1000, (i + 1) * 1000, group='same-mapset', kind='repair')
                   for i in range(12)]
        discovery = [candidate(f'discovery-{i}', 0, 1000) for i in range(20)]
        result = priorities.select_batch(repairs + discovery, 24, 42)
        self.assertEqual(Counter(c['selectionRoute'] for c in result),
                         {'repair': 10, 'priority': 9, 'seeded-exploration': 5})
        self.assertEqual(sum(c['selectionGroup'] == 'same-mapset' for c in result), 10)
        issue_ids = [i for c in result for i in c['issueIds']]
        self.assertEqual(len(issue_ids), len(set(issue_ids)))

    def test_batch_is_seeded_diverse_and_nonoverlapping(self):
        ranked = [candidate("a", 0, 1000, group="song-a"), candidate("a", 500, 1500, group="song-a"),
                  candidate("a", 1000, 2000, group="song-a"), candidate("a2", 0, 1000, group="song-a"),
                  *[candidate(f"other-{i}", 0, 1000) for i in range(8)]]
        for c in ranked[4:7]:
            c["stratum"] = "same-structure"
        result = priorities.select_batch(ranked, 5, 42)
        self.assertEqual(result, priorities.select_batch(ranked, 5, 42))
        self.assertEqual(len(result), 5)
        self.assertEqual(Counter(c["selectionRoute"] for c in result), {"priority": 4, "seeded-exploration": 1})
        self.assertEqual([(c["sourceSha256"], priorities.bounds(c)) for c in result[:2]],
                         [("a", (0, 1000)), ("a", (1000, 2000))])
        self.assertTrue(all(count <= 2 for count in Counter(c["selectionGroup"] for c in result).values()))
        self.assertTrue(all(count <= 2 for count in Counter(c["stratum"] for c in result).values()))
        for i, a in enumerate(result):
            for b in result[i + 1:]:
                if a["sourceSha256"] == b["sourceSha256"]:
                    self.assertEqual(priorities.intersect([priorities.bounds(a)], [priorities.bounds(b)]), [])
        self.assertTrue(all("selectionRoute" not in c for c in ranked))


class CampaignReplayTest(unittest.TestCase):
    def test_saved_feedback_builds_coverage_and_queue_without_changing_campaign(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            campaign, feedback_dir = root / "campaign", root / "feedback"
            for path in (campaign / "controller", campaign / "admin", campaign / "agent/charts", feedback_dir):
                path.mkdir(parents=True)
            foundation = "f" * 64
            config = {"foundationSha256": foundation, "skill": {"path": "fixture-skill", "sha256": "s" * 64},
                      "workspace": str(root / "workspace"), "server": "http://127.0.0.1:1"}
            (campaign / "controller/config.json").write_text(json.dumps(config))
            sources = [{"source": {"sha256": letter * 64, "beatmapSetId": i + 1}}
                       for i, letter in enumerate(("a", "b"))]
            (campaign / "admin/source-map.json").write_text(json.dumps(sources))
            for index, source in enumerate(sources):
                sha = source["source"]["sha256"]
                notes = [{"source_line": i + 1, "column": i % 4, "kind": "tap", "start_ms": t, "end_ms": t}
                         for i, t in enumerate(range(1000 if index == 0 else 0, 10000, 1000))]
                metadata = {"source": source["source"], "range": {"startMs": 0, "endMs": 10000}}
                table = pa.Table.from_pylist(notes).replace_schema_metadata({b"beatmap_lens": json.dumps(metadata).encode()})
                pq.write_table(table, campaign / "agent/charts" / f"{sha}.parquet")
                value = {"sourceSha256": sha, "taskBinding": {"foundationSha256": foundation},
                         "agentReviews": [], "directObservations": []}
                if index == 0:
                    for tag in priorities.TAGS:
                        human = claim(f"human-{tag}", tag, 0, 4000, "absent")
                        if tag == "tech":
                            value["agentReviews"].append(review(claim("old-tech", tag, 0, 6000), "modified",
                                modifiedClaim=human, decision={"id": "modified-tech-decision", "disposition": "modified"}))
                        else:
                            value["agentReviews"].append(review(human, "accepted"))
                        value["agentReviews"].append(review(claim(f"machine-{tag}", tag, 0, 8000)))
                    value["agentReviews"].append(review(claim("duplicate-tech", "tech", 0, 8000),
                                                        handoffId="second-handoff"))
                    value["directObservations"].append({"id": "direct-conflict", "summary":
                        claim("conflicting-ln", "ln-coordination", 2000, 3000)})
                    value["agentReviews"].extend([
                        review(claim('open-stream', 'stream-organization', 5000, 10000), 'needs-revision',
                               audits=[{'auditId': 'revision-audit', 'result': {'outcome': 'needs-revision',
                                         'rationale': 'The crop omits the repeated entry organization.'}}]),
                        review(claim('open-ln', 'ln-coordination', 8000, 10000), 'needs-expert',
                               expertReason='Slow transfers need a semantic decision.',
                               question='Does the full entry and ending express coordination?'),
                    ])
                (feedback_dir / f"{sha}.json").write_text(json.dumps(value))
            original = {str(path.relative_to(root)): path.read_bytes()
                        for parent in (campaign, feedback_dir) for path in parent.rglob("*") if path.is_file()}
            command = [sys.executable, str(SCRIPT), "--campaign", str(campaign), "--feedback-dir", str(feedback_dir),
                       "--window-ms", "2000", "--stride-ms", "2000", "--batch-size", "3", "--seed", "7"]
            out = root / "output"
            subprocess.run([*command, "--out", str(out)], check=True, capture_output=True, text=True)
            report = json.loads((out / "quality.json").read_text())
            queue = json.loads((out / "queue.json").read_text())
            chart = next(c for c in report["charts"] if c["sourceSha256"] == "a" * 64)
            self.assertEqual(report["chartCount"], 2)
            self.assertEqual(report["groupCount"], 2)
            self.assertEqual(report["groupsWithHumanLabels"], 1)
            self.assertEqual(chart["human"]["anyDimension"]["ms"], 4000)
            self.assertEqual(chart["human"]["allDimensions"]["ms"], 3000)
            self.assertEqual(chart["human"]["allDimensions"]["noteStarts"], 2)
            self.assertEqual(chart["human"]["dimensions"]["tech"]["ms"], 4000)
            self.assertEqual(chart["machineOnly"]["dimensions"]["tech"]["ms"], 4000)
            self.assertEqual(chart["labelCounts"]["machineOnly"]["tech"], {"supporting": 1})
            self.assertEqual(report["labelCounts"]["machineOnly"]["tech"], {"supporting": 1})
            self.assertEqual(chart["combined"]["dimensions"]["ln-coordination"]["ms"], 7000)
            self.assertEqual(report["combined"]["anyDimension"]["timeRate"], .4)
            self.assertEqual(report["combined"]["allDimensions"]["timeRate"], .35)
            self.assertEqual(report["combined"]["allDimensions"]["noteRate"], 6 / 19)
            self.assertEqual(report["humanCorrectionExamples"], 1)
            self.assertEqual(report["humanConflicts"][0]["ranges"], [[2000, 3000]])
            self.assertEqual(queue["reportSha256"], hashlib.sha256((out / "quality.json").read_bytes()).hexdigest())
            candidates = [json.loads(line) for line in (out / "candidates.jsonl").read_text().splitlines()]
            conflict = next(c for c in candidates if c["sourceSha256"] == "a" * 64
                            and c["scope"] == {"startMs": 2000, "endMs": 4000})
            self.assertEqual(conflict["components"]["openReview"], 1)
            self.assertEqual(conflict["missingDimensions"]["ln-coordination"], .5)
            self.assertEqual(conflict["missingDimensions"]["tech"], 0)
            self.assertIsNone(conflict["feedbackExample"])  # This is the corrected source itself.
            other = next(c for c in candidates if c['sourceSha256'] == 'b' * 64)
            self.assertEqual(other["feedbackExample"]["handoffId"], "fixture-handoff")
            self.assertEqual(other["feedbackExample"]["decisionId"], "modified-tech-decision")
            self.assertFalse(any(c["sourceSha256"] == "a" * 64 and c["scope"] == {"startMs": 0, "endMs": 2000}
                                 for c in candidates))
            self.assertEqual(len(queue["sections"]), 3)
            repair, = [c for c in queue['sections'] if c['selectionRoute'] == 'repair']
            self.assertEqual(repair['scope'], {'startMs': 5000, 'endMs': 10000})
            self.assertEqual(repair['reviewContext'], {'startMs': 0, 'endMs': 10000})
            self.assertEqual(len(repair['issueIds']), 2)
            self.assertEqual(report['pendingIssueIds'], [])
            self.assertEqual(set(report['selectedIssueIds']), set(repair['issueIds']))
            for issue in report['openIssues']:
                self.assertIn(issue['issueId'], repair['issueIds'])
                self.assertLessEqual(repair['scope']['startMs'], issue['scope']['startMs'])
                self.assertGreaterEqual(repair['scope']['endMs'], issue['scope']['endMs'])
                self.assertEqual(issue['reviewContext'], {'startMs': 0, 'endMs': 10000})
                if issue['claimId'] == 'open-stream':
                    self.assertEqual(issue['status'], 'needs-revision')
                    self.assertEqual(issue['audits'][0]['result']['rationale'],
                                     'The crop omits the repeated entry organization.')
                else:
                    self.assertEqual(issue['status'], 'needs-expert')
                    self.assertEqual(issue['expertReason'], 'Slow transfers need a semantic decision.')
                    self.assertEqual(issue['question'], 'Does the full entry and ending express coordination?')
                for ordinary in candidates:
                    if ordinary['candidateKind'] == 'discovery' and ordinary['sourceSha256'] == issue['sourceSha256']:
                        self.assertFalse(priorities.intersect([priorities.bounds(ordinary)], [priorities.bounds(issue)]))
            assignment = json.loads((out / "assignment.proposed.json").read_text())
            self.assertEqual(assignment["coverageMode"], "selected-sections")
            self.assertEqual(assignment["queueSha256"], hashlib.sha256((out / "queue.json").read_bytes()).hexdigest())
            for selected in assignment["charts"]:
                sha = selected["sourceSha256"]
                self.assertEqual(selected["targetRanges"], [c["scope"] for c in queue["sections"] if c["sourceSha256"] == sha])
                self.assertEqual(selected["parquetSha256"], hashlib.sha256(Path(selected["parquetPath"]).read_bytes()).hexdigest())
            replay = root / "replay"
            subprocess.run([*command, "--out", str(replay)], check=True, capture_output=True, text=True)
            self.assertEqual(queue["sections"], json.loads((replay / "queue.json").read_text())["sections"])
            self.assertTrue(all((root / path).read_bytes() == content for path, content in original.items()))


if __name__ == "__main__":
    unittest.main()
