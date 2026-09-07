# Pattern evidence profiles

- Status: Deferred by the user on 2026-09-06; no new semantic thresholds or labels approved
- Date: 2026-09-05

The expert suggested replacing binary queries with a scorer that tolerates
unexpected notes and reports several dimensions. The seven-chart query-first
pilot also exposed an independent problem: a worker paired some scopes with notes
and descriptions from another episode. Fixing source references is necessary,
but does not solve fuzzy pattern recognition. On 2026-09-06 the user deferred this
design and authorized immediate 500-chart annotation with GPT-6 Astra under the
existing V2 Foundation and skill, reusing expert golden feedback. This proposal
does not gate that campaign. Original tasks and results remain unchanged.

## Keep exact facts; soften interpretation

Use **Pattern Analyzer** for the overall component. Exact structural queries
remain useful internal tools. A scorer describes support for a candidate pattern;
it is not automatically a calibrated probability, section salience, or human label.
Deterministic execution is compatible with continuous, approximate measurements:
identical notes and configuration must produce identical profiles. It does not
mean that a style boundary has an exact mathematical definition.

An unexpected note is relative to a candidate organization. Do not subtract a
uniform penalty for every note outside a selected core:

- An extra simultaneous key can decorate a repeated two-key jack core without
  breaking it. Preserve both the core and the extra key.
- Alternating disjoint groups are affirmative Trill evidence. Projecting onto
  one group and treating the other as a small penalty would manufacture Jack.
- A changed row can mark a new local episode instead of weakening the preceding
  one. Retain the alternative boundary; do not average successive patterns into
  a mediocre score for the entire crop.

## Small initial profile

Start with the existing Jack-core, fixed A/B alternation, and directional roll
extractors. Extend a candidate into neighboring rows while retaining all source
events. Report a small profile for each candidate, not one universal sum:

| Aspect | Observable evidence | Interpretation left open |
| --- | --- | --- |
| Core agreement | Satisfied candidate relationships, complete row groups, selected witnesses | How characteristic the organization is |
| Continuity and extent | Consecutive relationships, break locations, duration, attack gaps | Whether speed and sustained extent establish the pattern |
| Other notes and boundaries | Extra simultaneous keys, intervening rows, entry/exit changes, entering holds | Decoration, interference, or a separate episode |
| Competing organization | The same full rows evaluated for other candidates | Whether a rival organization explains the region better |

Any ratio must retain its numerator, denominator and source selection. The
denominator cannot silently exclude every inconvenient row. Note fraction alone
does not measure style expression. Preserve raw counts and timing rather than
inventing a 0–100 strength scale or penalty weights before calibration.

Targets are assessed independently; there is no softmax requiring their scores
to sum to one. A fixed A/B explanation of a pure Trill episode can contradict
Jack or Stream there, while other independently sourced targets may coexist.
Candidate boundaries and selected notes are part of the evidence, not a fixed
window containing every note by definition.

## Structure is not target strength

Cyber has strong roll structure but expert-approved supporting Stream. Conversely,
its four-note groups must not lose structural validity for harmless 1 ms rounding.
The final Stream judgment depends on flow and organization beyond group count.

Tech cannot be a generic "unexpected note" total: the sink example has varied
events with clear rhythm landmarks and is Tech absent. LN coordination cannot be
an overlap score: independent timing relations matter after the two-column
necessary condition. Retain their concrete descriptors and agent interpretation
initially, instead of forcing all five targets into the same scoring formula.

The inexpensive path is:

1. Compute source facts and candidate profiles with ordinary code, one chart at
   a time. Keep selected notes, unused-note evidence and provenance available.
2. Let a bounded agent interpret the unresolved candidate and its context, using
   the approved Foundation. Exact necessary-condition rules may still settle
   cases such as complete-source LN coordination absence.
3. Send only remaining semantic disagreements to the expert. A high uncalibrated
   score alone cannot bypass this path or justify a claimed zero-false-positive
   label. Preserve query/rule, agent and human origins separately.

Calibrate any later profile-to-label or salience rule on the existing positive
and counterexamples, with different source episodes held out for validation.
Do not treat overlapping crops or prior machine agreement as independent truth.
Start with these few extractors and inspect their profiles before introducing
weights, a generic pattern language, learned segmentation, or a new model stack.

The approved five-target Foundation remains unchanged. These profiles would be
additional machine evidence for the existing workflow, not replacement semantic
definitions or a new set of expert sliders.
