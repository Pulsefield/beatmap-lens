#!/usr/bin/env python3
"""Check the skill's maintained instruction budget without external dependencies."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
LIMITS = {
    "SKILL.md": (650, 5200),
    "references/judgment-guide.md": (1500, 12000),
}
TOTAL_LIMIT = (3500, 28000)


def main():
    total = [0, 0]
    failed = False
    for path in sorted(ROOT.rglob("*.md")):
        relative = path.relative_to(ROOT).as_posix()
        content = path.read_text(encoding="utf-8")
        counts = (len(content.split()), len(content))
        total = [a + b for a, b in zip(total, counts)]
        limit = LIMITS.get(relative)
        exceeded = limit and any(a > b for a, b in zip(counts, limit))
        failed = failed or bool(exceeded)
        suffix = f" (limit {limit[0]} / {limit[1]})" if limit else ""
        print(f"{'FAIL' if exceeded else 'OK'} {relative}: {counts[0]} words / {counts[1]} chars{suffix}")
    exceeded = any(a > b for a, b in zip(total, TOTAL_LIMIT))
    print(f"{'FAIL' if exceeded else 'OK'} all Markdown: {total[0]} words / {total[1]} chars "
          f"(limit {TOTAL_LIMIT[0]} / {TOTAL_LIMIT[1]})")
    return int(failed or exceeded)


if __name__ == "__main__":
    sys.exit(main())
