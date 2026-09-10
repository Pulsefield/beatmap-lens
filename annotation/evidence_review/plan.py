"""Build a source-bound supplemental review plan without changing annotations.

Run with ``uv run --locked python -m annotation.evidence_review.plan --help``.
Hygiene flags are cross-checks, not semantic judgments or eligibility policy.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import pyarrow.parquet as pq

from annotation.release.snapshot import judgment_cell_id

PINNED_MANIFEST = "d662dc74f6171518707f83186521f57786910569ffaa62fbb0dc568eaac336c3"
NOTE_KEYS = ("source_line", "column", "kind", "start_ms", "end_ms")
CAMEL = {"sourceLine": "source_line", "startMs": "start_ms", "endMs": "end_ms",
         "noteRefs": "note_refs", "contextNoteRefs": "context_note_refs"}
ACCEPTANCE = [
    "Review the fixed source, interval, tag and playback rate with all section notes and review context visible, including entering holds and intervening unselected rows.",
    "Preserve the published label and record identities. A disputed label requires a separate human revision; an evidence-only proposal cannot override it.",
    "Explicitly record whether the inherited witness selection was inspected, retained or revised; retain the original selection and identify the new reviewer and review method.",
    "Explain how the selected arrangement supports the final presence and, when present, salience. Retaining all scope notes is allowed with an arrangement-level explanation.",
    "Describe omitted notes by source-linked group or relationship, allowing 'not separately assessed'. Do not call the context complement or every unselected note a negative.",
    "Record separate outcomes for selection support, rationale alignment, and omission contrast. A not-assessed contrast cannot close an omission-supervision task. Do not mistake a generic selection-review checkbox for contrast judgments.",
    "Keep minimality and sufficiency as untested unless a separate ablation or comparison was performed; state uncertainty rather than manufacture per-note reasons.",
    "Store the result as an additive, source-bound supplemental review referencing every record ID in this cell; human evidence gold requires an explicit human selection review, not an agent follow-up.",
]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def snake(value):
    if isinstance(value, dict):
        return {CAMEL.get(k, k): snake(v) for k, v in value.items()}
    return [snake(v) for v in value] if isinstance(value, list) else value


def note_key(note):
    return tuple(note[k] for k in NOTE_KEYS)


def overlaps(note, start, end):
    return note["start_ms"] < end and (note["end_ms"] > start if note["kind"] == "long" else note["start_ms"] >= start)


def exact_cell(row):
    # Float normalization makes integer and Arrow double timestamps identical.
    return (row["source_sha256"], float(row["start_ms"]), float(row["end_ms"]),
            row["tag_id"], float(row.get("playback_rate", 1)))


def cell_identity(key):
    return judgment_cell_id(dict(zip(("source_sha256", "start_ms", "end_ms", "tag_id", "playback_rate"), key)))


def claim_core(claim):
    return {"tag_id": claim["tagId"], "playback_rate": claim.get("playbackRate", 1),
            "scope": snake(claim["scope"]), "review_context": snake(claim["reviewContext"]),
            "presence": claim["assessment"]["presence"], "salience": claim["assessment"].get("salience"),
            "evidence": snake(claim["evidence"])}


def published_core(row):
    return {"tag_id": row["tag_id"], "playback_rate": row.get("playback_rate", 1),
            "scope": {"start_ms": row["start_ms"], "end_ms": row["end_ms"]},
            "review_context": row["details"]["review_context"],
            "presence": row["presence"], "salience": row["salience"],
            "evidence": row["details"]["evidence"]}


def inspect_record(row, notes, proposal):
    """Recompute factual relations; no inference about historical human intent."""
    scope = [n for n in notes if overlaps(n, row["start_ms"], row["end_ms"])]
    context_range = row["details"]["review_context"]
    context = [n for n in notes if overlaps(n, context_range["start_ms"], context_range["end_ms"])]
    evidence = row["details"]["evidence"]
    selected, available = evidence["note_refs"], evidence["context_note_refs"]
    selected_set, available_set = ({note_key(n) for n in values} for values in (selected, available))
    scope_set, context_set, source_set = ({note_key(n) for n in values} for values in (scope, context, notes))
    errors = []
    for name, refs, unique, allowed in (("witness", selected, selected_set, scope_set),
                                        ("context", available, available_set, context_set)):
        if len(refs) != len(unique):
            errors.append(name + "_duplicate_refs")
        if not unique <= source_set:
            errors.append(name + "_source_mismatch")
        if not unique <= allowed:
            errors.append(name + "_outside_range")
    if not selected:
        errors.append("empty_witness")
    if not context_range["start_ms"] <= row["start_ms"] < row["end_ms"] <= context_range["end_ms"]:
        errors.append("invalid_review_range")
    ancestor = claim_core(proposal)
    old_evidence = ancestor["evidence"]
    attacks = {note_key(n) for n in scope if n["start_ms"] >= row["start_ms"]}
    witness_changed = selected_set != {note_key(n) for n in old_evidence["note_refs"]}
    context_changed = available_set != {note_key(n) for n in old_evidence["context_note_refs"]}
    assessment_changed = (row["presence"], row["salience"]) != (ancestor["presence"], ancestor["salience"])
    scope_changed = ancestor["scope"] != {"start_ms": row["start_ms"], "end_ms": row["end_ms"]}
    rationale_changed = evidence["rationale"] != old_evidence["rationale"]
    rationale_present = bool(evidence["rationale"].strip())
    is_human = row["origin"].startswith("human-")
    rationale_status = ("empty" if not rationale_present else
                        "inherited_after_claim_change" if (assessment_changed or scope_changed) and not rationale_changed else
                        "changed_not_semantically_reviewed" if rationale_changed else "ancestor_text_unchanged")
    flags = {
        "structural_errors": errors,
        "selection_origin": ("inherited_agent" if not witness_changed else "changed_from_agent") if is_human else "agent",
        "selection_review_status": "not_recorded",
        "witness_set_changed": witness_changed, "context_set_changed": context_changed,
        "assessment_changed": assessment_changed, "scope_changed": scope_changed,
        "evidence_rationale_changed": rationale_changed, "evidence_rationale_present": rationale_present,
        "rationale_status": rationale_status,
        "rationale_semantic_alignment": "not_assessed",
        "ancestor_assessment_matches_final": not assessment_changed,
        "ancestor_scope_matches_final": not scope_changed,
        "selection_shape": "all_scope" if selected_set == scope_set else "proper_subset" if selected_set < scope_set else "outside_scope",
        "all_attacks_only_entering_holds_unselected": bool(attacks and attacks <= selected_set < scope_set),
        "context_equals_review_complement": available_set == context_set - selected_set,
        "label_supervision_status": "preserved_human_final" if is_human else "preserved_audited_machine",
        "human_note_selection_gold": False,
        "per_note_exclusion_reasons_available": False,
        "minimality_certified": False, "sufficiency_certified": False,
        "positive_strength_target_available": row["presence"] == "present",
        "rationale_as_salience_input_allowed": False,
        "unselected_as_semantic_negative_allowed": False,
    }
    return {"record_id": row["record_id"], "origin": row["origin"], "flags": flags,
            "final": published_core(row), "ancestor": ancestor,
            "observation_id": row.get("observation_id"), "decision_id": row.get("decision_id"),
            "handoff_id": row["handoff_id"], "claim_id": row["claim_id"],
            "source_sha256": row["source_sha256"],
            "auxiliary_evidence_status": row["auxiliary_evidence_status"],
            "scope_notes": scope, "review_context_notes": context,
            "left_boundary_releases": [n for n in notes if n["kind"] == "long" and n["end_ms"] == row["start_ms"]],
            "unselected_scope_lines": sorted(n[0] for n in scope_set - selected_set)}


def review_reasons(record):
    flags = record["flags"]
    reasons = []
    if record["origin"] == "human-modified":
        reasons.append("human_modified_evidence_not_separately_reviewed")
    if flags["rationale_status"] == "inherited_after_claim_change":
        reasons.append("ancestor_rationale_after_claim_change")
    if not flags["evidence_rationale_present"]:
        reasons.append("empty_evidence_rationale")
    if flags["selection_shape"] == "all_scope":
        reasons.append("full_scope_arrangement_study_not_an_error")
    if flags["all_attacks_only_entering_holds_unselected"]:
        reasons.append("entering_hold_omission_study_not_an_error")
    return reasons


def group_plan(rows, inspected):
    groups = defaultdict(list)
    for row in rows:
        groups[exact_cell(row)].append(inspected[row["record_id"]])
    cells, tasks = [], []
    for key, members in sorted(groups.items()):
        members.sort(key=lambda m: m["record_id"])
        targets = {(m["final"]["presence"], m["final"]["salience"]) for m in members}
        if len(targets) != 1:
            raise ValueError(f"Conflicting labels in exact cell {key}; no automatic resolution")
        reasons = sorted({reason for m in members for reason in review_reasons(m)})
        cell = {"cell_id": cell_identity(key), "source_sha256": key[0], "start_ms": key[1], "end_ms": key[2],
                "tag_id": key[3], "playback_rate": key[4], "record_ids": [m["record_id"] for m in members],
                "presence": members[0]["final"]["presence"], "salience": members[0]["final"]["salience"],
                "label_weight_total": 1, "record_label_weight": 1 / len(members),
                "selection_sets_agree": len({canonical(sorted(note_key(n) for n in m["final"]["evidence"]["note_refs"])) for m in members}) == 1,
                "review_reasons": reasons}
        cells.append(cell)
        if reasons:
            priority = 1 if "human_modified_evidence_not_separately_reviewed" in reasons else 2 if "empty_evidence_rationale" in reasons else 3
            tasks.append({**cell, "task_id": "evidence-review-" + cell["cell_id"][5:], "priority": priority,
                          "status": "pending_supplemental_judgment", "label_revision_requested": False,
                          "purpose": "current_evidence_explanation_review" if priority < 3 else "optional_selection_shape_study",
                          "blocks_label_publication": False,
                          "required_before_current_explanation_supervision": priority < 3,
                          "human_needs_expert_inbox": "unchanged",
                          "records": members, "acceptance_criteria": ACCEPTANCE})
    return cells, sorted(tasks, key=lambda t: (t["priority"], t["cell_id"]))


def quality_findings(rows, cells, dependencies):
    """Measure coverage and dependency risks without relabeling overlapping scopes."""
    sections, same_source_tag = defaultdict(set), defaultdict(list)
    for cell in cells:
        sections[(cell["source_sha256"], cell["start_ms"], cell["end_ms"], cell["playback_rate"])].add(cell["tag_id"])
        same_source_tag[(cell["source_sha256"], cell["tag_id"], cell["playback_rate"])].append(cell)
    overlap_pairs = []
    for members in same_source_tag.values():
        for i, left in enumerate(members):
            for right in members[i + 1:]:
                if max(left["start_ms"], right["start_ms"]) < min(left["end_ms"], right["end_ms"]):
                    overlap_pairs.append({"left_cell_id": left["cell_id"], "right_cell_id": right["cell_id"],
                                          "assessments_differ": (left["presence"], left["salience"]) != (right["presence"], right["salience"])})
    durations = [key[2] - key[1] for key in sections]
    return {"unique_sections": len(sections), "tags_per_section": dict(Counter(len(tags) for tags in sections.values())),
            "section_duration_ms": {"min": min(durations), "max": max(durations)},
            "playback_rates_by_record": dict(Counter(str(row.get("playback_rate", 1)) for row in rows)),
            "foundations_by_record": dict(Counter(row["foundation_id"] for row in rows)),
            "class_cells": dict(Counter(f"{cell['tag_id']}:{cell['presence']}:{cell['salience']}" for cell in cells)),
            "human_auxiliary_status": dict(Counter(row["auxiliary_evidence_status"] for row in rows if row["origin"].startswith("human-"))),
            "overlapping_distinct_scope_pairs_same_source_tag_rate": overlap_pairs,
            "overlapping_scope_note": "Different scope assessments are not contradictory by themselves. Keep related scopes in the same evaluation partition.",
            "exemplar_dependency_edges": len(dependencies),
            "exemplar_edges_with_unpublished_example_record": sum(d["example_record_id"] is None for d in dependencies),
            "distinct_exemplar_sources": len({d["example_source_sha256"] for d in dependencies}),
            "split_status": "not_created; group by source/song/audio and account for all exemplar dependency edges",
            "rationale_semantic_consistency": "not_assessed; textual equality and claim lineage do not certify meaning",
            "sampling_representativeness": "not_established; selected sections and uneven tag/rate coverage do not estimate population prevalence"}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def build(release, workflow, hygiene, output, expected_manifest=PINNED_MANIFEST):
    release, workflow, hygiene, output = map(Path, (release, workflow, hygiene, output))
    if output.exists():
        raise ValueError("Output must be a new directory; preserve existing supplemental reviews")
    if digest(release / "manifest.json") != expected_manifest:
        raise ValueError("Release manifest differs from the explicit pin")
    manifest = json.loads((release / "manifest.json").read_text())
    for name, info in manifest["files"].items():
        if digest(release / name) != info["sha256"]:
            raise ValueError(f"Release file checksum mismatch: {name}")
    checksums = json.loads((hygiene / "checksums.json").read_text())
    for name in ("summary.json", "records.parquet", "source_notes.parquet", "source_provenance.json", "example_dependencies.parquet"):
        if digest(hygiene / name) != checksums[name]:
            raise ValueError(f"Hygiene file checksum mismatch: {name}")
    if json.loads((hygiene / "summary.json").read_text())["release_manifest_sha256"] != expected_manifest:
        raise ValueError("Hygiene artifact references a different release")
    rows = []
    for name, info in manifest["files"].items():
        if info.get("schema") == "judgment-v2":
            rows.extend(pq.read_table(release / name).to_pylist())
    rows.sort(key=lambda r: r["record_id"])
    hygiene_rows = {r["record_id"]: r for r in pq.read_table(hygiene / "records.parquet").to_pylist()}
    if {r["record_id"] for r in rows} != set(hygiene_rows):
        raise ValueError("Hygiene record identities differ from release")
    by_source = defaultdict(list)
    for note in pq.read_table(hygiene / "source_notes.parquet").to_pylist():
        by_source[note.pop("source_sha256")].append(note)
    source_provenance = json.loads((hygiene / "source_provenance.json").read_text())
    for source in {row["source_sha256"] for row in rows}:
        info = source_provenance[source]
        if digest(info["source_path"]) != source:
            raise ValueError(f"Exact source bytes differ: {source}")
        if len(by_source[source]) != info["notes"]:
            raise ValueError(f"Source note count differs from the pinned extraction: {source}")
    docs, workflow_hashes, inspected = {}, {}, {}
    for row in rows:
        source = row["source_sha256"]
        if source not in docs:
            path = workflow / (source + ".v2.json")
            workflow_hashes[source] = digest(path)
            docs[source] = json.loads(path.read_text())["document"]
        doc = docs[source]
        handoff = next(h["handoff"] for h in doc["handoffs"] if h["handoff"]["handoffId"] == row["handoff_id"])
        proposal = next(c for c in handoff["proposals"] if c["id"] == row["claim_id"])
        final = proposal
        if row["origin"].startswith("human-"):
            observation = next(o for o in doc["observations"] if o["id"] == row["observation_id"])
            decision = next(d for d in doc["decisions"] if d["id"] == row["decision_id"])
            if (decision["observationId"], decision["handoffId"], decision["claimId"]) != (row["observation_id"], row["handoff_id"], row["claim_id"]):
                raise ValueError("Human decision binding differs from release")
            final = observation["claim"]
        if claim_core(final) != published_core(row):
            raise ValueError(f"Local final claim core differs from release: {row['record_id']}")
        peer = hygiene_rows[row["record_id"]]
        if any(peer.get(k) != v for k, v in row.items()):
            raise ValueError(f"Hygiene changed published columns: {row['record_id']}")
        result = inspect_record(row, by_source[source], proposal)
        if result["flags"]["structural_errors"]:
            raise ValueError(f"Source reference error: {row['record_id']}: {result['flags']['structural_errors']}")
        for key in ("selection_origin", "witness_set_changed", "context_set_changed", "assessment_changed", "scope_changed",
                    "evidence_rationale_changed", "evidence_rationale_present", "selection_shape",
                    "all_attacks_only_entering_holds_unselected", "context_equals_review_complement"):
            if result["flags"][key] != peer[key]:
                raise ValueError(f"Independent calculation disagrees with hygiene: {row['record_id']}: {key}")
        result["flags"]["final_label_and_evidence_same_claim_verified"] = True
        result["upstream_cell_id"] = peer["cell_id"]
        inspected[row["record_id"]] = result
    cells, tasks = group_plan(rows, inspected)
    counts = {}
    for layer in ("human", "machine"):
        members = [r for r in inspected.values() if r["origin"].startswith("human-") == (layer == "human")]
        counts[layer] = {"records": len(members), "origins": dict(Counter(r["origin"] for r in members)),
                         "selection_shapes": dict(Counter(r["flags"]["selection_shape"] for r in members)),
                         "rationale_statuses": dict(Counter(r["flags"]["rationale_status"] for r in members)),
                         **{k: sum(r["flags"][k] for r in members) for k in ("assessment_changed", "scope_changed", "context_equals_review_complement", "all_attacks_only_entering_holds_unselected")}}
    summary = {"contract": "beatmap-lens-supplemental-evidence-review-plan", "version": 1,
               "release_manifest_sha256": expected_manifest, "records": len(rows), "cells": len(cells),
               "exact_source_bytes_verified": len({row["source_sha256"] for row in rows}),
               "counts": counts, "review_tasks": len(tasks),
               "additional_quality_findings": quality_findings(rows, cells, pq.read_table(hygiene / "example_dependencies.parquet").to_pylist()),
               "tasks_by_priority": dict(Counter(t["priority"] for t in tasks)),
               "tasks_by_reason": dict(Counter(reason for t in tasks for reason in t["review_reasons"])),
               "duplicate_cells": [c for c in cells if len(c["record_ids"]) > 1],
               "semantic_reviews_completed": 0, "historical_records_modified": 0,
               "verification_scope": "Release file hashes, exact source byte hashes, published columns, workflow final claim core and decision identities, ancestor relations and source-note selection sets. Source-note parsing and cryptographic workflow body binding remain supplied by the separately pinned hygiene audit; no semantic certification."}
    output.mkdir(parents=True)
    for name, records in (("cells.jsonl", cells), ("review_tasks.jsonl", tasks), ("record_flags.jsonl", [
        {"record_id": r["record_id"], "cell_id": cell_identity(exact_cell(row)), "upstream_cell_id": r["upstream_cell_id"], "flags": r["flags"]}
        for row in rows for r in [inspected[row["record_id"]]]])):
        (output / name).write_text("".join(canonical(record) + "\n" for record in records))
    write_json(output / "summary.json", summary)
    write_json(output / "inputs.json", {"release": str(release.resolve()), "workflow": str(workflow.resolve()),
        "hygiene": str(hygiene.resolve()), "release_manifest_sha256": expected_manifest,
        "hygiene_files": {name: digest(hygiene / name) for name in ("checksums.json", "summary.json", "records.parquet", "source_notes.parquet", "source_provenance.json", "example_dependencies.parquet")},
        "workflow_files": workflow_hashes, "generator_sha256": digest(__file__)})
    write_json(output / "checksums.json", {p.name: digest(p) for p in sorted(output.iterdir())})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--workflow", required=True, help="Directory containing source SHA .v2.json journals")
    parser.add_argument("--hygiene", required=True)
    parser.add_argument("--output", required=True, help="New local output directory")
    parser.add_argument("--expected-manifest-sha256", default=PINNED_MANIFEST)
    args = parser.parse_args()
    print(json.dumps(build(args.release, args.workflow, args.hygiene, args.output, args.expected_manifest_sha256), indent=2))


if __name__ == "__main__":
    main()
