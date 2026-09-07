# Beatmap Lens exchange

Read the checkout's `docs/agent-workflow.md`, assigned role guide in
`docs/agent-roles/`, and `apps/inspector/src/annotation/workflow/contracts.ts` for
current fields and commands. The persistent review UI is normally
`http://127.0.0.1:4176/review`; use the task's actual workspace/server.

```sh
pnpm annotation:workflow -- inbox --server http://127.0.0.1:4176
pnpm annotation:workflow -- fetch-task --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --fresh --out task.json
pnpm annotation:workflow -- evidence --task task.json --out evidence/ --start-ms 10000 --end-ms 15000
pnpm annotation:workflow -- handoff --task task.json --input proposal.json --out handoff.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input handoff.json
pnpm annotation:workflow -- audit --task task.json --handoff handoff.json --input audit.json --out sealed-audit.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input sealed-audit.json
```

A fresh task pins current source, Foundation, and review base. Its auditor uses
that exact task, even if a newer one exists. `scope` is the claim's arrangement;
`reviewContext` and `contextNoteRefs` preserve its neighborhood and entering holds.
Give related dimension claims a shared `sectionId`, with separate witnesses and
brief bullet rationales. Submit at least one claim; standalone semantic questions
use the curator lane.

Embedded labeler self-checks are not independent audit. A different actual auditor
producer judges every original claim and question, binding original handoff/hash,
source, task, Foundation, and base. Supported claims cannot retain unsettled
questions. Current supported claims become `agent-reviewed`, never human-confirmed.

`submit` forwards sealed content without rebasing. Receipts distinguish imported,
duplicate, pending, and error. Fetch current feedback after human changes. For
machine revisions, use explicit `supersedes` lineage; changed scopes require a
`scopeChangeReason`. Preserve old packets, excluded regions, and episode grouping.
Follow the terminal replacement assessment. Machine supersession cannot replace
a human decision.

Consume human assessments at their actual scopes, with human rationales kept
separate from old proposal text. Reject is not absent; defer preserves the original
assessment. Descriptive mention of another pattern creates no human assessment
for it. Use the delivery-only spot-check workflow for quality samples rather than
inventing semantic disputes. Human responses and canonical records remain in the
human workflow; the CLI does not approve Foundations or author human decisions.

No inherited tags or implicit pattern graph exists. V1 meanings, whole-map targets,
and already frozen Foundations keep their original semantics.
