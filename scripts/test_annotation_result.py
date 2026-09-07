"""Mechanical preflight regressions using exact normalized-note fixture columns."""
import copy
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


SCRIPT = Path(__file__).with_name("check-annotation-result.py")
REPO = SCRIPT.resolve().parents[1]
spec = importlib.util.spec_from_file_location("result_check", SCRIPT)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
CASES = json.loads(SCRIPT.with_name("fixtures").joinpath("pattern-queries-reviewed.json").read_text())["cases"]


def write(path, value):
    Path(path).write_text(json.dumps(value) + "\n")


class ResultPreflightTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name)
        self.case = next(case for case in CASES if case["id"] == "aleph-one-ms-overlap")
        self.assigned = self.add_parquet(self.case)
        self.sha = self.assigned["sourceSha256"]
        self.skill = {"name": "fixture-skill", "version": "frozen", "sha256": "a" * 64}
        write(self.job / "skill-provenance.json", self.skill)
        write(self.job / "foundation.json", {"tags": [{"id": tag} for tag in sorted(checker.TAGS)]})
        write(self.job / "assignment.json", {"assignmentId": "fixture", "charts": [self.assigned]})
        self.claim = {
            "id": "entering-ln", "sectionId": "local-episode", "tagId": "ln-coordination",
            "scope": {"startMs": 50803, "endMs": 50804},
            "reviewContext": {"startMs": 50500, "endMs": 51030},
            "assessment": {"presence": "present", "salience": "supporting"},
            "noteLines": [6681, 6683], "contextLines": [6681, 6684],
            "rationale": "Factual validation fixture; this test asserts no semantic accuracy.",
        }
        self.chart = {"sourceSha256": self.sha, "inspectedRanges": [self.case["availableRange"]],
                      "discoverySummary": "Inspected the complete fixture input.",
                      "claims": [self.claim], "questions": []}
        self.result = {"skill": self.skill, "charts": [self.chart]}

    def add_parquet(self, case):
        path = self.job / f"{case['source']['sha256']}.parquet"
        schema = pa.schema([
            ("note_id", pa.string()), ("source_line", pa.int32()), ("column", pa.int8()),
            ("kind", pa.string()), ("source_kind", pa.string()), ("start_ms", pa.int64()),
            ("end_ms", pa.int64()), ("x", pa.int32()), ("hit_sound", pa.int32()),
        ], metadata={b"beatmap_lens": json.dumps({
            "format": "beatmap-lens-normalized-notes-parquet-v1",
            "source": case["source"], "range": case["availableRange"],
        }).encode()})
        pq.write_table(pa.Table.from_pylist(case["notes"], schema=schema), path)
        return {"sourceSha256": case["source"]["sha256"], "parquetPath": str(path),
                "parquetSha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    def check(self):
        write(self.job / "result.json", self.result)
        return checker.check(self.job)

    def test_valid_entering_hold_empty_negative_and_cross_list_reuse(self):
        self.chart["claims"].extend([
            {**self.claim, "id": "empty-negative", "assessment": {"presence": "absent"},
             "noteLines": [], "contextLines": []},
            {**self.claim, "id": "unreviewed", "assessment": {"presence": "unreviewed"},
             "noteLines": [], "contextLines": [], "rationale": ""},
        ])
        # Overlapping discovery ranges may be supplied out of order.
        self.chart["inspectedRanges"] = [{"startMs": 50500, "endMs": 51254}, {"startMs": 49664, "endMs": 50501}]
        report = self.check()
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["checkedClaims"], 3)

    def test_selected_targets_allow_surrounding_context_but_default_requires_full_chart(self):
        self.assigned["targetRanges"] = [{"startMs": 50000, "endMs": 50200}, {"startMs": 50700, "endMs": 50900}]
        self.chart["inspectedRanges"] = [{"startMs": 50600, "endMs": 51030}, {"startMs": 49900, "endMs": 50300}]
        assignment = {"coverageMode": "selected-sections", "charts": [self.assigned]}
        write(self.job / "assignment.json", assignment)
        report = self.check()
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["checkedClaims"], 1)

        del assignment["coverageMode"]
        write(self.job / "assignment.json", assignment)
        report = self.check()
        self.assertFalse(report["ok"])
        self.assertEqual(report["errors"][0]["gaps"], [
            {"startMs": 49664, "endMs": 49900}, {"startMs": 50300, "endMs": 50600},
            {"startMs": 51030, "endMs": 51254},
        ])

    def test_selected_targets_and_claim_scopes_cannot_skip_uninspected_gaps(self):
        self.chart["inspectedRanges"] = [{"startMs": 50500, "endMs": 50803}, {"startMs": 50804, "endMs": 51030}]
        self.assigned["targetRanges"] = [{"startMs": 50500, "endMs": 51030}]
        assignment = {"coverageMode": "selected-sections", "charts": [self.assigned]}
        write(self.job / "assignment.json", assignment)
        report = self.check()
        self.assertEqual({e["code"] for e in report["errors"]},
                         {"uninspected-gaps", "scope-outside-inspected-ranges"})
        self.assertTrue(all(e["gaps"] == [{"startMs": 50803, "endMs": 50804}] for e in report["errors"]))

        self.assigned["targetRanges"] = self.chart["inspectedRanges"]
        write(self.job / "assignment.json", assignment)
        report = self.check()
        self.assertEqual([e["code"] for e in report["errors"]], ["scope-outside-inspected-ranges"])

    def test_selected_assignments_require_nonempty_targets_within_source(self):
        for targets in (None, [], [{"startMs": 49663, "endMs": 50804}], [{"startMs": 50803, "endMs": 51255}]):
            with self.subTest(targets=targets):
                if targets is not None:
                    self.assigned["targetRanges"] = targets
                else:
                    self.assigned.pop("targetRanges", None)
                write(self.job / "assignment.json", {"coverageMode": "selected-sections", "charts": [self.assigned]})
                report = self.check()
                self.assertFalse(report["ok"])
                expected = "target-ranges-required" if not targets else "target-outside-source-range"
                self.assertIn(expected, {e["code"] for e in report["errors"]})

    def test_all_outside_duplicate_and_missing_references_are_reported(self):
        self.claim["noteLines"] = [6675, 6683, 6684, 6683, 99999, 6676]
        self.claim["reviewContext"] = {"startMs": 50577, "endMs": 50804}
        self.claim["contextLines"] = [6684, 6684]
        self.chart["claims"].append({
            **self.claim, "id": "release-at-left-edge", "scope": {"startMs": 50804, "endMs": 51030},
            "reviewContext": {"startMs": 50500, "endMs": 51030},
            "noteLines": [6681], "contextLines": [],
        })
        report = self.check()
        self.assertFalse(report["ok"])
        first = [e for e in report["errors"] if e.get("claimId") == self.claim["id"]]
        outside = next(e for e in first if e["code"] == "references-outside-range" and e["field"] == "noteLines")
        self.assertEqual([n["sourceLine"] for n in outside["notes"]], [6675, 6684, 6676])
        self.assertEqual(outside["notes"][1], {
            "sourceLine": 6684, "column": 2, "kind": "long", "startMs": 50804, "endMs": 51029,
        })
        self.assertEqual(next(e for e in first if e["code"] == "unknown-source-lines")["sourceLines"], [99999])
        self.assertEqual(len([e for e in first if e["code"] == "duplicate-references"]), 2)
        release = next(e for e in report["errors"] if e.get("claimId") == "release-at-left-edge")
        self.assertEqual(release["notes"][0]["endMs"], release["range"]["startMs"])

    def test_shapes_target_vocabulary_question_links_and_source_coverage(self):
        second = self.add_parquet(next(case for case in CASES if case["id"] == "cyber-four-directional-groups"))
        write(self.job / "assignment.json", {"charts": [self.assigned, second]})
        self.result["skill"] = {**self.skill, "version": "different"}
        self.claim.update(tagId="trill", noteLines=[], reviewContext={"startMs": 50804, "endMs": 51030})
        self.chart["inspectedRanges"] = [{"startMs": 49664, "endMs": 50500}, {"startMs": 50501, "endMs": 51254}]
        self.chart["questions"] = [{"id": "question", "claimIds": ["missing"], "text": "A concrete question."}]
        self.result["charts"] += [copy.deepcopy(self.chart), {"sourceSha256": "not-assigned"}]
        report = self.check()
        codes = {e["code"] for e in report["errors"]}
        self.assertTrue({"skill-mismatch", "source-coverage", "unassigned-source", "uninspected-gaps",
                         "context-does-not-contain-scope", "positive-requires-witnesses", "unknown-tag",
                         "unknown-question-claims"}.issubset(codes), report)
        coverage = [e for e in report["errors"] if e["code"] == "source-coverage"]
        self.assertEqual({e["actualCount"] for e in coverage}, {0, 2})
        gap = next(e for e in report["errors"] if e["code"] == "uninspected-gaps")
        self.assertEqual(gap["gaps"], [{"startMs": 50500, "endMs": 50501}])

    def test_cli_is_read_only_and_reports_nonzero_json_for_failed_result(self):
        self.claim["noteLines"] = [6675]
        write(self.job / "result.json", self.result)
        before = {p.name: p.read_bytes() for p in self.job.iterdir()}
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.job)], capture_output=True, text=True)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["errors"][0]["notes"][0]["sourceLine"], 6675)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.job.iterdir()})
        self.assertEqual(report["resultSha256"], hashlib.sha256(before["result.json"]).hexdigest())

    def test_evidence_rules_match_the_authoritative_typescript_domain(self):
        variants = [copy.deepcopy(self.claim) for _ in range(7)]
        variants[1]["scope"] = {"startMs": 50804, "endMs": 51030}  # Releasing at scope start is outside.
        variants[1]["noteLines"] = [6681]
        variants[2]["noteLines"] = []
        variants[3].update(assessment={"presence": "absent"}, noteLines=[], contextLines=[])
        variants[4]["noteLines"] = [6683, 6683]
        variants[5].update(assessment={"presence": "unreviewed"}, noteLines=[], contextLines=[], rationale="")
        variants[6]["contextLines"] = [6675]
        by_line = {n["source_line"]: n for n in self.case["notes"]}
        expected = []
        domain_claims = []
        for claim in variants:
            errors = []
            checker.check_claim(claim, by_line, lambda *args, **details: errors.append(args))
            expected.append(not errors)
            domain_claims.append({
                **{key: claim[key] for key in ("id", "sectionId", "tagId", "scope", "reviewContext", "assessment")},
                "evidence": {"noteRefs": [checker.source_ref(by_line[line]) for line in claim["noteLines"]],
                             "contextNoteRefs": [checker.source_ref(by_line[line]) for line in claim["contextLines"]],
                             "rationale": claim["rationale"]},
            })
        code = """
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(), require=createRequire(repo+'/apps/inspector/package.json');
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
let text=''; for await (const chunk of process.stdin) text+=chunk;
const input=JSON.parse(text);
const vite=await createServer({root:repo,configFile:false,server:{middlewareMode:true,ws:false,watch:null},
  optimizeDeps:{noDiscovery:true,include:[]},resolve:{alias:{'beatmap-lens':repo+'/packages/beatmap-lens/src/index.ts'}}});
try {
 const {assertClaimV2}=await vite.ssrLoadModule('/apps/inspector/src/annotation/workflow/domain.ts');
 process.stdout.write(JSON.stringify(input.claims.map(claim=>{
   try {assertClaimV2(claim,input.notes,{tags:input.tags.map(id=>({id}))}); return true;}
   catch {return false;}
 })));
} finally {await vite.close();}
"""
        output = subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=REPO, text=True,
                                         input=json.dumps({"claims": domain_claims,
                                                           "notes": [checker.source_ref(n) for n in self.case["notes"]],
                                                           "tags": sorted(checker.TAGS)}))
        self.assertEqual(json.loads(output), expected)
        self.assertEqual(expected, [True, False, False, True, False, True, False])


if __name__ == "__main__":
    unittest.main()
