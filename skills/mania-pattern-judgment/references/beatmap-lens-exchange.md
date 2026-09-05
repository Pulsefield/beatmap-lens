# Beatmap Lens exchange

Read `docs/agent-workflow.md` and
`apps/inspector/src/annotation/workflow/contracts.ts` in the checkout. The
persistent human inbox/outbox is `http://127.0.0.1:4176/review`. After building the
Inspector, run `pnpm review:workspace --workspace .local/review-pilot/workspace`. The human
uses that fixed page without JSON transfers or a directory picker; agents work
concurrently and deliver through the service.

From the repository root:

```sh
pnpm annotation:workflow -- inbox --server http://127.0.0.1:4176
pnpm annotation:workflow -- fetch-task --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --fresh --out task.json
pnpm annotation:workflow -- evidence --task task.json --out full-evidence/
pnpm annotation:workflow -- evidence --task task.json --out local-evidence/ --start-ms 10000 --end-ms 15000
pnpm annotation:workflow -- handoff --task task.json --input proposal.json --out handoff.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input handoff.json
pnpm annotation:workflow -- audit --task task.json --handoff handoff.json --input audit.json --out sealed-audit.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input sealed-audit.json
pnpm annotation:workflow -- dispositions --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --out dispositions.json
```

Choose a source SHA from the inbox. `fetch-task --fresh` registers new frozen
current context under an approved Foundation without changing old tasks. Without
`--fresh`, it reads the latest registered task. The auditor uses the exact task
that produced the original labeler handoff, even when a newer task exists.
The task contains full source and normalized structure, Foundation, and review
base. The labeler discovers sections without requiring human-selected windows.

Evidence retains complete facts even for narrower SVG exports. A claim's `scope`
is the arrangement judged; `reviewContext` provides context; `noteRefs` and
`contextNoteRefs` select its own witnesses. Preserve complete entering holds,
stable source references, and grouping of related episodes.

The labeler submits `handoffId`, `createdAt`, `agent`, `proposals`, `audit`, and
`questions`, with role `labeler` and at least one claim. Embedded `audit` notes are
only self-checks. Standalone semantic questions belong to the curator lane;
historical empty handoffs do not gain support through an empty audit.

An independent auditor submits `auditId`, `createdAt`, `agent`, `claims`, and
`questions`, with role `auditor` and a different actual producer ID. The audit binds
original handoff ID/hash, source, Foundation, task, and base. Every original claim
needs one supported/revision/expert outcome; expert cases require a reason and
question. Every original question needs a resolved/revision/expert disposition.
Supported claims cannot retain unsettled questions. Empty original question claim
lists affect all claims; role guides describe exact field names.

`submit` forwards sealed content without rebasing or resealing. Receipts distinguish
imported, duplicate, pending, and error; an early audit can wait for its labeler
handoff. Current consistently supported claims become `agent-reviewed`. Revision
work returns to agents; concrete expert cases and audit conflicts reach the fixed
page. Self-checks and machine agreement never create human-confirmed observations.
After human changes, fetch a fresh task for new work and preserve old packets.

A supported batch need not invent a semantic expert case. For a small human sample,
submit a delivery-only request with `requestId`, `sourceSha256`, original
`handoffId`/`handoffSha256`, selected `claimIds`, `reason: "spot-check"`, `question`,
actual `requestedBy` producer/role, and `createdAt`. Send it with
`submit --server ... --input review-request.json`. The service validates its
original claims and shows pending members separately from semantic disputes.
It does not change audit outcomes or imply the human requested it. Each actual
human decision, including defer, resolves that request member independently.

Network inbox/dispositions expose current work and saved human outbox responses.
The CLI exposes no Foundation-approval or human-decision mutation. Offline tools
remain available: `review-status --file review.v2.json`,
`expert-queue --file review.v2.json`, and `dispositions --file review.v2.json`.
Supply `--source chart.osu` for a canonical file without embedded source bytes;
file dispositions also accepts an exported view. Read commands use stdout unless
`--out` is supplied. Offline tools are not required human UI steps.

Preserve expert corrections to scope, pattern identity, typicality, and assessment
separately from original proposals. Human accept/reject/defer needs no mandatory
text; a modification supplies the changed claim and explanation. Consume this
structured feedback directly without another confirmation. New agent judgments
or scopes need new immutable proposals and independent audits, with only genuine
remaining doubt escalated. Rejection is not absence; defer preserves the original
assessment and does not convert it to unknown. The actual partial-acceptance/deferral exchange must be saved and read
back before claiming the human-handoff milestone; machine or Foundation approval
alone does not establish it.

No tag inheritance, inferred parent labels, or implicit pattern graph is defined.
Local Foundation approval does not approve community whole-map targets. Legacy
**Annotate** V1 semantics and original salience meanings remain intact.
