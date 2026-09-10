# Scaling selected-section annotation

A frozen-skill expansion added 500 fixed sections from 179 previously unregistered
native 4K charts, assessing Jack, Stream, Trill, Tech and LN coordination at 1×.
All 2,500 initial judgments received a separate machine audit. After targeted
repairs, 2,483 judgments were supported, 16 required an expert judgment and
one remained excluded because of its fixed-window boundary. The subsequent
expert review resolved all 16 referrals and revised seven of the 80 reviewed
dimensions. These are selected review results, not measured population accuracy.

## Coverage and execution

Source bytes, metadata checksums, native key count and source-header identities
were checked before registration. Every eligible new chart participated, with at
most three nonoverlapping four-measure sections per chart. One chart was excluded
because its source header and metadata disagreed on beatmapset identity. The
registered corpus grew from 529 to 708 sources.

| Metadata rating | New charts | Selected sections |
| --- | ---: | ---: |
| 2–4★ | 107 | 303 |
| 4–6★ | 66 | 185 |
| 6–8★ | 6 | 12 |

The source pool was previously stratified by rating and informed by community
discovery hints. These sections do not estimate population style prevalence or
establish whole-chart coverage. Fixed windows are requested judgment units and
are not assumed to coincide with natural episode boundaries. All five dimensions
were assessed independently without positive-label quotas.

Three chart-disjoint coordinators allowed two concurrent actual workers each.
There were 127 completed labeler jobs and 127 completed fresh auditor jobs, with
254 distinct actual producer identities and worker threads. A quota interruption
also left 59 response-free failed attempts, archived before fresh retries. Recovery
preserved the 139 workers already completed without reusing model conversation
history. Labelers used `gpt-6-astra` with
medium reasoning; auditors used the same model family with high reasoning. Most
initial jobs contained four sections. Frozen input and response hashes, exact
source/task/handoff/audit bindings, and canonical delivery were verified.

The skill content hash was
`73e8007c7523667ea610f80e59cf1225fdddebf9c60ab9223d35a72de595a2c6`;
the initial descriptor referenced checkout `ee9bcab7`. Foundation definitions and
expert judgments were not revised. All 397 pre-existing human observations and
their 397 decisions remained unchanged during the initial expansion.

## Initial findings

| Independent audit disposition | Judgment cells |
| --- | ---: |
| Supported machine judgment | 2,451 |
| Agent revision required | 33 |
| Expert judgment required | 16 |

Initially, 456 sections had all five dimensions supported. The revision findings
included omitted Trill cores beneath changing companion notes, incorrect LN
timestamps or retention descriptions, and a scope that captured an onset while
excluding the later split release. A correct assessment with an incorrect witness
explanation still required revision.

Expert questions concerned concrete boundaries such as supporting Tech versus
ordinary Stream articulation, short attack-aligned LN tails versus independent
hold control, and slowly spaced alternation versus separated gestures. Routine
factual corrections were kept in the agent workflow instead of generating human
review requests. Broad approval of earlier annotations was not converted into
individual human acceptances.

## Targeted repairs and exclusions

A follow-up pass assigned each of the 29 affected sections to a fresh single-section
labeler and a separate auditor. The 33 exact revision targets retained their
original sources, rates and scopes. The skill descriptor referenced checkout
`110de618`, with identical skill, role and Foundation contents. This added 58
distinct worker sessions. Of the 33 replacements, 31 were supported: 19 changed
the assessment and 12 retained it while correcting or strengthening its evidence.
These cases were selected for prior audit failure and received the earlier audit
feedback and exact correction questions. This pass is therefore not a controlled
test of reducing batch size from four sections to one.

Two targets still required action. In `scale500-003` (Granat [Normal]), the Trill assessment remained
absent but a cited `0–1–0` turn was described as `1–0–1`; a further isolated factual
correction and fresh independent audit resolved this witness error without
changing the assessment. In `scale500-223` (arc-en-ciel (TV Size) [Rainbow]),
the fixed window `[20702, 28087)` ms
contains a paired LN onset at 28086 ms, while its two releases occur at 28317 and
28547 ms. Both the labeler and auditor identified a scope problem. This LN cell
remains unresolved and excluded from usable machine labels. A different crop
would be a separate proposal and cannot count as a supported judgment of the
original fixed window. Other dimensions retain their own audit dispositions.

Repair workers also returned assessments for non-target dimensions. Delivery
preserved existing supported judgments and retained the unsubmitted alternatives
and diagnostics. These alternatives did not receive individual independent audits
in this targeted pass; retaining the original label does not establish repeat-run
agreement. The original initial outputs and each rejected replacement remain
available alongside explicit replacement history.
The first repair pass produced 112 non-target assessments: 102 compatible skips,
nine conflicting alternatives and one missing supersession reference. Those nine
differences are not an error rate or a measure of context degradation. One example,
`scale500-252` LN, is sensitive to a window ending shortly after a paired LN onset.
The original labeler and auditor already considered the true out-of-window tails;
the new unresolved proposal introduces a more conservative scope interpretation,
not a newly established endpoint error. Its diagnostic remains machine follow-up
material and does not assert anything about the full subsequent LN episode.

## Verified result before expert review

| Current disposition | Judgment cells |
| --- | ---: |
| Supported machine judgment | 2,483 |
| Expert judgment required | 16 |
| Scope revision required; excluded | 1 |

Of 500 sections, 483 have all five dimensions supported. Overall, 32 of the 33
initial revision targets were resolved: 19 changed assessment and 13 retained it.
The complete work used 314 distinct completed producer identities and actual
worker threads, including independent audits of the repairs. The final export
preserves all 2,500 cells with eligibility flags, full evidence, audit identity
and explicit replacement history; excluded cells are not silently dropped or
converted to absent. Original and first-pass exports remain immutable.

The production review inbox contains 17 concrete expert questions: 16 from this
expansion and the original ANiMA Tech question. The rate-experiment inbox contains
five focused claim/rate questions after broad requests were archived. The scope
defect remains a machine workflow issue rather than a fabricated expert decision.
All 397 existing production observations and their 397 decisions, plus the ten
existing experiment decisions, were preserved. Actual browser checks confirmed
version visibility, five assessment sliders and the section submission control;
these read-only checks created no human judgments.

Delivery fixes preserved completed worker responses through quota recovery,
disjoint response fragments and a rejected-revision chain. The final code check
passed 493 TypeScript and 281 Python tests, builds, package checks and corpus
smokes. These operational checks establish provenance and delivery behavior,
not semantic correctness.

## Interpretation

Separate worker sessions and source-bound auditing were verified. An auditor from
the same model family can still share a labeler's blind spots, so the supported
fraction is not an accuracy estimate. The unresolved cases remain useful targets
for expert calibration without turning the whole batch into a human review queue.
Factual mistakes occurred even in single-section jobs, so session size alone is
not a sufficient correctness guarantee.

This expansion uses one playback rate and no explicit player profiles. It does
not establish speed sensitivity or the proposed dependence of style on player
capability. The earlier [rate experiment](rate-style-response.md) and the
[context-control investigation](annotation-context-control.md) retain their own
limitations. A matched comparison of single-section and four-section jobs is
still needed to measure the effect of job context on judgment quality.

## Expert review and method freeze

On 2026-09-10, 81 new saved decisions produced 80 effective judgments over all five
dimensions of 16 sections on 15 charts. One section was saved twice; the later
decision is effective. All 16 referred dimensions were resolved, together with
64 companion dimensions that had previously received supporting machine audits.
Seven assessments changed: four referrals and three previously supported
dimensions. The other 73 assessments agreed with the final machine baseline.

| Section (original source milliseconds, 1×) | Dimension | Machine baseline → effective human judgment |
| --- | --- | --- |
| Super Nuko ni Narenkatta [Hyper], `[81010, 86063)` | Trill | absent → supporting |
| The Worst [Terrible], `[120016, 127696)` | Trill | supporting → absent |
| Catalinesie [Catalyst of Amnesia], `[113311, 117485)` | Trill | absent → supporting |
| think abt it w/ ppgcasper [_o_ [1.3x Rate]], `[58010, 62626)` | Trill | absent → supporting |
| Yolomania Vol. 3A [Ariana Grande - Baby I [Leo137] 14], `[143960, 153372)` | Trill | supporting → absent |
| Same Yolomania section | LN coordination | supporting → absent |
| Destiny [Noch's MAXIMUM], `[87706, 92030)` | Stream | prominent → supporting |

The rate written in a difficulty name is source metadata; this expansion played
each supplied source at 1×. Super Nuko's final Trill judgment is supporting: its
four single notes at 85431, 85510, 85589 and 85668 ms alternate columns 0–2–0–2.
The human described a perceptible weak alternation at the ending. This is distinct
from the Yolomania section, whose effective human Trill judgment remains absent.

The reviewed set was selected for uncertainty and includes correlated dimensions
from each section. Neither 73/80 agreement nor the earlier machine-supported
fraction is a random-sample accuracy estimate. The five Tech referrals were all
confirmed supporting, mostly without new human-authored explanation; these
confirmations do not provide a newly established universal Tech rule.

The [method bundle](../../annotation/methods/scale-500-20260910/README.md) freezes
the exact skill, roles and evidence tools used for this expansion. Publication
does not revise judgment guidance. A future small skill iteration should test
grouping of short or fragmented Trill episodes and whole-section Stream salience
against the expert examples. It should not infer a universal note-count or speed
cutoff, require only one prominent tag, or claim that player-profile dependence
has been established. Any judgment-affecting revision needs the existing critical
case and repeated-comparison regression gate before adoption.

After exact human precedence, the expansion contributes 80 human cells and 2,419
machine-only cells; the single fixed-boundary LN defect remains excluded. The
release separates human judgments from opt-in machine method tables and prevents
an independently supported repair on another handoff from overriding an effective
human assessment at the same source, scope, tag and playback rate. The cumulative
human resource also includes earlier records; these are not all new expansion
reviews. See the [publication guide](../annotation/dataset-publication.md).
