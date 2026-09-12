# Annotation harness

For open reading studies, use the [natural beatmap learning entry](beatmap-learning.md),
which adds complete chart and sibling discovery, community observations, and
revisable reading experience. That path excludes agent-only section labels from
learning evidence and does not dispatch annotation jobs.

The harness gives section labelers and independent auditors additional source
context, inspectable human examples, and a defined player-action perspective.
Agents start with a compact section brief and call tools only when another fact or
representation can improve the judgment. Foundation pins semantics; the thin skill
guides reading and reference use, while deterministic tools expose observations.
This separation keeps the instruction budget bounded
while allowing difficult Tech and salience cases to receive deeper inspection.

Use [the harness labeler role](../../annotation/roles/harness-labeler.md) and
[the harness auditor role](../../annotation/roles/harness-auditor.md) for newly prepared jobs.
Harness tools are read-only; normal claim validation, independent audit, and exchange submission
remain separate from inspection.

## Tool contract

All section tools accept `section_id`. Source ranges are half-open milliseconds;
columns are zero-based. Optional `start_ms` and `end_ms` expand or narrow inspection
inside the chart, without silently changing the assigned claim scope.
Targets may also freeze a `playbackRate`; see [playback-rate annotation](playback-rate.md)
for performance-time fields, example-rate filters, and source-coordinate rules.

| Tool | Use when needed | Bounded result |
| --- | --- | --- |
| `chart_context` | Clarify chart metadata, active tempo/SV, or neighboring arrangement. | Eight arrangement bins, neighboring attack rows, and timing changes with `timing_offset=0`, `timing_limit=12` (maximum 32); follow `timingChanges.nextOffset` for more. Annotation mode also supplies overlapping human judgments. |
| `inspect_section` | Read missing rows, press/release/continuing-hold events, or LN head/tail relationships. | `view="rows"`, `"actions"`, or `"articulation"`; `offset=0`, `limit=32`, maximum 64 rows/events; explicit coverage and next offset. |
| `section_perspective` | Reconsider organization or expression strength through player actions. | Whole-scope counts, selected recurrence/pulse/articulation examples, and interpretation questions. |
| `query_structure` | Test a specific structural hypothesis. | `fixed-group`, `repeated-subset`, `alternation`, `roll`, or `ln-events`; default three previews, maximum six. Only `repeated-subset` accepts `columns`. |
| `find_human_examples` | Find references for a particular presence or strength question. | Default `tag_id="tech"`, three cards, maximum six; filters `assessment`, `confidence`, `key_count`, `note_kind`, `playback_rate`, literal `text`, and `contrast_set`; follow `nextOffset`. Cards include title/difficulty and scoped source facts. Counts expose available confidence and missing label contrasts. |
| `get_human_example` | Open a useful reference and its exact human comment. | Source identity, scope, assessment, optional `humanConfidence`/`humanComment`, and independently derived `sourceFacts`, with a reusable `example:…` section ID. |
| `render_section` | See spatial organization or articulation. | One PNG page, `view="time"` or `"rows"`, zero-based `page`; explicit page count and view conventions. |

`find_human_examples` interleaves the matching absent, supporting, and prominent
examples using stable ordering. Assessment filters accept those three labels or
`present`. Every keyword must occur literally in substantive human comments or available
title/difficulty metadata. `matchedAssessmentCounts` and `missingContrastLabels`
describe all matching records before pagination, not just the current cards.
Filters can produce one-sided results, with a `contrastCaveat`; absent positive
examples in a search do not establish style absence. Search does not add unrelated
cards when keywords match only one side or nothing.

Start from the actual uncertainty: which dimension, presence or strength, and which
construction needs comparison. Select a small page using the known key count,
playback rate, and relevant source facts; prefer explicit High-confidence references
when available. Use human-text keywords when useful, but remove them if comments
do not name the relationship. Compare the available sides of the disputed decision
and open promising references with source inspection. Broaden filters after a miss;
do not fill the context with the bank or treat the first card as the closest match.

`confidence="high"`, `"low"`, or `"unspecified"` filters the human's recorded
confidence, independently of presence and strength. Omission searches all three.
`humanConfidence` appears only when explicitly recorded; old records are not
silently classified as Low or High. `availableConfidenceCounts` counts the eligible
tag/rate/source-fact/contrast-set pool before assessment, text, and confidence
filters. `matchedConfidenceCounts` counts all final matches before pagination.

`sourceFacts` is computed once from the frozen source for each exact human scope.
It contains `keyCount`, `attackRowCount`, `tapCount`, `longNoteHeadCount`,
`enteringHoldCount`, and `chordSizeCounts` as `[chord size, attack row count]` pairs.
These are tool observations, not human explanations or inherited selected evidence.
`note_kind="with-ln"` includes any scoped LN head or hold entering the scope;
`"tap-only"` requires at least one tap and no such LN. Empty scopes are reported
as `noteKind="empty"`, never tap-only. `key_count` filters the source key count.
Counts preserve short LNs and all chord members without assigning pattern labels,
playable roles, or semantic similarity. Inspect the ordered source relationships
before using a comparison; the counts cannot establish that two passages are alike.

`availableContrastSets` supplies the few available curated comparisons by ID
and `assessmentCounts`/`confidenceCounts`, without curation descriptions or member IDs.
These counts respect the requested tag, rate, source-fact filters, and evaluation
exclusions, before assessment/text/confidence filters. Pass a discovered ID as
`contrast_set` to intersect its membership with
the normal filters. Set membership is a curated comparison aid, not an automatic
structural or style ranking, and a set may have missing labels after exclusions.
Open useful cards through `get_human_example` and compare their actual scoped
relationships through source inspection when needed.

Human-only examples are a universal harness contract across every dimension and
annotation/evaluation mode. Stored `examples.json`, retrieval helpers, MCP/CLI
responses, corpus worker feedback and generated section briefs use the same
field allowlist. `public_example(record, comment_chars=None)` exposes identity,
source/scope, the final human assessment, optional explicit `humanConfidence` and
`humanComment`, and separately named source facts when prepared by the harness.
Full records and annotation-mode `existingHumanJudgments` preserve
the exact human comment. Cards limit it to 280 characters and report
`humanCommentTruncated`. Blank comments, slash-only placeholders, and the generated
“Human confirmed the original proposal.” supply no substantive comment; their
judgments still appear without a comment. Machine rationale is never substituted.
Agent comments, evidence, proposals, audits, task/handoff provenance, and arbitrary
extra record fields do not appear in these views or their keyword search. Chart
title/difficulty remain available for identity lookup.

Canonical feedback retains its original human rationale and administrative
provenance outside worker example views. Stored harness examples contain the
public judgment/confidence/comment, source facts, and group/title/difficulty identity
used for filtering. Extraction never copies source facts from an agent claim;
preparation derives them from the complete normalized source notes.
Callers supply extracted human records or their earlier public projections, never
machine proposals. An unattributed `rationale` is not a human comment. Source rows
remain independently inspectable through the returned `example:…` handle.
Ranking by structural or semantic relevance is deferred; an early card is not
necessarily the closest match. Search never returns note arrays or the full ledger.

`inspect_section(view="articulation")` keeps the same complete attack rows and
full source note references as `rows`, including taps and every chord member.
Each row adds `nextAttackGapMs` and compact LN facts, described by
`lnArticulationSchema`: duration in milliseconds and tempo-integrated beats,
the number of distinct attack rows strictly between head and tail, release
position (`at-attack`, `between-attacks`, or `after-last-attack`), columns pressed
at release, and other columns whose holds continue strictly across release.
Facts link to the full note references by `sourceLine`. Entering holds, including
those entering a later page, keep their full references and corresponding facts.

These relationships use the whole source span of each returned LN, even when its
head or tail is outside the requested crop. The next-attack gap also uses the
source's next row; `null` means there is no later source attack. Pagination still
covers only attack rows in the half-open requested scope. Use `actions` when the
complete release-event timeline matters. No duration, speed, ratio, or overlap
threshold assigns a playable role or style. Compare the ordered relationships
with human examples to judge whether a release supplies a separate control role
or follows through a brief attack; the tool preserves every LN as an LN.

## The additional perspective

`section_perspective` defines the view as **player-action relationships**. At each
source timestamp it distinguishes presses, releases, and holds continuing strictly
across that timestamp. It then describes three observable aspects:

- **Press organization:** complete-group recurrence, fixed disjoint exchange, and
  persistent columns with changing surrounding presses.
- **Pulse:** exact attack gaps and selected adjacent gap changes, with distances in
  beats integrated through tempo changes. SV does not change beat duration.
- **Articulation:** simultaneous press/release events and presses or releases while
  other holds continue.

The tool asks what familiar organization explains the passage, whether changes
interrupt that organization or belong to it, and which human comparisons would
clarify its expression. These are investigation prompts. No count, threshold,
highlighted change, or LN overlap supplies a Tech verdict. Summary examples omit
interior events; inspect them if they become decisive evidence.

Time-proportional images preserve performance-time distances at the assigned rate
(source-time distances at 1×). Row images align attack
and release events with compressed spacing, so they expose arrangement while
distorting rhythm. Both preserve LN identity, visible release endpoints, and
continuations across page boundaries. Neither rendering substitutes for unseen
pages when a claim requires complete local evidence.

## Frozen preparation and execution

The preparer reads a campaign source map and Parquets, verifies original source
bytes, and copies normalized chart data, exact human examples, and tool code into
a new bundle. Its manifest pins source, feedback, Foundation, and file provenance.
It also snapshots [the curated human sets](../../.agents/skills/mania-pattern-judgment/references/human-contrast-sets.json)
as `contrast-sets.json`, retaining only eligible example IDs and dropping empty
sets. The manifest pins both the original catalog hash (`contrastSetsSha256`) and
the filtered snapshot hash. `--contrast-sets` can supply another small curated
catalog with shape `{"sets":[{"id":"…","description":"…","exampleIds":["human-…"]}]}`.
Keep descriptions short and about the comparison, without source or example IDs.
Source/song exclusions apply before memberships, counts, or descriptors reach the
worker bundle or tools. Keep the inputs of an active job fixed.
The section input accepts either a `sections` or `cases` array, with
`sourceSha256`, `scope`, and optional `reviewContext` and `playbackRate`; supply stable `sectionId` or
`caseId` values. The job launcher supplies the frozen skill/Foundation, role,
compact section brief, and output schema alongside the bundle.

When both IDs exist, `caseId` is the tool handle. Handles must be unique across
the whole job: source-local names such as `whole-source` can recur on other songs.

Prepare the locked project environment from the repository root before creating
a bundle:

```sh
uv sync --locked
```

```sh
uv run --locked python harness/prepare-annotation-harness.py \
  --campaign .local/campaign \
  --sections /ABS/sections.json \
  --feedback-dir /ABS/feedback-snapshot \
  --out /ABS/new-harness-bundle \
  --mode annotation
```

The locked environment supplies `pyarrow` for preparation and structural queries,
`mcp` for the stdio server, and `Pillow` for PNG views. Launch the frozen copied
server, using the job's own command configuration; no global MCP configuration
needs modification. In the example below, `/ABS/PYTHON` is the absolute path to
this checkout's `.venv/bin/python`; these Codex overrides apply only to this run:

```sh
codex exec --ignore-user-config -C /ABS/JOB --skip-git-repo-check \
  -c 'mcp_servers.beatmap_lens.command="/ABS/PYTHON"' \
  -c 'mcp_servers.beatmap_lens.args=["/ABS/BUNDLE/tools/annotation-harness.py","--bundle","/ABS/BUNDLE","--trace","/ABS/JOB/tool-trace.jsonl"]' \
  -c 'mcp_servers.beatmap_lens.required=true' \
  'Read the supplied role, frozen skill/Foundation, section brief and output contract. Use harness tools only when needed to complete the assigned judgments.'
```

For a controller smoke check, `--call TOOL --arguments JSON` returns compact JSON
without starting MCP. A CLI `render_section` call may use `--image-out PATH` to
save its PNG. A trace records tool arguments, elapsed time, response size, repeated
calls, failures, and image identity. Tracing is optional and writes only the requested log.

## Human authority and evaluation

Annotation mode exposes current settled human observations and accepted/modified
decisions. Modified scopes and assessments replace the old proposal interpretation;
the public view contains the final assessment and optional substantive human
comment. Internal extraction preserves original decision text and each direct
observation's Foundation provenance. Rejected, deferred, unresolved, superseded,
and machine-only reviews do not become human labels. Describing another style
in prose does not label that dimension.

Corpus worker feedback, bindings and audit-package human judgments use this same
boundary. Rejected/deferred decisions remain separate human dispositions with no
inherited style assessment. Actual machine proposals being audited remain audit
inputs, and never become human examples. Worker Foundation views omit inherited
calibration examples while preserving the canonical Foundation binding. Benchmark
gold is resolved from its pinned human decision and checked against the exact
source, scope and assessment; design prose cannot supply a human comment.

Evaluation mode physically removes every target source and its entire group from
the example library before the worker sees it. Retrieval and direct example lookup
also enforce these exclusions. Default groups are mapsets; `--song-groups` accepts
a complete source-SHA-to-song-ID map when multiple mapsets share one song.
Target source notes remain inspectable. The worker receives no target human answer
from the harness.

This boundary does not make previously exposed skill examples fresh evaluation
data. Keep calibration replays separate from held-out results, exclude related
sources already shown in prompts/skills, and hide evaluator gold outside worker
inputs. Frozen feedback is a snapshot: refreshing human corrections requires a new
bundle, not alteration of a running job. Preparation consumes `--feedback-dir` as
supplied; it does not refresh that directory from the review service. When an
experiment claims to use the latest human feedback, first fetch the relevant
`/api/review/feedback/:sourceSha256` responses and verify their `documentVersion`
against canonical workflow revisions and hashes. Freeze those responses before
preparing both comparison arms. A historical snapshot remains valid for a declared
historical comparison, but its internal consistency does not establish freshness.
Changing the calibration pool requires a matched baseline using that pool.

Compare fixed evidence, optional inspection, and inspection plus example retrieval
under the same skill, scopes, and model settings. Measure presence and exact
salience agreement only where human reference labels exist; report missing dimensions
separately. Record elapsed time, tokens/cache usage, tool and image use, repeated
calls, and human review effort. Tools make a hypothesis testable; their existence
does not establish that Tech recognition improved.

Human judgments are reviewable reference evidence. A disagreement calls for
checking the source, scope, reasoning, and human decision; it does not establish
which judgment is wrong. Keep human records intact during evaluation and record
proposed corrections separately. Adopt a harness on useful measured gains and
sound reasoning, without making 100% label reconstruction its objective.

The paired benchmark scripts prepare one fixed-evidence worker and two independent
harness workers under the campaign's configured labeler model and effort. Each
gets identical complete compact rows, definitions, and a five-dimension response
schema. The administrative design contains gold and stays outside worker folders.
The harness arms additionally receive the optional inspection role and MCP access.

```sh
uv run --locked python annotation/evaluation/prepare-harness-benchmark.py \
  --campaign .local/campaign \
  --design /ABS/administrative-evaluation-design.json \
  --root /ABS/new-benchmark
uv run --locked python annotation/evaluation/run-harness-benchmark.py run \
  --campaign .local/campaign \
  --root /ABS/new-benchmark
```

`report` regenerates results without launching workers. Reports separate exposed
regression cases from fresh probes, sparse human accuracy from repeat consistency,
and measured time/tokens from assumed API-equivalent cost. The job's filesystem
read boundary is instructed; source/song exclusions are enforced inside retrieval.
Review command traces for boundary violations before interpreting a run.

Run the Python suite with the pinned environment:

```sh
uv run --locked python scripts/test-python.py
pnpm check:skill
```

The [regression gate](../../annotation/evaluation/README.md) governs candidate updates.
Labeler replay does not, by itself, validate whole-chart discovery or auditor behavior.

## Design basis

The small reusable tool set and explicit execution boundary follow
[OpenAI's practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf).
Small discoverable responses, expandable examples, and evaluation-driven tool
iteration apply the guidance in
[Anthropic's writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
and [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
The particular player-action view and payload limits are this repository's design
choices and should change only when real inspection/evaluation results justify it.
