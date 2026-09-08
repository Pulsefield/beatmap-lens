---
name: agent-notes
description: Write, review, and archive local Beatmap Lens research and decision notes when useful conclusions or unresolved work should persist across sessions. Use for requested note maintenance and substantial investigations, not every code change or annotation.
---

# Local Agent Notes

Keep working decisions and useful research evidence in `.local/agent-notes/`.
This adapts Pulsefield's writing and archival practice to local storage. Create the
needed directories as part of an authorized recording task; no notes branch,
worktree, commit, or publication procedure is required.

## Choose the owner

- Source, configuration, tests, and public documentation own product behavior.
  Notes retain working questions, alternatives, conclusions, and follow-up.
- Public research documents should explain useful conclusions and the reason for
  a skill iteration with enough evidence to assess them. They may include compact
  beatmap/section/judgment findings. Full research histories and reproducible old
  runs are not required; do not turn note keeping into an experiment tracking system.
- Canonical human judgments and Foundation definitions have their own authority.
  Accepting a note does not approve labels or revise those definitions.
- Keep raw data and run outputs in their existing local locations. Summarize the
  observation a note needs instead of requiring every artifact to survive forever.
- Search related active notes before creating one. Reuse the note when its question
  and scope match. Routine edits with no lasting decision value need no note.

## Identity and content

Use [the note template](templates/agent_note.md). Keep one current Markdown file per
stable `Note ID` at `.local/agent-notes/<status>/YYYY-MM-DD-topic.md`. The ID matches
the filename stem; the directory matches `Status`. Use note IDs for cross-references.
Use a local `Revision` integer when updating an existing record.

Separate explicit user decisions, open proposals, observations, and inference.
Record the question, scope, relevant alternatives, conclusion and rationale,
limitations, actual verification, and remaining work. Retain failed alternatives
when they explain a decision or prevent repeating a mistake. Remove unused template
sections rather than filling them mechanically.

Include source versions, run IDs, beatmap IDs, sections, labels, or measurements when
they are needed to support the conclusion. Ordinary notes do not require complete
source snapshots, hashes, or clean worktrees. A regression result still needs the
candidate and evidence identities required by its checker; those are evaluation
requirements, not a universal note policy. Never report checks that did not run.

## Status and authority

Read-only review stays read-only. A recording request authorizes scoped writing and
metadata maintenance. Existing explicit user decisions count as acceptance; record
their date and approved scope without asking again for clerical confirmation.

| Status | Meaning |
| --- | --- |
| `proposed` | A direction or material part of it remains open. |
| `accepted` | The user approved the recorded scope. |
| `implemented` | The accepted work is complete and the claimed verification has evidence. An authorized implementation task includes recording completion. |
| `rejected` | The user declined the direction, or an authorized update meets a previously agreed rejection criterion. |
| `archived` | An implemented or rejected note has no active follow-up but retains useful decision history. |

Move the current file and update status together. A material change to an accepted
direction returns it to `proposed` unless the user already approved that change.
Preserve an earlier decision or result when it remains useful; an optional local
snapshot may do so, but every edit needs neither a snapshot nor an approval record.
Reconsidering a settled decision may use a linked new proposal.

Archive, restore, or consolidate within a request that includes that action or
bounded lifecycle cleanup. Keep archived conclusions unchanged; restoration can
correct a premature archive, while new findings belong in a current note. Do not
automatically archive or delete because a file is old or a directory is large.

## Retain useful conclusions

For consolidation, preserve still-relevant rationale, constraints, failed
alternatives, consequences, and reconsideration conditions. Partial overlap can
justify keeping two notes with clearer scopes. Link superseded records by ID.

Delete only within an explicit deletion scope after checking unique future value
and inbound references. A note deletion does not authorize deleting human records,
datasets, snapshots, or other referenced artifacts. Repair affected active links.

Before finishing, re-read affected notes for scope, status, factual support,
remaining uncertainty, and links. Report what was recorded or archived and any
conclusions promoted to public documentation. Local persistence is not publication.
