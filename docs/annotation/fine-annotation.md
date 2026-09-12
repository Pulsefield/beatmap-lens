# Fine annotation with the optional harness

Selected-section annotation follows whole-chart discovery in the main workflow.
The two stages use separate dispatchers and coverage checks.
`run-fine-annotation.py` prepares new source-bound selected-section jobs from a priority queue and its matching annotation-mode harness bundle.
It freezes the current skill and approved Foundation definitions for the new jobs
while preserving current human decisions.
Targets can specify `playbackRate` for [rate-specific annotation](playback-rate.md).
Queue and frozen bundle rates must agree; scopes remain original source ms.

```sh
uv run --locked python annotation/pipeline/run-fine-annotation.py prepare \
  --campaign .local/campaign \
  --python .venv/bin/python \
  --root .local/section-annotation \
  --queue .local/section-priorities/queue.json \
  --bundle .local/section-harness
uv run --locked python annotation/pipeline/run-fine-annotation.py run \
  --root .local/section-annotation --concurrency 5
uv run --locked python annotation/pipeline/run-fine-annotation.py status \
  --root .local/section-annotation
```

## Worker mounting protocol

All selected-section execution uses `annotation_runtime.run_job`, either through
the batch controller or its single-job CLI. A parent or native dispatcher starts
that runtime; the resulting Codex worker is the actual labeler or auditor.

1. Prepare 1–4 selected windows for one labeler. `--max-sections` may reduce this
   limit, never raise it. Preparation and the runtime both enforce four; runtime
   counts the actual `cases.json` assignments and checks the recorded `caseCount`.
2. Invoke the runtime on that frozen job. It verifies input hashes and assignment
   counts, configures the job's lens MCP server and evidence trace, and starts a
   fresh worker using `--ignore-user-config --ephemeral`. It sends `prompt.txt`
   unchanged, including the frozen `ROLE.md`, thin skill, and Foundation once.
   Do not add parent analysis, remembered example verdicts, global role prose, or
   another skill copy. Native `spawn_agent` may dispatch this command with
   `fork_turns="none"`; it does not perform semantic labeling or audit itself.
3. Finish that batch, then use a new worker for further windows. Audit it with a
   separate fresh producer following the same four-window cap and frozen auditor
   role. Do not turn a labeler's accumulated conversation into its audit context.

To execute one already prepared labeler or auditor job:

```sh
uv run --locked python annotation/annotation_runtime.py \
  --job .local/section-annotation/runs/labeler-001 \
  --config .local/campaign/controller/config.json
```

This uses the same execution and recorded producer identity as batch dispatch.
The parent returns the job result for the controller's normal sealing and delivery.
It must not submit native-agent prose as a worker response or run the same prepared
job concurrently with a batch dispatcher; a nonblocking per-job lock rejects a
second owner before execution. Existing completed jobs are reported
without relaunch; failed or running jobs are left for controller inspection.

The 28,000-character source-brief target includes human and repair records. A
single longer section stays intact in its own batch and can exceed that target.
It is not a full-context or token cap: instructions, claims, tool results, and
reasoning add context. Preserve complete attack context and entering holds; use
progressive source/example inspection when a judgment needs it. Four windows is
a conservative execution bound, not a measured performance-degradation threshold.

The stable role, skill, and Foundation prefix precedes variable job details.
Source evidence is read once from the brief. The auditor's compact claim view uses
source-line references into the complete brief; exact sealed task and handoff files
remain frozen alongside it. Compact claims avoid repeating source evidence already
present in the brief. Actual input/cache/output tokens and
worker durations remain in `run.json` and aggregate `progress.json`; a shared
prefix permits cache reuse without conversation reuse, but does not guarantee a
cache hit rate. Do not edit historical frozen jobs to install these instructions.
Previously running or completed jobs retain their inputs and outputs; prepared
jobs above the current cap require new bounded preparation before launch. For an
older recurring controller, set its mutable `config.json` `maxSections` to 4 or
less before preparing a new batch; this does not change its existing frozen jobs.

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

The frozen Foundation input may be a canonical document or a worker projection
with an embedded `foundationSha256`. For both labelers and auditors, delivery
checks the task against the campaign pin and compares every supplied Foundation
field with the task, including all required definitions. An embedded pin must
also match. Recovery reuses completed responses and their unchanged input hashes;
do not edit a frozen document to add a missing embedded pin.

When a labeler splits one case across response records, the controller groups its
disjoint judgment fragments in memory before the existing five-dimension checks.
Duplicate tags, missing dimensions, and wrong or missing cases still block sealing.
The raw response, its recorded hash, frozen inputs, and worker identity remain
unchanged. Auditor response records still require unique case IDs.

`--labels-only` runs prepared labelers without sealing or submitting. Running the
same root normally afterward uses the completed labeler results for audit and
delivery, retaining their actual producer identity and frozen evidence.

A provider usage-limit failure stops new worker dispatch for that invocation.
Active workers finish and their results are retained; queued jobs stay prepared,
including audits prepared from those finishing labelers. Run the same root again
when capacity is available to continue queued work. Failed attempts remain visible
for controller inspection and are never automatically relaunched under their old
producer identities; retained failures do not stop a later invocation.

## Recurring target

The `fine-annotation-campaign.py` controller tracks a target across section batches.
`status` refreshes canonical feedback for registered source/scope units;
`advance` runs one unfinished or new batch under a campaign lock. The target is
configured for the campaign.
The controller uses 25-section rounds, five concurrent workers, and at most four
sections per worker. The source-brief grouping target is 28,000 characters,
including human and repair records, with the intact-singleton exception above.

```sh
uv run --locked python annotation/pipeline/fine-annotation-campaign.py advance \
  --root .local/section-campaign --campaign .local/campaign --target 100
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
