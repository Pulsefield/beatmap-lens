"""Read-only labeler-result preflight; TypeScript domain sealing remains authoritative.

Read one assigned Parquet chart at a time. Report every invalid reference with
its exact source time, rather than failing at the first claim. No semantic
judgment, range repair, note replacement, or workflow mutation is performed.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playback_rate import normalize_playback_rate

TAGS = {"jack-organization", "stream-organization", "trill-organization", "tech", "ln-coordination"}
NOTE_COLUMNS = ["source_line", "column", "kind", "start_ms", "end_ms"]


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(65536), b""):
            value.update(chunk)
    return value.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def source_ref(note):
    return {"sourceLine": note["source_line"], "column": note["column"], "kind": note["kind"],
            "startMs": note["start_ms"], "endMs": note["end_ms"]}


def intersects(note, interval):
    if note["kind"] == "long":
        return note["start_ms"] < interval["endMs"] and note["end_ms"] > interval["startMs"]
    return interval["startMs"] <= note["start_ms"] < interval["endMs"]


def time_range(value, field, fail):
    if (not isinstance(value, dict) or set(value) != {"startMs", "endMs"}
            or not number(value["startMs"]) or not number(value["endMs"])
            or value["startMs"] >= value["endMs"]):
        fail("invalid-range", field, value=value)
        return None
    return value


def check_lines(value, field, interval, by_line, fail):
    if not isinstance(value, list):
        fail("expected-array", field)
        return
    seen, duplicates, unknown, outside = set(), [], [], []
    for line in value:
        if not number(line) or line not in by_line:
            unknown.append(line)
            continue
        note = by_line[line]
        if line in seen:
            duplicates.append(source_ref(note))
        seen.add(line)
        if interval is not None and not intersects(note, interval):
            outside.append(source_ref(note))
    if unknown:
        fail("unknown-source-lines", field, sourceLines=unknown)
    if duplicates:
        fail("duplicate-references", field, notes=duplicates)
    if outside:
        fail("references-outside-range", field, range=interval, notes=outside)


def coverage_gaps(ranges, target):
    through = target["startMs"]
    gaps = []
    for interval in sorted(ranges, key=lambda item: item["startMs"]):
        if interval["endMs"] <= through:
            continue
        if interval["startMs"] >= target["endMs"]:
            break
        if interval["startMs"] > through:
            gaps.append({"startMs": through, "endMs": interval["startMs"]})
        through = min(target["endMs"], max(through, interval["endMs"]))
    if through < target["endMs"]:
        gaps.append({"startMs": through, "endMs": target["endMs"]})
    return gaps


def check_claim(claim, by_line, fail, inspected_ranges=None):
    if not isinstance(claim, dict):
        fail("expected-object", "claim")
        return
    try:
        normalize_playback_rate(claim.get("playbackRate"))
    except ValueError:
        fail("unsupported-playback-rate", "playbackRate", value=claim.get("playbackRate"))
    for field in ("id", "sectionId"):
        # The corpus exchange always forwards sectionId into the domain claim.
        if not nonempty(claim.get(field)):
            fail("nonempty-text-required", field)
    if not isinstance(claim.get("tagId"), str) or claim["tagId"] not in TAGS:
        fail("unknown-tag", "tagId", value=claim.get("tagId"), allowed=sorted(TAGS))
    scope = time_range(claim.get("scope"), "scope", fail)
    context = time_range(claim.get("reviewContext"), "reviewContext", fail)
    if scope is not None and inspected_ranges is not None:
        gaps = coverage_gaps(inspected_ranges, scope)
        if gaps:
            fail("scope-outside-inspected-ranges", "scope", scope=scope, gaps=gaps)
    if scope is not None and context is not None and (
            context["startMs"] > scope["startMs"] or context["endMs"] < scope["endMs"]):
        fail("context-does-not-contain-scope", "reviewContext", scope=scope, reviewContext=context)
    assessment = claim.get("assessment")
    presence = assessment.get("presence") if isinstance(assessment, dict) else None
    if presence not in ("present", "absent", "unresolved", "unreviewed"):
        fail("invalid-assessment", "assessment", value=assessment)
    elif presence == "present":
        if set(assessment) != {"presence", "salience"} or assessment.get("salience") not in ("supporting", "prominent"):
            fail("invalid-assessment", "assessment", value=assessment)
    elif set(assessment) != {"presence"}:
        fail("invalid-assessment", "assessment", value=assessment)
    rationale = claim.get("rationale")
    if not isinstance(rationale, str) or (presence != "unreviewed" and not nonempty(rationale)):
        fail("rationale-required", "rationale")
    check_lines(claim.get("noteLines"), "noteLines", scope, by_line, fail)
    check_lines(claim.get("contextLines"), "contextLines", context, by_line, fail)
    if presence == "present" and claim.get("noteLines") == []:
        fail("positive-requires-witnesses", "noteLines")


def check_targets(value, chart_range, fail):
    if not isinstance(value, list) or not value:
        fail("target-ranges-required", "targetRanges", chartRange=chart_range)
        return []
    ranges = []
    for index, candidate in enumerate(value):
        field = f"targetRanges[{index}]"
        interval = time_range(candidate, field, fail)
        if interval is None:
            continue
        if interval["startMs"] < chart_range["startMs"] or interval["endMs"] > chart_range["endMs"]:
            fail("target-outside-source-range", field, range=interval, chartRange=chart_range)
        ranges.append(interval)
    return ranges


def check_coverage(value, chart_range, fail, target_ranges=None):
    if not isinstance(value, list) or not value:
        fail("inspected-ranges-required", "inspectedRanges", chartRange=chart_range)
        return []
    ranges = []
    for index, candidate in enumerate(value):
        interval = time_range(candidate, f"inspectedRanges[{index}]", fail)
        if interval is not None:
            ranges.append(interval)
    targets = [chart_range] if target_ranges is None else target_ranges
    gaps = [gap for target in targets for gap in coverage_gaps(ranges, target)]
    if gaps:
        fail("uninspected-gaps", "inspectedRanges", chartRange=chart_range, gaps=gaps)
    return ranges


def check_questions(value, claim_ids, fail):
    if not isinstance(value, list):
        fail("expected-array", "questions")
        return
    seen = set()
    for index, question in enumerate(value):
        field = f"questions[{index}]"
        if not isinstance(question, dict) or set(question) != {"id", "claimIds", "text"}:
            fail("invalid-question-shape", field)
            continue
        if not nonempty(question["id"]) or not nonempty(question["text"]):
            fail("nonempty-text-required", field)
        if isinstance(question["id"], str):
            if question["id"] in seen:
                fail("duplicate-question-id", field, questionId=question["id"])
            seen.add(question["id"])
        if not isinstance(question["claimIds"], list):
            fail("expected-array", f"{field}.claimIds")
        else:
            unknown = [value for value in question["claimIds"] if not isinstance(value, str) or value not in claim_ids]
            if unknown:
                fail("unknown-question-claims", field, claimIds=unknown)


def check(job, result_path=None):
    job = Path(job)
    result_path = Path(result_path) if result_path is not None else job / "result.json"
    assignment = read(job / "assignment.json")
    result = read(result_path)
    expected_skill = read(job / "skill-provenance.json")
    foundation = read(job / "foundation.json")
    errors = []

    def failure(code, field, **details):
        errors.append({"code": code, "field": field, **details})

    if not isinstance(result, dict):
        failure("expected-object", "result")
        result = {}
    if result.get("skill") != expected_skill:
        failure("skill-mismatch", "skill", expected=expected_skill, actual=result.get("skill"))
    if {tag["id"] for tag in foundation["tags"]} != TAGS:
        failure("unexpected-foundation-targets", "foundation.tags", expected=sorted(TAGS))
    charts = result.get("charts")
    if not isinstance(charts, list):
        failure("expected-array", "charts")
        charts = []
    for index, assigned in enumerate(assignment["charts"]):
        try:
            original_speed = normalize_playback_rate(assigned.get("playbackRate")) == 1
        except ValueError:
            original_speed = False
        if not original_speed:
            failure("unsupported-assignment-playback-rate", f"assignment.charts[{index}].playbackRate",
                    value=assigned.get("playbackRate"),
                    message="Whole-chart jobs support 1x assignments only. Use selected-section fine annotation for rate-specific assignments.")
    expected = {chart["sourceSha256"]: chart for chart in assignment["charts"]}
    source_counts = Counter(c.get("sourceSha256") for c in charts
                            if isinstance(c, dict) and isinstance(c.get("sourceSha256"), str))
    for sha in expected:
        if source_counts[sha] != 1:
            failure("source-coverage", "charts", sourceSha256=sha, expectedCount=1, actualCount=source_counts[sha])
    checked_charts = checked_claims = 0
    for index, chart in enumerate(charts):
        if not isinstance(chart, dict):
            failure("expected-object", f"charts[{index}]")
            continue
        sha = chart.get("sourceSha256")
        if not isinstance(sha, str) or sha not in expected:
            failure("unassigned-source", f"charts[{index}].sourceSha256", sourceSha256=sha)
            continue

        def chart_failure(code, field, **details):
            failure(code, field, sourceSha256=sha, chartIndex=index, **details)

        path = Path(expected[sha]["parquetPath"])
        if not path.is_absolute():
            path = job / path
        if digest(path) != expected[sha]["parquetSha256"]:
            chart_failure("parquet-hash-mismatch", "parquetSha256")
        table = pq.ParquetFile(path).read(columns=NOTE_COLUMNS)
        meta = json.loads(table.schema.metadata[b"beatmap_lens"])
        by_line = {note["source_line"]: note for note in table.to_pylist()}
        del table
        if meta["source"]["sha256"] != sha:
            chart_failure("parquet-source-mismatch", "sourceSha256", actual=meta["source"]["sha256"])
        selected_sections = assignment.get("coverageMode") == "selected-sections"
        targets = check_targets(expected[sha].get("targetRanges"), meta["range"], chart_failure) if selected_sections else None
        inspected = check_coverage(chart.get("inspectedRanges"), meta["range"], chart_failure, targets)
        if not nonempty(chart.get("discoverySummary")):
            chart_failure("discovery-summary-required", "discoverySummary")
        claims = chart.get("claims")
        if not isinstance(claims, list) or not claims:
            chart_failure("claims-required", "claims")
            claims = []
        claim_ids = set()
        for claim_index, claim in enumerate(claims):
            claim_id = claim.get("id") if isinstance(claim, dict) else None

            def claim_failure(code, field, **details):
                chart_failure(code, field, claimId=claim_id, claimIndex=claim_index, **details)

            if isinstance(claim_id, str):
                if claim_id in claim_ids:
                    claim_failure("duplicate-claim-id", "id")
                claim_ids.add(claim_id)
            check_claim(claim, by_line, claim_failure, inspected if selected_sections else None)
            checked_claims += 1
        check_questions(chart.get("questions"), claim_ids, chart_failure)
        checked_charts += 1
        del by_line
    return {"ok": not errors, "checkedCharts": checked_charts, "checkedClaims": checked_claims,
            "errorCount": len(errors), "errors": errors,
            "checkerSha256": digest(__file__), "assignmentSha256": digest(job / "assignment.json"),
            "resultSha256": digest(result_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("--result", type=Path, help="Read another result file without changing the job's result.json.")
    args = parser.parse_args()
    try:
        report = check(args.job, args.result)
    except (OSError, json.JSONDecodeError) as error:
        report = {"ok": False, "errorCount": 1, "errors": [{"code": "input-read-error", "message": str(error)}]}
    print(json.dumps(report, separators=(",", ":")))
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
