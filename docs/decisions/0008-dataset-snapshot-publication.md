# Compact dataset snapshot publication

- Status: Accepted on 2026-09-09; publication pipeline implemented and first-release settings confirmed
- Date: 2026-09-09
- Confirmed direction: publish annotation snapshots on Hugging Face, keep repository
  development public on GitHub, and reference skill/Foundation artifacts instead
  of embedding them in the dataset. Sources use hash plus reference; do not bundle
  raw beatmaps or audio.

## Separate publication from the working document

The repository previously specified a future human dataset with optional,
versioned agent-reviewed annotations, but no publication schema. The V1 dataset
manifest and V2 review documents are workspace contracts. They contain working
history and embedded inputs that should not become the public download format.

Introduce an independent `beatmap-lens-annotations` publication schema, version 1.
Each release is a complete snapshot of selected effective judgments. It is not an
event journal, an agent task packet, or a promise to reproduce every historical run.
Later human corrections appear in a new snapshot; prior released commits remain
addressable. Development and human editing continue independently of release checks.

## Files and Hugging Face loading

Use Parquet with Zstandard compression for tables, readable field names, and a
small JSON manifest for shared identities and references. Start with one file per
table/subset; shard only when size warrants it. Do not duplicate JSONL/CSV copies
in every release. Hugging Face recommends Parquet for typed, compressed tabular
data and supports named configurations without a custom loading script.
See [supported formats](https://huggingface.co/docs/hub/datasets-adding) and
[configuration metadata](https://huggingface.co/docs/hub/datasets-manual-configuration).

```text
README.md                         # Dataset card, semantics, configs, license
LICENSE                           # Complete MIT terms and project copyright notice
manifest.json                     # Release policy, references, counts, file hashes
data/sources.parquet              # One row per exact source, shared by all subsets
data/human.parquet                # Default config: current human judgments
data/agent/<method-id>.parquet     # Optional config per frozen labeler/auditor method
```

All judgment files have the same schema. Configure `human` as the default, `sources`
as a separate configuration, and each `agent-<method-id>` as an explicit opt-in.
Do not silently union human and machine rows: overlapping judgments can differ,
and the consumer must choose how to use them. A human-confirmed agent proposal
belongs in `human`; its machine ancestor may still appear in the corresponding
agent configuration, identified as an ancestor rather than an independent example.

Use a split named `full` (`all` is a reserved Hugging Face Datasets keyword). The
release is an annotation resource, with no
held-out benchmark claim. A later benchmark needs a declared grouping policy that
keeps related charts, sections, and exposed calibration/retrieval examples out of
its test population. Agent method versions are configurations, not train/test splits.

Consumers pin an HF **commit**, independently of the GitHub code commit:

```python
from datasets import load_dataset

human = load_dataset(
    "sed-i/mania-pattern-annotations", "human",
    revision="<full-hugging-face-commit>", split="full",
)
```

The commit above is a placeholder until a release receipt identifies the snapshot.
Hugging Face supports the
[`revision` argument](https://huggingface.co/docs/datasets/loading). Release names
such as `2026-09-09.1` are convenient aliases; a recorded full commit identifies
the exact published snapshot. Do not embed the containing HF commit in its own
manifest, creating a self-reference. Record it in the release announcement/citation.

## Source and judgment rows

`sources.parquet` uses the SHA-256 of the original `.osu` bytes as its primary key.
Keep byte length, normalizer ID, key count, available beatmap/set IDs, and ordinary
chart metadata (title, artist, creator, difficulty) once per source. Remote beatmap
IDs are discovery aids, not immutable source identity.

Source delivery is **hash plus reference**, as selected by the user. Do not include
original `.osu` bytes, normalized notes, audio, or images. Each source has a
`source_ref` locating its content separately. Supported kinds are an HF repository
with full commit, file path, and optional record key (`hf`), an HTTPS path containing
the exact source hash (`content-addressed`), the official beatmap download
endpoint (`osu`), and a general HTTPS download locator (`url`). An `osu` reference
has `uri` exactly `https://osu.ppy.sh/osu/{beatmap_id}` matching the source metadata.
A `url` reference can identify a public mirror holding the original revision; it
must not contain credentials or a fragment. Both use only `uri`, with their other
locator fields null. Publication retrieves the bytes and verifies `source_sha256`.

The official endpoint and general URLs are mutable retrieval locators. They do not
pin a revision or guarantee archival availability. The original byte hash remains
the exact source identity. A historical source may later become unavailable from
those locations; a pinned independent corpus can provide an additional retrieval
option in a later snapshot. A local path is not a public reference.

Consumers obtain source content separately and verify the original byte hash before
applying time ranges or note references. A changed download must fail that check,
not silently replace the annotated source. The dataset card explains the corpus
dependency and retrieval procedure. Annotation-table browsing and filtering need
no source download; chart reconstruction and training on notes do.

The logical judgment unit is **one tag assessment over one source interval**.
Tags can have different scopes and can independently be prominent. Do not turn the
release into one exclusive chart class or require all tags to share one section.

| Fields | Meaning |
| --- | --- |
| `record_id` | Immutable exported record identity, namespaced by source and original observation or handoff/claim identity |
| `source_sha256` | Foreign key to the exact source row |
| `start_ms`, `end_ms` | Judgment scope in original source time, half-open `[start_ms, end_ms)` |
| `tag_id`, `presence`, `salience` | V2 assessment; salience is `supporting`/`prominent` only when presence is `present`, otherwise null |
| `foundation_id` | Short key into the manifest's Foundation registry |
| `origin` | `human-direct`, `human-confirmed`, `human-modified`, or `agent-reviewed` |
| `observation_id`, `decision_id`, `handoff_id`, `claim_id` | Original record identities where applicable; human rows preserve machine ancestry when present |
| `provenance_id` | Nullable short key into shared machine method/packet/evidence provenance; direct human judgments need none |
| `supersedes_record_ids` | Explicit prior human revision identities, including prior-release records where applicable |
| `auxiliary_evidence_status` | Snapshot-relative `current`, `changed`, `untracked`, or `not-applicable`; independent of human authority |
| `details` | Typed nested review context, evidence, human rationale, and optional boundary uncertainty, transition, exemplar role, and section ID |

The exporter must preserve exact scope/context boundaries and existing evidence
meaning. Evidence note references may use source-line pointers only when validated
against the exact source bytes; do not regenerate them from a different chart
revision. Preserve original human wording, distinguish it from machine rationale,
and retain original observation/decision identifiers. Column projection lets
training consumers omit `details` without deleting it from the research dataset.

Absence requires an explicit `absent` assessment for the stated scope. Missing
rows mean unreviewed, never negative. Rejection of a proposal does not create an
absent label. Preserve explicit `unresolved` and `unreviewed` observations when
selected; they are masked supervision, not negatives. No rows are manufactured for
unassessed tag/interval combinations. The dataset card states the positive-first,
partially exhaustive collection policy and supplies a validity-mask example.

Export effective human observations using the existing domain selector, not the
entire append-only observation journal or a filter on proposal status `accepted`.
Human revisions that change scope retain their explicit lineage. Keep unresolved
overlaps distinguishable; never resolve conflicting gold by silently taking the
last exported row. When a row is removed without a replacement, the next manifest
records its ID and removal reason relative to the previous snapshot.

## References once per snapshot

`manifest.json` contains schema version, release ID, creation time, previous HF
snapshot reference, exporter GitHub commit, selected scope, release policy, file
SHA-256 hashes and row counts, exclusion counts/reasons, and these registries:

- **Foundations:** original frozen Foundation hash, public artifact reference, and
  the declared relationship between the public artifact and frozen record.
- **Methods:** exact labeler/auditor model identifiers as recorded, skill bundle,
  role/prompt/harness artifact references, tool version, and any public evaluation
  report used by the release policy. Distinct frozen methods get distinct IDs;
  a model name or skill version string alone is insufficient.
- **Provenance:** shared packet/producer identities and deduplicated sets of actual
  auxiliary human evidence references. Each dependency retains source hash,
  observation ID, and observation hash; include a resolvable snapshot record
  reference when available. Unknown legacy dependencies remain explicitly untracked.

Keep per-observation identities on judgment rows rather than creating one manifest
entry per human row. Legacy records may lack role/prompt/harness identities; never
fill those gaps from today's checkout. Record unknown provenance explicitly and
let the declared machine release policy admit it or exclude the affected subset.

An artifact reference consists of `repository`, **full `commit`**, `path`, and
`sha256`. Its digest describes the actual referenced bytes, or a precisely defined
bundle manifest for multi-file skills. GitHub URLs use the pinned commit, never
`main` or `latest`. Public definitions and methods must be published before a
release that claims their references are resolvable. No local absolute paths.

The current frozen Foundation includes calibration source bytes and approval data;
the skill digest includes a bundle of referenced guides. A link to today's source
code or to `SKILL.md` alone cannot reproduce those identities. A public Foundation
artifact may replace embedded calibration bytes with exact source hashes and retrieval references,
but must preserve all normative definitions, policies, and calibration judgments
needed to interpret the labels. Its hash is different from the original full
frozen Foundation hash. Name both explicitly and publish the mapping; do not
assert byte equality or semantic equivalence merely because IDs/revisions match.
Calibration sources referenced by public semantics must also be resolvable.

The HF download therefore includes **references and interpretation rules**, while
GitHub owns the versioned Foundation, skill, harness, and evaluation descriptions.
The dataset card still explains coordinates, assessment enums, salience, missing
values, and provenance categories without requiring users to execute repository
code. Referencing method artifacts does not imply that private historical traces
or exact nondeterministic model runs are reproducible.

## Confidence and release admission

Keep three separate concepts: judgment authority (human/machine), source/Foundation
compatibility, and auxiliary evidence freshness. These are categorical facts,
not a calibrated confidence probability. Resolve compatibility against the declared
snapshot targets, never against whatever happens to be the latest live workspace.

The default human configuration contains effective human judgments with valid
source identity and a resolved, declared Foundation basis. A change to auxiliary
examples used by an ancestor agent does not revoke a human judgment. Human
confirmation also does not certify the ancestor's rationale. Human rows do not
require a skill version or passing auditor evaluation.

An optional agent configuration requires valid source/Foundation binding and the
independent audit required by its declared policy. Record auxiliary status even
when that policy admits `changed` or `untracked` evidence; such admission must be
explicit in the manifest/card. `agent-reviewed` describes the review process, not
human gold or measured accuracy. Report any quality evaluation separately, with
sample selection and exposure limitations. A file hash proves identity, not quality.

Release checks validate the selected snapshot: schema and foreign keys, exact
source/evidence binding, effective human revisions and conflicts, resolvable
semantic/method references, declared admission policy, and any promised quality
evaluation. Evaluate cross-chart evidence against the frozen dependency inventory,
not a single-document resolver or the changing live workspace. Incompatible rows
are excluded or held for a later snapshot with reasons retained. They remain
accessible and editable in Review. Missing evaluation for an optional machine
configuration does not block an independently valid human release.

A release can explicitly omit sources whose historical bytes are unavailable or
fail retrieval verification. `policy.excluded_sources` maps collected source hashes
to nonempty reasons and defaults to an empty map. Their human and agent judgments
are excluded with `source-excluded` counts; the source hashes and reasons remain in
the manifest, and the dataset card identifies the partial selection. This changes
only publication admission, never workspace gold or the collected projection.
Every included Foundation still requires all of its calibration sources. Listing
a required calibration source for exclusion fails the build instead of changing
the Foundation or silently discarding its examples.

## First-release settings

The first publication targets `sed-i/mania-pattern-annotations` and contains human
judgments only. Its source table uses official `osu` locators and verified HTTPS
mirrors where needed, with mandatory original-byte hash verification; no beatmaps
or audio are bundled. Human identity
fields are omitted from annotation tables, while original observation and decision
identifiers remain available for revision and provenance links.

The user explicitly selected MIT for the exported annotations and accompanying
dataset documentation. MIT snapshots include `LICENSE` with the complete terms
and the repository's notice, `Copyright (c) 2026 Pulsefield contributors`. Its file
hash appears in the manifest and the exporter reference inventory. This choice
does not distribute or relicense externally referenced beatmaps.

No benchmark split, numeric accuracy threshold, public annotator identity,
or quality certification is implied. The byte-level Arrow schema is defined in
`annotation/release/snapshot.py`; the operating commands are documented in
[Dataset publication](../annotation/dataset-publication.md).
