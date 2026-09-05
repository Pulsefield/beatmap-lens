# A small section vocabulary for style learning and control

- Status: Four-dimension Foundation approved with expert calibration corrections;
  community targets and alignments remain proposals
- Scope: Beatmap Lens observations consumed by Pulsefield research
- Formulation reference: Pulsefield-model `7faff4cbdef5ebc93fb11fb4acce5a95d7bfc713`,
  `docs/formulation/gameplay-state.md` sections 2, 5, 10–18 and
  `docs/formulation/notation.md` sections 8–9

## Purpose and authority

The first consumer needs a small experiment that tests whether learned style
requests produce mapper-recognizable changes, such as more jack organization or
stronger technical character. Annotation should supply useful semantic supervision
for that experiment. Completing a pattern taxonomy is not its acceptance criterion.

There are two independently versioned vocabularies: selected whole-difficulty
community observations and local section-style predicates. Their names can overlap,
but neither list defines the other. The formulation leaves the final inventories
open. The community-tag research pages describe a corpus snapshot, not an approved
model target list. The earlier nine-concept campaign remains a calibration proposal;
its count is not a requirement for this experiment.

The [compositional judgment guide](../../skills/mania-pattern-judgment/references/judgment-guide.md)
helps experts inspect arrangements. Its analytical levels are not a required model
hierarchy, annotation inventory, or set of independent control parameters.

## Evidence scope

Use concepts supported by materialized chart actions, causal history, and the fixed
canonical gameplay profile over a declared interval. Chart facts such as chord
cardinality, recurrence, intervals, and hold occupancy are computed from source.
Humans judge their semantic organization and salience.

The current style module excludes predicates whose distinguishing evidence requires
aligned audio, external presentation assets, provenance, or unobserved mapper intent.
For example, this experiment does not express dump's chart–audio relationship,
delay's represented sound, storyboard/video, or mapping lineage/inspiration.

Other concepts can be chart-intrinsic yet outside this small experiment: whole-map
skillset breadth, cross-section progression, composite hybrid labels, detailed LN
subtypes, or every trill and roll variant. These are experimental deferrals, not a
claim that the formulation permanently excludes them. Player-specific fatigue,
wrist technique, memory, and subjective pain are not measured by the canonical
profile or by a section style label.

## Approved first section subset

The user approved the four-dimension Foundation after reviewing ten source-backed
cases and correcting their interpretations. The local definitions and resolved
calibration judgments are approved; each dimension retains independent salience.
Record the reviewed snapshot through the human workflow. The revision-2 factory
still creates an empty proposed template; approval does not fabricate examples or
silently replace an existing pinned Foundation. Community target selection and
alignments are separate, unapproved decisions.

| Section predicate | Approved local interpretation | Role in the experiment |
| --- | --- | --- |
| Jack organization | Repeated-column organization includes the reviewed fixed-group long jump jack and typical changing-chord jack/chordjack; the latter is not longjack. | Test recognizable reuse organization across different rates and densities without losing subtype distinctions in evidence. |
| Stream organization | Includes reviewed jumpstream and roll/burst; excludes the reviewed left/right grouped jumpdrill. Preserve flow direction and episode changes. | Test sustained flow without treating all ongoing tapping as the same style. |
| Tech | Which locally understandable expectations are disrupted by timing, added/omitted attacks, or articulation? | Test a mapper concept that is not a residual class or density score. |
| LN coordination | How do independent presses, releases, and taps interact with occupied columns? | Include a case where entering holds and event history can matter. |

The expert accepted the fixed-group long jump jack as prominent broad Jack
organization and its precise proposed scope. The reviewed no-jack interval remains
absent. The jumpstream scope was accepted, the grouped jumpdrill was explicitly
Stream absent ("salience 0"), and roll/burst was confirmed Stream present. The
subsequent exact-four-notes and three-consecutive-groups criterion resolves the
source-backed roll example to prominent. The Tech
positive was confirmed typical, its comparator absent, and both LN coordination
judgments correct. Original source bytes, proposals, and approximate earlier
boundaries remain preserved separately from these decisions.

One roll/burst group contains exactly four notes moving in one direction across
columns with equal adjacent-note spacing and no jump/chord relation bridging
consecutive bursts. Three or more consecutive complete groups establish prominent
Stream organization in the local episode. Burst is the faster roll description,
without a supplied numerical speed threshold. The reviewed source contains three
complete descending groups and three ascending groups, with two turning notes
between them. Its integer 42/43 ms spacing exactly follows consecutive ticks of
the source timing point's equal grid after flooring; retain these timestamps and
that derivation without inventing a general timing tolerance. A direction change
alone does not assign salience. A few recognized minijacks likewise do not by
themselves establish a prominent jack-organized section.

Jump, hand, minijack, long jump jack, chordjack, grouped jumpdrill, roll, burst, and LN
release remain available in evidence explanations. Retaining a description does
not require creating another manually supervised output coordinate. Conversely,
existing reviewed observations are not deleted merely because an experiment omits
their concepts.

## Proposed community observation subset

Use the observed community IDs for `style/chordjack`, `style/longjack`,
`style/jumpstream`, `skillset/tech`, and `style/LN coordination` as a small candidate
set of whole-difficulty observations, including the retained LN dimension.

| Catalogue ID | Community target candidate |
| --- | --- |
| 105 | `style/chordjack` |
| 106 | `style/longjack` |
| 102 | `style/jumpstream` |
| 111 | `skillset/tech` for osu!mania |
| 113 | `style/LN coordination` |

These IDs refer to the catalogue snapshot fetched on 2026-08-07. Join by ID and
ruleset applicability: a same-name Tech tag for another ruleset occurs in the
metadata and must not be merged with mania Tech by display name.

Preserve catalogue identity and raw vote counts. A difficulty contributes one
occurrence per tag; votes are a separate quantity, not independent training examples
or a probability that the label is true. Missing tags remain unobserved.

These candidates cover the proposed experimental questions and occur in the local
4K corpus. Longjack gives a contrasting jack form despite having fewer tagged maps.
Corpus frequency informs sampling; it does not certify definitions or alignments.
The 4★–6★ preference selects the first human handoff example, not the whole training
population. Keep other rate, density, and difficulty ranges available for evaluation
and control-confound checks.

For the broad section subset, the initial relationship is deliberately limited:

| Community observation | Proposed local relation | What it cannot establish |
| --- | --- | --- |
| Chordjack, longjack | Each can supply positive weak aggregate evidence for compatible jack organization after calibration. | Broad jack salience cannot recover which specific jack subtype received votes. |
| Jumpstream | Positive weak aggregate evidence for compatible stream organization after calibration. | General stream organization does not imply jumpstream. |
| Tech | Related weak evidence for a locally calibrated technical concept. | The catalogue's complex-snap emphasis is not identical to the expert's local definition. |
| LN coordination | Candidate alignment with the independently judged local coordination predicate. | Whole-map votes do not identify boundaries, per-section salience, or actual demand. |

These are alignment proposals. They are not an approved training manifest. Do not
merge community coordinates into `Foundation.tags`: that array is the section
assessment vocabulary.

### Pooling is a separate hypothesis

The broad pilot prioritizes local recognition and eventual control. Specific map
tags may provide one-way weak evidence; their absence is not a negative and the
reverse subtype implication does not follow.

If the first experiment must test whether section salience alone predicts specific
community tags, preserve the required distinctions in the section targets. A small
alternative is locally calibrated Longjack, Jumpstream, Tech, and LN coordination;
Chordjack remains outside that alignment until represented separately. This route
tests narrower controls and cannot claim full broad jack/stream coverage.

Adding exact subtype facts or a separate chart readout to a map classifier may be
a useful later experiment, but changes its inputs. Do not call it evidence that
pooling only broad style salience recovered the lost distinctions. Pooling must
also account for duration, recurrence, prominence, and unobserved sections; a
mean over selected positive crops is not a whole-map style estimate.

## How this helps learning

Human observations supervise realized section style, with explicit masks for
positive, negative, unresolved, and unreviewed judgments. They support local
recognition, calibration of mixed sections, aligned weak supervision, and expert
evaluation of generated changes. Supporting/prominent are ordinal observations;
do not silently convert them into calibrated numerical target values.

Exact chart evidence and incoming/within-section demand enter the style readout
in parallel. Compare chart-only, demand-only, and joint recognition against density,
event-count, and difficulty baselines. Better style recognition alone does not
demonstrate a sufficient frontier representation or justify a new demand channel.

For frontier research, use annotated episodes to select meaningful histories and
controlled continuation probes: repeated-role versus distributed use, different
recovery intervals, hold occupancy with free-role taps, or release followed by a
chord. Preserve exact state and legal continuations. Model-defined probe responses
need independent grounding under the canonical profile; experts do not invent
demand values when annotating style. This is a Pulsefield experiment, not a Lens
simulator or a claim that such responses have already been validated.

## What a strength control must demonstrate

Keep realized style salience, requested style tendency, adherence strength, and
realized/desired demand separate. A mapper-facing amount control could concern
local prominence, duration/coverage, or repetition frequency; its user-facing
meaning must be calibrated rather than inferred from one scalar name. The first
pilot need not expose all these controls.

First establish recognition on held-out human sections. Then vary a style request
with audio and committed history fixed, matching realized demand as closely as
possible. Judge whether the intended organization changes, including ordered
comparisons when testing strength. Test demand changes with style held fixed as a
separate intervention. More notes, higher global difficulty, or different decoding
entropy alone do not establish successful style control. The coordinates may be
correlated; they are not assumed to be independent sliders.

## Bounded collection and implementation

Collect a compact set of informative episodes with exact source identities,
independent evidence, entry context, and expert judgments. Include calibrated
positives, actually inspected negatives, ambiguous examples, and a small unscreened
sample to check candidate-selection bias. Compare different arrangements at similar
densities and the same organization at different rates. Preserve song/difficulty
and overlapping-episode grouping, and separate exposed calibration examples from
held-out evaluation. A community tag count is not an independent-song count.

No model training, generic ontology editor, dense human note labeling, or demand
trajectory annotation is needed in Beatmap Lens milestones 1–2. Its existing claim,
evidence, decision, and frozen-task semantics remain useful. Section-vocabulary
changes require a new proposed Foundation; old tasks retain their hashes and meaning.

With four dimensions, the original five-case demonstration spans two scopes: a
mixed scope can contain two prominent positives, a negative, and an unresolved
judgment; another scope demonstrates an unreviewed dimension. Preserve all cases
after reopening. The generic contract still supports the original larger-vector
test without making a fifth concept part of this experiment.

The new campaign must support unaligned and multiply aligned local concepts while
retaining historical snapshots with one external correspondence. Descriptive
catalogue correspondence alone is not a complete weak-supervision alignment: the
consumer also needs direction, scope, and pooling meaning. The four-dimension
Foundation starts with no declared correspondences while those decisions are open.

Source-ms half-open intervals remain the Lens contract. A Pulsefield consumer must
explicitly adapt milliseconds and endpoint membership to its coordinates, including
entering LN occupancy. It must not silently reinterpret an interval or fill unknown
labels during adaptation.

The next checkpoint is the agent–human workflow over this reviewed Foundation,
with only a small set of substantive uncertainties handed to the expert. Recording
the approved snapshot does not require another global semantic approval. Community
alignments and any broader taxonomy remain independent research decisions; neither
blocks the bounded local annotation experiment.
