# Annotation performance

Agents read one normalized Parquet at a time through `scripts/annotation-facts.py`.
The single-file reader avoids loading the dataset/Pandas backend. It produces the
same source-time facts and does not construct a browser, SVG scene, or full workflow.
Human reviewers retain the complete Inspector and its source-backed evidence.

The local workspace stores immutable Foundation, task and source-byte objects once
in `.workflow-objects/`. Workflow files reference those objects. Canonical exports,
packet hashes, human decisions and conflict checks retain their original meaning.
Back up the **whole workspace**, including `.workflow-objects/`.

The service retains at most one full source. Inbox and machine feedback use compact
summaries, persisted beside the existing outbox and invalidated when the canonical
file changes. Unchanged feedback reads and warm restarts do not hydrate full tasks.
`GET /api/review/feedback/:sha` includes dispositions, provenance and exact human
modifications; the full human/source endpoints remain available.

Measurements on macOS, Node 24.13.0, Python 3.10.20 and PyArrow 22.0.0, 2026-09-05:

| Workload | Observed result |
| --- | --- |
| Nine existing workflow files, including shared objects | 374,600,157 → 945,836 bytes; all canonical hashes unchanged |
| Fact-reader overview of 17,892 notes | Peak RSS 113.6 → 73.8 MiB; 59,875 output bytes identical |
| Warm service with eight real sources and feedback reads | About 126–149 MiB RSS; zero full-source reads |
| Thirty-minute chart, repeated browser seeks | 2–147 rendered note elements from 17,892 notes; revisiting a position restores the same count |

The fact-reader figures include Python and library overhead. A separate staged
measurement put chart data, Python rows and attack grouping at about 20 MiB above
the warmed reader. These measurements are not Codex model/runtime memory.
The live service also restarted successfully with 80 registered sources; its RSS
after reading the inbox was about 145 MiB (a snapshot, not a measured peak).

**Cold validation and writes still have substantial peaks.** A real registration,
five-claim handoff and independent audit reached approximately 929 MiB service RSS
with a 256 MiB V8 heap limit; the separate controller client reached 627 MiB. A
384 MiB heap run reached about 1,093 MiB service RSS. No default heap cap was added:
earlier lower-cap attempts exhausted the heap, and heap limits do not bound total
RSS. The lightweight reader and warm-feedback results must not be presented as
measurements of these full canonical write operations.

The falling-note scene already uses a bounded time buffer. ReviewWorkspace also
uses the time index for evidence candidates and a per-source reference lookup for
selection, avoiding a full-chart scan on each seek. Boundary checks on 8,065 real
ranges preserved exact note membership and ordering, including entering holds.
Browser node counts verify virtualization, not frame time or browser heap usage.
