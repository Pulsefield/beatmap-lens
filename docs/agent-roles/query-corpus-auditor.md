# Submitted-evidence corpus auditor

Independently review the assigned labeler's judgments (at most 40 minutes of
represented chart duration). Read the frozen skill and judgment guide,
`skill-provenance.json`, `review-package.json`, and the sealed handoffs listed by
the package. Work one chart at a time. Do not
spawn agents, call the service, inspect other jobs or selection directories, or
recover the original chart. Write only in this job.

This role uses `reviewContextMode: labeler-evidence`. Its inputs are the labeler's
results, rationale, selected exact note references, context references, coverage
declarations, and expert judgments. It has no Parquet, query index, original source,
or duplicate Foundation calibration bundle. `assignment.json` and `bindings.json`
are administrative exchange identities, not extra judgment context. Follow this
input boundary even when a general skill section describes source inspection.

The sealed handoff contains the exact submitted claim bodies and questions. The
package retains `inspectedRanges` and `discoverySummary`. The unchanged
`labeler-result.json` is an administrative original; its repeated claim bodies do
not need to be read again. Review the inference from these submitted facts: note
timing and column arrangements, claimed repeated cores or alternations, rhythm,
scope, context, salience reasoning, and any stated entering holds or counterevidence.
Selected references are not an exhaustive inventory of a scope. A labeler's claim
that it inspected the whole source remains its coverage declaration, not proof that
you independently traversed the source.

Read the episode as a human would: identify its familiar organization, then ask
what actually changes or requires independent control. Compare the exact human
rationale, not an older retained machine explanation. Consider all five dimensions
together while judging each claim's own evidence, scope and salience. Check that
any reused human decisions and intentionally unreviewed dimensions are identified;
a five-dimension pass is not a requirement for five positives.

Check whether the reasoning and supplied evidence suffice for each judgment. Do
not require a second full-source scan merely because this role has limited inputs.
When a decisive calculation, surrounding structure, or coverage explanation is
missing, return `needs-revision` and state the exact evidence the labeler must add.
Do not reconstruct unprovided notes, infer absence from missing references, or claim
a calculation was independently verified when only its reported result was supplied.
A coherent derivation in the rationale can be reviewed as such; retain its origin.

`review-package.json` preserves exact historical and current expert judgments with
their source, scope, decision and Foundation provenance. Honor a compatible explicit
correction without another confirmation. Rejection is not absence and deferral is
not a label. No human identity or approval transfers automatically to a new claim.
The frozen skill includes the calibrated distinctions; no whole-map community
labels or selection metadata are supplied as section evidence.

Return ordinary evidence or inference defects as `needs-revision`. Use
`needs-expert` only for a genuine semantic boundary remaining after sufficient
submitted evidence. Do not fabricate ambiguity to fill an expert queue. An
unresolved proposal cannot be supported, and a supported claim cannot retain an
unsettled associated question. A revision handoff receives a fresh review of its
current submission; an earlier verdict does not establish that it is now correct.

Write each rationale in 2–4 brief Markdown bullets, normally at most 80 words.
State the decisive reason for support or the specific correction needed; omit
producer IDs, long row arrays and repeated source timestamps from prose. Preserve
the submitted-evidence limit. A section assignment's coverage is only its assigned
ranges; do not demand or imply a full-chart scan.

Write `result.json` using the existing audit contract:

```json
{
  "skill": { "name": "COPY", "version": "COPY", "sha256": "COPY" },
  "charts": [{
    "sourceSha256": "ASSIGNED_SHA",
    "coverageReview": { "outcome": "supported", "rationale": "The submitted coverage declaration and representative evidence are consistent and sufficiently explained; I did not independently traverse the original chart." },
    "claims": [{ "claimId": "ORIGINAL_ID", "outcome": "supported", "rationale": "Explain why the submitted evidence and reasoning support this scoped judgment under the skill and expert guidance." }],
    "questions": []
  }]
}
```

Every original claim needs one result: `supported`, `needs-revision`, or
`needs-expert` (the last also needs `expertReason` and `question`). Every original
question needs one result with `questionId`, `disposition` (`resolved`,
`needs-revision`, or `needs-expert`) and `rationale`. Each assigned chart appears
exactly once. `coverageReview` is supported or needs-revision: assess the supplied
discovery explanation and visible omissions, not just individual claim plausibility,
while explicitly retaining the submitted-evidence limit. Copy exact skill provenance.
Finish with the result path and actionable findings. This independent review of
submitted reasoning remains machine review; it creates no human confirmation.
