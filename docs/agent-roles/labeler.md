# Labeler

Discover local sections from a complete frozen difficulty and propose independent
per-tag judgments. Read the [shared workflow](../agent-workflow.md) and
[pattern judgment skill](../../skills/mania-pattern-judgment/SKILL.md).

1. Read the fixed workspace inbox and choose a registered source SHA:

   ```sh
   pnpm annotation:workflow -- inbox --server http://127.0.0.1:4176
   pnpm annotation:workflow -- fetch-task --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --fresh --out task.json
   pnpm annotation:workflow -- evidence --task task.json --out evidence/
   ```

   Inspect the complete source, approved Foundation, and review base. Community
   tags suggest candidates but do not prove section labels. Discovery does not
   require human-selected windows or exhaustive labeling.
2. Locate organization and changes before choosing scopes. Reviewed jumpstream and
   roll/burst support Stream organization; grouped jumpdrill does not. Preserve
   those episodes, entering holds, and intervening rows. Bounded evidence exports
   can help inspect a neighborhood without changing the full task.
3. Create at least one claim in `proposals`, with identity, scope, context,
   assessment, independent witness/context references, and rationale. Several
   tags can be prominent. Negatives require inspection; unresolved and unreviewed
   remain distinct. Copy stable references and preserve exact source timestamps.
4. Resolve ordinary source questions yourself. Record necessary concrete
   `questions` with affected claim IDs; an empty ID list affects every claim.
   The handoff's `audit` array contains only self-check notes and cannot establish
   independent support. Standalone semantic questions belong to the curator lane.
5. Use your actual producer identity with role `labeler`. Seal `handoffId`,
   `createdAt`, `agent`, `proposals`, `audit`, and `questions`, then push the packet:

   ```sh
   pnpm annotation:workflow -- handoff --task task.json --input proposal.json --out handoff.json
   pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input handoff.json --out receipt.json
   ```

   Make the same frozen task and unchanged handoff available to an independent
   auditor. The human does not import these files. Identical retries keep their
   packet ID; changed content needs a new ID.
6. Read results while the human and other agents continue working:

   ```sh
   pnpm annotation:workflow -- inbox --server http://127.0.0.1:4176
   pnpm annotation:workflow -- dispositions --server http://127.0.0.1:4176 --source-sha SOURCE_SHA
   ```

   `needs-revision` returns to you. Correct it in a new handoff and obtain a new
   content-bound audit. After human changes, `fetch-task --fresh` explicitly
   freezes current approved context; it never rebases old proposals. Inspect
   pending/error receipts instead of treating delivery as semantic approval.

`agent-reviewed` is machine provenance, not human confirmation. To request a small
human sample of supported work, submit an honest delivery-only `spot-check`
review-request from the shared workflow. It identifies your actual producer,
original handoff hash, and selected claims without inventing a semantic conflict.
The fixed human page is `http://127.0.0.1:4176/review`; responses return through the
service outbox without manual JSON transfers.

Do not edit canonical files, manufacture a second identity for your self-check,
approve semantic changes, or invent human provenance. Rejection is not absence;
deferral does not change the original assessment to unknown or permit guessing.
Consume structured human feedback directly without asking for confirmation again.
A newly judged scope or assessment requires a new immutable proposal and audit;
only remaining substantive doubt needs escalation. The approved local Foundation does not select
community whole-map targets or reinterpret earlier pinned snapshots.
