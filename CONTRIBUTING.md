# Contributing

Beatmap Lens is pre-release software. Describe the beatmap or development workflow a change serves
before adding a new abstraction.

## Product boundary

Two workflows guide the project:

1. A program consumes `.osu` text and receives deterministic, explainable evidence.
2. A human reviews a target `t ± Xs` window with synchronized audio and a chosen visual speed.

The parse, normalize, in-memory archive/resource model, scene, and SVG foundation exist today.
Playback and the interactive review loop remain planned and must stay labeled as planned.

## Key-count boundary

- The publishable package supports every integer key count from 4K through 10K.
- The Inspector's first-priority product and acceptance range is 4K-7K.
- App priorities must not narrow package models, geometry, diagnostics, or tests to 4K-7K.
- All package stages and tests must preserve the full 4K-10K range.

## Architecture rules

- `packages/beatmap-lens` is the only publishable package.
- The public root export is curated. Internal convenience helpers are not public by default.
- Core APIs accept strings and objects. Filesystem, upload, Blob URL, and media-element behavior
  belong at an application boundary.
- Parser, normalized chart, findings, render scene, and serializer are separate data boundaries.
- Key count is chart data. Do not create separate public pipelines or model variants for individual
  supported key counts.
- One scene projection should feed browser rendering and SVG serialization. Do not create a second
  note-geometry implementation in an app.
- Keep archive resource policy explicit on each load operation. Add a longer-lived coordinator only
  when a real consumer needs shared state or lifecycle management. Any future cache must be
  measured, bounded, and explicitly releasable.
- Visual falling speed and audio playback rate are independent. The browser media clock owns
  playback time.
- Findings must remain explainable through rule, severity, note, time, and source locations. Do not
  replace them with an unexplained total score.
- Do not add a package, adapter, plugin system, or rendering backend for a hypothetical consumer.

A new published package needs a second real consumer, its own runtime or dependency boundary, and an
independent release lifecycle. A folder name is not a package boundary.

## Changes

- Add or update tests at the boundary being changed.
- Keep public options honest. Do not expose a setting that the implementation ignores.
- Prefer structured results and discriminated types over string protocols.
- Include benchmark evidence when performance is the reason for added complexity.
- Keep local corpus data private. Pass paths at runtime and do not commit filenames or reports.
- Keep project documentation in English and separate current behavior from direction.

For a public behavior change, include compatibility notes and a Changeset. Documentation-only and
repository-maintenance changes do not need one unless they alter the published package.

## Verification

```bash
pnpm check
```

The root check covers source formatting, types, tests, builds, package contents, and the corpus
validator privacy smoke test.

## License

Contributions must be compatible with the MIT License.
