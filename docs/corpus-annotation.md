# Running the local annotation campaign

The current preparation contains 500 distinct 4K difficulties as 500 Parquet files,
partitioned into 44 assignments. Their summed Lens chart duration is 103,414,351 ms
(about 28.73 hours); every assignment is at most 2,400,000 ms. The longest chart is
1,800,044 ms, so no chart was truncated. These are prepared inputs, not a statement
that 500 charts have been annotated or accepted. Read the persisted campaign status
for completed work.

The experiment collects useful source-backed sections under the approved Jack
organization, Stream organization, Tech, and LN coordination Foundation. Full-chart
structural discovery is required, but representative section collection does not
claim exhaustive semantic labeling of every instant or dimension.

## Selection and clean inputs

Select by the sum of difficulty-level community `top_tag_ids[].count` descending,
then distinct tag count descending. Break ties by beatmapset ID and beatmap ID
ascending. Retain one locally verified 4K difficulty per beatmapset, without a star
filter. Count all stored community tag IDs, including tags outside the four section
dimensions; do not count the beatmapset's free-form keyword string. Vote sums are
not unique voters, missing tags are not negatives, and community metadata never
establishes section truth or approves whole-map model targets. One per set also
does not guarantee one per song.

Keep selection ranks, per-tag votes, original metadata/source paths, hashes, and
checksum discrepancies in `.local/corpus-500/admin/`. The current snapshot includes
24 local files whose BeatmapID matches metadata but whose MD5 differs. Preserve
these exact local SHA-256 identities: the metadata supplied selection priority,
not endorsement of the current byte version. They were not silently replaced.

The worker inputs under `agent/charts/` omit ranks, tags, votes, stars, titles,
creators, difficulty names, and raw `.osu` bytes. Each Parquet retains every
canonical Lens note, its actual source line, zero-based column, kind, start/end
milliseconds, and source identity/hash. Schema metadata retains the full chart
range and exact parsed TimingPoints fields. Complete hold endings allow entering
holds to be derived when a worker chooses a narrower scope. A display crop never
changes a hold ending.

The preparation command uses the repository's parser and normalizer, then writes
and verifies each Parquet with PyArrow:

```sh
node scripts/prepare-annotation-corpus.mjs \
  --selection .local/corpus-500/admin/selection.json \
  --out .local/corpus-500 \
  --python ../Pulsefield-model/.venv/bin/python \
  --max-duration-ms 2400000
```

Run preparation before dispatch; do not regenerate inputs while their jobs are
active. The prepared Python environment has PyArrow. Administrative manifests and
intermediate JSON are not worker inputs. `agent/README.md` documents the table
schema. First-fit decreasing duration creates opaque assignment IDs, with source
SHA-256 used for ties and within-assignment order. Selection determines which
500 charts enter the campaign; dispatch follows assignments without exposing the
selection ranking. The 40-minute limit is summed chart duration, not worker wall
time. This separation is an input policy, not a filesystem access-control boundary.

## Persistent service and task binding

Build the Inspector and start the persistent review workspace:

```sh
pnpm --filter @pulsefield/beatmap-lens-inspector build
node scripts/review-workspace.mjs --workspace .local/review-pilot/workspace
```

The human keeps **http://127.0.0.1:4176/review** open. The controller registers exact
sources and obtains frozen tasks; workers write results in their own job folders.
The human does not transfer JSON, choose a directory, or open a different page for
each chart.

`controller/config.json` holds the service URL, approved reference source hash,
exact Foundation hash, skill provenance, duration cap, and actual Codex executable.
`worker-common/` holds the frozen skill, `skill-provenance.json`, and a Foundation
view preserving approved definitions and calibration claims. The controller retains
the complete approved Foundation and exact source bytes behind the task hashes.
These prepared files are prerequisites; the dispatcher is not a general corpus
selection or Foundation-approval command.

`node scripts/campaign-exchange.mjs prepare CAMPAIGN JOB` reads current feedback, registers
an absent source against the approved workspace Foundation, and writes clean
`bindings.json` with task/Foundation hashes, review base, and existing judgments.
Full frozen tasks stay gzip-compressed under `controller/tasks/`. Subsequent sealing
uses those exact tasks, without rebasing or modifying historical packets.

For a controller's individual source operation, the public CLI remains available:

```sh
node scripts/annotation-workflow.mjs register-source \
  --server http://127.0.0.1:4176 --source "PATH_TO_DIFFICULTY.osu" \
  --foundation-source-sha APPROVED_REFERENCE_SOURCE_SHA \
  --foundation-sha APPROVED_FOUNDATION_SHA --out task.json
node scripts/annotation-workflow.mjs fetch-task \
  --server http://127.0.0.1:4176 --source-sha SOURCE_SHA --fresh --out fresh-task.json
```

Registration preserves the original Foundation approval; it does not copy the
reference chart's observations or create another human approval. Existing source
history remains intact. Read feedback before new work and use a fresh task after
review changes. A few previously reviewed claims do not finish a whole chart;
retain those claims and inspect additional coverage without resubmitting them.

## Actual labelers, auditors, and skill provenance

Use the supplied [corpus labeler](agent-roles/corpus-labeler.md) and
[corpus auditor](agent-roles/corpus-auditor.md) roles. Each job receives only its own
assignment, copied Parquet files, frozen references, and task bindings. The auditor
receives the original sealed handoffs and discovery record, not the labeler's
analysis logs or selection evidence. Workers do not call the service, inspect
other jobs, or spawn agents. The controller seals and delivers their results.

The dispatcher launches separate actual `codex exec` processes for labeler and
auditor, using ephemeral sessions and the job directory as the workspace. Producer
IDs are `corpus-500-labeler-<UUID>` and `corpus-500-auditor-<UUID>`. `run.json` records
the actual command, CLI version, producer/role, input hashes, and execution state;
`events.jsonl` preserves execution events, with thread IDs and usage retained when
completion is recorded. Changing a producer ID on a labeler's self-check does not
constitute an independent audit.

The prepared skill descriptor is:

```json
{
  "name": "mania-pattern-judgment",
  "version": "git:ce6eb4df6e2cc8fd5379eb0d443cd5717ce80106",
  "sha256": "f516a9f360193f0fc64fc01f63a85ec82daddb0f0ca8d8fe41ff73855d82764d"
}
```

The SHA-256 identifies the frozen `skill/manifest.json`; that manifest records
individual file hashes. The runner verifies both the manifest and its files before
launch and before accepting the result. Workers copy this exact descriptor into
`result.json`, and sealed handoff/audit provenance records it with the actual
producer identity and CLI version. Do not substitute a globally installed skill or
silently edit a frozen bundle. A later guidance revision requires an explicit new
snapshot and provenance.

From the repository root, launch or inspect the prepared campaign:

```sh
python3 scripts/run-annotation-campaign.py run \
  --campaign .local/corpus-500 --concurrency 3
python3 scripts/run-annotation-campaign.py status --campaign .local/corpus-500
```

Concurrency counts all active workers, including auditors. `--label-limit N` limits
labeler assignments, not charts. The runner keeps one dispatcher lock, resumes
persisted work, and retains failures for coordinator inspection instead of silently
retrying changed judgments. A successful labeler job is followed by a separate
auditor job for the same assignment.

Workers use factual inspection helpers with the PyArrow-enabled Python runtime:

```sh
../Pulsefield-model/.venv/bin/python scripts/annotation-facts.py overview CHART.parquet
../Pulsefield-model/.venv/bin/python scripts/annotation-facts.py rows CHART.parquet \
  --start 10000 --end 15000
```

The helper reports structure, exact attack groups, source lines, and entering holds;
it assigns no semantic labels. The controller validates full-chart discovery
coverage and resolves worker `noteLines`/`contextLines` against the original frozen
source. Every original claim and question requires an auditor outcome. Fixable
scope/evidence defects return as `needs-revision`; concrete semantic doubts reach
the expert. Supporting individual claims is insufficient when the chart's broader
structure was skipped.

## Revision attempts

After both original jobs are submitted, prepare a separate attempt for the charts
requiring correction:

```sh
python3 scripts/prepare-annotation-revision.py \
  --campaign .local/corpus-500 --assignment-id ORIGINAL_ASSIGNMENT_ID \
  --source-sha SOURCE_SHA
```

Repeat `--source-sha` for multiple charts within the 40-minute total; `--reason`
can add a coordinator explanation to the saved findings. The command copies the
original frozen task gzip bytes unchanged and records the original handoff, audit,
compact feedback, and correction reasons in
`controller/revision-inputs/<newId>/prior-review.json`. It publishes
`controller/revisions/<newId>.json` only after those inputs exist. `revisionOf`
identifies the prior assignment; `supersedes` explicitly binds each source to its
original handoff ID/hash and audit ID/hash. Old runs, results, packets, and tasks
remain intact. Preparation itself does not run a worker or change the task base.

The running dispatcher discovers new revision assignments dynamically and starts
a fresh labeler followed by a fresh independent auditor. If it has exited, resume
with the existing `run` command. Workers receive `prior-review.json` and must
correct the actual source/scope/reasoning defects, not merely repeat an old verdict.
Once the replacement auditor has submitted, the explicit supersession chain chooses
the current attempt for campaign acceptance. Final counts deduplicate by source;
competing attempts without that chain are an error, not extra completed charts.

## Feedback, acceptance, and checkpointing

The controller uses `GET /api/review/feedback/SOURCE_SHA` for compact machine
feedback. It returns current task/base bindings, claim summaries and statuses,
audits, human decisions, and exact modified claims without duplicating the full
source or Foundation. The campaign exchange reads this endpoint automatically;
there is no separate `feedback` subcommand in `annotation-workflow.mjs`. The full
`source` and `dispositions` endpoints remain available for human review and complete
exports. Inspector retains the full evidence and editing context.

Before final acceptance, refresh saved feedback from the canonical service:

```sh
python3 scripts/run-annotation-campaign.py status \
  --campaign .local/corpus-500 --refresh
```

This refreshes submitted auditor jobs before computing status, so subsequent human
decisions and current review bases affect acceptance. Plain `status` reads the
saved feedback snapshots and is not a final freshness check.

Supported machine judgments remain `agent-reviewed`. `acceptedCharts` in
`controller/progress.json` means current judgments and independent coverage review
satisfy campaign acceptance; it is not a count of human-confirmed charts or
exhaustive labels. Report
labeler submissions, auditor submissions, accepted machine reviews, revision work,
expert cases, and human decisions separately. Execution success or a cleared inbox
alone is not completion. Inspect failed jobs, receipts, coverage records, and
outstanding work before declaring the campaign finished.

Human confirm/modify/reject/defer feedback is consumed directly. Accepted or
modified observations retain human provenance. Rejection is not absence; defer
does not change the claim to unknown. New agent judgments need new immutable
proposals and independent audits, while unchanged human decisions need no second
confirmation. Continue other charts while focused expert cases wait. A small honest
spot-check request can sample supported work without inventing semantic doubt.

## Compact workspace storage and backup

`workflow/<SOURCE_SHA>.v2.json` may be a compact local storage envelope. Shared
Foundation/task objects and exact source bytes live in `.workflow-objects/`.
The local adapter expands these into byte-identical canonical JSON, preserving
canonical document hashes, frozen task hashes, history, and compare-and-swap checks.
Legacy expanded files remain readable. This is physical storage encoding, not a
new semantic contract or conversion of V1 records.

Back up the **whole workspace, including `.workflow-objects/`**, with its workflow
and exchange directories. Pause its writer for a consistent backup. A compact
`.v2.json` copied alone is not a standalone export. Offline CLI readers expand
compact files in their workspace location:

```sh
node scripts/annotation-workflow.mjs dispositions \
  --file .local/review-pilot/workspace/workflow/SOURCE_SHA.v2.json --out dispositions.json
node scripts/annotation-workflow.mjs review-status \
  --file .local/review-pilot/workspace/workflow/SOURCE_SHA.v2.json
```

`readCanonicalWorkflowFile(path)` in `scripts/workflow-local-directory.mjs` supplies
expanded canonical text when a standalone document export is needed. The same
module's `compactReviewWorkspace(workspace)` is an offline storage migration: stop
the service first; it verifies every expanded canonical hash after rewriting. It
creates no annotations or approvals.
