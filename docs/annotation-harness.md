# Annotation harness

The harness gives section labelers and independent auditors additional source
context, inspectable human examples, and a defined player-action perspective.
Agents start with a compact section brief and call tools only when another fact or
representation can improve the judgment. The skill retains semantics; deterministic
tools expose observations. This separation keeps the instruction budget bounded
while allowing difficult Tech and salience cases to receive deeper inspection.

Use [the harness labeler role](agent-roles/harness-labeler.md) and
[the harness auditor role](agent-roles/harness-auditor.md) for newly prepared jobs.
The existing corpus campaign and its frozen roles remain unchanged. Harness tools
are read-only; normal claim validation, independent audit, and exchange submission
remain separate from inspection.

## Tool contract

All section tools accept `section_id`. Source ranges are half-open milliseconds;
columns are zero-based. Optional `start_ms` and `end_ms` expand or narrow inspection
inside the chart, without silently changing the assigned claim scope.

| Tool | Use when needed | Bounded result |
| --- | --- | --- |
| `chart_context` | Clarify chart metadata, active tempo/SV, or neighboring arrangement. | Eight arrangement bins, neighboring attack rows, and timing changes with `timing_offset=0`, `timing_limit=12` (maximum 32); follow `timingChanges.nextOffset` for more. Annotation mode also supplies overlapping human judgments. |
| `inspect_section` | Read missing attack rows or exact press/release/continuing-hold events. | `view="rows"` or `"actions"`; `offset=0`, `limit=32`, maximum 64 events; explicit coverage and next offset. |
| `section_perspective` | Reconsider organization or expression strength through player actions. | Whole-scope counts, selected recurrence/pulse/articulation examples, and interpretation questions. |
| `query_structure` | Test a specific structural hypothesis. | `fixed-group`, `repeated-subset`, `alternation`, `roll`, or `ln-events`; default three previews, maximum six. Only `repeated-subset` accepts `columns`. |
| `find_human_examples` | Compare a difficult target or strength distinction. | Default `tag_id="tech"`, three cards, maximum six; optional `assessment`, keyword `text`, and `offset`. |
| `get_human_example` | Read one useful card's exact human rationale and provenance. | One record with a reusable `example:…` section ID; notes remain behind inspection tools. |
| `render_section` | See spatial organization or articulation. | One PNG page, `view="time"` or `"rows"`, zero-based `page`; explicit page count and view conventions. |

`find_human_examples` interleaves absent, supporting, and prominent examples using
stable ordering. Assessment filters accept those three labels or `present`.
Keywords match human rationale and available title/difficulty metadata. Cards
truncate rationale at 280 characters and mark truncation. Ranking by structural or
semantic relevance is deferred; an early card is not necessarily the closest match.
Search never returns note arrays or the full calibration ledger.

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

Time-proportional images preserve source-time distances. Row images align attack
and release events with compressed spacing, so they expose arrangement while
distorting rhythm. Both preserve LN identity, visible release endpoints, and
continuations across page boundaries. Neither rendering substitutes for unseen
pages when a claim requires complete local evidence.

## Frozen preparation and execution

The preparer reads a campaign source map and Parquets, verifies original source
bytes, and copies normalized chart data, exact human examples, and tool code into
a new bundle. Its manifest pins source, feedback, Foundation, and file provenance.
The section input accepts either a `sections` or `cases` array, with
`sourceSha256`, `scope`, and optional `reviewContext`; supply stable `sectionId` or
`caseId` values. The job launcher supplies the frozen skill/Foundation, role,
compact section brief, and output schema alongside the bundle.

When both IDs exist, `caseId` is the tool handle. Handles must be unique across
the whole job: source-local names such as `whole-source` can recur on other songs.

Install the pinned runtime into a local environment before preparing a bundle:

```sh
uv venv .local/annotation-harness-venv --python python3.10
uv pip install --python .local/annotation-harness-venv/bin/python \
  -r scripts/requirements-annotation-harness.txt
```

```sh
.local/annotation-harness-venv/bin/python scripts/prepare-annotation-harness.py \
  --campaign .local/corpus-500-v2 \
  --sections /ABS/sections.json \
  --feedback-dir /ABS/feedback-snapshot \
  --out /ABS/new-harness-bundle \
  --mode annotation
```

Use a Python environment with `pyarrow` for preparation and structural-query code,
`mcp` for the stdio server, and `Pillow` for PNG views. Launch the frozen copied
server, using the job's own command configuration; no global MCP configuration
needs modification. For example, these Codex overrides apply only to this run:

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
the human decision's rationale remains exact, even if it only confirms the original
proposal. Rejected, deferred, unresolved, superseded, and machine-only reviews do
not become human labels. Direct observations retain their own rationale and
Foundation provenance. Describing another style in prose does not label that
dimension.

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
bundle, not alteration of a running job.

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
.local/annotation-harness-venv/bin/python scripts/prepare-harness-benchmark.py \
  --design /ABS/administrative-evaluation-design.json \
  --root /ABS/new-benchmark
.local/annotation-harness-venv/bin/python scripts/run-harness-benchmark.py run \
  --root /ABS/new-benchmark
```

`report` regenerates results without launching workers. Reports separate exposed
regression cases from fresh probes, sparse human accuracy from repeat consistency,
and measured time/tokens from assumed API-equivalent cost. The job's filesystem
read boundary is instructed; source/song exclusions are enforced inside retrieval.
Review command traces for boundary violations before interpreting a run.

Run the Python suite with the pinned environment:

```sh
.local/annotation-harness-venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
pnpm check:skill
```

## Design basis

The small reusable tool set and explicit execution boundary follow
[OpenAI's practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf).
Small discoverable responses, expandable examples, and evaluation-driven tool
iteration apply the guidance in
[Anthropic's writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
and [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
The particular player-action view and payload limits are this repository's design
choices and should change only when real inspection/evaluation results justify it.
