# Annotation balance and section selection

The next acquisition work should broaden independent examples across labels,
style strength, difficulty, and temporal context while retaining the existing
five-dimensional annotation contract. Equal tag counts alone would not address
the observed gaps. Missing dimensions remain unreviewed; supporting/prominent
measures style expression, not numerical difficulty.

This assessment describes the local Review state on **2026-09-09**, before the
next contrast annotation round. Counts are observations of that snapshot, not a
continuously updated dataset inventory or a quality certification. The intended
low-difficulty acquisition range starts at **2 stars**; charts below 2 stars are
outside the current collection scope.

## Human supervision gaps

The snapshot contains 215 effective human records with current source and
Foundation bindings. Deduplicating exact source, tag, interval, and assessment
tuples gives 214 judgments, 154 distinct intervals, and 123 source charts/mapsets.
One repeated Stream-supporting judgment for *Sommarfagel* at
181454–189454 ms counts once; canonical records are preserved. No contradictory
overlapping human assessments were found in the inspected workspace.

| Dimension | Absent | Supporting | Prominent | Independent source charts |
| --- | ---: | ---: | ---: | ---: |
| Jack | 9 | 6 | 8 | 13 |
| Stream | 1 | 10 | 11 | 12 |
| Trill | 24 | 13 | 9 | 36 |
| Tech | 36 | 20 | 20 | 65 |
| LN coordination | 21 | 18 | 8 | 37 |

Fifteen intervals have complete five-dimensional human assessments. All belong
to five recently acquired Tech/hybrid charts; the other 139 exact intervals each
have one judged dimension. Interval-intersection accounting finds no additional
all-five human coverage outside those five charts. Complete supervision is
therefore concentrated in one acquisition route, even though the individual
dimensions have broader source coverage.

Stream absence is the clearest marginal gap. Jack's weaker expression also needs
more independent sources and contrasting contexts. Adding nearby crops from the
same chart can increase judgment counts without substantially broadening those
contrasts. Unresolved, omitted, rejected, and deferred judgments must not be
converted to absent to improve the histogram.

These counts differ from the published v0.1.0 human snapshot, which contains
156 rows. Its staging input contained 164 human records before later review;
publication also omitted some sources. Snapshot comparisons must distinguish
review timing, publication eligibility, and analysis deduplication.

## Difficulty coverage

The local comparison contains 14,642 distinct native 4K BeatmapIDs with both a
local `.osu` file whose header identifies 4K mania and matching metadata. This
denominator counts difficulties, not unique songs, and does not claim to cover
every supplemental source or the global osu!mania population.

| Metadata star rating | Local matched 4K charts | Selected corpus | Human-labeled charts |
| --- | ---: | ---: | ---: |
| Below 2 | 3,241 | 0 | 0 |
| 2 to below 4 | 7,030 | 164 | 37 |
| 4 to below 6 | 3,974 | 318 | 79 |
| 6 to below 8 | 382 | 18 | 6 |
| 8 and above | 15 | 0 | 1 |
| Total | 14,642 | 500 | 123 |

The prepared 500-chart corpus was selected by descending community vote total,
then tag count, with one difficulty per mapset. It had no explicit star filter,
but its realized distribution favors 4–6 stars. Median metadata rating is 3.107
in the matched local population, 4.451 in the selected corpus, and 4.710 among
human-labeled charts. The absence of sub-2-star sources describes the population
comparison; it is not a request to expand the current acquisition scope.

Chart star rating is an administrative difficulty proxy, not a rating of the
annotated interval. Twenty-four prepared charts differ from their metadata MD5;
their metadata ratings must not be presented as freshly computed ratings of the
exact local bytes. Preserve rating provenance and either exclude mismatches from
strict sampling strata or recompute with a pinned rating implementation.

Within the eligible range, prioritize 2–4-star contrasts and retain local attack
rate, peak density, recurrence, hand imbalance, LN occupancy, and release
relationships as separate facts. A sparse passage in a hard chart does not
establish broad coverage of easy charts. Conversely, a prominent style need not
be difficult. These facts do not supply calibrated gameplay-demand labels.

## Boundary selection and its biases

There is no single semantic boundary detector behind the current collection:

| Acquisition route | Inspection scope | Boundary limitation |
| --- | --- | --- |
| Whole-chart discovery | Workers inspect full-chart evidence and propose representative episodes, assisted by structural queries | Query matches and recognizable cores can attract more attention than ordinary or transitional material |
| General section selector | 10-second windows at a 5-second stride; known scopes up to 20 seconds; complete merged repair scopes | A time grid need not coincide with an episode, and reusing old scopes can reproduce earlier crop preferences |
| Five-chart Tech/hybrid pilot | Four measures near 20%, 50%, and 80% of the note span, aligned to the active timing point; one measure of context each side | Measure alignment is not phrase detection; fixed positions miss other locations and duration changes with BPM |

The general selector omits generated tails shorter than half the nominal window,
except for very short whole charts, and retains exact reviewed and repair scopes.
It adds at least two seconds of context around ordinary targets, clipped to the
chart. Empty discovery windows are excluded while entering holds remain visible.
The five-chart pilot's actual four-measure windows lasted 3–8 seconds. Its
preparation asserted at least ten attack notes per target; retaining that check
in future sampling would restrict sparse examples.

Discovery windows locate material for inspection. The production
[fine-annotation runner](../../annotation/pipeline/run-fine-annotation.py) freezes
selected scopes as requested judgment units: workers may retrieve wider context,
but must report a concrete boundary problem instead of silently widening a claim.
A revised semantic cut needs an explicit new scoped proposal. Other discovery
roles can propose episode boundaries; that flexibility must not be assumed for
an already frozen fine-annotation job.

The median human interval is 1.920 seconds; 113 of 154 intervals (73.4%) are
shorter than three seconds. This demonstrates a short-crop skew, not that any
particular judgment is incorrect. Sustained organization, weaker embedded
expression, onset/exit, and transitions have less representation. None of the
current human judgments populates the optional boundary-uncertainty or transition
fields; their omission does not certify an exact semantic boundary.

Longer charts generate more grid candidates. The inspected general-selector pool
contains 22,263 candidates, including 19,741 exact ten-second windows; one source
contributes 380 candidates. Mapset and structural-stratum caps constrain final
selection but do not make inclusion probabilities equal across charts.

## Acquisition priorities under the existing contract

1. Seek ordinary and confusable Stream negatives, weaker Jack expression, and
   missing dimensions on useful existing episodes. Independently assess all five
   dimensions; candidate retrieval must not prescribe the resulting label.
2. Add 2–4-star examples and contrasting local structures across independent
   sources. Do not require every style to exist in every difficulty bin or force
   uniform label co-occurrence.
3. Include sustained bodies, entry/exit, and transitions alongside short cores.
   Keep the original inspection window, final claim scope, source note identity,
   full hold endpoints, and episode grouping distinct. A label on a short core
   cannot be propagated to a larger interval without a fresh judgment.
4. Retain an independent sampling arm when measuring generalization. Choose
   source groups and time anchors before inspecting predictions; keep ordinary
   and negative regions instead of retaining only a positive core. Reserve whole
   song/mapset groups and exclude evaluation judgments from calibration.

The current selector scores correction similarity, open review, missing usable
dimensions, structural rarity, chart coverage gaps, and a small density-based
demand proxy. It does not enforce tag/salience or star quotas. Usable machine
coverage can conceal a shortage of human supervision, and repeated correction
similarity can concentrate work around already frequent Tech/LN examples. These
are limitations of its acquisition objective, not evidence of wrong labels.

Prefer new settled judgments per human review minute, independent sources per
tag/assessment/difficulty stratum, complete five-dimensional episodes, and
boundary/context coverage over total claim count. A targeted annotation set is
useful for filling gaps but does not directly estimate population accuracy:
[active-learning bias](https://arxiv.org/abs/2101.11665) and
[active testing](https://proceedings.mlr.press/v139/kossen21a.html) distinguish these
objectives. No downstream model benefit or optimal allocation has been measured.

The investigation used canonical feedback, exact-tuple deduplication, human
conflict checks, interval unions/intersections, local source-header/metadata joins,
and the existing selector's derived report. It did not change the Foundation,
annotation meanings, canonical human records, or sampling implementation. Raw
feedback and local analysis outputs remain local; this document preserves the
findings and their limits without requiring those private artifacts.
