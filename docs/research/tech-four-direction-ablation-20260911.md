# Tech failure: four-direction controlled ablation

Date: 2026-09-11. Status: completed diagnostic pilot; no arm eligible for extension.

The selected analogous examples improved one positive case, but neither added
time-view images nor the tested wording improved Tech beyond that example pack.
The experimental definition recovered one additional positive trial while leaving
the common false positive intact. All alternatives failed the predeclared
advancement criteria. No production skill, Foundation, human label or release was
changed. Design sections below preserve the pre-run plan; completed results follow.

## Question and authority

The previous [combined intervention](tech-reference-calibration-20260910.md) did
not recover supporting Tech reliably. This experiment separates supplied examples,
retrieval/delivery, source representation, procedural wording and Foundation
interpretation. It studies four directions; harness behavior requires two contrasts.
Human labels, source scopes, playback rates and published datasets remain unchanged.
No arm can approve a new Foundation or create human representativeness judgments.

Existing evidence distinguishes an actual stale input selection from hypotheses
about language and semantic interpretation. The 708 feedback document versions were
rechecked against canonical workflow revisions/hashes on this date: all still match
the September 10 freeze. Every arm therefore uses the same verified snapshot and
the same 440 eligible human records. No historical baseline is reused for the new
controlled-policy comparisons.

## Frozen comparison graph

All arms use the production selected-section preparer, gpt-6-astra with medium
reasoning, fresh ephemeral worker processes, the same Lens implementation, complete
source rows/entering holds and five-dimensional output contract. Controlled ablation
instructions are explicit additions, not an assertion that the prompt is untouched
production. Existing failed candidate co-label code is not used.

| Arm | Tech example access | Representation | Tech guide | Foundation |
| --- | --- | --- | --- | --- |
| B | Autonomous retrieval from current eligible pool | Text rows | Current | Approved F0 |
| G | Fixed generic four-example pack | Text rows | Current | F0 |
| E | Fixed analogous four-example pack | Text rows | Current | F0 |
| R | Same pack as E | Same text plus complete time piano-roll pages | Current | F0 |
| W | Same pack as E | Text rows | Procedural first-paragraph revision W1 | F0 |
| F | Same pack as E | Text rows | Identical W1 | Explicit unapproved experimental F1 |

- **E versus G, gold:** effect of the chosen comparison-pack composition/relevance.
  The pool is identical; this is not an old/new snapshot effect or proof of corpus
  sufficiency. Example count and assessment balance are matched, not note/token
  count, comment richness or difficulty.
- **E versus B, harness access:** effect of guaranteed direct calibration and its
  restriction to a fixed Tech pack, versus autonomous retrieval. This combines
  delivery and access policy; it does not isolate ranking quality alone.
- **R versus E, harness representation:** adding the existing deterministic time
  piano-roll view while keeping all textual source information. This tests an
  additional representation, not whether image-only judgment is better.
- **W versus E, skill language:** change only the first Tech guide paragraph;
  keep role, remaining guide, examples and approved Foundation identical.
- **F versus W, Foundation:** change the explicit Tech definition and necessary
  experimental identity/approval metadata. All other definitions/cues remain
  identical. Agreement measures compatibility with historical gold, not correctness
  under an independently validated F1.

The row arms do not use rendered images. Fixed-pack arms read all four supplied
Tech examples and use those for Tech calibration; ordinary factual inspection and
other-tag example retrieval remain available. Cards, source reads, image delivery
and policy crossovers are audited. Instructions cannot establish that evidence was
actually consumed or that a comparison is conceptually adequate.
Keep assigned-arm outcomes when a worker deviates, and report the violation;
do not silently discard it or claim that the intended factor was successfully
tested. An arm with unmet required evidence controls cannot advance.

The image arm uses existing `render_section` time coordinates and page coverage,
including complete review context and entering holds for targets and examples.
Image layout carries source facts and original identifiers, with no target labels
or controller explanations. Native image responses and page identities are traced.

## Comparator selection, before seeing new outputs

A separate agent selected packs using complete target source arrangements and
eligible human example sources. It was denied target gold, historical/new worker
responses, scores and prior output rationales. The parent suggested Destiny and
Paracausal as candidates to investigate; selection was therefore answer-blind, not
independent of all prior hypotheses. Paracausal was inspected and not selected.
Packs are shared across targets, not adapted to each target's answer.

| Pack | Human supporting Tech | Human absent Tech |
| --- | --- | --- |
| Generic G | SYSTEM ERROR; d e a t h p i a n o | Pentiment; Kanjou no Matenrou |
| Analogous E/R/W/F | Destiny; Q.E. | Swampgator; The Cyber Grind |

Both packs contain exactly two supporting and two absent records. All eight target
scopes are tap-only. The analogous pack covers chord flow, rhythmic subdivision
changes, repeated cells and sparse tails; the generic pack comes from the existing
curated Tech comparisons, including mixed-LN constructions. This is a controller's
relevance hypothesis, not an expert endorsement of representativeness. The actual
human assessments/comments and complete source context are delivered uniformly;
selection rationales and reconstructed explanations are not worker inputs.

Exact IDs/scopes, source identities, exclusions and inspected source facts are in
`.local/tech-ablation-20260911/comparator-proposal.json`. The source/song exclusions
cover all eight original screen sources, including targets not launched in the pilot.

## The isolated wording and definition changes

W1 replaces only the first paragraph under Tech:

> Apply the supplied Tech Foundation criterion to the complete scope. Describe
> sequence, rhythm and articulation, then compare relationships with scoped
> human positive and negative constructions. Regular timing or familiar named
> components are observations, not automatic verdicts. Decide whether the
> construction meets the Foundation criterion before judging strength. Keep
> uncertain interpretation separate from a certain supporting positive.

F1 changes the Tech definition to the following **experimental, unapproved target**:

> Tech is a local construction style expressed through the particular ordering and
> combination of column actions, rhythmic grouping, and articulation within or
> between cells. Use scoped human-positive and ordinary-flow examples to calibrate
> this style: familiar components and repeated cells may express Tech; generic
> variation alone does not establish it. Judge the whole episode without requiring
> a claim about a player's surprise, unfamiliarity, or difficulty.

This is a semantic intervention, not a claimed paraphrase of F0. Historical gold
continues to have its original authority and meaning. F cannot advance to production
adoption through improved agreement with those labels.

## Stages, thresholds and token economy

Stage 1 runs all six arms unconditionally, with three fresh repeats of the first
actual production group: Split EX [100244,105891), Quite Contrary [308280,311280),
Pumpin' Junkies (case-03), and Sesshoku (probe-08), at 1x. The first two have human
supporting Tech; the latter two have human absent Tech. There are 12 scored human
cells and 20 returned judgments per worker. These four cases follow unchanged
production grouping rather than a new target-answer-based ordering.

This is **18 workers**, a two-positive/two-negative local diagnostic pilot, not the
complete eight-case regression gate. Three repeats are execution sensitivity on
four sections, not independent source samples. No critical cell is in this first
group; critical coverage remains untested until extension.

Report every arm, exact/presence judgments, per-case repetitions, FP, FN, unresolved
positives/negatives, and each other tag's paired correctness. Missing class strata
are unavailable. Unresolved positives count as FN; unresolved negatives are errors,
not successful absence. No post-hoc filtering by inferred confidence is permitted.

At most one F0-compatible arm advances to the remaining production group if it:

- Gains at least two exact supporting positive trials over B across six trials,
  with each pilot positive exact in at least two of three repeats.
- Has at most one FP across six negative trials and does not increase B's FP.
- Resolves every scored human cell with complete valid output and faithful inputs.
- Retains at least 95% of each other tag's paired B-correct judgments, loses no
  more than three percentage points of exact accuracy, and increases neither FP
  nor FN rate by more than five points where the denominator exists.

If several qualify, choose highest exact positive count, then lowest FP, highest
all-gold exact count, then lowest uncached input usage. Run B and that arm on the
remaining four cases, preserving their three repeats; at most six additional
workers. Apply the [original full eight-case screen thresholds](tech-reference-calibration-20260910.md#frozen-experiment-and-cost-policy)
to the combined results. A passing screen still does not replace the broader
adoption gates. No extra candidate revisions or factorial interaction runs are
launched as part of this fixed diagnostic experiment.

Use one pool of at most three workers, stable common prompts, bounded production
groups and complete source reuse. Report actual cached/uncached receipts. Staging
avoids launching all 36 possible jobs when the pilot already shows no eligible
production improvement; it does not suppress any of the four diagnostic directions.

## Completed pilot results

All 18 fresh workers completed: six arms, three repeats, four sections per worker.
They returned 360 five-dimensional judgments, of which 216 have corresponding
human gold. These are repeated observations of four unique sections, not 216
independent examples. All scored cells were resolved and all outputs passed the
mechanical source/contract checks.

| Arm | Tech positive exact / 6 | Tech FN / 6 | Tech FP / 6 | All Tech exact / 12 | Stream exact / 6 |
| --- | ---: | ---: | ---: | ---: | ---: |
| B: autonomous current pool | 2 | 4 | 3 | 5 | 6 |
| G: fixed generic pack | 0 | 6 | 3 | 3 | 4 |
| E: fixed analogous pack | 3 | 3 | 3 | 6 | 5 |
| R: E plus time-view images | 3 | 3 | 3 | 6 | 4 |
| W: E plus procedural wording | 3 | 3 | 3 | 6 | 4 |
| F: W plus experimental definition | 4 | 2 | 3 | 7 | 5 |

Every correctly detected Tech positive was exactly supporting. Each arm's Jack,
Trill and LN judgments matched all six available gold observations per tag. The
Stream errors were Split EX prominent becoming supporting, not presence losses.
Stream has no negative gold in this pilot; Trill and LN have no positive gold.
Their missing FP/FN strata are untested, not zero-error evidence.

The repeated per-section results explain the aggregate change:

| Section | Human Tech | B exact / 3 | G | E | R | W | F |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Split EX, beatmap 4767840, [100244,105891) | supporting | 0 | 0 | 0 | 0 | 0 | 1 |
| Quite Contrary, beatmap 4940921, [308280,311280) | supporting | 2 | 0 | 3 | 3 | 3 | 3 |
| Pumpin' Junkies, beatmap 1040757, [16219,19930) | absent | 3 | 3 | 3 | 3 | 3 | 3 |
| Sesshoku, beatmap 2399799, [87341,88872) | absent | 0 | 0 | 0 | 0 | 0 | 0 |

All scopes use source milliseconds and playback rate 1x. E versus G recovers all
three Quite Contrary trials, while E versus B recovers only its second repeat.
Neither comparison recovers Split EX. This supports an effect of these particular
example packs, with composition/relevance still confounded with their token and
source complexity. It does not establish that more gold, or more typical gold,
would generally repair Tech recognition.

R versus E and W versus E produced identical Tech assessments in every paired
trial. Adding the existing time-view pages or revising this paragraph did not
solve the remaining Tech errors here. Both comparisons reduced Stream exactness
from 5/6 to 4/6: they lost E-correct Split EX repeats 1 and 3 and regained repeat 2,
so paired preservation was 3/5, not 4/5. This result does not exclude other visual
representations, prompts, factor interactions or runtime configurations.

F versus W recovered Split EX only in repeat 1. That same repeat also strengthened
the wrong Sesshoku prediction from supporting to prominent. This is weak local
evidence of a changed decision boundary, not a validated Foundation repair.
Historical-gold agreement cannot approve the experimental definition.

No candidate meets the advancement criteria: every candidate misses Split EX in
at least two repeats, every arm has three false positives rather than at most one,
and every candidate regresses Stream beyond the stability thresholds. Thus no
extension, broader regression suite or production adoption was launched. The
remaining 18 prepared jobs are unrun placeholders. Brazil and the other extension
sources remain untested in this experiment.

## Evidence delivery, cost and verification

A separate process audit verified complete target briefs in all 18 workers'
returned command output and complete calibration files in all 15 fixed-pack
workers. The target briefs match all 283 scoped attack-note tuples. All 57 native
image payloads in R match the prescribed source identities, page coverage and
decoded image hashes. Their complete review contexts were delivered. The existing
renderer does not shade claim scope; scope is supplied explicitly in the text and
page plan, which limits what this representation test establishes.

B retrieved Kanjou no Matenrou, d e a t h p i a n o and davay rasskazhem cards in
every repeat. All repeats inspected death piano's complete scoped attack rows;
only B2 additionally inspected Kanjou's rows. Davay remained card-only. This
confirms that autonomous access and direct-pack delivery created different
exposures; it does not isolate retrieval ranking or prove internal attention.

There were no failed shell/MCP calls, extra Tech retrievals in fixed arms, images
in row arms, or final frozen-input mismatches. Recovered model transport incidents
occurred in E1 (one reconnect) and W3/F1/F2 (six reconnect/network-wait events and a
WebSocket-to-HTTPS fallback each). All subsequently completed successfully; their
results are retained. Requested model and reasoning configuration were unchanged.
This pilot does not test higher reasoning effort or isolate transport effects.

The 18 worker receipts total 2,837,038 input tokens, including 2,117,376 cached
tokens (**74.6%**) and 719,662 uncached tokens, plus 55,392 output tokens. These
cumulative totals are not peak context size, monetary billing or whole-task usage;
parent/auditor usage and any unreported transport retries are outside the count.
R used 1,121,385 cumulative input tokens versus E's 359,557, and 177,385 uncached
versus 138,117, without improving Tech in this pilot. The frozen stop rule avoided
launching the extension after the pilot failed, rather than tuning additional
prompts against the same four cases.

Verification completed before the documentation milestone:

- All 1,221 frozen input files still match their hashes; all 18 scored workers
  have valid outputs, unchanged-input receipts and compliant access traces.
- Four local runner structural tests passed, covering isolated overlays, changed
  inputs, producer uniqueness and correct treatment of unrun jobs.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm check` passed: 503 TypeScript
  tests, 307 Python tests, skill/source budgets, types, build, package and smoke
  checks. Mechanical checks do not establish judgment quality.

The pre-run proposal is retained separately as
`.local/tech-ablation-20260911/proposal-before-runs.md` (SHA256
`b297410e95ff1b89d6e7aa49fa225036086c61ecff03b63761981e1e3cfb4f4d`).
The global freeze SHA256 is
`e9d20859f5c118bd1a9f93e64de50e82c2102b791fc2a124a3a8888255e151b1`.
Local `pilot-scores.json`, `pilot-analysis.json`, `process-audit.json` and
`usage-summary.json` retain per-trial outcomes, decision checks, delivery audit and
receipts. The source baseline is commit
`7e829b87282bab25ee2acc48266a78e4c296a33b`. The small diagnostic sample and missing
strata prevent generalization claims or approval of a replacement skill.

## Should expert representativeness be recorded?

Yes, initially for the small calibration subset. Keep three different questions:

| Question | Meaning and use |
| --- | --- |
| Presence and salience | Does this scope express the style, and how strongly? This remains the existing absent/supporting/prominent assessment. |
| Exemplar representativeness/use | Is this a useful canonical example, an atypical construction, or a boundary comparison for a stated teaching purpose? This helps choose calibration evidence. |
| Judgment uncertainty | Is presence, strength, scope, or exemplar suitability still in doubt? Uncertainty is not weak style expression. |

A clear supporting section can be an excellent example of weak expression. A
prominent section can be atypical. A near-miss can be a confidently absent and
highly useful counterexample. Thus a single axis from representative through weak
to uncertain would conflate different information.

The current contract already has independent optional `exemplarRole` values
`typical-positive`, `weak-positive`, and `near-miss`, plus `unresolved` assessments
and boundary uncertainty. `weak-positive` must not be reinterpreted as uncertain or
weakly representative. None of the 475 current effective human observations has
an explicit canonical `exemplarRole`; missing means unrecorded, not atypical.

The proposed next annotation affordance is optional expert example-use metadata
and, when needed, which judgment needs another look. Its wording and value mapping
need to preserve these axes; no schema/UI change is assumed necessary for this
experiment. Do not backfill from salience, empty comments, machine disagreement or
agent-chosen examples. Historical labels and already released records remain intact.
Prototype examples can guide learning, while atypical/boundary examples remain
necessary for evaluation; excluding them would make reported quality misleading.

Subsequent static tracing found a prospective delivery gap: the feedback API
preserves `exemplarRole` in claim summaries and publication keeps
`details.exemplar_role`, but `harness_examples._record` and `public_example` both
omit it. The current worker library/search therefore cannot use a future expert
marker without carrying it through those projections. Since all current effective
human records lack the field, this omission does not explain today's Tech misses.
An explicit expert designation must also remain distinguishable from an agent's
example choice merely attached to a confirmed label; confirmation alone does not
establish a dedicated representativeness review. No implementation was changed
during the frozen experiment.

A bounded follow-up would start with the eight calibration examples used here:
ask the expert which are useful to teach presence, weak expression or a confident
negative boundary, and separately record any uncertainty. Target relevance should
remain a relationship to a target construction, not be collapsed into global
typicality. This would make the next comparator intervention better grounded;
the pilot does not show that this metadata alone will repair recognition. No such
expert designation or new annotation task was fabricated in this experiment.
