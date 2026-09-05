"""Query exact chart structure; matches are facts, never semantic annotations.

Complete-row repetition and disjoint A/B alternation are maximal within the
requested range, regardless of speed or gaps. Repeated-subset selects explicit
columns present in every consecutive full attack row, retaining extra notes;
it never skips intervening rows. Fixed-group still requires identical full rows.
Four singleton-row rolls retain unequal
source gaps as candidates; no snapping, tolerance, or quantization is applied.
LN events distinguish equal-time releases from holds continuing strictly across
the event. Bounds are source-ms half-open evidence extents, not section claims.

Reads one chart through annotation-facts.py and streams NDJSON: provenance,
matches, then completion. No match does not establish a semantic negative.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path


HELPER_PATH = Path(__file__).with_name("annotation-facts.py")
spec = importlib.util.spec_from_file_location("annotation_facts", HELPER_PATH)
facts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(facts)
QUERIES = ("fixed-group", "repeated-subset", "alternation", "roll", "ln-events")
VERSION = 2


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def refs(notes):
    return [{"sourceLine": n["source_line"], "column": n["column"],
             "kind": n["kind"], "startMs": n["start_ms"], "endMs": n["end_ms"]}
            for n in notes]


def columns(row):
    return tuple(sorted(n["column"] for n in row[1]))


def row_match(rows, start, end, holds):
    selected = rows[start:end]
    gaps = [b[0] - a[0] for a, b in zip(selected, selected[1:])]
    return {
        "record": "match",
        "bounds": {"startMs": selected[0][0], "endMs": selected[-1][0] + 1},
        "rows": [refs(notes) for _, notes in selected],
        "rowGapsMs": gaps,
        "literalEqualSpacing": len(set(gaps)) == 1,
        "previousRow": refs(rows[start - 1][1]) if start else [],
        "nextRow": refs(rows[end][1]) if end < len(rows) else [],
        "enteringHolds": refs(entering_holds(holds, selected[0][0])),
    }


def row_queries(query, rows, start_ms, end_ms, holds, selected_columns):
    first = next((i for i, row in enumerate(rows) if row[0] >= start_ms), len(rows))
    limit = next((i for i in range(first, len(rows)) if rows[i][0] >= end_ms), len(rows))
    groups = [columns(row) for row in rows]
    i = first
    while i < limit:
        if query == "fixed-group":
            end = i + 1
            while end < limit and groups[end] == groups[i]:
                end += 1
            if end - i >= 2:
                yield {**row_match(rows, i, end, holds), "columns": list(groups[i])}
            i = end
        elif query == "repeated-subset":
            core = set(selected_columns)
            if not core.issubset(groups[i]):
                i += 1
                continue
            end = i + 1
            while end < limit and core.issubset(groups[end]):
                end += 1
            if end - i >= 2:
                notes = [note for _, row in rows[i:end] for note in row]
                yield {
                    **row_match(rows, i, end, holds),
                    "selectionRule": {
                        "kind": "persistent-columns-consecutive-attack-rows",
                        "columns": sorted(core), "allowsRowSkipping": False,
                    },
                    "selectedNoteRefs": refs(n for n in notes if n["column"] in core),
                    "incidentalNoteRefs": refs(n for n in notes if n["column"] not in core),
                }
            i = end
        elif query == "alternation":
            if i + 3 < limit and not set(groups[i]) & set(groups[i + 1]):
                end = i + 2
                while end < limit and groups[end] == groups[i + (end - i) % 2]:
                    end += 1
                if end - i >= 4:
                    yield {**row_match(rows, i, end, holds),
                           "groups": [list(groups[i]), list(groups[i + 1])]}
                    # A different alternating run may share this final row.
                    i = end - 1
                    continue
            i += 1
        else:
            sequence = groups[i:i + 4]
            if i + 4 <= limit and sequence in (
                    [(0,), (1,), (2,), (3,)], [(3,), (2,), (1,), (0,)]):
                yield {**row_match(rows, i, i + 4, holds),
                       "direction": "ascending" if sequence[0] == (0,) else "descending"}
            i += 1


def entering_holds(notes, start_ms):
    return [n for n in notes if n["kind"] == "long"
            and n["start_ms"] < start_ms < n["end_ms"]]


def ln_events(notes, rows, start_ms, end_ms):
    attacks = {time: ns for time, ns in rows if start_ms <= time < end_ms}
    releases = defaultdict(list)
    active = {}
    for note in notes:
        if note["kind"] != "long":
            continue
        if start_ms <= note["end_ms"] < end_ms:
            releases[note["end_ms"]].append(note)
        if note["start_ms"] < start_ms <= note["end_ms"]:
            active[note["source_line"]] = note
    for time in sorted(attacks.keys() | releases.keys()):
        ending = releases[time]
        for note in ending:
            active.pop(note["source_line"])
        continuing = list(active.values())
        heads = attacks.get(time, [])
        starting = [n for n in heads if n["kind"] == "long"]
        for note in starting:
            active[note["source_line"]] = note
        if ending or starting or (continuing and heads):
            yield {
                "record": "match",
                "bounds": {"startMs": time, "endMs": time + 1},
                "attacks": refs(heads),
                "releases": refs(ending),
                "continuingHolds": refs(continuing),
                "heldAfter": refs(active.values()),
            }


def query_chart(query, notes, start_ms, end_ms, selected_columns=()):
    rows = facts.attack_rows(notes)
    if query == "ln-events":
        yield from ln_events(notes, rows, start_ms, end_ms)
    else:
        holds = [note for note in notes if note["kind"] == "long"]
        yield from row_queries(query, rows, start_ms, end_ms, holds, selected_columns)


def parse_columns(value):
    try:
        selected = tuple(sorted({int(column) for column in value.split(",")}))
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use comma-separated zero-based columns, e.g. 0,1.") from error
    if not selected or not set(selected).issubset(range(4)):
        raise argparse.ArgumentTypeError("Columns must be between 0 and 3.")
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", choices=QUERIES)
    parser.add_argument("parquet", type=Path)
    parser.add_argument("--start-ms", type=int)
    parser.add_argument("--end-ms", type=int)
    parser.add_argument("--columns", type=parse_columns,
                        help="Required for repeated-subset: comma-separated core, e.g. 0,1; no row skipping.")
    parser.add_argument("--skill-file", type=Path, action="append", required=True,
                        help="Hash each supplied skill/guide file; repeat for referenced files.")
    args = parser.parse_args()
    if (args.query == "repeated-subset") != (args.columns is not None):
        parser.error("--columns is required for repeated-subset and only applies to that query.")
    notes, meta = facts.read_chart(args.parquet)
    if meta["source"]["keyCount"] != 4:
        parser.error("This structural prototype supports the prepared 4K charts only.")
    start = args.start_ms if args.start_ms is not None else meta["range"]["startMs"]
    end = args.end_ms if args.end_ms is not None else meta["range"]["endMs"]
    if not start < end:
        parser.error("--start-ms must precede --end-ms.")

    def emit(value):
        print(json.dumps(value, separators=(",", ":")))

    emit({
        "record": "query", "query": args.query, "version": VERSION,
        "source": meta["source"], "parquetSha256": sha256_file(args.parquet),
        "querySha256": sha256_file(__file__), "helperSha256": sha256_file(HELPER_PATH),
        "skillFiles": [{"path": str(path), "sha256": sha256_file(path)}
                       for path in args.skill_file],
        "range": {"startMs": start, "endMs": end},
        **({"columns": list(args.columns)} if args.columns is not None else {}),
        "enteringHolds": refs(entering_holds(notes, start)),
    })
    count = 0
    for match in query_chart(args.query, notes, start, end, args.columns or ()):
        emit(match)
        count += 1
    emit({"record": "complete", "matches": count})


if __name__ == "__main__":
    main()
