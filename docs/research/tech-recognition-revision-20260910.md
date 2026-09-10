# Tech recognition revision: proposal and production evaluation

Date: 2026-09-10. Outcome: both candidates rejected; production guidance unchanged.
The proposal and thresholds were fixed before launching candidate workers. Full
production adoption was not demonstrated. The staged experiment is complete.

## Hypothesis and intervention

The [previous diagnosis](selection-run-diagnosis-20260910.md) found persistent
misses on supporting Tech, specific prior regressions, and a supplement that had
removed production inspection facilities. This experiment uses the production
selected-section configuration on both sides. It tests a combined guide/role
revision, not the isolated effect of each sentence or tool availability.

The candidate replaces the opening Tech paragraph with affirmative reading of
restrained expression inside familiar Stream, Jack and Trill frameworks. Read
how rhythm and articulation shape a cell and its continuation before deciding
presence and strength. Repetition does not erase expression. Accents, omissions
and pauses are inspection questions, not positive-label rules. Ordinary-flow
counterexamples and supporting/prominent contrasts remain. Foundation meanings
and the other four dimension sections are unchanged. The candidate adds no
target-specific gold answers or difficulty/feature-count cutoffs.

The labeler role makes a supporting-positive versus ordinary-flow-negative
comparison useful when that boundary could change the judgment. Retrieval stays
optional and bounded. Complete attack-row briefs, timing, entering holds, all five
dimensions and the existing Lens tools remain available. No post-hoc explanation
or omitted-note explanation stage is introduced. The evaluation retains the
production output contract, including its short concurrent rationale and note
selection, to avoid another unmeasured execution change.

## Frozen acceptance policy

Presence is `present` versus a resolved `absent`. Supporting and prominent remain
separate exact assessments. Metrics score only actual human cells; another
returned dimension is not assumed negative. Count each source/scope/tag/rate cell
once per repeat. Repeats measure sensitivity to execution, not independent charts.

| Measure | Required result |
| --- | --- |
| Tech recall | At least 85%, and at least 10 percentage points above baseline. |
| Tech false-positive rate | At most 10%, and no higher than baseline. |
| Four disputed supporting Tech cells | Each exactly supporting in at least 2/3 repeats. |
| Tech strength | Exact agreement must not decrease; report supporting/prominent confusion separately. |
| Existing critical cells | Exact human assessment in every candidate repeat, as the existing gate requires. |
| Each other tag: correct-result retention | At least 95% of paired baseline-correct results remain exactly correct. |
| Each other tag: exact accuracy | Decrease at most 3 percentage points. |
| Each other tag: FP and FN rates | Neither increases by more than 5 percentage points. |
| Resolution and validity | All scored candidate cells resolved; complete, valid, source-bound output. |

False-positive rate uses gold-absent cells as denominator; false-negative rate
uses gold-present cells. Unresolved positives count as missed positives and all
unresolved results fail exact agreement and the resolution condition. Report
unresolved negatives separately, so abstention cannot pass through a lower FP
count. A missing positive/negative denominator is unavailable, never zero. Each
paired noncritical loss still receives the existing gate's explicit review;
aggregate improvement cannot waive critical failures or these thresholds.

These are operational adoption thresholds on a small development-exposed set,
not population error guarantees. The four disputed cells are Split EX
[100244,105891), cyanine [151337,156612), Quite Contrary [308280,311280), and
MEGALOVANIA [145819,149786), at 1x. Their latest human supporting assessments
remain authoritative; their old agent explanations are not new human reasoning.

## Stages and cost controls

1. Screen the four disputed positives against four existing human negatives:
   Brazil, Mazare Party, Pumpin' Junkies and Sesshoku, at their frozen exact scopes.
   Run three fresh repeats per condition with the production preparer and runner.
   This checks the proposed failure mechanism before expanding paid work.
   Advance only if every disputed positive is exactly supporting at least 2/3,
   the candidate adds at least two exact positive successes across the 12 trials,
   and there is at most one negative false positive, with no increase over baseline.
   Also enforce the stability and resolved-output conditions on available screen
   gold. The 85% recall and 10-point gain requirements apply to final combined
   adoption metrics; this screen alone cannot authorize adoption.
2. A promising candidate must also pass the unchanged 28-cell regression suite
   and the seven-section, 35-cell all-dimension feedback suite. Combine distinct
   cells for the adoption metrics; retain suite-specific and per-cell results.
   For the four duplicated negative cells, always use original-suite predictions
   in final metrics; screen predictions remain a separate diagnostic. Add only
   the four new challenge sections from the screen. Never choose the better of
   two predictions. Report integer denominators: a single error can exceed a
   percentage tolerance on these small per-tag strata.
3. Allow at most two candidate attempts in this experiment. Retain failed outputs
   and do not relax thresholds after observing results. If the screen fails,
   stop or make one evidence-grounded revision; do not run the large suite merely
   to search for a compensating aggregate gain.

Use `gpt-6-astra` at medium reasoning, fresh ephemeral jobs, at most five sections
and 28,000 brief characters per job, and concurrency at most three. Preserve the
unchanged production `common_prompt`, output schema and required Lens MCP setup.
Exclude target sources and known song groups from retrieval; strip target review
records from inputs. Ordinary named guide examples remain, so these are exposed
regression checks, not a held-out benchmark. Existing grouping does not prove all
alternate-title aliases were discovered.

Reuse the adopted V3 baseline's completed workers only after matching judgment
source, suite, model, Foundation and evaluation-data identities. Freeze the same
calibration pool for paired runs. Preserve shared prompt text; place variable
source evidence in the existing brief rather than duplicating it in the prompt.
Run jobs close together and aggregate actual input, cached input, output and
reasoning usage. Do not claim monetary savings from cache-hit percentages or
change model/reasoning solely to lower cost. These controls follow the official
[prompt caching guidance](https://developers.openai.com/api/docs/guides/prompt-caching).
CLI support determines exposed cache controls; do not invent unsupported flags.

Candidate files and full receipts are local under
`.local/tech-recognition-20260910/`. Production guidance is unchanged until all
adoption conditions pass. Evaluation never submits human decisions or changes
the published dataset.

## Completed results

Eight fixed sections were evaluated in three conditions: current production,
candidate V1 and candidate V2. Each condition used three fresh repeats, split into
two four-section jobs per repeat. The 18 distinct workers returned 360 judgments;
216 had exact human gold and were scored. All outputs were complete, resolved and
mechanically valid. Root independently verified every frozen input/response hash,
model setting and the 18 distinct thread identities. Missing human dimensions
were left unscored.

| Screen measure | Production baseline | V1 | V2 |
| --- | ---: | ---: | ---: |
| Tech positives exactly supporting / 12 | 2 | 4 | 3 |
| Tech recall | 16.7% | 33.3% | 25.0% |
| Tech false negatives / 12 | 10 | 8 | 9 |
| Tech false positives / 12 negatives | 4 | 6 | 4 |
| Tech false-positive rate | 33.3% | 50.0% | 33.3% |
| All Tech exact / 24 | 10 | 10 | 11 |
| Jack exact / 12 | 12 | 12 | 12 |
| Stream exact / 12 | 11 | 12 | 12 |
| Trill exact / 12 | 11 | 11 | 11 |
| LN coordination exact / 12 | 12 | 12 | 12 |
| Paired baseline-correct Trill retained / 11 | — | 10 | 10 |

Both candidates fail. V1's extra positive detections accompany two extra false
positives; its total Tech accuracy is unchanged. V2 adds one positive success but
keeps four false positives. Split EX and MEGALOVANIA remain absent in all six
candidate runs. Quite Contrary is supporting once in V1 and never in V2; cyanine
is supporting in all three repeats of both candidates. Each candidate also loses
a previously correct MEGALOVANIA Trill result, in different repeats: 90.9%
retention fails the 95% requirement despite unchanged aggregate Trill accuracy.
There are no Tech strength-only errors in this screen.

V2 was proposed after V1 had mathematically failed the screen, before V2 launched.
Its guide reads column/action sequences alongside rhythm and articulation:
unchanged pulse does not prove unchanged construction, and pulse changes do not
prove Tech. Its role requires inspecting both positive and negative source
arrangements when a human comparison settles the boundary, reusing useful
contrasts across cases. It remains a combined guide/role change. No target answer
was added. V1/V2 guide budgets are 1,499/1,498 words; other style sections and the
main skill entrypoint remain identical to baseline.

The first-repeat V2 traces confirm the observable intervention happened. Both
workers inspected complete Kanjou negative and deathpiano supporting source rows,
including entering holds; target perspectives were also used. That improved
inspection did not resolve the distinction. Several negative judgments still
relied on the lack of displaced or fragmented construction; Sesshoku's pickup
rhythm still triggered false positives. These are observed machine readings,
not new human causal explanations. Internal reading order is not observable.

No candidate advances to the original 28-cell gate or seven-section feedback
suite. Their 24 existing baseline jobs were validated as reusable, but no new
full-suite comparison was launched. Therefore this report makes no new broader
stability or full regression-pass claim. Stop at the predeclared two-candidate
limit; retain both experimental patches without installing either production
skill. Do not modify human gold to rescue the hypotheses.

The remaining inference is narrower than a general capability claim: neither
short wording clarification nor the tested two-source comparison sufficiently
separates these weak Tech positives from ordinary rhythmic constructions. A
future attempt needs source-based contrast learning and disjoint evaluation,
rather than another permissive positive cue or larger replay of these same eight
development cases. This does not require post-hoc generated explanations or
additional human rationale authoring.

## Actual usage and artifacts

The three arms used **3,136,971 input tokens**, of which **2,527,104 (80.6%)** were
reported cached, leaving 609,867 uncached input tokens. The runtime also reported
59,242 output tokens and 5,749 reasoning-output tokens. These are worker usage
receipts, not total conversation usage or a monetary/account-quota calculation.
V2 reused the six screen-baseline workers; failed screens prevented the larger
candidate comparisons. No model or reasoning downgrade was used.

Local `proposal-before-runs.md` and `proposal-v2.md` retain the prelaunch proposals;
freeze records bind the texts and candidate sources. `screen-*-score.json`,
`screen-v*-comparison.json`, `source-review.md` and `final-verification.json` retain
denominators, losses, usage, source inspection and all run/response identities.
`candidate-v1.patch` and `candidate-v2.patch` retain the rejected implementations.
`evaluate.py` uses the existing production prepare/run/scoring functions, without
canonical delivery. The local candidate checkout remains isolated from production.

Engineering verification: candidate skill validation and length budgets passed;
the repository `pnpm check` passed (503 TypeScript and 307 Python tests, type
checking, builds and smoke checks). Engineering success does not waive either
semantic failure. Existing human revisions and published v0.2.0 remain unchanged.
