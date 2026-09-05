# Auditor

Independently inspect the original labeler handoff against its exact source and
frozen Foundation. Use the task that produced that handoff, even if the service
now has a newer task. Read the [shared workflow](../agent-workflow.md) and
[expert guide](../../skills/mania-pattern-judgment/references/judgment-guide.md).

Export source evidence with
`pnpm annotation:workflow -- evidence --task task.json --out evidence/`.
Inspect the full arrangement, entry holds, boundaries, negative coverage, and any
transition or boundary uncertainty. Multiple prominent tags are valid. Typicality,
salience, and uncertainty are separate; agreement with the labeler's prose is not
independent source review.

Submit `auditId`, `createdAt`, `agent`, `claims`, and `questions`. Use role `auditor`
and an actual producer ID distinct from the labeler's. Preserve original claims;
do not copy them into another handoff and call that independent confirmation.
Embedded labeler `audit` notes are self-checks, not this audit contract.

Every original claim needs exactly one `claimId`, `outcome`, and `rationale`:

| Outcome | Use it when |
| --- | --- |
| `supported` | The complete settled assessment is supported by source and approved guidance. |
| `needs-revision` | The agent can fix scope, references, evidence, or reasoning through further work. |
| `needs-expert` | A concrete semantic judgment remains unsettled; also supply `expertReason` and `question`. |

Unresolved or unreviewed proposals cannot be supported as settled claims. Every
original question also needs one `questionId`, `disposition`, and `rationale`,
using `resolved`, `needs-revision`, or `needs-expert`. Supported claims cannot retain
unsettled associated questions. An expert question requires `needs-expert` for
every affected claim; an empty original ID list affects all claims.

Seal and automatically deliver:

```sh
pnpm annotation:workflow -- audit --task task.json --handoff handoff.json --input audit.json --out sealed-audit.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input sealed-audit.json --out receipt.json
```

The audit binds source, Foundation, task, base, and original handoff ID/content hash.
Delivery before the original handoff can return `pending`; the service retries
when the dependency arrives. Identical submissions are idempotent. Different
content cannot reuse an audit ID, and new labeler content needs a new audit.
Conflicting audits on an original claim remain visible and enter expert review.

Read the workspace `inbox --server http://127.0.0.1:4176` and
`dispositions --server http://127.0.0.1:4176 --source-sha SOURCE_SHA` through the CLI.
The human and other agents can work concurrently. Consistently supported current
claims become `agent-reviewed`; ordinary revision work returns to agents. Concrete
expert cases appear on `http://127.0.0.1:4176/review`, and saved human responses
return through the outbox. No human file transfer is needed.

If all claims are supported, leave the semantic expert queue empty. For an honest
small sample, submit a delivery-only `spot-check` review-request bound to selected
original claims. It states your producer and question without changing audit
outcomes or pretending the human requested it. Each actual human decision resolves
its request member independently. Preserve every proposal and decision; machine
support does not create human provenance or approve a new Foundation rule.

Consume saved structured human decisions as authoritative feedback without asking
for another confirmation. Audit a new immutable proposal if later agent work
changes scope or judgment; do not repackage the same human decision as a new doubt.
