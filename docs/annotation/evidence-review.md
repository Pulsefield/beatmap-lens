# Review evidence separately from labels

A section label, a witness selection, and an explanation are different review
targets. A human can correctly revise the label without having selected the
attached notes or endorsed the earlier explanation. Preserve that distinction in
the review record and in research claims about it.

## What the existing evidence means

`noteRefs` identifies source-backed witnesses for the claim. It can contain a
whole arrangement, a disconnected set, or selected members of chords. None of
those shapes establishes a defect, minimality, or sufficiency.

`contextNoteRefs` retains context. The section annotation delivery packager fills
it with the supplied review-context notes minus witnesses. That operation does
not select negative examples. Unselected notes have no recorded per-note omission
reason. Preserve the full section and review context when interpreting a subset,
including intervening unselected rows and the original endpoints of entering long
notes. Source coordinates remain original milliseconds at every playback rate.

`auxiliary_evidence_status` concerns the packet's referenced human examples and
their snapshot-relative compatibility. It does not check whether this claim's
explanation still supports this claim's current assessment. An independent
machine audit also does not certify human selection, a minimal witness set, or a
counterfactual removal experiment.

An evidence-review-only human revision still has a new observation identity and
hash. Packets citing its predecessor may therefore acquire `changed` auxiliary
status even if the label and notes did not change. That status reports an exact
dependency mismatch, not semantic disagreement. Do not silently retarget the old
reference to the new observation.

## Complete a supplemental review

Use an exact source hash, section, tag, playback rate, and observation identity
from the review plan. Check that the target is still the effective observation;
a newer revision requires comparison before carrying forward the task. Keep the
published record identity in the review result even when its replacement gets a
new observation identity.

1. Read the final human assessment and the ancestor proposal separately. Keep the
   final assessment as the target unless an explicit new human judgment revises
   it. A missing or obsolete explanation does not invalidate that label.
2. Inspect the full arrangement at the recorded playback rate. Evaluate the
   selected notes in their actual timing, chord, hold, and surrounding context.
   Whole-section evidence may be appropriate; do not shrink it to satisfy a
   selection-cohort filter.
3. Decide whether the current witness set supports the final assessment. Keep or
   edit it deliberately, then explicitly mark selection reviewed in the evidence
   editor. Ordinary section Save does not make that assertion.
4. Check the explanation against the final label, scope, and witnesses. Supply
   or revise it if necessary; only mark rationale reviewed after reading the
   resulting explanation. Use **Save evidence review for this judgment** for an
   existing human label; it preserves the source interval, tag, rate and assessment
   and does not require filling other unreviewed dimensions. A change to that
   target belongs in the ordinary section revision. Historical
   prose remains accessible in its original observation/proposal.
5. Record the outcome as accepted, revised, or still unresolved for the requested
   evidence purpose. A deferred evidence question remains open even when its
   section label is usable. Do not close a task merely because a new record exists.

The UI records whether notes were inherited, automatically filled from the
section, explicitly selected as the whole arrangement, or manually edited. Those
operations describe how the set was made; the separate review flags describe
what was explicitly checked. Missing metadata in historical observations means
unknown. Reopening inherited evidence does not retroactively certify it.

## Acceptance depends on the research question

For **section-label supervision**, require the appropriate label authority,
source/version binding, and a resolved target. Missing tag assessments remain
missing. Deduplicate agreeing exact source/scope/tag/rate cells within the chosen
authority policy while preserving their record identities.

For **why these notes**, additionally require an explanation of the current
witness set under the current label and scope. Human-reviewed selection is still
not evidence of a unique, smallest, or sufficient subset.

For **why other notes were omitted**, collect an explicit contrast judgment.
Specify which unselected notes or groups were considered and whether they are
redundant, contextual, irrelevant to this dimension, or unresolved, with an
explanation. Those are review questions, not labels derivable from the complement.
The existing release does not supply this supervision. Generic selection review
alone does not fill that gap.

For **predicting strength from evidence**, use present supporting/prominent
targets, preserve the whole section as context, and specify the intended section
scale and player/rate conditions. Absence is a separate presence target. Exclude
rationale and other answer-bearing prose from predictor inputs. Group evaluation
by song/audio and inspect the recorded exemplar dependencies; an exact-cell
deduplication does not produce an independent evaluation split. Compare an
evidence-based model against a full-section baseline before claiming the selected
set explains strength.

See the [v0.2.0 evidence findings and review plan](../research/evidence-quality-v020.md)
and [publication contract](dataset-publication.md). These review requirements
describe additional evidence research; they do not redefine Foundation labels.
