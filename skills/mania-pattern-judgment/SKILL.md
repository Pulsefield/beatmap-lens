---
name: mania-pattern-judgment
description: Judge osu!mania section styles across multiple dimensions using source structure and human calibration. Use for annotation, pattern review, and feedback-driven calibration.
---

# Mania pattern judgment

Recognize the organization a player follows and explain its source relationships.
Read the frozen Foundation and [judgment guide](references/judgment-guide.md).
V2 covers Jack, Stream, Tech, LN coordination, and Trill; the task's pinned meanings
remain authoritative.

When an annotation harness is supplied, start from its section brief. Invoke tools
only for missing evidence, another viewing perspective, or a useful human comparison.
Expand relevant example cards individually; do not dump ledgers or run every tool.
Reuse visible evidence. Evaluation jobs restrict calibration access; respect their
allowed pool.

## One section, several judgments

1. Read supplied human feedback at its exact scope, including revised boundaries.
   Use the human decision's rationale instead of unresolved wording retained from
   an older machine proposal. Inspect the exact difficulty, complete entering
   holds, and neighboring rows needed to see entry, continuation, and exit.
2. Describe the episode in familiar terms: repeated chords, alternating groups,
   flowing singles, a direction change, or independent hold/release roles. Check
   complete attack rows and timing; keep short LNs as LNs. Do not select notes
   first and classify a cleaned sequence that hides interruptions.
3. Review **every active Foundation dimension in the same pass**. Give each its
   own witnesses, scope, presence, and salience. Share a `sectionId` for the same
   episode; use a common scope when valid and separate justified cuts when the
   organizations change. Several prominent dimensions are allowed; successive
   episodes alone do not establish co-occurrence.
4. Use `present` with `supporting`/`prominent`, an evidence-backed `absent`,
   `unresolved` for an inspected semantic uncertainty, or `unreviewed` for a
   dimension not actually inspected. Missing evidence and query misses are not
   negatives. Inspect query-uncovered regions when whole-chart coverage is asked.
5. Compare the closest human positive and counterexample when a distinction is
   difficult. Explain the relevant similarity or difference, rather than copying
   a verdict. Escalate only the concrete semantic choice that remains open.

## Human-readable notes

Write `evidence.rationale` as **2–4 brief Markdown bullets**, normally at most
80 words. Lead with recognizable organization; explain the decisive relation and
its role in this section. Add a comparison, boundary, or uncertainty only when it
changes the judgment. Keep spaces between words, numbers, and units.

For example, an inspected Tech negative might read:

- Chord minijacks lead into a short, readable stream.
- The change follows a familiar flow; it does not create a tricky rhythm here.

Keep full timestamps, source lines, arrays, calculations, and hashes in structured
evidence or the analysis sidecar. Brief prose must still explain each claim; a
tag name, density count, or copied Foundation definition is not a rationale.

## References and provenance

- For Beatmap Lens delivery and independent audit, read
  [exchange](references/beatmap-lens-exchange.md).
- For deterministic source queries, read
  [structural queries](references/structural-queries.md).
- To update this skill from feedback, follow
  [feedback maintenance](references/feedback-maintenance.md), including its length
  budget. Retrieve only the relevant calibration records, not every past example.

Submit proposals and audits; do not write canonical human decisions or approve
Foundation semantics for the expert. Preserve original proposals, human corrections,
and frozen task/skill hashes. Explicit human decisions need no repeat confirmation.
Keep old packets and worker copies frozen. Identify guidance/Foundation conflicts
without silently changing meanings.
Without a frozen task, label source-backed analysis unsealed and leave pins unset.
