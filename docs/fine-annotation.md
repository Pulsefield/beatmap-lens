# Fine annotation with the optional harness

The whole-chart corpus dispatcher and its frozen workers are separate from fine
section annotation. `run-fine-annotation.py` prepares new source-bound selected
section jobs from a priority queue and its matching annotation-mode harness bundle.
It freezes the current skill and approved Foundation definitions without changing
historical workers or human decisions.

```sh
.local/annotation-harness-venv/bin/python scripts/run-fine-annotation.py prepare \
  --root .local/fine-annotation-next \
  --queue .local/annotation-priorities-next/queue.json \
  --bundle .local/annotation-harness-next
.local/annotation-harness-venv/bin/python scripts/run-fine-annotation.py run \
  --root .local/fine-annotation-next --concurrency 5
.local/annotation-harness-venv/bin/python scripts/run-fine-annotation.py status \
  --root .local/fine-annotation-next
```

Each fresh ephemeral labeler receives at most five sections, with a 28,000-character
source-brief grouping limit. A single longer section stays intact and can exceed
that limit. Complete attack context and entering holds are preserved. The shared
role, skill, guide and Foundation prefix remain identical within each role; raw
source evidence is read once from the brief, with optional progressive harness
inspection. Each completed batch goes to a separate fresh auditor. Its compact claim view uses
source-line references into the complete brief; exact sealed task and handoff files
remain frozen alongside it. On the initial batch, this removes 85.2% of repeated
claim-view JSON characters without changing the source evidence or canonical packets. Context is
never extended indefinitely across batches. Actual input/cache/output tokens and
worker durations remain in `run.json` and aggregate `progress.json`; a shared
prefix permits reuse but does not guarantee a cache hit rate.

A derived queue may declare `selectionFocus.tag: "tech"` in its adjacent
`quality.json`. Preparation freezes that focus into labeler and auditor prompts:
spend inspection effort on Tech rhythm, articulation, and strength comparisons,
while independently judging all five dimensions. Candidate selection never
supplies a predicted label or positive quota.

Workers produce judgments only. The controller binds source references to fresh
canonical tasks, preserves current human cells, seals proposals and obtains an
independent audit before public exchange delivery. Exact settled duplicates are
reused; conflicting or changed review states are surfaced for coordinator review.
Replacing a pending machine claim requires explicit supersession. Selected-section
coverage does not establish whole-chart completion. A repair requiring new semantic
boundaries remains explicit rather than forcing a positive across unrelated rows.

`--labels-only` runs prepared labelers without sealing or submitting. Running the
same root normally afterward uses the completed labeler results for audit and
delivery, retaining their actual producer identity and frozen evidence.

## Recurring target

The `fine-annotation-campaign.py` controller tracks a target across section batches.
`status` refreshes canonical feedback for registered source/scope units;
`advance` runs one unfinished or new batch under a campaign lock. The current
configuration targets 4,000 sections and uses 25-section rounds, five concurrent
workers, and at most five sections per worker. The final source-brief grouping cap
is 28,000 characters, including human and repair records.

```sh
.local/annotation-harness-venv/bin/python scripts/fine-annotation-campaign.py advance \
  --root .local/fine-annotation-4000
```

Completion requires settled coverage in all five dimensions across each actual
registered section. Human precedence, source identity, current machine status and
open review issues are checked again from canonical feedback. Previously attempted
scopes are excluded from new selection to prevent repeated unresolved work and
closely overlapping samples. A new batch freezes the latest local skill and harness;
a resumed batch retains its original hashes. The controller stops new dispatch at
the target, on exhausted eligible selection, or on an execution/delivery error that
needs inspection. Partial semantic sections stay visible without blocking unrelated
new sections.

The first 24-section trial used fresh labelers and independent auditors: all ten
workers completed, with 2,747,453 aggregate input tokens, 2,172,032 cached input
tokens (79.1%), and 37,844 output tokens. These cumulative request counts are not
peak context sizes. The measurements support retaining five-section jobs; they do
not establish a universal optimal batch size or semantic accuracy.
