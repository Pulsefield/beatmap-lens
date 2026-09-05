# Query-assisted recognition after corpus feedback

- Status: Campaign stopped; Drill scope and roll/Stream distinction approved;
  five-target Foundation and query-to-label mappings under calibration
- Date: 2026-09-05

The first corpus round exposed repeatable errors: alternation was treated as
Stream, roll count was used as a direct Stream strength rule, literal LN overlap
was over-interpreted, and rhythmic variation prompted too many Tech questions.
Running a large-model labeler and auditor on every simple factual relationship
did not resolve these semantic boundaries efficiently.

The user stopped the annotation agents and requested a revised skill, Drill as
an additional section target, and high-precision queries for simple patterns.
The existing 500-chart inputs, submitted packets, human feedback, and worker
provenance remain intact. The dispatcher and its scheduled continuation are
paused; this decision does not authorize an automatic restart.

## Recognition and targets

Use three distinct decisions: source structure, pattern interpretation, and the
strength of each section-style target. The new experimental set is Jack, Stream,
Drill, Tech, and LN coordination. Chord arity, rate, repeat count, and roll direction
remain computed evidence instead of extra manually labeled coordinates.

The expert approved Drill as continuing A↔B alternation of two fixed disjoint
groups. A group may be a single key or chord; same-hand and cross-hand cases are
included. This covers both the original left/right pairs and the crossed pairs
reviewed in Memoria. Presence also depends on speed and sustained extent; four
alternating attacks alone are insufficient. Pure disjoint Drill without adjacent
same-column repetition is Jack absent, despite every column's periodic return.
Numerical sufficient conditions for query-only presence/strength need calibration.

The expert also clarified that three or more consecutive roll groups establish
strong roll structure, **not automatic Stream prominent**. Stream strength still
depends on flow variation and actual organization. Preserve the pilot's prominent
example and Cyber's explicit supporting judgment. This supersedes that automatic
implication for future recognition, without rewriting the frozen pilot snapshot.

Supporting/prominent means how strongly the section expresses the target style,
with typicality allowed to influence that judgment. It is not just note coverage
or duration. For LN coordination, the expert supplied a necessary condition of
at least two LN-occupied columns at some point; occupancy alone remains insufficient.
For Tech, a perfect template is not required: explain why the actual organization
is hard to anticipate through familiar patterns.

Tech and LN coordination retain contextual interpretation. Regularity alone is
neither a positive nor a blanket exclusion; compare the actual playable grouping,
rhythmic landmarks, and independent press/release organization. See the revised
[judgment guide](../../skills/mania-pattern-judgment/references/judgment-guide.md)
for the source-specific positive/negative comparisons and remaining questions.

## Minimal implementation

The [query reference](../../skills/mania-pattern-judgment/references/structural-queries.md)
defines a standalone Parquet helper for fixed-group repeats, disjoint-group
alternation, a selected repeated core with incidental chord notes, four-note
directional candidates, and LN event relations. It emits
compact source-backed evidence and version/hash provenance without a model call
or workflow hydration. It does not automatically assign semantic labels or salience.

A separate `createQueryPilotFoundationV2` factory creates a proposed five-target
snapshot with no fabricated calibration or inherited human approval. The original
four-target factory and all pinned tasks retain their definitions and hashes.
The generic existing claim contract can already carry the fifth tag, so no ontology
editor, schema redesign, or new Inspector flow is needed.

The intended cheapest annotation method is a deterministic rule that directly
outputs supported presence/salience, with zero false positives as its acceptance
requirement. Selected witnesses need not include every note in a crop, but unused
notes must be checked for counterevidence: selecting A out of A↔B Drill cannot
manufacture Jack. Uncertain selection, scope, or salience goes to an agent; only
remaining semantic uncertainty goes to the expert.

There is no global row-skipping switch in the semantic definition. The expert
judges continuity through the dominant organization: inserted rows/chords may be
part of the pattern or mark mini-section boundaries. The first repeated-core query
therefore handles added simultaneous keys, retains all context, and conservatively
splits at intervening rows. Joining those pieces requires contextual judgment until
a specific safe rule has been established.

Use the factual helper to implement these rules, lighter inference for bounded
contextual interpretation, and stronger inference only for unresolved cases.
Test precision and abstention by target on held-out expert sections before
resuming corpus labeling. No particular cheaper model has been validated yet.
Human confirmations remain distinct from query outputs and all machine judgments.

The immediate next step is to settle the remaining concrete Foundation boundaries
and run a small evaluation. Reusing the 500-chart corpus does not require repeating
already settled human reviews or treating earlier machine agreement as ground truth.
