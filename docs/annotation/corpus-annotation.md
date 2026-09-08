# Whole-chart discovery and section annotation

The production workflow starts with complete-chart discovery, then selects useful
sections for deeper annotation and repair. Labelers consider Jack, Stream, Trill,
Tech, and LN coordination independently under the task's approved Foundation.
Independent auditors review the results, and the Inspector collects human decisions.
A completed discovery pass does not mean every instant has all five labels.

## Working boundaries

| Stage | Entry point | Result |
| --- | --- | --- |
| Prepare charts | `annotation/pipeline/prepare-annotation-corpus.mjs` | Source-bound Parquets and whole-chart assignments |
| Discover and review | `annotation/pipeline/run-annotation-campaign.py` | Section proposals, independent audits, discovery coverage, and delivery status |
| Select sections | `annotation/pipeline/annotation-priorities.py` | Repair and discovery queue with coverage measurements |
| Prepare inspection | `harness/prepare-annotation-harness.py` | Source facts, human examples, and tools for the selected scopes |
| Annotate sections | `annotation/pipeline/run-fine-annotation.py` | Bounded labeler/auditor batches delivered to the Review service |
| Continue batches | `annotation/pipeline/fine-annotation-campaign.py` | Progress against a configured section target |
| Revise judgments | `annotation/pipeline/prepare-annotation-revision.py` | New proposals linked to the reviewed claims they replace |

Read [agent–human review](agent-workflow.md) for the packet and authority boundaries,
[selection](annotation-selection.md) for ranking and coverage, and
[fine annotation](fine-annotation.md) for section jobs. These tools operate on a
prepared local campaign and approved Foundation; there is no generic command that
invents a Foundation approval or configures every possible dataset.

## Local inputs and runtime

Paired development with Pulsefield is the default. Keep dataset and workspace paths
configurable and pass the Python environment used for preparation explicitly.
Shared configuration is:

| Setting | Use |
| --- | --- |
| `PULSEFIELD_ROOT` | Pulsefield checkout; defaults to `../Pulsefield-model` |
| `PULSEFIELD_PYTHON` | Pulsefield audio runtime; defaults to that checkout's `.venv/bin/python` |
| `PULSEFIELD_DATASET` | Review metadata dataset; `--dataset` overrides it |
| `ANNOTATION_PYTHON` | Whole-chart worker helper runtime; falls back to `PULSEFIELD_PYTHON`, then the paired checkout's Python |

Learning also accepts `--dataset` and `--pulsefield-root`. Fine annotation uses its
launching Python unless a preparation runtime is supplied. For a separate
annotation environment:

```sh
uv venv .local/annotation-venv --python python3.10
uv pip install --python .local/annotation-venv/bin/python -r harness/requirements.txt
export ANNOTATION_PYTHON="$PWD/.local/annotation-venv/bin/python"
```

`.local/` paths below are example destinations for new work. They do not refer to
bundled campaigns. Keep raw beatmaps, selection manifests, generated inputs, and
run output local. Small public findings can identify a source, section, and judgment
without publishing an entire working directory.

Prepare a selected corpus with the Lens parser and a PyArrow-enabled runtime:

```sh
node annotation/pipeline/prepare-annotation-corpus.mjs \
  --selection /path/to/selection.json \
  --out .local/campaign \
  --python .local/annotation-venv/bin/python \
  --max-duration-ms 2400000
```

A selection can use community tags to choose varied material, but votes are
whole-difficulty observations. They do not establish section labels, and missing
tags are not negatives. Preserve the actual local source identity when metadata
and bytes differ. One beatmapset is not necessarily one song.

The worker Parquets preserve canonical notes, source lines, zero-based columns,
full LN endings, source identity, chart range, and timing points. Administrative
selection ranks, votes, titles, and difficulty names are excluded from whole-chart
worker inputs. Summed assignment duration bounds chart material, not worker time.
Prepare inputs before dispatch and keep an active job's inputs fixed.

## Review service and whole-chart discovery

Build and run the Inspector against the campaign's persistent workspace:

```sh
pnpm --filter @pulsefield/beatmap-lens-inspector build
pnpm review:workspace --workspace .local/campaign/workspace
```

The human page is **http://127.0.0.1:4176/review**. The controller registers exact
sources, obtains tasks bound to the approved Foundation and current review base,
and delivers proposals and audits. The human reviews in the browser without
transferring worker files.

The dispatcher consumes `controller/config.json`, assignments, and a prepared
`worker-common/` containing skill, roles, tool code, and Foundation definitions.
The config supplies the service, reference source/Foundation, executable, and
role-specific model and reasoning settings. Whole-chart jobs use the
[query labeler](../../annotation/roles/query-corpus-labeler.md) and a matching
[auditor](../../annotation/roles/query-corpus-auditor.md).

```sh
.local/annotation-venv/bin/python annotation/pipeline/run-annotation-campaign.py run \
  --campaign .local/campaign --concurrency 5
.local/annotation-venv/bin/python annotation/pipeline/run-annotation-campaign.py status \
  --campaign .local/campaign --refresh
```

Labeler and auditor are separate executions with distinct producer identities.
A renamed self-check is not independent review. In `labeler-evidence` audit mode,
the auditor checks submitted claims, witnesses, and coverage declarations rather
than independently traversing the original chart. Insufficient submitted evidence
returns for revision; this mode cannot prove that an omitted source event is absent.
The mechanical result checker validates source references and declared coverage,
not semantic truth.

The controller refreshes human feedback before new work. Reuse settled human
judgments at their exact scope and inspect the remaining material. A few reviewed
claims do not establish complete-chart discovery.

## Select, annotate, and repair

Run the selector against the discovered corpus and current review feedback:

```sh
.local/annotation-venv/bin/python annotation/pipeline/annotation-priorities.py \
  --campaign .local/campaign --out .local/section-priorities --batch-size 24
```

The queue combines open repairs, missing dimensions, structural coverage, and a
seeded exploration share. Ranking is an experimental retrieval heuristic, not a
predicted label or calibrated measure of model uncertainty. Use its scopes to
prepare an annotation-mode harness and then run the
[selected-section workflow](fine-annotation.md). Workers may refine semantic cuts
while preserving complete local context and current human decisions.

For an unsubmitted failed whole-chart attempt, `prepare-annotation-recovery.py`
creates a new attempt from concrete findings. For a delivered attempt needing
correction, `prepare-annotation-revision.py` records the old claim bindings and
prepares new work. Its `--current-base` option obtains a fresh task after human
review has changed the base. Read the command's `--help` for the required inputs.
Submit replacement proposals with explicit supersession and independent audit;
a new machine claim never replaces an existing human decision.

## Completion and human feedback

Refresh canonical feedback before reporting completion. Plain campaign `status`
reads saved feedback; `status --refresh` obtains current review state first.
Report submissions, independently reviewed machine results, discovery coverage,
section coverage, open revisions, expert cases, and human decisions separately.
`acceptedCharts` means the configured campaign checks passed; it does not count
human-confirmed charts or exhaustive labels.

The Inspector supports focused expert questions and random samples of current
machine-reviewed claims, including labeler and auditor version filters. Human
acceptance or modification supplies a human judgment. Rejection is not absence;
deferral leaves a judgment unsettled. Consume a recorded correction directly,
then investigate whether its distinction applies elsewhere instead of copying
that label onto superficially similar sections.

Future Hugging Face releases will distinguish human annotations from optional
versioned agent-reviewed annotations. Selection and workflow completion alone do
not establish release quality. No general format adapter is required by this plan.

## Workspace storage

Canonical workspace files may reference shared objects in `.workflow-objects/`.
Back up the whole workspace, including that directory and exchange state; pause
its writer when taking a consistent copy. A compact workflow file alone is not a
standalone export. The Review CLI can read it in its workspace and export a full
view. Raw execution logs and working research notes are local operational records,
not required public documentation.
