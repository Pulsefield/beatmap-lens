# Context control in section annotation

Fresh worker sessions prevent history from accumulating across annotation jobs.
They do not establish that the context within each job is short enough to preserve
judgment quality. Inspection of the September 9–10, 2026 expansion found working
session isolation, but also repeated guidance and bulky auditor claim views.

## Observed execution

The expansion assigns 500 fixed sections from 179 new native 4K charts to three
chart-disjoint coordinators. Coordinators supervise dispatch and do not provide
their conversation history to the actual labelers or auditors. Each coordinator
allows two concurrent model workers. Labelers use `gpt-6-astra` with medium
reasoning; a different actual producer audits each sealed batch with high
reasoning. The Foundation, skill and both roles are frozen for this campaign.

There are 127 initial labeler jobs: 122 contain four sections, three contain three,
one contains two, and one contains one. Commands use fresh ephemeral sessions with
user configuration ignored and no resume operation. A snapshot of 26 completed
labelers and 24 completed auditors found a distinct single thread ID per worker.
A separate inspection of 16 completed workers in one shard also found no reuse
of conversation history between jobs.
After initial delivery completed, full verification confirmed 254 distinct actual
producer identities and worker threads across all 127 labeler and 127 auditor
jobs. This expands the isolation check; the text-size measurements below still
describe the earlier snapshot.

Grouping targets a 28,000-character source-brief cap, allowing a single dense
section to exceed it. Prepared labeler briefs have a median of 13,450 characters
and a maximum of 39,343. This cap excludes other prompt and tool content and is
therefore not a total-context budget.

## Size and duplication

Frozen prompts contain approximately 31,000 characters, including the skill and
judgment guide. Workers nevertheless reread approximately 13,600 characters of
that guidance. Auditor handoffs are pretty-printed JSON: in the completed snapshot,
the median file size is 60,924 characters and the maximum is 78,516. Auditors
commonly read this file and then print the claims again in compact form. The
separate shard inspection observed repeated claim reading in all eight auditors
it checked, without a full source-task or cases dump.

The following diagnostic adds prompt text, completed command and MCP text outputs,
and agent messages across each worker's visible transcript:

| Role | Median characters | 95th percentile | Maximum |
| --- | ---: | ---: | ---: |
| Labeler | 78,045 | 88,215 | 89,256 |
| Auditor | 177,426 | 200,735 | 206,355 |

These are cumulative visible-text proxies, **not measured peak context tokens**.
They exclude system instructions, tool schemas and hidden reasoning. Event logs
also do not establish exactly what text survived output truncation. Cumulative
input-token usage repeatedly counts shared history across inference calls; it
cannot substitute for a peak measurement. No exposed compaction event was found
in the inspected shard, but this event schema does not prove that compaction
never occurred.

## Interpretation and next comparison

Cross-job isolation is mechanically supported. The stronger assertion that the
controls eliminate quality degradation is untested. Auditor input has avoidable
duplication, the grouping cap omits later tool and claim text, and no matched
single-section versus four-section quality comparison has been completed.

A future candidate should compact handoff serialization, avoid duplicate guide
reads while retaining the evidence, and budget the full input with room for later
tools and audit claims. Record per-request context usage when the runtime exposes
it. Compare identical fixed sections under single-section and four-section jobs,
using repeated fresh runs, counterbalanced order and unchanged guidance. Include
dense evidence and difficult semantic boundaries. Assess correctness against
protected expert cases separately from model agreement.

A [factual repair pass](annotation-scale.md) using single-section jobs is not this
controlled experiment: those sections are selected because an auditor already
found a problem, and the workers receive the audit feedback. Shorter prompts alone do not
pass the repository's semantic regression gate. Prepared campaign jobs must remain
unchanged while a new candidate is evaluated.
