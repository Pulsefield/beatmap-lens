# Human label confidence and automatic regression gold

Human reviewers can record **High** or **Low** confidence for each section label.
Confidence belongs to the human observation, independently of the claim's
`absent` / `supporting` / `prominent` assessment. A certain supporting judgment can
be High. Confidence does not assert that a section is a typical teaching example,
that witnesses are minimal/sufficient, or that its explanation was reviewed.

## Review and revision

The five assessment sliders retain one section submission. Each label has an
independent High checkbox beside its slider: checked means High, unchecked means
Low for new judgments. Newly authored and newly confirmed proposal drafts start
unchecked. There is no section-wide confidence assignment. An older human
observation without the field stays unchecked and its saved history identifies
confidence as unspecified, which means not recorded and is not a third confidence
level. Saving an unchanged historical observation does
not invent a confidence or create a revision.

Changing only confidence appends a human observation through the existing revision
path. Earlier labels, notes and confidence values remain inspectable. Changing a
draft's assessment, scope, tag or playback rate resets its confidence to Low so
certainty attached to an earlier judgment is not silently reused. Evidence-only
edits preserve confidence in the label. Edits made while saving remain in the
draft for the next submission.

The canonical field is optional `HumanObservationV2.confidence: "high" | "low"`.
It is absent from machine claims and independent audits. Human mutation inputs
carry per-decision `confidence` or per-claim `confidences` for direct observations.
Canonical feedback retains the observation-level field. Publication v4 exports
`human_confidence`, with null for historical omissions and machines, and reports
confidence changes in the immediate `human_revision.changed_fields`. Previous
published snapshots remain unchanged and readable.

## Re-reviewing a selected human batch

The Review page accepts `?confidencePlan=/confidence-review.json`, a same-origin
static JSON file served beside the Inspector build. A plan selects current human
observations for confidence review; it does not submit decisions or set confidence.

```json
{
  "version": 1,
  "id": "confidence-review-batch",
  "title": "Confidence review",
  "items": [
    {
      "id": "section-001",
      "sourceSha256": "SOURCE_SHA256",
      "observationIds": ["HUMAN_OBSERVATION_ID"]
    }
  ]
}
```

Group targets only when they share an exact source, scope, playback rate and
compatible original section/handoff. The queue opens the selected human labels,
preserves their original evidence, and follows revision links to their current
observations. Progress counts saved, explicitly recorded confidence. Use High or
Record Low separately for each label, then save the section. Unselected labels
remain outside the batch, and an unchanged unspecified confidence stays missing.

For a balanced batch, stratify unique current human cells by label and
absent/supporting/prominent, retain source/mapset diversity, and record the seed,
exclusions and selected observation identities. Such a batch is a targeted review
sample, not an estimate of the corpus distribution or a quota for High confidence.
Keep derived plans and feedback snapshots under `.local/`; rebuilding the Inspector
may remove a plan copied into its `dist/` directory, so retain the original under `.local/`.

## Regression selection

The active [method regression gate](../../annotation/evaluation/README.md)
automatically selects current effective High-confidence human observations from
the canonical workflow. A historical High superseded by Low is no longer gold;
old confirmations without confidence are not inferred to be High. Only settled
present/absent labels with the applicable Foundation and valid source evidence
qualify. Low and missing confidence do not become negative labels.

Gold cells are exact source/scope/tag/playback-rate identities. Consistent duplicate
observations share one scored cell while retaining their provenance. Conflicting
current judgments cannot be resolved by arbitrarily picking a row. The selected
suite pins canonical document and observation identities and is frozen once for
the baseline/candidate pair. Canonical revisions invalidate stale acceptance
evidence; a saved feedback directory alone does not establish current gold.

All selected High cells are protected across the required independent candidate
repeats. No eligible High labels, missing source data, incomplete runs or stale
gold must fail explicitly. Historical handpicked case lists and accepted receipts
remain historical artifacts and are not fallbacks. Target gold/confidence stay
with the controller, and the evaluation example pool excludes target sources and
their song groups. Deterministic pipeline tests establish these mechanics, not a
new model-quality pass.

Human confidence remains a reviewer's decision. Agent disagreement, passing a
regression threshold or wanting a larger suite does not authorize setting High,
lowering confidence or rewriting a historical human observation.
