"""Read chart facts for annotation workers; this helper assigns no semantic labels."""
import argparse
from collections import Counter, defaultdict
import json

import pyarrow.parquet as pq


def read_chart(path):
    table = pq.ParquetFile(path).read()
    return table.to_pylist(), json.loads(table.schema.metadata[b"beatmap_lens"])


def attack_rows(notes):
    groups = defaultdict(list)
    for note in notes:
        groups[note["start_ms"]].append(note)
    return sorted(groups.items())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["overview", "rows"])
    parser.add_argument("parquet")
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument("--bin-ms", type=int, default=20000)
    args = parser.parse_args()
    notes, meta = read_chart(args.parquet)
    if args.command == "overview":
        print(json.dumps({"source": meta["source"], "range": meta["range"], "timingPoints": meta["timingPoints"]}))
        for start in range(meta["range"]["startMs"], meta["range"]["endMs"], args.bin_ms):
            end = min(start + args.bin_ms, meta["range"]["endMs"])
            rows = attack_rows([n for n in notes if start <= n["start_ms"] < end])
            gaps = Counter(b[0] - a[0] for a, b in zip(rows, rows[1:]))
            overlap = sum(bool({n["column"] for n in a[1]} & {n["column"] for n in b[1]}) for a, b in zip(rows, rows[1:]))
            print(json.dumps({"range": [start, end], "attackRows": len(rows), "chordArities": dict(Counter(len(ns) for _, ns in rows)), "commonRowGapsMs": gaps.most_common(6), "adjacentRowsSharingColumns": overlap, "holdStarts": sum(n["kind"] == "long" for _, ns in rows for n in ns), "enteringHolds": sum(n["start_ms"] < start < n["end_ms"] for n in notes)}))
    else:
        start = args.start if args.start is not None else meta["range"]["startMs"]
        end = args.end if args.end is not None else meta["range"]["endMs"]
        print(json.dumps({"range": [start, end], "enteringHolds": [n for n in notes if n["start_ms"] < start < n["end_ms"]]}))
        for time, ns in attack_rows([n for n in notes if start <= n["start_ms"] < end]):
            print(f"{time}: " + " ".join(f"c{n['column']}/L{n['source_line']}" + (f"→{n['end_ms']}" if n['kind'] == 'long' else "") for n in ns))


if __name__ == "__main__":
    main()
