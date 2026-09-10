# Publish an annotation dataset snapshot

The publication pipeline reads the V2 Review workspace and produces a compact
Hugging Face dataset. It uses the existing human revision rules. It does not run
annotation agents, change golden judgments, or require the Review server to stop.
See the [format decision](../decisions/0008-dataset-snapshot-publication.md).

## Prepare the local inputs

Run from the repository with its locked Python environment and installed Node
dependencies. Hugging Face authentication uses the normal local `hf auth login`
credentials; do not put access tokens in release configuration or source control.

```sh
uv sync --locked
pnpm dataset:release collect \
  --workspace .local/corpus-500-v2/workspace \
  --out .local/release-work/release-input.json
pnpm dataset:release init \
  --input .local/release-work/release-input.json \
  --out .local/release-work/config
```

Collection validates exact source bytes through the existing workflow domain,
extracts effective human observations, and resolves auxiliary human evidence
against the whole frozen workspace. A concurrent canonical edit makes collection
fail; collect again after the edit. The internal input includes public Foundation
projections and dependency metadata. Only the final snapshot directory is uploaded.

`init` creates `release.json` with the project defaults (`sed-i/mania-pattern-annotations`,
MIT, human-only), explicit missing artifact commits, and official source locators.
It writes each
public Foundation JSON under `foundations/`. These artifacts retain definitions,
policies, and calibration judgments, but replace embedded chart bytes with hashes.
Publish the chosen artifacts in GitHub, then fill their exact commit/path/hash
references. The original frozen Foundation hash and public artifact hash differ.

Fill the release configuration with:

- `repo_id`, title, release ID, and the dataset license.
- `exporter`: the public GitHub commit, entrypoint path and file SHA-256 containing
  the implementation being used. A dirty checkout is not an immutable code version.
- `sources`: each selected original source SHA-256 and its public external locator,
  including the calibration sources needed by selected Foundations.
- `foundations`: public artifact references for the selected frozen Foundation hashes.
- `policy.agent_methods`: optional exact method IDs from the collected inventory.
  The default empty list publishes only human judgments.
- `policy.human_precedence`: new configurations set this to `true`. An effective
  human assessment at the exact same source hash, start, end, tag and playback
  rate excludes an otherwise eligible machine row, even on a different handoff.
  Unresolved and unreviewed human assessments also mask machine supervision.
  This is a publication filter; it does not delete historical machine proposals
  or change human records. Historical configurations without this field retain
  their original overlap behavior.
- `policy.excluded_sources`: optional source SHA-256 to reason mapping, for example
  when the annotated historical bytes are no longer publicly retrievable. It
  excludes those judgments from this snapshot and records their counts and reasons;
  it never changes workspace gold. A required Foundation calibration source cannot
  be excluded from its definition's dependencies.

An HF source reference has this shape (values shown are placeholders):

```json
{
  "kind": "hf",
  "repository": "organization/source-corpus",
  "commit": "<full-HF-commit>",
  "path": "data/sources.parquet",
  "record_key": "<source-record-key>",
  "uri": null
}
```

Set `record_key` to null for a file whose entire bytes are the original `.osu`.
Alternatively use `kind: "content-addressed"` and an HTTPS `uri` containing the exact
source SHA-256; other locator fields are null. For a chart with a public beatmap ID,
`init` uses `kind: "osu"`, `uri: "https://osu.ppy.sh/osu/<beatmap-id>"`, and null
values for the other locator fields. This official URL can change: identity is the
original `source_sha256`, and publication downloads and checks those exact bytes.
Consumers must do the same. A missing file or hash mismatch means the annotated
version is unavailable, and never authorizes attaching labels to another version.
An external mirror that retains the exact bytes can use `kind: "url"` and its
HTTPS `uri` (other locator fields null). This also requires byte-for-byte SHA-256
verification; neither a mirror's beatmap ID nor a normalized-chart match suffices.
No chart bytes, normalized notes, audio, or images are added to the publication.
The MIT license covers the annotations; it does not relicense linked beatmaps.

Agent methods preserve the recorded labeler/auditor identities, independent of
worker IDs. Declare immutable skill, role, and harness artifacts for complete
provenance. Unknown historical artifacts remain partial: only an explicit
`allow_partial_method_provenance` policy admits them. The separately declared
`auxiliary_evidence` policy selects which of `current`, `changed`, and `untracked`
are allowed for agent rows. Human judgments are independent of these machine gates.
These fields describe provenance and admission, not measured annotation accuracy.

## Build and check the snapshot

```sh
pnpm dataset:release build \
  --input .local/release-work/release-input.json \
  --config .local/release-work/config/release.json \
  --out .local/releases/2026-09-09.1
pnpm dataset:release validate .local/releases/2026-09-09.1
```

The output directory must be new. The builder writes typed Zstandard Parquet,
generates the Dataset Card with `human` as the default configuration, includes the
MIT `LICENSE` notice, and records
file hashes, row counts, registries, exclusions, and policy in `manifest.json`.
Source/Foundation incompatibility is reported as an exclusion. Explicit unresolved
or unreviewed assessments remain masked values; missing rows never become absent.
Agent proposals that were modified, rejected, superseded, or lack an independent
supporting audit are excluded from the agent subset.

Validation checks schemas, hashes, counts, identifiers, ranges, assessments,
references, and the exact file inventory. Unexpected files and symbolic links
fail validation. It does not claim semantic accuracy or execute a model evaluation.
New snapshots use manifest version 2 and `judgment-v2`, including a required
`playback_rate`. Historical version 1 snapshots remain readable as 1×. All source
coordinates stay in original milliseconds; see [playback rates](playback-rate.md).
Contradictory supervised human judgments for the exact same source/scope/tag/rate block
release; different overlapping scopes remain distinguishable. Empty configurations
can be inspected locally but cannot be published: deselect empty agent methods,
and include at least one effective human judgment in the default configuration.

For a later release, download the previous snapshot at a fixed HF commit, pass
`build --previous PATH`, and set `previous_snapshot` to its `repo_id` and `commit`.
The pipeline retains explicit revision lineage and requires reasons for removed
records not superseded by a replacement. Remote publication also checks that this
predecessor is still the destination's current commit.

## Preview and publish

```sh
pnpm dataset:release plan .local/releases/2026-09-09.1
pnpm dataset:release publish .local/releases/2026-09-09.1 \
  --receipt .local/release-work/published.json
```

`plan` is read-only. It verifies public GitHub artifact bytes and source locators,
then lists added/replaced/deleted snapshot files. Standalone source files are
downloaded and hash-checked; corpus shard references are checked for public file
availability at the pinned commit, without downloading and decoding whole shards.
The report distinguishes these checks. Consumers must still verify the original
source byte hash when resolving a corpus row.

`publish` repeats validation and reference checks, copies the exact file inventory
into private temporary staging, and sends one HF commit guarded by the observed
parent commit. Old files are removed only when owned by the preceding manifest.
Unmanaged remote files stop publication. A retry after a successful commit returns
the existing commit identity when the same snapshot is already present.

For the first release into a new repository, add `--create-repo`; new repositories
are private unless `--public` is also supplied. This flag never changes visibility
of an existing repository. The receipt stays outside the immutable snapshot and
contains the full HF commit and citation URL. The code and Foundation GitHub
commits are independent of this HF dataset commit. No version tag is moved. Every release remains accessible at its full HF commit;
a version tag may be added to that commit without modifying the snapshot.
The manifest includes digests of the actual collector/exporter implementation
files; publication verifies those files at the declared GitHub commit as well as
the entrypoint. A previous local snapshot is bound to its HF predecessor through
the previous manifest's checksum.

```python
from datasets import load_dataset

human = load_dataset("sed-i/mania-pattern-annotations", "human", revision="<HF-commit>", split="full")
supervision = human.filter(lambda row: row["presence"] in ("present", "absent"))
```

Install `datasets` in the consumer's own environment. The `full` split is an
annotation resource, not an advertised held-out benchmark. Agent configurations
are opt-in and must not be silently unioned with human judgments as independent gold.
When constructing training examples, deduplicate agreeing human observations on
the exact source/scope/tag/rate key so independent provenance records do not add
duplicate training weight. Preserve the original records for traceability. Use
the human precedence policy when adding machine supervision; missing or masked
human values do not become machine-provided negatives. Different scopes and rates
remain distinct judgments.

## Published snapshots

The first human-only release is
[v0.1.0](https://huggingface.co/datasets/sed-i/mania-pattern-annotations/tree/892845970a21861b51d7f2c6797ae2cf5784e729),
published on 2026-09-09 under MIT. Its immutable HF commit is
`892845970a21861b51d7f2c6797ae2cf5784e729`; the `v0.1.0` tag resolves to that commit.
The exporter and public Foundation are pinned to GitHub commit
`ee8db26b8a22b7a6ec89ea5b2b3a777b1a722667`.

It contains 156 human judgments (89 present, 67 explicitly absent) across 117
charts, with 121 source rows including all five required calibration sources.
Every included source reference was downloaded and verified against its original
SHA-256 before publication: 120 official osu! downloads and one osu.direct mirror.
The five published files total 328,104 bytes, including metadata and MIT notice.

Eight judgments on six historical source versions are deferred because none of
the checked public downloads matched the annotated bytes. Their source hashes and
reasons are recorded in the manifest, and the original workspace judgments remain
unchanged. No machine judgment table is included in this release.
