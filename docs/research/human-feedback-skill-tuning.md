# Human-feedback skill calibration after v0.2.0

Date: 2026-09-10. Outcome: V3 adopted with explicitly accepted noncritical
limitations. This updates guidance for future annotation; the published v0.2.0
dataset and its frozen method retain their original identities.

## What changed

The latest effective review contains 80 judgments across 16 sections. Eight
selected human observations were added to the structured feedback ledger with
source, scope, playback rate, decision identity and rationale provenance.

The guide now covers Super Nuko's closing four-tap Trill, Catalinesie's perceived
ending transition, and think abt it's recurring three-note turns as supporting
positives. The Worst and Jumpstream Complexes remain negative grouping contrasts.
Destiny supplies supporting Stream alongside prominent Jack; another prominent
dimension does not impose a salience ceiling.

Presence and strength are distinguished within Trill, with the older Grimoire,
Lagtrain, Caravan and za kazdym contrasts retained explicitly. Eviternity's
confirmed supporting LN label is restored alongside its source structure.
Yolomania supplies scoped LN and Trill negatives: its human tap-like LN reading
does not erase its longer holds and split endings, and the human supplied no
Trill-specific causal explanation.

The final guide is 1,499 words / 11,102 characters, versus 1,500 / 10,863 before.
All skill Markdown is 3,496 / 26,510, versus 3,497 / 26,271. Existing limits hold.
No Foundation definition or numerical speed/count threshold was introduced.

## Comparison design

The unchanged original suite contains 28 exact human cells, including 14 protected
cells across five dimensions. The baseline and each candidate use three fresh,
independent repeats of gpt-6-astra at medium reasoning effort. Each worker receives
at most five sections and a bounded brief, in its own ephemeral context. Source,
Foundation and example inputs match within each comparison; target sources and
known song groups are excluded from human-example retrieval. Evaluation outputs
are not delivered to the annotation workspace.

A separate replay scores all five dimensions on seven recent-feedback sections:
35 cells per repeat. It does not replace the original suite or change its gold.
The same frozen baseline runs, prepared from Git parent `74fcff5`, are reused
against distinct candidates. Rejected candidates and their outputs remain local.

Named calibration examples are ordinary skill content. These are deliberately
**exposed regression checks**, including possible scoped-label recall, not held-out
accuracy, causal ablations, or an accuracy estimate for the published dataset.

## Results

Counts below are exact agreement with human assessments over three repeats.

| Version | Original suite / 84 | Protected / 42 | Recent feedback / 105 | Decision |
| --- | ---: | ---: | ---: | --- |
| Baseline | 46 | 28 | 79 | Published prior method |
| V1 | 48 | 31 | 88 | Rejected |
| V2 | 58 | 41 | 90 | Rejected |
| V3 | 60 | 42 | 95 | Accepted with named limitations |

V1 improved the new fragmented Trill positives but incorrectly added Trill to
Destiny in all three repeats. It also failed protected cells and introduced a
Hysteric Night Girl Tech strength regression.

V2 clarified presence versus strength globally. It recovered the four protected
Trill anchors and Eviternity, but over the top Stream became prominent once and
The Worst Stream fell from prominent 3/3 to 1/3. V3 restores the original global
Style judgments paragraph and keeps the stronger clarification within Trill.
This is a tested revision, not proof that one sentence caused either regression.

V3 preserves all protected assessments in every repeat. The Worst Stream,
Yolomania LN/Trill, the three new supporting Trill positives, and Destiny Stream
each match their human assessments 3/3.

## Accepted limitations and review disagreement

The original broader suite contains one paired loss: Android Girl LN coordination
is supporting 3/3 at baseline and 2/3 in V3, with one incorrect prominent result.
The independent broader reviewer recommended rejecting this loss. The root
accepted the narrow revision with this explicit residual risk: the output retains
the correct scope, coordinated presence and hold relationships, while making an
unsupported ordinal strength increase once. The incorrect label is not approved.
No universal sequential-hold ceiling was invented from a generic confirmation;
the exact human supporting assessment retains precedence. The review artifact
preserves both the rejection recommendation and the root's adoption decision.

The supplemental review separately accepts these observed limitations:

| Cell | Correct baseline → V3 repeats | Remaining error |
| --- | --- | --- |
| Super Nuko LN | 1/3 → 0/3 | Separate endpoints under an anchor are overread as coordination. |
| Yolomania Tech | 3/3 → 2/3 | One run dismisses expressive cells through regularity and tap-like tails. |
| Destiny Trill | 3/3 → 2/3 | One run promotes the real short alternating bridge into Trill. |
| Destiny Tech | 2/3 → 1/3 | An already unstable comparison boundary becomes worse by one repeat. |

These remain failures. They are not all isolated errors, and three repeats do not
establish statistical noise. Shared older Tech presence/strength errors also
remain unresolved. Adoption accepts specific noncritical limitations; it does
not silently turn higher aggregate agreement into approval of every output.

Source/reasoning review also retains a precise erratum: A Fool Moon Night V3
repeat 3 calls the 242923 ms triple offbeat. It is onbeat; the preceding LN head
at 242815 ms is offbeat. The other pulse-turn and LN/triple relationships still
support the label. Eviternity's explanations based on releases/rests are model
inferences, not human-approved causal rules. Raw outputs were not repaired.

## Evidence and next use

The [original comparison](../../annotation/evaluation/accepted-evidence.json)
retains frozen identities, output receipts and named dispositions. The separate
[feedback cases](../../annotation/evaluation/feedback-tuning-20260910/cases.json)
and [comparison](../../annotation/evaluation/feedback-tuning-20260910/evidence.json)
retain the supplemental scope and review. The actual-parent semantic check is:

```sh
uv run --locked python annotation/evaluation/regression_gate.py check --base-ref 74fcff5
```

The source baseline advances together with accepted evidence; checking against the
prior Git tree still verifies this change. This covers selected-section labeler
guidance, not independent auditor or discovery quality. New batches freeze the
maintained skill; prepared batches keep their existing bundles.

Skill schema/budget validation and the actual-parent semantic gate passed. The
complete `pnpm check` passed: 493 TypeScript tests, 290 Python tests, type checking,
builds, package checks and the corpus/category-map smoke checks.

Human wording and literal source facts remain separate. The Worst contains an
equal-gap 1–2–1 despite its perceived-grouping comment; Catalinesie's adjacent
attack pulse remains roughly 65–66 ms through the perceived faster transition.
Neither supplies a literal timing rule. Player-profile dependence remains a
research hypothesis: this 1× calibration does not establish a new profile-based
definition. Further generalization needs unseen sections and explicit contrasts.
