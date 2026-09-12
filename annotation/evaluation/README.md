# Annotation regression gate

The active gate automatically protects **every current effective human observation
whose confidence is explicitly `high`**. Historical observations without confidence
are unspecified and excluded; `low` observations are excluded. The canonical Review
workspace is the authority. A cached feedback export cannot establish current gold.

The previous `cases.json`, `accepted-evidence.json`, `source-baseline.json`, and
`feedback-tuning-20260910/` files retain their historical meanings. The
[2026-09-10 calibration report](../../docs/research/human-feedback-skill-tuning.md)
describes that earlier comparison. Static cases and accepted receipts are never a
fallback for the active automatic selection.

## Selection and identity

`read-current-human-feedback.mjs` uses the same `WorkflowDirectoryV2` and
`effectiveHumanObservationsV2` as Inspector. It reads plain or packed canonical
workflow documents without writing them and checks that the document inventory and
bytes stayed unchanged during the snapshot. Revision resolution happens before
confidence filtering: lowering or withdrawing a current observation removes its old
High judgment even though append-only history remains on disk.

The generated suite pins canonical document revisions/hashes and all contributing
observation IDs/hashes, Foundation hashes, and exact human scopes, rates, and review
contexts. Source/scope/tag/playback-rate duplicates count once; omitted playback
rate and explicit 1x identify the same cell. Equal independent judgments retain all
human identities. Conflicting independent current High judgments fail explicitly.
Tags sharing a source/scope/rate share a worker section; its bounded review context
is the union of the contributing human contexts. Every gold cell is protected.

Zero usable High gold fails explicitly. Missing campaign sources, unsupported High
judgments, and incompatible High Foundation identities also fail; they are never
silently omitted. Gold edits remain human decisions, never a way to make a candidate
pass.

## Freeze once, prepare both sides

Install dependencies with `uv sync --locked` and the project pnpm environment. The
canonical reader uses the installed Inspector/Vite runtime. Freeze the complete
current pool **once for a baseline/candidate pair**:

```sh
uv run --locked python annotation/evaluation/run_regression.py freeze \
  --workflow-dir /path/to/review-workspace \
  --out /path/to/local-comparison/suite.json
```

`--workflow-dir` names the workspace root containing `workflow/`. The new suite has
a unique comparison ID and cannot overwrite an existing suite. Keep it outside
worker jobs. Both sides must use this exact file, even if human review continues
while workers run. A changed canonical pool requires a new suite and both new sides
before acceptance.

Run the current evaluator for both sides, selecting the adopted and candidate
production checkouts with `--source-repo`. Use the same suite, campaign, example
snapshot, and model settings, with distinct output roots:

```sh
uv run --locked python annotation/evaluation/run_regression.py prepare \
  --root /path/to/local-comparison/baseline \
  --source-repo /path/to/adopted-checkout \
  --suite /path/to/local-comparison/suite.json \
  --campaign /path/to/campaign \
  --feedback-dir /path/to/example-feedback
```

For the candidate, change `--root` to the candidate output directory and
`--source-repo` to the candidate checkout. The selected checkout owns the production
preparer, skill, roles, harness tools, and execution runtime. Its imports run in an
isolated adapter process; candidate guidance is never copied into the baseline.
This also works when the adopted checkout still has the historical static evaluator.
The current common evaluator is fingerprinted separately and must be identical on
both sides; production source fingerprints identify their respective checkouts.
`run` automatically reuses the recorded source checkout and verifies its sources
before launch. Keep both checkouts unchanged through preparation and execution.

Preparation makes three independent repeats through the actual production
`prepare_job`, prompt, role, skill, runtime, and bounded section packing. Each job
uses the selected production checkout's section limit and brief packing target;
a single complete dense section may exceed that target, as in production. No source
context is truncated to fit a budget. Preparation does not launch model workers.

The evaluation harness excludes every target source and its known song group from
human-example retrieval. Target gold, confidence, review records, and prior repair
questions remain outside worker inputs. Calibration examples are removed from the
worker Foundation. The frozen suite stays in the controller root; worker bindings
contain only its opaque hash. Ordinary skill guidance remains visible, so this is
exposed regression testing. Filesystem access outside the job is forbidden by the
production instructions rather than an OS read sandbox.

The following command consumes model usage; run it separately for each side:

```sh
uv run --locked python annotation/evaluation/run_regression.py run \
  --root /path/to/local-comparison/baseline --concurrency 3
```

Evaluation never invokes production delivery or changes canonical human records.

## Review and acceptance

```sh
uv run --locked python annotation/evaluation/regression_gate.py compare \
  --baseline /path/to/local-comparison/baseline \
  --candidate /path/to/local-comparison/candidate \
  --out /path/to/local-comparison/evidence.json
```

The first comparison writes v2 evidence embedding the frozen suite and exits nonzero
until reviewed. It verifies frozen worker inputs, source/Foundation/harness bindings,
completed output receipts, source sections and rates, independent producers, equal
model settings, and at least three complete repeats on each side. Both sides must
use the exact same suite and underlying source/example data. Every protected cell
must match its exact human assessment in every candidate repeat, including cells
where the baseline was wrong. Aggregate improvements cannot hide individual losses.

Copy the generated `review` object into a review file, retaining its
`comparisonSha256`, and fill in a named source-evidence and rationale review:

```json
{
  "comparisonSha256": "copy from the generated evidence",
  "reviewer": "reviewer name",
  "rationaleReview": "Source facts and explanations checked, including remaining limits.",
  "regressions": {}
}
```

Run `compare` again with `--review /path/to/review.json`. A review of older outputs
cannot be rebound to new receipts. Label agreement alone cannot pass, and a review
disposition cannot override a protected failure. Check the reviewed evidence against
both current annotation sources and the canonical human workspace:

```sh
uv run --locked python annotation/evaluation/regression_gate.py check \
  --evidence /path/to/local-comparison/evidence.json \
  --workflow-dir /path/to/review-workspace
```

The check rebuilds the current canonical pool and compares it to the embedded frozen
suite. Changed confidence, judgments, observation identity, document revision, or
workspace inventory invalidates stale evidence. There is no default evidence file,
static corpus fallback, reset, or unconditional acceptance command.

An unchanged annotation source snapshot still passes without private datasets or
model calls. `pnpm check:regression` is separate from engineering `pnpm check` and
human dataset publication. A changed judgment source requires fresh evidence;
missing evidence is not a pass. Set `ANNOTATION_REGRESSION_BASE` or `--base-ref` to
the actual CI base commit and fetch that history. The checker computes sources from
that tree, so replacing `source-baseline.json` cannot erase a change in the same
commit. An all-zero first-push base uses the historical initial source snapshot.

This gate covers selected-section labeler behavior, not whole-chart discovery or
independent audit quality. Direct auditor, discovery, selected-workflow controller,
and Foundation changes still fail with explicit unsupported coverage until their
own replay adapters exist. Historical experimental benchmark reports do not approve
current changes.

Deterministic verification (no model calls):

```sh
uv run --locked python -m unittest discover -s annotation/evaluation/tests
```
