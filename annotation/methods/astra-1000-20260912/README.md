# Frozen Astra 1000-section method

This package records the method used for the 2026-09-12 campaign: 1,000 selected
sections on 500 charts, with five independent dimensions per section at 1×.
It preserves the actual frozen instructions and their identities. It does not
change Foundation definitions, human judgments, or the historical scale-500 method.

| Component | Recorded identity or execution request |
| --- | --- |
| Labeler model | `gpt-6-astra`, reasoning effort `medium` |
| Independent auditor model | `gpt-6-astra`, reasoning effort `high` |
| Worker CLI | `codex-cli 0.154.0-alpha.6.2` |
| Skill name | `mania-pattern-judgment` |
| Skill version | `fine-harness:eb233598c6d0fcf5e9931416948d105f23ca8a71` |
| Skill bundle SHA-256 | `bf56212bc04c99b4bcc5736917285680f0fba756864bd8222c8a22ca3a186299` |
| Harness source commit | `eb233598c6d0fcf5e9931416948d105f23ca8a71` |
| Harness entrypoint SHA-256 | `7755bc61aa0721a9f530e8611e317198f5cbaea739b50247e5fbd6bb9b2f2ad0` |
| Private harness bundle manifest SHA-256 | `296804d611d117cd7ebdf067faf8fdbd0101570df2075dd9d6763d7af42e8bc7` |
| Frozen Foundation SHA-256 | `15fa68913bdb2bf395a189df7ab433f6d5b126fc35c46c1dbc8e607ce2182e97` |

The skill bundle hash identifies the exact bytes of [skill/manifest.json](skill/manifest.json),
which lists all eight copied skill files and their SHA-256 digests. It is not the
hash of `SKILL.md` alone. [manifest.json](manifest.json) inventories the public
package, and [harness.json](harness.json) binds all eight tool files to the original
GitHub source commit. The private harness manifest also covers chart and exemplar
inputs; recording its digest does not publish those inputs.

## Instructions and independent audit

The exact [labeler](labeler.md) and [auditor](auditor.md) roles, shared worker
instructions, full prompts, response schemas, and Foundation definitions without
embedded calibration examples are preserved under `inputs/`. The prompts load the
role, skill, and Foundation once. Workers inspect source arrangements and retrieve
scoped human comparisons through the read-only harness. Community tags guide
selection and are not canonical label evidence.

The campaign uses 125 tranches and 257 final jobs for each role. Each job contains
one to four sections. The controller requests fresh ephemeral workers with
distinct labeler and auditor producer identities, seals their outputs, and binds
the audit to the exact handoff and claim. Both roles use the same model family;
independent producers do not eliminate correlated model errors. Recorded requests
and receipts do not establish hidden model state, model weights, or a historical
executable digest, which were not recorded.

During publication preparation, all 11,252 recorded input hashes across 514 final
run records were verified. Shared instructions, roles, prompts, schemas, skill,
and Foundation inputs match across final jobs for each role. All 512 files in the
private harness inventory match their hashes; its eight tool files also match
the recorded GitHub commit. Failed attempts remain local historical records and
are not recast as successful final jobs.

## Publication scope and limits

The dataset selects exact campaign handoff IDs, then requires current source and
Foundation bindings, current auxiliary human evidence, and independent supporting
audit. A method version alone is insufficient to identify this campaign because
other runs used the same version. Effective human cells take precedence over
machine judgments, including human uncertainty. Pending revision, expert issues,
and skipped conflicts are not promoted to supported results. Admission is per
tag judgment; other tags in the section can remain unreviewed.

The 1,000-section count describes completed campaign execution, not 1,000 fully
settled or human-confirmed sections. New machine tables contain this campaign's
eligible records only; earlier machine methods remain available in previous
immutable dataset versions. Luna shadow results are not included.

The [method development report](../../../docs/research/thin-annotation-method-20260911.md)
records the adopted candidate's 21/24 score over eight human cells and three fresh
labeler repeats, under an explicit task-specific acceptance criterion. Full-suite
and auditor semantic accuracy were not established. Repeated development on those
same cells is not held-out evaluation. No annotation accuracy percentage is claimed
for this campaign or for the published machine layer.

This archive distributes instructions and source identities, not chart bytes,
normalized notes, audio, exemplar banks, raw responses, or traces. Public dataset
rows preserve their source, section, method, handoff, audit, and human dependency
identities for inspection and downstream split controls.

## Acknowledgments

Thanks to LuckyCosine7042 for moral support.
