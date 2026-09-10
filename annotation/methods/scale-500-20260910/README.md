# Frozen scale-500 annotation methods

This package preserves the instructions used for the 500-section expansion and
its repairs on 2026-09-09–10. It adds public provenance for existing judgments.
It does not revise the maintained skill, Foundation, or historical assessments.

[manifest.json](manifest.json) records both original method identities and the
five required publication references: `labeler_skill`, `auditor_skill`,
`labeler_role`, `auditor_role`, and `harness`.

| Method | Recorded version | Requested batch limit |
| --- | --- | --- |
| Initial: `method-a444f6f5f4d5468cca164c350c6f70a49ebe3d15cc2b807b9fd354bda105d4b1` | `fine-harness:ee9bcab75a48755041e1db2365608f96b7f34fb4` | Up to four selected sections |
| Repair: `method-46fb9e0f64b8c2b249019fa18b6642b825c1a4e3343317d28918724668332f20` | `fine-harness:110de618a488a17af35f97c8fa8e9557263a179e` | One selected section |

Both use recorded model `gpt-6-astra` and CLI version `codex-cli 0.153.4`.
Requested reasoning effort is `medium` for the labeler and `high` for the separate
auditor. The controller requested fresh, ephemeral workers and a 28,000-character
brief limit. These settings describe execution requests; they do not prove every
hidden context boundary. No historical executable or model-weights digest was
recorded.

## Exact frozen instructions and inputs

The [skill manifest](skill/manifest.json) retains its original bytes and SHA-256
`73e8007c7523667ea610f80e59cf1225fdddebf9c60ab9223d35a72de595a2c6`.
All eight referenced files are copied byte for byte. Both methods share that
bundle and the exact [labeler](labeler.md) and [auditor](auditor.md) roles.
The frozen skill's calibration JSON links were already omitted from worker
bundles; the supplied prompts instead require progressive, scoped human-example
retrieval. Adding current calibration ledgers here would change the frozen input.

The `inputs/` directory preserves shared job instructions, both complete prompts,
both response schemas, and the Foundation definitions without embedded calibration
examples. `worker-instructions.md` is the exact job `AGENTS.md` content under an
archival filename. The full frozen Foundation identity is
`15fa68913bdb2bf395a189df7ab433f6d5b126fc35c46c1dbc8e607ce2182e97`;
its public source-referenced projection is maintained separately under
[`annotation/foundations/`](../../foundations/).

Job-specific inputs were exact source-linked section briefs/cases, current scoped
human judgments, prior repair questions, and, for audit, sealed proposals and
binding identities. Returned human examples are separately tracked auxiliary
evidence. Source identity, original millisecond scopes, and 1× playback remain
part of each judgment. This package contains no source chart bytes, normalized
notes, audio, example libraries, sealed packets, or private logs. Human calibration
prose inside the copied skill is unchanged and was already public.

## Evidence harness and delivery provenance

[harness.json](harness.json) lists all eight evidence tool files, their original
bundle paths, repository paths, and exact SHA-256 digests. Every tool and the
bundle preparer match both recorded Git commits byte for byte. Thus the method
references point to the actual copied evidence implementation:
[initial entrypoint](https://github.com/Pulsefield/beatmap-lens/blob/ee9bcab75a48755041e1db2365608f96b7f34fb4/harness/annotation-harness.py)
and [repair entrypoint](https://github.com/Pulsefield/beatmap-lens/blob/110de618a488a17af35f97c8fa8e9557263a179e/harness/annotation-harness.py).
Their shared entrypoint SHA-256 is
`410e9f07ec01d8aee0ce04586a7368aedacbf93136193dc83d206ddf8572bf21`.

The version suffix records Git HEAD when the skill descriptor was created; it
does not identify every later controller operation. Delivery separately received
the [raw Foundation binding fix](https://github.com/Pulsefield/beatmap-lens/commit/3c271783d3ef2ac6d4e50c5f656dfd45e6668070),
[disjoint response-fragment fix](https://github.com/Pulsefield/beatmap-lens/commit/110de618a488a17af35f97c8fa8e9557263a179e),
and [failed-current-claim revision fix](https://github.com/Pulsefield/beatmap-lens/commit/b591ce47d79958a6ea465556100a56e21f36a0ef).
Dispatch also received a
[provider-usage stop fix](https://github.com/Pulsefield/beatmap-lens/commit/f9e648dbec0caf53efc778293084e37c3639b328).
Those changes concern dispatch or canonical delivery; they did not change the
verified evidence tool bytes or copied worker instructions. This package does
not assert an unrecorded hash for every historical controller process.

## Verification and publication binding

All named files in seven retained harness bundles pass their original manifest
hashes. Across 314 run records (254 initial, 58 first repair, and two factual
correction workers), all skill files and shared instructions, roles, prompts,
Foundation definitions, and response schemas pass recorded hashes. The copied
files were also checked for exact equality across those runs. Skill files, roles,
and evidence source files were verified against public GitHub bytes at the
initial commit; all evidence files also match the repair commit locally.

For release configuration, bind each package-local artifact path in
`manifest.json` to the full GitHub commit that publishes this directory. Preserve
the explicit historical commits on the two `harness` references. The package
manifest's shared `optional_artifacts` can be merged into each method's artifacts
to verify every copied dependency, input, and this document during publication.
Add a `method_inventory` reference using the manifest's final file hash; a manifest
cannot embed its own hash. It is an inventory, not a ready-to-publish release
configuration.
No annotation or model run was performed to create this archive. Provenance and
independent machine audit establish neither human confirmation nor measured
annotation accuracy; coverage remains selected sections.
