# Tech recognition: calibrating the reference instead of proving difficulty

Date: 2026-09-10. Outcome: the new candidate failed its frozen screen and was not
adopted. The approved Foundation and production method remain unchanged.

## What the earlier experiments did not establish

The [two failed revisions](tech-recognition-revision-20260910.md) used a consistent
but older human-feedback snapshot. Consistency with a frozen directory does not
establish freshness against current canonical human decisions. A fresh read-only
audit of all 708 campaign sources found 185 changed document versions. Every API
response was checked against its current workflow revision and canonical hash.

With identical screen source/song exclusions, the available pool increases from
360 to 440 human records. Tech increases from 102 to 118: supporting 23 to 32,
absent 57 to 63, and prominent 22 to 23. Destiny, The Worst and both Yolomania
supporting Tech scopes were absent from the previous calibration snapshot.
Destiny has an actual human comment connecting primary Jack, a Stream framework
and rhythmic changes to Tech; several other comments discuss different dimensions
and must not be promoted into Tech-specific human explanations.

This is an input-selection omission, not a demonstrated revision-resolution bug.
The preparer faithfully freezes its supplied directory; it does not refresh that
directory from the canonical service. Keeping the old directory was valid for
paired wording comparisons but did not test learning from all current feedback.
Old workers cannot serve as a matched baseline after refreshing that pool.

## Four explanations, with different evidence

| Hypothesis | Finding and limitation |
| --- | --- |
| Relevant gold was not supplied | Some recent relevant gold was missing. Other framework positives already existed but were hard to discover. Lack of analogous gold is partly a coverage problem and partly retrieval visibility; it is not established that the corpus has no adequate contrasts. |
| Harness was insufficient | Complete rows and tools were available, but search matched literal comments/titles and ordered results by label then ID. Only 3/23 old supporting Tech examples had substantive comments. Two curated Tech sets advertised only two supporting examples. They were not structural-neighbor retrieval. |
| Wording induced the wrong task | Workers repeatedly converted stable timing into absence and timing changes into presence. Requiring a convincing story about difficulty can become a separate, unsupported gate on human-calibrated style. This is a hypothesis about interpretation, not a proven sentence-level cause. |
| Foundation is underspecified | “Hard to anticipate or follow through familiar patterns” needs a reference repertoire or player. The supplied canonical profile does not identify that repertoire; playback rate alone does not supply it. This does not prove inconsistent human gold or make learning a shared style convention impossible. |

The literal psychological claim and a learned annotation convention are different
targets. The latter can be learned from judged constructions without inventing
the player's familiarity. No experiment so far justifies rewriting the human
labels or declaring a general loss of model capability.

## A more fundamental formulation

Separate observable arrangement `X` and playback rate `r` from a player's
repertoire/capabilities `p` and the annotation convention `H`. There are at least
two legitimate targets: `J_H(X, r, scope)`, agreement with a human-calibrated style
judgment, and `R(X, r, p)`, a player's response to that arrangement. Existing human
gold supervises the first. It may reflect the annotator's response, but without
declared profiles or comparative judgments it does not identify the second.

This explains why an apparently structural definition can become circular: an
agent names a familiar construction, decides that it must therefore be easy to
follow, and uses that invented reference experience to reject Tech. Conversely,
describing something as irregular can invite a positive without establishing the
human style boundary. These are plausible shortcut mechanisms, not measurements
of the model's internal reasoning.

The experimental change treats human judgments as calibration data for `J_H`.
It does not require an agent to reconstruct an unavailable player or to write
new human reasons. A future explicit response model would need profile-conditioned
judgments on the same constructions, ideally including fixed-note rate changes.
Rate sensitivity alone cannot distinguish player limitations from changes in
perceptual grouping or a shared style convention.

## New recognition mechanism

Use confirmed constructions to calibrate what the Foundation's reference means
in this dataset. Read the complete target construction, retrieve comparable
positive and negative human constructions, inspect the relationships that make
the analogy applicable, and then decide presence and strength independently.
An explanation records the decision; producing persuasive difficulty prose is
not an additional positive-label requirement. Human verdict, source facts and
machine interpretation remain separate. No post-hoc explanation task is added.
We test whether exemplar-conditioned recognition faithfully operationalizes the
approved meaning; that equivalence is not established by keeping Foundation bytes
unchanged. Agreement with human labels can support usefulness without independently
validating a psychological interpretation.

The experimental harness adds an optional `co_tag_id` filter to
`find_human_examples`. For example, Tech judgments can be retrieved where the
same source/scope/rate also has human-confirmed Stream presence. This exposes
framework comparisons even without a human comment. Cards retain the contributing
human example identities. Different rates/scopes/sources do not join; missing
co-labels remain unknown, conflicting co-labels cannot satisfy the filter, and
source/song exclusions also govern contributing labels. Retrieval is bounded and
is not a similarity score, majority vote, or numeric style classifier.
Human co-assessment also does not establish a shared organizing framework: source
inspection must establish whether a retrieved construction is actually comparable.

The Tech guide is rewritten around this comparison process. Generic named pairs
remain available for appropriate constructions; opening the same pair does not
prove that it addresses every target. All other style sections, source coordinates,
Foundation contents, output contract and model settings remain unchanged. This is
a joint guide/role/retrieval intervention, not an isolated ablation of each part.

## Foundation wording for discussion only

The following is an **unapproved alternative**, not a replacement for any frozen
Foundation or a new interpretation silently applied to published labels:

> Tech is a local construction style calibrated by human-approved examples. Its
> character resides in ordered column actions, rhythmic grouping and articulation
> across an episode. Familiar components and repeated cells can carry this
> character. Judge presence against confirmed Tech and ordinary-flow constructions,
> and supporting/prominent by the strength of that character. Claims about
> anticipation, readability or difficulty require an explicit reference repertoire
> or player context and are separate interpretive claims.

This makes the dependence on human calibration explicit rather than claiming an
independent psychological measurement from chart rows. It is not a complete
feature definition. An explicitly player-response target is another possible
research formulation, requiring a declared profile and its own validation. The
current experiment tests a recognition procedure under the unchanged approved
Foundation; it cannot approve this alternative definition.

## Frozen experiment and cost policy

Use the same eight development-exposed screen sections and exact human cells as
the prior experiment, with the same numerical thresholds. Both the unchanged
production baseline and this single new candidate receive the newly frozen
feedback pool. Run three fresh repeats per side through the actual production
preparer, grouped briefs, Lens MCP, five-dimensional output and gpt-6-astra/medium
configuration. Jobs contain at most five sections/28,000 brief characters, with
at most three concurrent workers. Target source/song judgments remain excluded.

Advancement requires each of the four disputed supporting Tech cells to be exact
in at least 2/3 repeats, at least two extra exact positive successes over baseline,
and at most one false positive across the 12 negative trials, without increasing
baseline FP. Other tags retain at least 95% of paired correct results, lose at
most three percentage points of exact accuracy, and worsen FP/FN rates by at most
five points. Scored outputs must be resolved and valid; available critical cells
must all be exact. Missing class denominators are unavailable, not zero error.

Only a passing screen proceeds to the unchanged broader suites. Full adoption
still requires Tech recall at least 85% and a ten-point gain, FP at most 10% without
increase, no Tech exact decline, every original critical assessment correct in
every repeat, and the other-tag stability thresholds. No pooled result may hide
paired losses. This run tests one new candidate, not open-ended prompt search.
Previous old-pool results are descriptive historical context only.
These are development-exposed regression tests. Passing them would still leave
generalization to a separately reserved source/song-disjoint set unmeasured.

Keep common prompts stable, read source once unless further context is needed,
reuse inspected comparisons within a job, and report actual cached-token receipts.
Refreshing the pool invalidates old baseline reuse; token economy cannot justify
that mismatch. Do not alter human judgments, previous releases or prepared jobs.
Local proposals, patches, API snapshot and run receipts are under
`.local/tech-rethink-20260910/`.

## Completed production experiment

Both arms completed all six jobs: 12 distinct ephemeral worker threads, four
sections per job, three repeats, gpt-6-astra with medium reasoning. The eight 4K,
1x sections produce 40 judgments per repeat; only the 24 actual human gold cells
are scored. Across both arms there are 240 outputs and 144 scored observations.
The maximum brief is 11,130 characters. These are cumulative repeated judgments
of eight sections, not 144 independent samples or a measurement of peak context.

Paired cases, briefs, Foundation, output schemas and job AGENTS files are byte
identical. The evaluation-data digest is identical. Only the Tech guide, labeler
role and two example-retrieval implementation files differ. Input/output hashes,
distinct producer/thread identities and the pre-launch candidate freeze were
verified after completion. No target gold was added to worker inputs.

| Measure | Fresh-pool production baseline | New candidate |
| --- | --- | --- |
| Tech positive presence and exact supporting | 1/12 | 2/12 |
| Tech false negatives, including unresolved positives | 11/12 | 10/12 |
| Tech false positives | 4/12 | 0/12 |
| Tech unresolved gold-negative trials | 0/12 | 3/12 |
| Tech exact assessment, all gold trials | 9/24 | 11/24 |
| Jack exact | 11/12 | 12/12 |
| Stream exact | 12/12 | 10/12 |
| Trill exact | 11/12 | 11/12 |
| LN coordination exact | 12/12 | 12/12 |

There is also one unresolved positive Tech result. All three *Sesshoku* negatives
become unresolved rather than correctly absent. Therefore zero FP is not zero
negative error, and the candidate fails the resolved-output requirement.

| Supporting Tech challenge, exact scope in ms | Baseline exact | Candidate exact |
| --- | --- | --- |
| Split EX (Instrumental Ver.), [100244,105891) | 0/3 | 0/3 |
| cyanine, [151337,156612) | 1/3 | 1/3 |
| Quite Contrary, [308280,311280) | 0/3 | 1/3 |
| MEGALOVANIA (Camellia Remix), [145819,149786) | 0/3 | 0/3 |

The matching cyanine totals hide a lost baseline-correct repeat and a different
newly correct repeat. For other tags, the candidate retains Jack 11/11, Stream
10/12, Trill 11/11 and LN 12/12 baseline-correct results. Split EX Stream is
incorrectly demoted from prominent to supporting in repeats one and two. This
fails the 95% retention and maximum three-point accuracy-loss requirements.
The available critical Brazil cell remains correct in all three repeats, but
that cannot waive the failed challenge, improvement, resolution or stability gates.
The broader suites were consequently not launched; no full adoption claim is made.

The old-pool production result was 2/12 positive Tech and 4/12 FP. The fresh-pool
baseline's 1/12 and 4/12 shows no observed recovery merely from making current gold
available. This small historical comparison does not isolate a causal freshness
effect or establish that new gold has no value.

All six candidate workers used `co_tag_id`, with 13 such searches and no failed
harness calls. They saw 22 distinct example cards and inspected ten distinct
example sources. Every inspected example had complete attack-row coverage of its
human scope plus entering holds, including second pages where necessary.

New supporting *The Worst* was fully inspected by all six workers; new negative
*Jumpstream Complexes Vol. 2A* by three. These were the only newly added Tech
examples whose sources were inspected. *Destiny* was neither exposed nor inspected;
*Yolomania* cards appeared in three workers without source inspection. Thus the
new pool and retrieval were actually used, but the particularly relevant Destiny
calibration was never tested. Co-tag filtering still does not select the most
informative construction. Returned rationales continue to distinguish many
supporting examples by fragmented/interrupted organization and several targets by
familiar flow; this is output evidence, not proof of an internal causal mechanism.

## What follows from the result

The implemented combined revision is insufficient. It does not prove that
exemplar-based recognition is inherently ineffective, that human gold is wrong,
or that the Foundation must change. The candidate must remain isolated.

The next useful diagnostic should separate access from representation and
interpretation, before another broad wording revision:

1. For the same small targets, fix genuinely comparable positive/negative source
   constructions chosen independently of the target's answer. Supply those
   comparisons directly in one arm and use autonomous retrieval in the other.
   This tests retrieval selection instead of conflating it with recognition.
   Co-label agreement alone is insufficient to establish a useful comparison.
2. With comparisons fixed, compare the existing attack-row representation with
   the already available piano-roll view. A gain would point toward an evidence
   presentation problem; it would not require changing labels or player theory.
3. If neither resolves the boundary, distinguish failure to infer the human
   convention from an ambiguous target definition. Compare human judgments on
   matched constructions across rates or explicitly declared profiles before
   claiming player dependence. Preserve original gold and any new judgments as
   their own observations. Do not invent missing human reasons.

These are proposed discriminating tests, not additional runs performed here.
Retuning on the same eight exposed sections cannot establish generalization.

## Verification and resource use

The candidate passed the complete repository check: 503 TypeScript tests, 313
Python tests with four skips, type checks, source/skill budgets, builds, package
checks and validator smoke tests. The isolated checkout reused locked local
dependencies. On this Node 24 environment the check used
`NODE_OPTIONS=--no-experimental-webstorage` so Happy DOM supplies its test storage;
the first environment setup attempts failed before that was corrected. Deterministic
tool checks do not establish semantic success.
The final main checkout also passed its complete repository check: 503 TypeScript
and 307 Python tests, plus the remaining check stages.

| Worker receipts | Input tokens | Cached input | Output tokens |
| --- | --- | --- | --- |
| Fresh baseline, six workers | 1,096,402 | 914,432 | 19,219 |
| Candidate, six workers | 1,495,486 | 1,201,664 | 22,240 |
| Total | 2,591,888 | 2,116,096 (81.6%) | 41,459 |

The receipts also report 3,703 reasoning output tokens. They cover these 12
workers, not the whole parent conversation/research agents, peak context, or
actual billing. The candidate incurred more retrieval work; caching did not make
it free. Failed screening stopped the more expensive broader evaluation.

Local retained artifacts include `proposal-before-runs.md`, `candidate.patch`,
`candidate-freeze.json`, `feedback-freeze.json`, `gold-coverage-audit.json`,
`process-audit.json`, `paired-input-check.json`, `run-integrity.json`, both score files and
`comparison.json`. The preparer's snapshot semantics are now explicit in the
[harness operating guide](../annotation/annotation-harness.md#human-authority-and-evaluation).
