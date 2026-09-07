# Selecting valuable annotation sections

Pulsefield V3 needs trustworthy, partly observed section-style labels. Read its
canonical `../Pulsefield-model/docs/formulation/gameplay-state.md` together with
its README: there is currently no executable V3 evaluator, calibrated demand scale,
or model uncertainty signal. The initial selector is a reproducible retrieval
heuristic. Its score is neither style truth nor model error.

## One inspection, five dimensions

Use an episode, rather than a single target, as the annotation unit. Inspect the
complete arrangement and its entry/exit once, then consider Jack, Stream, Trill,
Tech and LN coordination independently. Keep one `sectionId` for related claims.
Use the same scope when supported; split actual changes of organization instead
of forcing co-occurrence across a broad crop. Each dimension has its own evidence,
presence and strength. An inspected negative is useful supervision; an omitted
or unresolved dimension is masked, never interpreted as negative.

Reuse an exact current human assessment at its original scope, identifying its
record in `discoverySummary`. Add only the missing judgments. Human descriptions
naming another style do not automatically give it a presence or strength label.
A complete dimension pass means every dimension was considered, including an
honest reason for unresolved/unreviewed cells; it does not mean five positives.

The [labeler](agent-roles/query-corpus-labeler.md) and
[auditor](agent-roles/query-corpus-auditor.md) use 2–4 short bullets per rationale,
normally at most 80 words. Describe what repeats or flows, what disrupts it, and
why the dimension fits. Keep source references and calculations structured. The
submitted bullets and references must contain decisive audit evidence; an analysis
sidecar unavailable to the auditor cannot carry the only explanation. The Inspector
preserves newlines in these notes. Historical proposals and human prose are retained.

## Current selector

Run from this checkout with the existing PyArrow environment:

```sh
../Pulsefield-model/.venv/bin/python scripts/annotation-priorities.py \
  --campaign .local/corpus-500-v2 \
  --out .local/annotation-priorities-next \
  --batch-size 24 --seed 20260907
```

The output directory must be new. This reads current service feedback for registered
workspace sources and writes derived files only; it does not dispatch workers,
submit labels, resume a stopped campaign, or rewrite frozen inputs. For reproducible
reranking, pass `--feedback-dir PREVIOUS_OUTPUT/feedback`. A snapshot is per source,
captured over the recorded time interval, not an atomic snapshot of a live workspace.

Outputs:

- `report.md` and `quality.json` (`annotation-priorities-v2`): corpus and per-chart
  coverage, group coverage, review states, deduplicated strength counts, human
  conflicts, open issues with selected/pending identities, and provenance.
- `queue.json`: selected scopes, surrounding context, missing dimension fractions,
  candidate kind, repair issue IDs, feature values, component scores and closest
  human correction identities.
- `candidates.jsonl`: the complete ranked pool for inspection and comparison.
- `feedback/`: the exact source-bound canonical feedback used for this run.
- `assignment.proposed.json`: selected ranges and original Parquet hashes, ready
  for a new section job's preparation. This is not a frozen task or a submission.

There are two candidate kinds. **Repair** targets use the complete original scopes
of current `needs-expert` / `needs-revision` claims, including scopes longer than
20 seconds. Overlapping issue scopes on the same source are merged into one target
that fully contains every attached issue. Identity includes source SHA, handoff ID
and claim ID, so similar claims from different handoffs stay traceable. A single
issue cannot occupy two adjacent queue slots. A repair's review context contains
both the usual two-second padding and every original issue's review context,
clipped to chart bounds. The issue records preserve status, expert reason/question
and matching audit results so preparation can recover the concrete problem without
rereading the full feedback snapshot.

**Discovery** candidates are 10-second windows with a 5-second stride, plus existing
reviewed scopes up to 20 seconds. Generated clipped grid tails shorter than half
the nominal window are omitted; a whole-chart window remains when the entire
chart is shorter than that threshold. Exact reviewed scopes and repair scopes
retain their original lengths. Exclude every window overlapping an open issue,
even if that issue's repair was not selected. Empty discovery windows are excluded;
entering holds remain visible. Windows locate inspection targets, not automatic
semantic cuts. The labeler may expand context and split or refine semantic episodes.

The weights remain explicit, unvalidated experimental choices. They are not a
measured estimate of expected annotation benefit or value per unit cost:

| Component | Weight | Meaning |
| --- | ---: | --- |
| Feedback similarity | 0.30 | Nearby human-modified/rejected examples from a different source |
| Open review | 0.25 | A repair target contains a current issue, or human judgments conflict |
| Missing dimensions | 0.20 | Mean fraction of the five scoped targets lacking usable labels |
| Structural rarity | 0.10 | Inverse square-root frequency of the candidate's coarse feature stratum |
| Chart coverage gap | 0.10 | Mean missing per-dimension coverage on its source chart |
| Local demand proxy | 0.05 | Mean corpus percentile of NPS and peak half-second attacks |

Similarity uses mean absolute distance between empirical feature ranks, falling
linearly to zero at distance 0.25. Features include LN-head share, occupied hold
time, release relationships, recurrence, rhythm variation and scope duration;
a short all-LN crop should not look identical to mixed tapping over a long passage.
Similarity excludes all correction examples from the candidate's own source. This
prevents settled corrections from earning perfect error-transfer scores by matching
themselves. It retrieves comparisons, not transferable human labels. A correction's
own scope may still be selected for its missing dimensions through `dimensionGap`;
its settled human cell is reused.

For a 24-section batch, reserve five slots for seeded exploration. Use up to ten
of the remaining nineteen slots for repairs, ordered by the same experimental
score, separately from discovery's mapset and feature-stratum caps. Fill the
remaining priority slots with discovery candidates. Across priority discovery and
exploration, cap both source-group and coarse feature-stratum contributions at two;
repair selections do not consume those caps. No selected targets overlap on one
source. Report every unselected issue ID explicitly instead of silently dropping it
behind a diversity cap. Selection may return fewer than requested if eligible
discovery candidates are exhausted. Keep the seed, weights and complete pool for
comparisons. Seeded exploration checks blind spots; this constrained sample is not
an unbiased corpus-accuracy estimate.

## Mina-inspired facts, separate semantic judgments

[`section-features.py`](../scripts/section-features.py) measures local attacks,
sliding 500 ms peaks, hand imbalance, same-column timing, chord shares, recurrence,
ABAB structure, rhythm variation, and LN occupancy/releases. Counts use exact
half-open scopes and full source hold endings. The feature-only rhythm histogram
groups gaps differing by at most 1 ms; source rows and semantic cuts stay unchanged.

The reference is Mug-Diffusion's `scripts/prepare_beatmap_features.py::get_ett_scores`
and `scripts/MinaCalc-1.0.tar.gz` in the sibling repository. Its wrapper sends sorted
attack `(ms, column)` pairs and returns eight difficulty ratings. It omits LN
releases and occupancy. Cropping also resets stamina/context and requires rebased
time; a crop rating is not additive song difficulty. This implementation borrows
measurement ideas without copying the calculator or presenting its output as a
calibrated Mina rating. Numerical demand is separate from section-style strength.

## Coverage and dataset quality

Coverage uses interval unions per exact source SHA and target, clipped to the chart
range. Witness-note fraction, selected context, repeated submissions and number of
accepted charts do not define coverage. A long LN-absence claim can cover a chart
for one target while leaving the other four almost entirely unlabeled.

Report human, current independently reviewed machine-only, and combined usable
labels separately. Count only present/absent judgments. Read a modification's exact
replacement scope/assessment and its human decision rationale; the original
summary and retained evidence prose may describe the rejected interpretation.
Keep human decisions after unrelated base changes. Exclude stale machine claims,
superseded proposals, unresolved/unreviewed judgments, rejection and deferral.

Human intervals take precedence over overlapping machine-only intervals for this
report. Contradictory overlapping human assessments are listed and removed from
usable coverage; there is no automatic latest-human-wins rewrite of canonical data.
Review-state counts describe persisted claims, not deduplicated training examples.

Measure both elapsed-time coverage and note-start coverage. Time uses the full Lens
range, including leading silence; note-start coverage includes tap/LN heads but
does not pretend to measure release coverage. Report any-dimension coverage,
all-five intersection, and each dimension separately, per chart and globally.
Strength counts deduplicate equal source/target/scope/assessment tuples after
human clipping; split remnants are distinct scopes, not independent examples.
Full-chart discovery declarations remain in campaign status and are not inferred
from this section report.

By default, group by BeatmapSetID and call the result **mapset coverage**. One set
is not necessarily one song. For song coverage, provide `--song-groups FILE.json`,
a complete object mapping source SHA to a curated song ID. The report hashes that
mapping, counts groups reached, and aggregates chart-time within each song; it does
not assume multiple difficulties share an aligned timeline. Use the same song
identity for train/calibration/test separation. Metadata titles alone should not
silently merge remixes or editions.

## Preparing and evaluating the next pass

Keep the current campaign's frozen workers and user-stop state. Prepare new jobs
from the proposed assignment, fetch fresh task bindings and human feedback, and
freeze the revised skill, roles and checker with new provenance. Preserve original
source bytes and complete chart context. `coverageMode: "selected-sections"` asks
the checker to verify `targetRanges`; its default still requires the entire chart.
Use the public `annotation-workflow.mjs handoff` / `audit` / `submit` commands
for these bounded jobs. The existing `campaign-exchange.mjs` and whole-chart
dispatcher still require full discovery; do not feed this proposed section
assignment to that dispatcher. Section dispatch and completion accounting are
a separate integration from this read-only selector and section preflight.
Route new immutable claims and independent audits through the public exchange;
explicit supersession is required when replacing previous machine proposals.

For a bounded 24-section pilot, inspect whether the priority arm finds more
corrected or newly settled dimension judgments per review minute than the
exploration arm. Record which scopes changed, unresolved reasons, dimensional
coverage gained and selection strata reached. Retain easy positive/negative
contrasts so the dataset does not become only ambiguities. Report calibration
replay separately from held-out semantic accuracy.

Evaluate skill changes separately from selection changes. The
[`run-section-benchmark.py`](../scripts/run-section-benchmark.py) runner executes
prepared, frozen jobs in fresh ephemeral CLI processes and retains input hashes,
producer IDs, requested model/effort, raw events, wall time and token usage. Give
old and new skill arms identical evidence and output contracts. Score only exact
human-labeled dimensions; report presence and strength separately, keeping missing
gold predictions in the denominator. Additional predictions without human labels
measure completeness or repeat consistency, not accuracy. Keep entire known
mapsets and calibration-exposed sources out of the evaluation pool; record any
remaining author exposure. API-equivalent cost estimates must include actual cache
usage and remain distinct from subscription billing. Pre-extracted section timing
does not measure discovery, independent audit, or human review time. A shorter
guide or a passed exposed replay alone is insufficient evidence of improvement.

When actual V3 predictions exist, pin their model/checkpoint and source/scope
alignment; add per-dimension calibrated error or independent-model disagreement
as a measured component. Compare it against this fixed heuristic and a separate
random evaluation sample. Do not substitute density for uncertainty or report
training-exposed human corrections as held-out model performance.

The selection tests require PyArrow. Run them with the prepared runtime:

```sh
../Pulsefield-model/.venv/bin/python -m unittest discover -s scripts -p 'test_annotation_priorities.py'
../Pulsefield-model/.venv/bin/python -m unittest discover -s scripts -p 'test_section_features.py'
../Pulsefield-model/.venv/bin/python scripts/test_annotation_result.py
pnpm check:skill
```
