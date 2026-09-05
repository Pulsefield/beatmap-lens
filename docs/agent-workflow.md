# Agent–human section review

Beatmap Lens gives a human and an external agent the same source-backed object of
judgment. A beatmapset groups the work. Each claim belongs to one difficulty's
exact source bytes and one source-time interval. Shared audio and community tags
do not transfer a claim to another difficulty.

## Judgment and evidence

A claim separates judgment, context, and evidence:

- `scope` is the half-open source interval whose complete arrangement is judged.
- `reviewContext` is the surrounding source interval needed to inspect that judgment.
- `evidence.noteRefs` and `evidence.contextNoteRefs` select the witness notes and
  relevant context for this particular claim. They may be non-contiguous.

Witnesses explain a section judgment; they are not note-level ground truth or a
new cropped chart. A hold beginning before the claim can remain occupied inside
it. Its original start, end, column, and source line remain intact. Playback rate,
visual speed, pagination, and selection do not change source identity or time.

Each tag receives its own assessment:

| Assessment | Meaning |
| --- | --- |
| `present`, `supporting` | A certain positive that contributes to the section |
| `present`, `prominent` | A positive that strongly characterizes the section |
| `absent` | An explicit negative for a dimension actually inspected in this scope |
| `unresolved` | Inspected, but the evidence or semantic boundary does not settle the judgment |
| `unreviewed` or no claim | This dimension has no recorded assessment |

Multiple tags can be prominent. Supporting does not mean uncertain. Collection
is positive-first and partially exhaustive: missing labels never become negatives.
Accepting one claim does not settle another claim in the same section.

`boundaryUncertainty` optionally describes acceptable cuts near the nominal
boundaries. `transition` describes an evidenced temporal change, with its own
witnesses and explanation. Neither field is a substitute for an unresolved
assessment. Overlapping sections and mixed sections are allowed; overlaps do not
create independent training examples. `exemplarRole` records a calibration use
separately from the concept judgment.

## Experimental campaign vocabulary

Section predicates and selected whole-difficulty community targets are separate
vocabularies. `Foundation.tags` contains only section predicates. The first consumer
wants a small experiment for recognizable style learning and generation control;
see the [experimental supervision decision](decisions/0005-experimental-style-supervision.md).
The earlier nine-concept set is calibration history, not a required size or a final
model inventory. Exact chart descriptors help explain claims without each becoming
another manually annotated target. Style observations do not directly label demand
state or continuation-response values.

The first expert calibration identified incorrect episode scopes and conflated
pattern types in the historical nine-concept proposal. That proposal remains
**proposed**, not approved.
Use the [expert judgment guide](../skills/mania-pattern-judgment/references/judgment-guide.md)
and [compositional framework proposal](decisions/0004-compositional-pattern-judgments.md)
when revising it; the initial factory is not sufficient semantic authority for
human-confirmed observations.

The current experiment uses Jack organization, Stream organization, Tech, and LN
coordination. The user approved the four-dimension Foundation and the ten reviewed
calibration cases with explicit corrections. Revision 2 includes roll/burst in
Stream organization and excludes the reviewed grouped jumpdrill; three consecutive
complete four-note directional roll groups establish local prominence. Community
whole-difficulty target selection and alignments remain separate proposals. Its
[`experimental-campaign.ts`](../apps/inspector/src/annotation/workflow/experimental-campaign.ts)
factory still creates an empty **proposed** template. Record approval on the actual
reviewed source-backed snapshot; an empty template does not inherit approval. No
community alignments are declared. The earlier nine-concept
[`campaign.ts`](../apps/inspector/src/annotation/workflow/campaign.ts) remains as a
historical proposal. Opening an existing task does not replace its Foundation.

Each concept preserves a local ID and definition independently of any declared
external catalogue correspondences, their relations, and scopes. The
[official osu! catalogue](https://osu.ppy.sh/wiki/en/Beatmap/Beatmap_tags), checked
2026-09-05, names difficulty-level community tags. A catalogue vote is a candidate
search cue; it does not locate a section or prove its label.

For osu!mania, the catalogue's `skillset/tech` emphasizes frequent complex snaps.
The approved local Tech concept is broader: a positive must explain particular
rhythmic, column, chord, or hold/release relationships that make the arrangement
technical. It can coexist with streams, jacks, and LN concepts. It is not an alias
of `tech/complex snap`, an exclusive category, or a fallback when other labels fail.
Positive examples and near-misses must calibrate this broader boundary. Agent
agreement cannot approve that boundary.

Calibration examples preserve exact source bytes, source identity, the claim, and
an explanation. A proposed example remains a proposal even when its assessment
says `present`. Review the example and the local definition before approving the
Foundation snapshot. Keep unresolved examples unresolved; their inclusion in a
calibration set does not resolve them. Local corpus files, filenames, candidate
indexes, and generated research reports stay outside version control.

## Persistent workspace and automatic delivery

Run the local service against the persistent workspace containing the registered
sources and approved Foundation. Build the Inspector before serving it:

```sh
pnpm --filter @pulsefield/beatmap-lens-inspector build
pnpm review:workspace --workspace .local/review-pilot/workspace
```

The equivalent service command is
`node scripts/review-workspace.mjs --workspace .local/review-pilot/workspace`.
The fixed human page is **http://127.0.0.1:4176/review**. It displays incoming
expert cases, explicit spot-check requests, ordinary agent review status, and saved
human responses. Normal review requires no JSON import/export or directory picker.
The service keeps canonical documents in `workflow/*.v2.json` and exchange delivery
records in `exchange/inbox`, `exchange/receipts`, `exchange/requests`, and
`exchange/outbox`, within the selected persistent workspace.

Agents can work while the human reviews. They submit packets to the service;
the service validates and serializes canonical updates, updates the inbox, and
writes dispositions to the outbox. An audit delivered before its original handoff
can receive `pending`; later delivery of the dependency allows it to be processed.
Receipts distinguish `imported`, `duplicate`, `pending`, and `error`. Keep receipt
identity and packet identity when inspecting a retry; never change sealed content
to make a stale or rejected submission appear current.

### Agent commands

```sh
pnpm annotation:workflow -- inbox --server http://127.0.0.1:4176
pnpm annotation:workflow -- fetch-task --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --fresh --out task.json
pnpm annotation:workflow -- evidence --task task.json --out evidence/
pnpm annotation:workflow -- handoff --task task.json --input proposal.json --out handoff.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input handoff.json --out handoff-receipt.json
pnpm annotation:workflow -- audit --task task.json --handoff handoff.json --input audit.json --out sealed-audit.json
pnpm annotation:workflow -- submit --server http://127.0.0.1:4176 --input sealed-audit.json --out audit-receipt.json
pnpm annotation:workflow -- dispositions --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --out dispositions.json
```

Use a source SHA returned by `inbox`. `fetch-task` without `--fresh` reads the
latest registered task; `--fresh` explicitly freezes current approved context
through the service. This bookkeeping does not need another human approval. It
creates a new task and never rebases an old packet. An auditor uses the exact task
that produced the original labeler handoff, not whichever task is latest now.

The task contains exact source bytes, the full normalized difficulty, Foundation
content and hash, and the review base. The labeler discovers sections without
human-selected windows. A bounded `evidence` export changes only the SVG range;
`source.osu` and `facts.json` still contain the complete difficulty, with entering
hold occupancy recorded in the manifest.

`submit` sends an existing sealed handoff/audit or an explicit review request,
without resealing, replacing hashes, or creating human decisions. It returns the
server receipt and fails cleanly on rejected HTTP requests or error receipts.
`inbox` includes per-source statuses, focused expert cases, pending review-request
members, and receipts. Network `dispositions` preserves human decisions, audit
results, review requests, and the saved document version. Agents read these views;
the human does not shuttle files between workers.

The network endpoints are `GET /api/review/inbox`, `GET`/`POST
/api/review/task/:sourceSha`, `POST /api/review/submit`, and `GET
/api/review/dispositions/:sourceSha`. These agent commands expose no Foundation
approval or human-observation mutation. See [the contracts](../apps/inspector/src/annotation/workflow/contracts.ts),
[the CLI](../scripts/annotation-workflow.mjs), and
[the local service](../scripts/review-workspace.mjs).

### Explicit spot-check requests

A useful audit can support every selected claim. Do not fabricate uncertainty to
populate the expert queue. For a small human sample, a labeler or auditor can
submit a delivery-only request with `reason: "spot-check"`:

```json
{
  "requestId": "pilot-spot-check-1",
  "sourceSha256": "<source SHA-256>",
  "handoffId": "<original handoff ID>",
  "handoffSha256": "<original handoff content hash>",
  "claimIds": ["<claim to inspect>", "<another claim to inspect>"],
  "reason": "spot-check",
  "question": "Please inspect this small sample of independently audited claims.",
  "requestedBy": { "producerId": "<actual agent ID>", "role": "auditor" },
  "createdAt": "<creation timestamp>"
}
```

The agent sends this through `submit --server ... --input review-request.json`.
The service verifies its original handoff hash and claim IDs, persists the request,
and exposes it on the fixed human page. It does not alter the claim's audit status,
produce a semantic disagreement, or claim that the human requested the sample.
Each actual human decision, including defer, resolves only that request member;
other requested claims stay pending. The record of who requested the work remains.

### Offline compatibility

Offline evidence, sealing, and file readback remain available for reproducibility
and external tools; they are not required human interaction steps:

```sh
pnpm annotation:workflow -- evidence --task task.json --out section-evidence/ --start-ms 40000 --end-ms 44000
pnpm annotation:workflow -- review-status --file review.v2.json --out agent-status.json
pnpm annotation:workflow -- expert-queue --file review.v2.json --out expert-queue.json
pnpm annotation:workflow -- dispositions --file review.v2.json --out dispositions.json
```

Read commands print to stdout if `--out` is omitted. Supply `--source chart.osu`
when a canonical file has no embedded source-bearing task. File `dispositions`
also accepts an Inspector-exported dispositions view; `review-status` and
`expert-queue` read canonical workflow documents. Offline commands do not import
packets or create human observations. The standalone file-based Review workspace
remains available for explicit offline use.

### Labeler submission

The `handoff` input has `handoffId`, `createdAt`, `agent`, `proposals`, `audit`, and
`questions`. Use role `labeler`, a stable producer identity, and at least one
source-backed claim. Its `audit` array preserves submission self-check notes; it
is not independent audit evidence and cannot promote a claim to agent-reviewed.
Questions identify affected claim IDs. A question with an empty `claimIds` array
applies to all claims in that handoff.

Sealing copies source, Foundation, task, and base bindings from the frozen task.
Keep an unchanged packet and its ID when retrying. A changed proposal is a new
handoff with a new ID; the old proposal remains intact. Do not silently replace
bindings with the current browser state. Source mismatches are rejected; a changed
review base is shown as stale and requires a fresh task before confirmation.
Repeated imports of identical content do not create duplicates.

New handoffs and independent audits require claims. A standalone semantic question
belongs to the curator lane. Historical empty-proposal handoffs remain readable
with their questions, but cannot become agent-reviewed through an empty audit.

### Independent audit

An independent auditor reads the same frozen task and the original sealed labeler
handoff. Submit `auditId`, `createdAt`, `agent`, `claims`, and `questions` to the
`audit` command. The auditor has role `auditor` and a `producerId` distinct from the
labeler's. Changing an identity on a self-check does not constitute independent
review. The resulting packet binds the original handoff ID **and content hash**,
as well as the exact source, Foundation, task, and base. It does not copy or rewrite
labeler proposals. Submit it to the same workspace; an out-of-order audit waits
for its original handoff instead of requiring a human to arrange imports.

Every original claim needs exactly one result with `claimId`, `outcome`, and
`rationale`. Outcomes are `supported`, `needs-revision`, or `needs-expert`;
`needs-expert` also requires an `expertReason` and a concrete `question`. Unresolved
or unreviewed proposals cannot be supported as settled claims. Return omissions
or incorrect crops that the agent can fix for revision instead of escalating
routine source inspection to the expert.

Every original question also needs exactly one disposition, with `questionId`,
`disposition`, and `rationale`. The dispositions are `resolved`, `needs-revision`,
and `needs-expert`. A supported claim cannot retain an unresolved associated
question. A question needing expert review requires each affected claim to carry
`needs-expert`; an empty original `claimIds` list affects every claim. Covering
all claims while dropping an inconvenient question does not pass validation.

### Routine results and expert decisions

The service inbox and dispositions show each original claim with its audit results
and any saved human decision; offline `review-status` exposes the same routing. The current routing is:

| Status | Next action |
| --- | --- |
| `awaiting-audit` | An independent auditor must inspect the proposal. |
| `agent-reviewed` | Current, settled claim with consistently supported independent audits; retain as machine-reviewed supervision. |
| `needs-revision` | Return the concrete defect to the labeler; submit a new immutable proposal and audit its new content. |
| `needs-expert` | Present the specific unresolved choice, evidence, and reason to the expert. Conflicting audit outcomes also enter this queue. |
| `stale` | Read current review state and obtain a fresh task; do not silently rebase an old packet. |
| `accepted`, `modified`, `rejected`, `deferred` | Follow the recorded human disposition. |

Machine agreement does not create a human-confirmed observation, approve semantic
changes, or fill unreviewed dimensions. All agreeing `supported` results produce
agent-reviewed status; any disagreement between independent audit outcomes routes
the original claim to expert review. The semantic `expert-queue` export contains
only current `needs-expert` rows; delivery-only spot-check requests appear
separately in the service inbox. Awaiting audits and revision work remain with
agents. Saved human dispositions take precedence; a deferred claim remains
unsettled in its history even though it is no longer an open queue row.

The human sees the original scope, tag/assessment/salience, evidence, and rationale,
then accepts, modifies, rejects, or defers each claim. Accept/reject/defer do not
require a typed explanation; modification records the revised claim and an
explanation. This uses the existing claim and decision structures, without a
separate questionnaire or agent framework. Acceptance or modification creates a
human-provenance observation. Rejection is not an
`absent` judgment, and deferral neither changes the original assessment to unknown
nor licenses a guessed label. Deciding one
claim does not automatically decide its siblings. Original proposals, independent
audits, self-checks, questions, and human decisions remain separate records. Agents
read the inbox and network `dispositions` rather than infer decisions from UI state.
Structured human feedback is authoritative; consuming it does not require a
second confirmation of the same decision. If subsequent agent work changes the
judgment or scope, create a new immutable proposal and independent audit, escalating
only actual remaining doubt.

Opening a frozen task in a different workspace retains its old base; it does not
transfer canonical history. Continue against the original persistent workspace.
After human changes, use `fetch-task --fresh` for new proposals under current
approved context while retaining old tasks, packets, and decisions unchanged.

Role guides: [labeler](agent-roles/labeler.md), [auditor](agent-roles/auditor.md), and
[curator](agent-roles/curator.md). The curator handles proposed semantic revisions
outside routine labeling and auditing. It does not automatically rewrite a pinned
Foundation or make community targets part of the section vocabulary.

## V1 preservation and milestone boundary

The existing **Annotate** mode and V1 dataset contracts retain their original
meaning. V1 records are preserved without conversion. In particular, V1's numeric
salience `1` and `2` are not silently reinterpreted as V2 supporting/prominent.
Missing V1 labels do not acquire negative judgments, assessment coverage, or
unreviewed claims. A later reinterpretation requires an explicit new human
judgment; keeping source compatibility does not strengthen old supervision.

Milestone 1 is demonstrated by saving and reopening a mixed section with two
prominent positives, an explicit negative, an unresolved judgment, and an
unreviewed dimension, preserving per-claim witnesses and necessary context.
Foundation approval requires actual human review of the local semantics and
initial calibration examples.

The selected four-dimension pilot changes the concrete demonstration: two
positives, one negative, and one unresolved judgment already occupy all four
coordinates in one scope. Demonstrate an unreviewed dimension in a second scope
and preserve its mask after reopening. The generic contract can still express all
five cases together for a larger Foundation, as covered by protocol tests. Do not
add an artificial fifth experimental target or report that one four-coordinate
scope contains five independent assessment states.

Milestone 2 additionally requires a real difficulty task, an external labeler's
source-bound handoff, an independent audit that separates routine results from
concrete expert questions, and retained human dispositions that the agent can
read. Confirming some claims and deferring another must retain the original
proposal through repeated exchanges. Automated fixtures demonstrate
protocol behavior; they do not substitute for this human decision. The real
partial-acceptance/deferral demonstration requires those dispositions to be
actually saved and read back through the outbox. A small honest spot-check request
can select supported claims for this human interaction; Foundation approval or
machine agreement alone does not complete it.

For a small manually bounded corpus batch, follow the
[corpus annotation runbook](corpus-annotation.md). Corpus scheduling, selective
V2 releases, semantic re-review after Foundation changes, and research split/exposure
policy are later milestones. The V2 review
workspace does not claim exhaustive difficulty coverage or research-release
eligibility from a completed review interaction.
