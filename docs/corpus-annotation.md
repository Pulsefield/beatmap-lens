# Starting a local annotation batch

Start with ten 4K difficulties from the local corpus and the already approved
four-dimension Foundation. This is a small collection experiment: discover useful
sections and retain source-backed judgments, without claiming that every instant
or dimension of a difficulty has been annotated.

## Choose the batch

Use difficulty-level community `top_tag_ids` from the local metadata snapshot. Count
distinct tag IDs and sum their recorded votes. Total votes are not unique voters,
and missing tags are not negative evidence. Record both counts in the manifest.

The selected priority is total votes descending, then distinct tag count descending.
The expert chose this ordering after comparing it with tag-count-first ranking,
which can favor many single-vote tags over fewer well-supported tags. Use beatmapset
ID and then beatmap ID ascending for deterministic ties. For the first small batch,
select one difficulty per
beatmapset, checking its local `.osu` identity and 4K mode. Apply a star filter only
when requested. These are sampling choices, not annotation semantics.

Ranking may use all community tags. Only Jack organization, Stream organization,
Tech, and LN coordination are section targets in this experiment. Do not infer
section labels from community votes or turn the metadata inventory into a new
Foundation. Prioritizing highly tagged charts also does not create a representative
evaluation split.

Keep the ranked manifest, original metadata paths, vote counts, exact source paths
and hashes, agent artifacts, and progress under `.local/corpus-pilot/`. The source
corpus and canonical review workspace remain outside Git. A manifest and a small
progress file are sufficient; a scheduler or job database is not required.

## Connect each difficulty

Build the Inspector and start the same persistent service used for calibration:

```sh
pnpm --filter @pulsefield/beatmap-lens-inspector build
node scripts/review-workspace.mjs --workspace .local/review-pilot/workspace
```

The human keeps **http://127.0.0.1:4176/review** open. Agents use the HTTP exchange;
the human does not select a folder, import JSON, or visit a different review page
for each chart.

A new source reuses the exact approved Foundation already held in this workspace:

```sh
node scripts/annotation-workflow.mjs register-source \
  --server http://127.0.0.1:4176 \
  --source "PATH_TO_DIFFICULTY.osu" \
  --foundation-source-sha APPROVED_REFERENCE_SOURCE_SHA \
  --foundation-sha APPROVED_FOUNDATION_SHA \
  --out .local/corpus-pilot/charts/BEATMAP_ID/task.json
```

Both reference hashes come from the approved calibration record. The service reads
that canonical Foundation itself, preserves the original approval and all examples,
and creates a new source history with a frozen task. It does not copy the reference
chart's observations or create another human approval. Repeating registration
leaves an existing source's history intact. For new work after human changes, use
`fetch-task --fresh`; do not rewrite an old packet's base.

## Assign the work

One coordinating agent can keep one labeler and one independent auditor working
on successive difficulties. Parallelize different sources; use one active proposal
pass per source. The auditor must be a separate agent, not the labeler's self-check
under another producer ID.

1. The labeler reads the [skill](../skills/mania-pattern-judgment/SKILL.md), its
   judgment guide, and the exact frozen task. Inspect the complete difficulty to
   locate changes, then inspect candidate neighborhoods. Collect representative
   positive sections and useful inspected negatives without forcing a claim count
   or filling gaps with negatives. Preserve entering LN occupancy and exact cuts.
2. The labeler seals and submits its proposals through the existing
   [exchange commands](agent-workflow.md#agent-commands). Keep the original frozen
   task and handoff for the auditor.
3. The auditor checks every proposed claim against source events, surrounding
   context, and the same Foundation. Return fixable evidence or scope problems to
   the labeler. New proposals need new packet IDs and content-bound audits.
4. Supported claims remain `agent-reviewed`. Escalate only concrete semantic doubt,
   unresolved evidence, or disagreement requiring expertise. A small explicit
   spot-check can sample supported work; do not ask the expert to approve every
   ordinary claim or invent doubt to populate the queue.
5. Read `dispositions` between difficulties and after review. Apply the human's
   structured decision directly. Accepted or modified observations retain human
   provenance; rejection is not absence, and defer leaves the matter unsettled.
   Do not request another confirmation of an unchanged human decision. Work on
   other difficulties while a case waits for the expert.

If a selected difficulty already has claims, read its dispositions before starting.
Preserve and reuse existing judgments; do not submit them again to inflate the
batch. A few saved claims do not mean the whole difficulty has been inspected.
Obtain a fresh task for additional work under the current review base.

At the batch boundary, record selected sources, inspected ranges, original packet
IDs, receipt states, machine-reviewed and human-confirmed counts, and outstanding
expert tasks separately. A cleared inbox is not exhaustive chart coverage. If
only human-dependent work remains, save the checkpoint and report that state;
resume by consuming the outbox before proposing anything new.

## Agent instruction template

> Run the first local corpus annotation batch from MANIFEST_PATH. Read
> docs/corpus-annotation.md, docs/agent-workflow.md, the labeler/auditor role guides,
> and skills/mania-pattern-judgment/SKILL.md with its judgment guide. Use the
> manifest's ordering and approved Foundation reference. Register each selected
> source in the persistent workspace through the service; save artifacts under
> .local/corpus-pilot. Coordinate a labeler and a genuinely independent auditor.
> Discover representative section claims for the four approved dimensions, retain
> agreeing results as agent-reviewed, and send only concrete expert cases plus a
> small spot-check sample to http://127.0.0.1:4176/review. Consume human feedback
> directly while processing other charts. Preserve partial coverage and provenance.
> Finish this batch and report its checkpoint and remaining expert tasks; do not
> expand to the full corpus or change the Foundation.
