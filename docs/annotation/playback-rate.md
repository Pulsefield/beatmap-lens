# Annotation at different playback rates

V2 judgments support **0.5×, 0.75×, 1×, 1.25×, and 1.5×**. A judgment's
`playbackRate` describes the rate at which its assessment applies. Omission means
1× for historical records; loading them does not rewrite their canonical bytes.
The same source, scope, and tag can have different assessments at different rates.
This records rate-dependent evidence without assuming that style is invariant or
that rate alone captures a player's gameplay profile.

## Coordinates and identity

Source SHA-256, source bytes, note references, `scope`, and `reviewContext` always
refer to the original chart in **source milliseconds**. Do not create a sped-up
source or divide the claim's timestamps when changing rate.

At rate `r`, an interval or LN duration takes `sourceDurationMs / r` milliseconds
to perform, and effective BPM is `sourceBpm * r`. Performance views identify their
source origin and units separately. Beat relationships and source-line references
remain unchanged. For example, a 10-second source scope takes 20 seconds at 0.5×
and about 6.67 seconds at 1.5×.

Rate participates in judgment matching, human precedence, machine supersession,
repair selection, section completion, and publication conflict checks. A judgment
cannot revise or supersede one at another rate. Create a separate judgment instead.
Human judgments at another rate remain useful comparisons; they are not the target's
gold or evidence that its dimension has already been reviewed.

## Human Review

Use the **Playback rate** selector on the V2 Review page. Audio and falling-note
playback follow the chosen rate; audio preserves pitch. Scroll speed remains a
separate visual setting. The timeline and selection boundaries remain in source ms.

Opening a proposal or human observation restores its judgment rate. Auditioning
another rate shows the mismatch and prevents saving or accepting the existing
judgment. **Create judgment at …** starts an unreviewed draft with the same source
range and references, so its assessment and rationale can be supplied for that
rate. Drafts and saved history retain their individual rates.

Foundation calibration examples display their judgment rate and performance
duration. Their static source preview does not support audio playback. Existing
Foundation content and calibration meanings are unchanged. The legacy V1 Annotate
workspace remains fixed at 1×; rate-specific work uses V2 Review.

## Agent preparation, inspection, and delivery

Use the [selected-section workflow](fine-annotation.md). Add `playbackRate` to
each queue section and prepare the matching harness bundle from those same targets:

```json
{
  "sections": [
    {
      "sectionId": "example-slow",
      "sourceSha256": "<original-source-sha256>",
      "scope": { "startMs": 10000, "endMs": 20000 },
      "reviewContext": { "startMs": 8000, "endMs": 22000 },
      "playbackRate": 0.5
    }
  ]
}
```

Handles must be unique, including across rates. Preparation freezes the rate with
the target, source evidence, and tools; queue/bundle mismatches fail validation.
Workers return judgments for those case IDs, and the controller binds the frozen
rate to each canonical Claim. An auditor's case must match the sealed rate too.
Do not change a prepared bundle in place to run a different rate.

The [harness](annotation-harness.md) retains exact source fields and supplies
parallel `performanceTiming` for non-1× row/action/articulation, perspective, and
tempo views. Compact section briefs state the rate, effective durations and BPM,
and retain complete original rows. Time-proportional PNGs show performance time;
row views still compress time and cannot establish rhythm from spacing alone.

`find_human_examples` accepts an optional `playback_rate` filter. Without it,
comparisons can span rates and retain each example's own rate. Opening an example
inspects it at that rate. Same-source contextual gold is matched at the assigned
rate. Source/song evaluation exclusions apply across every rate of a source.

Default discovery continues at 1×. The priority queue also retains repair requests
at observed non-1× rates and checks their coverage separately. Whole-chart discovery
assignments do not support non-1× execution: use their selected-section queue with
fine annotation. This boundary is checked explicitly. New campaign snapshots copy
the Python rate helper beside the standalone result checker.

## Published data and validation

New snapshots use manifest version 2 and the `judgment-v2` Parquet schema, with a
required numeric `playback_rate`. Original source coordinates remain unchanged.
The publisher and validator also accept historical version 1 snapshots, treating
their omitted rate as 1× when checking immutable record continuity. A previous
published release is not rewritten. See [dataset publication](dataset-publication.md).

Compare or aggregate labels within their rate context. Group related source/song
variants together when constructing evaluation splits; another rate of the same
source is not an independent held-out chart.

Contract tests cover supported rates, clock behavior, frozen evidence, rate-bound
delivery, human revisions, coverage, and snapshot migration. They do not establish
semantic annotation accuracy at new rates. The existing regression gate still
lacks auditor, discovery, and selected-workflow replay coverage; deterministic 1× compatibility
checks do not approve those roles. Preserve gold and the baseline while collecting
the required role-specific and rate-specific evaluation evidence.
