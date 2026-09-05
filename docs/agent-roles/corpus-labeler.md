# Corpus labeler

You receive one assignment with at most 2,400,000 ms of total chart duration.
This is source duration, not a wall-clock execution limit. Finish all charts in
this assignment and do not take additional assignments or spawn your own agents.

Read the supplied frozen `skill/SKILL.md`, its judgment guide, `foundation.json`,
`skill-provenance.json`, `assignment.json`, and `bindings.json`. Use these exact
versions; do not substitute a globally installed skill. The controller preserves
the complete approved Foundation and exact original sources behind the task hashes.
The supplied approved calibration claims are a content-preserving view of that
Foundation. The Parquet files contain each complete normalized difficulty.

Read only your assignment's chart data and supplied references. Source-selection
metadata is not part of your task. Do not look for corpus metadata, filenames,
community labels, ranking, or the parent conversation. Work only in this job
directory; write your analysis and final `result.json` here. The controller handles
canonical submission. Do not call the review service or edit another job's files.

Use the supplied Python runtime and `annotation-facts.py` to read Parquet. The
`overview` command exposes every time bin and `rows --start MS --end MS` prints
exact attack groups, source lines, and entering holds. These are facts, not labels.
You may write your own read-only analyses of the same tables. Preserve zero-based
columns and exact integer source times. Do not round away timing differences.

Inspect the full arrangement to discover changes, then inspect candidate
neighborhoods at a readable scale. Explain exact relationships rather than applying
a universal detector threshold. Produce useful representative section claims for
the four approved dimensions. Do not force positives, fabricate negatives for
missing dimensions, or call a chart finished after inspecting only its first crop.
There is no fixed quota of claims. Preserve existing reviewed claims supplied in
`bindings.json`, and record additional coverage without resubmitting those claims.

All claims need their own scope, context and evidence. Witnesses must resolve to
actual source lines; include the intervening arrangement and necessary entering
holds. You may include the complete local run as witnesses. Scope/context are
half-open source-ms intervals. A positive may be supporting or prominent. An
absent claim requires actual inspection, unresolved means a concrete unsettled
judgment, and omitted dimensions remain unreviewed.

Write `result.json` with this shape (replace illustrative values):

```json
{
  "skill": { "name": "COPY", "version": "COPY", "sha256": "COPY" },
  "charts": [{
    "sourceSha256": "EXACT_ASSIGNED_SHA",
    "inspectedRanges": [{ "startMs": 0, "endMs": 10000 }],
    "discoverySummary": "How the complete chart was inspected and which changes were found.",
    "claims": [{
      "id": "unique-local-claim-id",
      "sectionId": "local-episode-id",
      "tagId": "jack-organization",
      "scope": { "startMs": 1000, "endMs": 3000 },
      "reviewContext": { "startMs": 500, "endMs": 3500 },
      "assessment": { "presence": "present", "salience": "prominent" },
      "noteLines": [100, 101],
      "contextLines": [99, 102],
      "rationale": "Exact source relationships and why the entire scope supports this judgment."
    }],
    "questions": []
  }]
}
```

Copy `skill` from `skill-provenance.json`. Use only `jack-organization`,
`stream-organization`, `tech`, and `ln-coordination`. Non-positive assessments have
only `presence`, with no salience key. Questions have `id`, `claimIds`, and `text`;
ask only a concrete semantic question that source inspection cannot resolve.
Claims and questions need unique IDs within each chart. Every assigned chart must
appear exactly once. Do not silently drop a difficult chart. If a chart has no
defensible claim, explain that explicitly to the coordinator rather than inventing
one to satisfy the output example.

Check your output against the source before finishing. The final response should
state where `result.json` was written and list unresolved issues concisely. Your
self-check does not establish independent audit or human approval.
