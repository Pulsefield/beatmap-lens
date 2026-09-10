"""Selection repair candidates preserve authority, geometry, and record identities."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import sys
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from annotation.evidence_review.plan import build, digest, exact_cell, group_plan, inspect_record, quality_findings


def note(line, start, end=None, column=0):
    return {"source_line": line, "column": column, "kind": "normal" if end is None else "long",
            "start_ms": start, "end_ms": start if end is None else end}


def fixture():
    notes = [note(1, 80, 120), note(2, 100), note(3, 150), note(4, 200), note(5, 70, 100)]
    evidence = {"note_refs": deepcopy(notes[:3]), "context_note_refs": deepcopy(notes[3:]), "rationale": "Old supporting interpretation."}
    row = {"record_id": "human:one", "source_sha256": "a" * 64, "start_ms": 100, "end_ms": 200,
           "tag_id": "stream-organization", "playback_rate": 1.0, "presence": "present", "salience": "supporting",
           "origin": "human-confirmed", "foundation_id": "foundation", "observation_id": "observation", "decision_id": "decision",
           "handoff_id": "handoff", "claim_id": "claim", "auxiliary_evidence_status": "current",
           "details": {"review_context": {"start_ms": 50, "end_ms": 250}, "evidence": evidence}}
    camel_names = {"source_line": "sourceLine", "start_ms": "startMs", "end_ms": "endMs"}
    camel_note = lambda n: {camel_names.get(k, k): v for k, v in n.items()}
    proposal = {"id": "claim", "tagId": row["tag_id"], "scope": {"startMs": 100, "endMs": 200},
                "reviewContext": {"startMs": 50, "endMs": 250}, "assessment": {"presence": "present", "salience": "supporting"},
                "evidence": {"noteRefs": [camel_note(n) for n in evidence["note_refs"]],
                             "contextNoteRefs": [camel_note(n) for n in evidence["context_note_refs"]],
                             "rationale": evidence["rationale"]}}
    return row, notes, proposal


class EvidenceReviewPlanTests(unittest.TestCase):
    def test_full_scope_is_not_error_or_human_gold_and_retains_boundary_hold(self):
        row, notes, proposal = fixture()
        result = inspect_record(row, notes, proposal)
        self.assertEqual(result["flags"]["structural_errors"], [])
        self.assertEqual(result["flags"]["selection_shape"], "all_scope")
        self.assertEqual([n["source_line"] for n in result["scope_notes"]], [1, 2, 3])
        self.assertEqual([n["source_line"] for n in result["left_boundary_releases"]], [5])
        self.assertEqual(result["flags"]["selection_origin"], "inherited_agent")
        self.assertEqual(result["flags"]["selection_review_status"], "not_recorded")
        self.assertFalse(result["flags"]["human_note_selection_gold"])
        self.assertTrue(result["flags"]["context_equals_review_complement"])
        self.assertFalse(result["flags"]["unselected_as_semantic_negative_allowed"])
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])

    def test_modified_absence_keeps_inherited_text_without_selection_task(self):
        row, notes, proposal = fixture()
        row.update(origin="human-modified", presence="absent", salience=None)
        before = deepcopy(row)
        result = inspect_record(row, notes, proposal)
        cells, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(row, before)
        self.assertEqual(cells[0]["presence"], "absent")
        self.assertEqual(result["ancestor"]["presence"], "present")
        self.assertEqual(result["flags"]["rationale_status"], "inherited_after_claim_change")
        self.assertEqual(tasks, [])

    def test_positive_label_inheriting_nonpositive_selection_needs_concurrent_judgment(self):
        for ancestor_presence in ("absent", "unresolved"):
            with self.subTest(ancestor_presence=ancestor_presence):
                row, notes, proposal = fixture()
                row["origin"] = "human-modified"
                proposal["assessment"] = {"presence": ancestor_presence}
                before = deepcopy(row)
                result = inspect_record(row, notes, proposal)
                _, tasks = group_plan([row], {row["record_id"]: result})
                self.assertEqual(row, before)
                self.assertEqual(tasks[0]["review_reasons"], ["positive_label_inherits_nonpositive_judgment_selection"])
                self.assertEqual(tasks[0]["status"], "needs_concurrent_reannotation_selection")
                self.assertEqual(tasks[0]["purpose"], "concurrent_judgment_and_selection")
                self.assertFalse(tasks[0]["label_revision_requested"])
                self.assertFalse(tasks[0]["blocks_label_publication"])

    def test_revised_selection_and_salience_change_do_not_trigger_reannotation(self):
        row, notes, proposal = fixture()
        row["origin"] = "human-modified"
        row["details"]["evidence"]["note_refs"] = deepcopy(notes[1:3])
        proposal["assessment"] = {"presence": "absent"}
        result = inspect_record(row, notes, proposal)
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])
        row, notes, proposal = fixture()
        row.update(origin="human-modified", salience="prominent")
        result = inspect_record(row, notes, proposal)
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])
        row, notes, proposal = fixture()
        row.update(origin="human-modified", start_ms=90)
        result = inspect_record(row, notes, proposal)
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertTrue(result["flags"]["scope_changed"])
        self.assertEqual(tasks, [])

    def test_missing_human_witness_is_candidate_not_machine_reannotation(self):
        row, notes, proposal = fixture()
        row["details"]["evidence"]["note_refs"] = []
        result = inspect_record(row, notes, proposal)
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks[0]["review_reasons"], ["missing_witness_selection"])
        self.assertEqual(tasks[0]["priority"], 1)
        row["origin"] = "agent-reviewed"
        result = inspect_record(row, notes, proposal)
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])

    def test_empty_rationale_does_not_remove_positive_strength_target(self):
        row, notes, proposal = fixture()
        row["origin"] = "human-modified"
        row["details"]["evidence"]["rationale"] = ""
        result = inspect_record(row, notes, proposal)
        self.assertEqual(result["flags"]["rationale_status"], "empty")
        self.assertTrue(result["flags"]["positive_strength_target_available"])
        self.assertFalse(result["flags"]["assessment_changed"])
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])

    def test_attack_only_subset_is_explicit_and_other_notes_are_preserved(self):
        row, notes, proposal = fixture()
        row["details"]["evidence"]["note_refs"] = deepcopy(notes[1:3])
        row["details"]["evidence"]["context_note_refs"].append(notes[0])
        result = inspect_record(row, notes, proposal)
        self.assertTrue(result["flags"]["all_attacks_only_entering_holds_unselected"])
        self.assertEqual(result["unselected_scope_lines"], [1])
        self.assertEqual(len(result["review_context_notes"]), 5)
        self.assertEqual(result["flags"]["structural_errors"], [])
        _, tasks = group_plan([row], {row["record_id"]: result})
        self.assertEqual(tasks, [])

    def test_exact_cells_preserve_duplicate_records_and_separate_rates(self):
        row, notes, proposal = fixture()
        other = deepcopy(row)
        other["record_id"] = "human:two"
        fast = deepcopy(row)
        fast.update(record_id="human:fast", playback_rate=1.5)
        rows = [row, other, fast]
        records = {r["record_id"]: inspect_record(r, notes, proposal) for r in rows}
        cells, tasks = group_plan(rows, records)
        self.assertEqual(len(cells), 2)
        duplicate = next(c for c in cells if len(c["record_ids"]) == 2)
        self.assertEqual(duplicate["record_ids"], ["human:one", "human:two"])
        self.assertEqual(duplicate["record_label_weight"], 0.5)
        self.assertEqual(tasks, [])
        self.assertNotEqual(exact_cell(row), exact_cell(fast))

    def test_differing_scope_labels_are_a_split_risk_not_auto_error(self):
        row, notes, proposal = fixture()
        other = deepcopy(row)
        other.update(record_id="human:two", start_ms=120, end_ms=180, presence="absent", salience=None)
        rows = [row, other]
        records = {r["record_id"]: inspect_record(r, notes, proposal) for r in rows}
        cells, _ = group_plan(rows, records)
        result = quality_findings(rows, cells, [])
        self.assertEqual(result["unique_sections"], 2)
        self.assertEqual(len(result["overlapping_distinct_scope_pairs_same_source_tag_rate"]), 1)
        self.assertTrue(result["overlapping_distinct_scope_pairs_same_source_tag_rate"][0]["assessments_differ"])

    def test_duplicate_label_conflict_is_not_silently_resolved(self):
        row, notes, proposal = fixture()
        other = deepcopy(row)
        other.update(record_id="human:two", presence="absent", salience=None)
        rows = [row, other]
        records = {r["record_id"]: inspect_record(r, notes, proposal) for r in rows}
        with self.assertRaisesRegex(ValueError, "Conflicting labels"):
            group_plan(rows, records)

    def test_source_tuple_mismatch_is_detected_even_when_line_matches(self):
        row, notes, proposal = fixture()
        row["details"]["evidence"]["note_refs"][0]["column"] = 3
        result = inspect_record(row, notes, proposal)
        self.assertIn("witness_source_mismatch", result["flags"]["structural_errors"])

    def test_pinned_build_is_additive_and_rejects_changed_release_bytes(self):
        row, notes, proposal = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release, workflow, hygiene = [root / name for name in ("release", "workflow", "hygiene")]
            for path in (release, workflow, hygiene):
                path.mkdir()
            source_file = root / "source.osu"
            source_file.write_text("test source bytes")
            row["source_sha256"] = digest(source_file)
            pq.write_table(pa.Table.from_pylist([row]), release / "human.parquet")
            manifest = {"files": {"human.parquet": {"schema": "judgment-v2", "sha256": digest(release / "human.parquet")}}}
            (release / "manifest.json").write_text(json.dumps(manifest))
            pin = digest(release / "manifest.json")
            doc = {"handoffs": [{"handoff": {"handoffId": "handoff", "proposals": [proposal]}}],
                   "observations": [{"id": "observation", "claim": proposal}],
                   "decisions": [{"id": "decision", "observationId": "observation", "handoffId": "handoff", "claimId": "claim"}]}
            journal = workflow / (row["source_sha256"] + ".v2.json")
            journal.write_text(json.dumps({"document": doc}))
            before = journal.read_bytes()
            peer = {**row, **inspect_record(row, notes, proposal)["flags"], "cell_id": "upstream-cell"}
            pq.write_table(pa.Table.from_pylist([peer]), hygiene / "records.parquet")
            pq.write_table(pa.Table.from_pylist([{**n, "source_sha256": row["source_sha256"]} for n in notes]), hygiene / "source_notes.parquet")
            pq.write_table(pa.table({"example_record_id": pa.array([], type=pa.string()), "example_source_sha256": pa.array([], type=pa.string())}), hygiene / "example_dependencies.parquet")
            (hygiene / "source_provenance.json").write_text(json.dumps({row["source_sha256"]: {"source_path": str(source_file), "notes": len(notes)}}))
            (hygiene / "summary.json").write_text(json.dumps({"release_manifest_sha256": pin}))
            (hygiene / "checksums.json").write_text(json.dumps({p.name: digest(p) for p in hygiene.iterdir()}))
            summary = build(release, workflow, hygiene, root / "output", pin)
            self.assertEqual(summary["historical_records_modified"], 0)
            self.assertEqual(summary["semantic_reviews_completed"], 0)
            self.assertEqual(journal.read_bytes(), before)
            self.assertEqual(digest(release / "manifest.json"), pin)
            flags = json.loads((root / "output" / "record_flags.jsonl").read_text())["flags"]
            self.assertTrue(flags["final_label_and_evidence_same_claim_verified"])
            with self.assertRaisesRegex(ValueError, "new directory"):
                build(release, workflow, hygiene, root / "output", pin)
            doc["observations"][0]["claim"]["assessment"] = {"presence": "absent"}
            journal.write_text(json.dumps({"document": doc}))
            with self.assertRaisesRegex(ValueError, "final claim core differs"):
                build(release, workflow, hygiene, root / "mixed-observation", pin)
            journal.write_bytes(before)
            with (release / "human.parquet").open("ab") as handle:
                handle.write(b"changed")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                build(release, workflow, hygiene, root / "second", pin)


if __name__ == "__main__":
    unittest.main()
