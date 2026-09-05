# Structural queries before semantic inference

Use this reference when constructing pattern queries or choosing how to perform
weak annotation. The first prototype is a small factual helper, not a pattern DSL,
new model architecture, or automatic replacement for the human-approved dataset.
The intended annotation order is **deterministic rules, then agents for abstentions,
then the expert for remaining semantic questions**. Rules should ultimately output
presence and salience directly where approved conditions suffice; zero false
positives is the acceptance requirement, not an accuracy claim for this prototype.

## What the query establishes

Read one chart's Parquet at a time. Group attacks with the exact same source-ms
timestamp into a row; retain every note's column, kind, end, and source line.
Preserve LN tails and entering holds even when the candidate uses only attack
order. Return the source identity, a half-open range, raw intervals, and witnesses.

| Query | Exact structural evidence | Semantic limit |
| --- | --- | --- |
| Fixed group | Consecutive complete attack rows use the same column set; report row count and gaps. | A useful Jack candidate. Extra chord keys break this narrow query even if a repeated subset remains a clear jack. Fast-only filtering would miss the reviewed 400 ms Jack positive. |
| Repeated subset | Selected core columns recur on consecutive attack rows; extra simultaneous notes remain visible. | Keeps a long-jump-jack core through decorative chords. Pure disjoint A/B alternation cannot be projected onto one side to create Jack. |
| Alternation | Two fixed disjoint sets repeat A–B–A–B, with any group arity; report all gaps. | Covers the approved Drill shape, including crossed pairs. Four rows are a query search minimum, not an approved presence or prominence threshold. |
| Four-note direction | Four consecutive singleton rows traverse all four columns in one direction; report gaps and literal equality. | Direction alone is a candidate. Equal spacing completes the local roll shape; unequal integer gaps require a declared timing derivation or calibrated interpretation. Roll prominence does not imply Stream prominence. |
| LN events | Presses/releases and complete holds continuing across each timestamp, including holds entering the window. | LN coordination requires at least two LN-occupied columns at some point, but that condition is not sufficient. Regular handoffs and tiny overlaps can be semantic negatives. |

The standalone prototype in the checkout is `scripts/annotation-queries.py`.
For example, using the project's Python with PyArrow installed:

```sh
python scripts/annotation-queries.py alternation CHART.parquet \
  --start-ms 259802 --end-ms 260766 \
  --skill-file skills/mania-pattern-judgment/SKILL.md \
  --skill-file skills/mania-pattern-judgment/references/judgment-guide.md \
  --skill-file skills/mania-pattern-judgment/references/structural-queries.md
```

Use `fixed-group`, `roll`, `ln-events`, or `repeated-subset --columns 0,1` for the other queries. Output is NDJSON:
provenance, structural records, then a completion count. It makes no style decision
and does not submit to the human inbox. It does not construct the full Inspector
workflow document, source SVGs, or multiple charts in memory.

Exact means exact under the stated query. Do not hide an epsilon, merge nearby
chords, discard an intervening row, or convert a source-ms near-match into equality.
When reporting a timing-grid derivation, name its anchor, beat subdivision, rounding
rule, and residuals separately from source facts. The expert accepts osu's 1 ms
quantization: harmless rounding differences do not require a perfect grid proof or
another expert review. The literal-equality flag remains a factual output, not a
semantic veto. Do not silently introduce broad tolerance or merge attack events.

Matches can end because the inspected window ends, rather than because the pattern
ends. Inspect the surrounding attack rows before promoting a match range to a
semantic episode. A query boundary is not automatically the expert's section cut.

## Selection and counterevidence

The evidence selector may take only some notes from a crop. Declare which notes
were selected, how they satisfy the relation, and what the remaining notes do.
For example, `repeated-subset --columns 0,1` keeps the two-key core of a long jump
jack through extra chord keys. It requires that core on every consecutive attack
row and retains incidental notes; it does not silently delete an intervening row.
This is one narrow executable selector, not a universal ban on row selection.
The expert requires judging continuity from the dominant structure: an inserted
row may be part of chordjack/quadstream or a mini-section boundary. Future selectors
may admit intervening rows only with explicit contextual checks. For the current
helper, an intervening row that breaks the core ends that exact match; any proposal
to join the pieces needs agent review. Do not turn this conservative split into a
negative semantic label.

A positive witness search alone cannot meet the zero-false-positive requirement.
Also check possible disqualifiers in the original sequence. Selecting only A out
of A↔B Drill is the important countercase: the selected subsequence repeats, but
the full arrangement is pure Drill and explicitly Jack absent. Entering LN holds,
intervening rows, simultaneous extra keys, rhythm resets, and group changes must
remain available. If the rule cannot establish whether unused notes change the
pattern, abstain and pass the candidate plus counterevidence to an agent.

Apply salience to the supported local organization, not the fraction of selected
notes in an arbitrarily wide crop. The expert defined strength as expression of
the target style, including typicality; a fixed note-count or selected-note ratio
does not supply that meaning by itself.

## Small experimental target set

Retain **Jack organization, Stream organization, Tech, LN coordination** and add
**Drill organization**. The expert approved Drill as sustained alternation of two
fixed non-overlapping groups, with single keys or chords and same-hand or cross-hand
arrangements. This does not create targets for every chord size or compound name.
Keep roll direction/count, minijack extent, chord size, and attack rate as evidence.
Drill presence requires consideration of speed and sustained extent; four alternating
attacks are not a sufficient semantic rule. A pure fixed disjoint Drill episode
does not imply Jack from each column's periodic return. Three consecutive roll
groups establish prominent roll structure, without automatically establishing
prominent Stream.

Each coordinate has its own presence and strength. A source can contain several
successive episodes, or support more than one coordinate in a shared scope. Do not
force a five-class softmax, infer positives by taxonomy, or fill query-uncovered
dimensions with negatives. Community tags still describe a different whole-chart
target system.

## Inference budget follows the question

1. **No model for facts.** Reuse the query output to count rows, check witnesses,
   measure intervals, and trace occupancy. Source verification should be mechanical.
2. **Deterministic rules for weak labels.** The cheapest annotation stage should
   emit a concrete presence/salience when sufficient approved conditions and
   contextual exclusions are satisfied. Precision takes priority over coverage:
   unsupported cases abstain rather than receive a guessed label. At first, the
   helper implements the factual substrate; semantic sufficient conditions are
   still being calibrated. Do not report this as a finished salience annotator.
3. **A lighter agent for bounded contextual questions.** Supply one candidate,
   neighboring rows/holds, the applicable definition, and relevant counterexamples.
   Evaluate this route before replacing existing annotation; do not assume it
   matches a stronger model's accuracy or that their agreement proves correctness.
4. **A stronger agent or expert for unresolved semantics.** Use a stronger model for
   complex composition, boundary disputes, and Tech/LN interpretation that the
   narrow routes cannot settle. Ask the human only when a concrete semantic
   boundary remains or for an explicit quality sample.

This is a routing proposal, not a new background campaign. Do not launch paid
model comparisons, restart workers, or change model settings just by reading it.
The stopped campaign's independent-auditor contract stays historical; the query
prototype does not impersonate an agent or create `agent-reviewed` records.

## What must be measured before batch use

First replay the reviewed counterexamples: crossed-pair Drill versus Stream,
slow Jack versus speedjack, roll presence versus Stream strength, and real LN
occupancy versus rejected LN coordination. These are calibration regressions, not
held-out accuracy results. Then evaluate new sections split by beatmapset, with
overlapping crops kept together and training/calibration exposure recorded.

Measure **precision among emitted labels**, **coverage/abstention**, scope errors,
and strength errors separately for each query-to-target mapping. Include similar
densities with different arrangements, varied rates, mixed boundaries, and
unscreened windows. Do not claim high accuracy from four hand-picked fixtures or
turn all old machine-reviewed claims into human truth. A query with modest coverage
can still be useful if its emitted labels are reliable; broaden it only when the
new counterexamples justify the change.

Keep provenance small: source/Parquet identity; query name, version, code hash and
parameters; the exact skill/reference hashes used; and, if an agent interprets it,
the actual model/producer and separate interpretation. Retain human decision ID,
scope, assessment, and rationale for calibration. A query code update cannot
silently change the provenance of older weak labels.
