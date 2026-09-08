"""Prepare reproducible, chart-local facts for a frozen query-first worker job."""
import argparse
from collections import Counter, defaultdict
import gzip
import importlib.util
import io
import json
from pathlib import Path


# Worker snapshots carry the query tool alongside this preparer.
query_tool = Path(__file__).with_name("annotation-queries.py")
if not query_tool.is_file():
    query_tool = Path(__file__).resolve().parents[2] / "harness/annotation-queries.py"
spec = importlib.util.spec_from_file_location("annotation_queries", query_tool)
queries = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queries)
RULE_ID = "ln-coordination-requires-two-ln-columns-v1"
QUERY_NAMES = ("fixed-group", "alternation", "roll", "ln-events")
TOOL_NAMES = ("annotation-facts.py", "annotation-queries.py", "prepare-query-evidence.py")


def read(path):
    return json.loads(Path(path).read_text())


def maximum_ln_columns(notes):
    events = defaultdict(lambda: {"starts": [], "ends": []})
    for note in notes:
        if note["kind"] == "long":
            events[note["start_ms"]]["starts"].append(note["column"])
            events[note["end_ms"]]["ends"].append(note["column"])
    active = Counter()
    maximum = 0
    for time in sorted(events):
        # Half-open occupancy: an ending hold is no longer down at this instant.
        active.subtract(events[time]["ends"])
        active.update(events[time]["starts"])
        maximum = max(maximum, sum(count > 0 for count in active.values()))
    return maximum


def ln_rule(notes, meta, evaluated_range, foundation_sha, code_sha):
    maximum = maximum_ln_columns(notes)
    base = {"ruleId": RULE_ID, "foundationSha256": foundation_sha,
            "codeSha256": code_sha, "maximumSimultaneousLnColumns": maximum}
    complete = (evaluated_range == meta["range"]
                and len(notes) == meta["source"]["noteCount"])
    if not complete:
        return {**base, "outcome": "abstain", "reason": "Complete source range and note population are required."}
    if maximum >= 2:
        return {**base, "outcome": "abstain", "reason": "The necessary condition is possible; presence and salience require judgment."}
    return {**base, "outcome": "rule-label", "origin": "deterministic-query",
            "tagId": "ln-coordination", "scope": evaluated_range,
            "assessment": {"presence": "absent"},
            "rationale": "The complete source never has two distinct LN columns occupied simultaneously; the pinned necessary condition cannot be satisfied."}


def overview(notes, meta):
    bins = defaultdict(list)
    start, end = meta["range"]["startMs"], meta["range"]["endMs"]
    for row in queries.facts.attack_rows(notes):
        bins[(row[0] - start) // 20000].append(row)
    result = []
    for index, left in enumerate(range(start, end, 20000)):
        rows = bins[index]
        gaps = Counter(b[0] - a[0] for a, b in zip(rows, rows[1:]))
        result.append({"startMs": left, "endMs": min(left + 20000, end),
                       "attackRows": len(rows),
                       "chordArities": dict(Counter(len(ns) for _, ns in rows)),
                       "commonRowGapsMs": gaps.most_common(6),
                       "holdStarts": sum(n["kind"] == "long" for _, ns in rows for n in ns)})
    return result


def prepare(job, foundation_sha, enable_ln_rule=False):
    job = Path(job)
    tools = {name: queries.sha256_file(job / name) for name in TOOL_NAMES}
    index = {"version": 1, "foundationSha256": foundation_sha,
             "skill": read(job / "skill-provenance.json"),
             "toolHashes": tools, "queryVersion": queries.VERSION, "charts": []}
    target_dir = job / "query-evidence"
    target_dir.mkdir(exist_ok=True)
    for chart in read(job / "assignment.json")["charts"]:
        path = Path(chart["parquetPath"])
        if queries.sha256_file(path) != chart["parquetSha256"]:
            raise ValueError("Parquet differs from the frozen assignment")
        notes, meta = queries.facts.read_chart(path)
        if meta["source"]["sha256"] != chart["sourceSha256"]:
            raise ValueError("Parquet source differs from the frozen assignment")
        relative_path = f"query-evidence/{chart['sourceSha256']}.ndjson.gz"
        counts = {}
        with (job / relative_path).open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8") as output:
                    def emit(value):
                        output.write(json.dumps(value, separators=(",", ":")) + "\n")
                    emit({"record": "chart", "source": meta["source"], "range": meta["range"],
                          "parquetSha256": chart["parquetSha256"],
                          "foundationSha256": foundation_sha, "toolHashes": tools,
                          "queryVersion": queries.VERSION, "skill": index["skill"]})
                    for name in QUERY_NAMES:
                        count = 0
                        for match in queries.query_chart(name, notes, meta["range"]["startMs"], meta["range"]["endMs"]):
                            emit({"query": name, **match})
                            count += 1
                        counts[name] = count
                    emit({"record": "complete", "queryCounts": counts})
        rules = [ln_rule(notes, meta, meta["range"], foundation_sha,
                         tools["prepare-query-evidence.py"])] if enable_ln_rule else []
        index["charts"].append({
            "sourceSha256": chart["sourceSha256"], "range": meta["range"],
            "noteCount": len(notes), "overview": overview(notes, meta),
            "queryCounts": counts, "evidencePath": relative_path,
            "evidenceSha256": queries.sha256_file(job / relative_path),
            "ruleLabels": [rule for rule in rules if rule["outcome"] == "rule-label"],
            "ruleAbstentions": [rule for rule in rules if rule["outcome"] == "abstain"],
        })
    (job / "query-index.json").write_text(json.dumps(index, separators=(",", ":")) + "\n")
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("--foundation-sha", required=True)
    parser.add_argument("--ln-coordination-requires-two-columns", action="store_true")
    args = parser.parse_args()
    index = prepare(args.job, args.foundation_sha, args.ln_coordination_requires_two_columns)
    print(json.dumps({"preparedCharts": len(index["charts"]), "queryIndex": "query-index.json"}))


if __name__ == "__main__":
    main()
