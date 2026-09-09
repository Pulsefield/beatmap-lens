# Style judgments across playback rates

The fixed-section experiment completed on **2026-09-09** did not establish a
stable rate effect beyond the current labeler's ordinary repeat variability.
High-difficulty Tech did not weaken when slowed, and low-difficulty sections did
not show stable emergence of other styles when accelerated. This result supports
taking structural interpretations seriously; it does not establish that style or
gameplay experience is independent of speed or the player.

## Question and design

The motivating hypothesis was that slowing difficult Tech might make its Tech
expression disappear while exposing Stream, Jack or another organization, and
that accelerating easy, sparsely labeled material might make a style emerge.

Eight expert-reviewed native 4K sections were selected before seeing experimental
outputs. The high-Tech group contains the four highest metadata star ratings among
Tech-positive sections in the newest targeted expert batch. The low group contains
the four lowest ratings in the same-day reviewed pool with at most two present
dimensions and no prominent dimension. All five dimensions had human assessments:
"sparse" means few positive styles, not missing review. The pool starts at 2 stars.
Chart ratings are sampling metadata, not difficulty estimates of these intervals.

| Section | Chart [difficulty] | Stars | Original scope (ms) |
| --- | --- | ---: | --- |
| s01 | TERABYTE [HARD DRIVE] | 6.67 | 84549–89120 |
| s02 | Bismuth [Light-years away] | 6.60 | 156273–161759 |
| s03 | The Blue Sanctuary [The Cradle of the Sky] | 6.35 | 274680–280461 |
| s04 | Tenshi no Kikyou (feat. L4hee) [Beyond the Petals, Where Eternity Awaits] | 6.16 | 193991–199324 |
| s05 | As It Was [Normal] | 2.00 | 121856–127373 |
| s06 | Craiova [Normal] | 2.09 | 58307–63731 |
| s07 | Flower Dance [CS' Hard] | 2.50 | 45797–55397 |
| s08 | Raindrop [Hard] | 2.93 | 78399–84593 |

Each section was judged at **0.5×, 0.75×, 1×, 1.25× and 1.5×**, with three fresh
model repeats at every rate. Thirty ephemeral `gpt-6-astra` workers at `medium`
reasoning effort each judged four distinct sources at one rate: **120 section
evaluations and 600 five-dimensional judgments**. Section grouping and order were
matched across rates within repeats; the execution schedule was shuffled with
seed 20260909. All jobs completed on their first attempt.

Original source bytes, SHA, note set, section boundaries and surrounding context
were fixed. The Foundation, skill and neutral prompt were also fixed. Every rate,
including 1×, received the same text-evidence schema with parallel performance
timing: source duration divided by rate, and source BPM multiplied by rate.
Workers did not receive target expert judgments, cohort names, the directional
hypothesis, another run's output or optional external examples. This controls the
available evidence while testing declared rate and transformed timing together.

Independent input verification checked all 120 cases, 8,550 performance timing
rows and 2,730 LN timing rows. Every output and source reference validated. Review
of the recorded worker commands found no observed reads outside pinned inputs;
this was a logged-command review, not a filesystem syscall audit.

## Results relative to repeat variability

For each section, dimension and adjacent pair of rates, cross-rate disagreement
compares all nine pairs of model outputs. Its repeat baseline is the average of
within-rate disagreement at the two endpoints, using the three unordered repeat
pairs at each endpoint. Average both quantities equally across sections,
dimensions and adjacent rate pairs. Preserve unresolved as its own category.

| Descriptive measure | Result |
| --- | ---: |
| Adjacent-rate cross-repeat disagreement | 6.3889% |
| Matched within-rate repeat disagreement | 6.4583% |
| Excess disagreement | -0.0694 percentage points |
| Adjacent changes with unanimous definite judgments at both endpoints | 0 |
| Exact agreement with human reference, at 1× only | 100/120 (83.33%) |
| Presence agreement with human reference, at 1× only | 113/120 (94.17%) |

The negative excess is retained, not clipped. It does not prove equivalence or
absence of an effect. The leave-one-section-out excess range was -0.008 to 0.002
in probability units; this is a sensitivity range, not a confidence interval.
The comparisons reuse outputs and are correlated. Four sections share each worker,
so 600 judgments are not 600 independent observations or human raters.

All three repeats retained each high-Tech section's Tech label at 0.5×, 0.75× and
1×: **prominent for TERABYTE and Bismuth; supporting for The Blue Sanctuary and
Tenshi no Kikyou**. All 12 corresponding 1× Tech judgments matched the human
reference. The 1× expert reference was used only for this separate comparison,
never as gold for another rate.

There was no unanimous style emergence in the low group at 1.25× or 1.5×. As It Was
and Raindrop had identical labels throughout all 15 evaluations. The clearest
fluctuations were:

| Section and dimension | 0.5× | 0.75× | 1× | 1.25× | 1.5× |
| --- | --- | --- | --- | --- | --- |
| Craiova — Jack | S2 P1 | P3 | S2 P1 | P3 | P3 |
| Flower Dance — Stream | A3 | A3 | A2 S1 | A2 S1 | A2 S1 |

Here A means absent, S supporting and P prominent; the digit counts repeats.
Craiova's salience varies nonmonotonically, and its 1× baseline is already split.
Flower Dance has the same distribution at 1× and both faster rates. Neither
provides stable evidence of a newly emerging style. Across all sections, 20
section/rate/dimension cells disagreed among repeats, and one judgment was
unresolved. A majority label must not erase that uncertainty.

## Interpretation: intended organization and constrained execution

Focused independent review of 51 rationales found that 15 of the 24 slowed
high-Tech rationales explicitly used correct transformed intervals while retaining
their labels. No wrong-rate numeric claim, invented demand threshold or decisive
source contradiction was found in this focused sample. The agents commonly
preserved categories using relative rhythm, articulation and action organization.
It would be inaccurate to conclude that they simply ignored timing.

After reviewing the result, the expert identified a distinction in their own
earlier judgments: **"how I think this should be played"** had been mixed with
**"how I can play this under the limits of my hands."** This is an interpretation
and proposed research distinction, not a fact established by the model experiment.

An intended action organization may remain recognizable over a range of rates,
while a player's feasible execution, grouping and compensation change with their
capabilities. The observations are compatible with a partially stable structural
component and a player-conditioned execution response. They do not identify a
unique intended technique, quantify either component, or justify redefining the
five existing style labels. A profile-response formulation remains plausible;
the experiment does not establish that all style variation belongs to that response.

Other explanations remain open. Some local intervals were still only 58–84 ms
at 0.5×, so the selected conditions may not cross a qualitative execution boundary.
The current judgment rules may favor structural categories, and text evidence may
not expose the same constraints as playing. Eight purposeful sections, one model,
three repeats and no explicit player profile cannot distinguish these explanations
or support conclusions about sub-2-star charts or the broader population.

## Next direction and retained evidence

First collect human judgments for the same fixed sections at shuffled individual
rates, before showing paired comparisons or model answers. Record the reviewer's
gameplay profile and uncertainty. Ask separately about the organization they read
and the execution they use under their own constraints. Preserve that distinction
as research information until there is evidence for a contract change. Then compare
human and model responses and investigate evidence modality or rule changes where
they disagree; do not tune prompts simply to force the expected rate trend.

The experiment ran from commit `33df3dcca3566ef00aadc858bca1cf9470b7d20d`, with skill
SHA `73e8007c7523667ea610f80e59cf1225fdddebf9c60ab9223d35a72de595a2c6` and Foundation
SHA `15fa68913bdb2bf395a189df7ab433f6d5b126fc35c46c1dbc8e607ce2182e97`.
The local run directory `.local/rate-style-experiment-20260909/` retains the frozen
design, source identities, all job inputs and outputs, full distribution matrix,
rationales and validation records. All 120 repeat-specific sets were exported as
600 distinct unaudited claims to an isolated human Review workspace. Later human
reviews are separate from the frozen machine analysis. No Foundation definition,
judgment skill or expert gold was changed, and the previously documented production
semantic regression coverage gaps remain open.
