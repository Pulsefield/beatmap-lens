# Beatmap Lens

Beatmap Lens develops an independent npm toolkit and an Inspector for understanding
`osu!mania` beatmaps. The longer-term direction is intelligent assistance for
mappers: inspect an arrangement, explain what it does, and help improve it.

- **[beatmap-lens](packages/beatmap-lens/README.md)** is the DOM-free TypeScript
  package. It parses `.osu` and `.osz` input, models 4K–10K charts and shared audio,
  and produces bounded render scenes and SVG review documents. The package README
  owns its API, examples, and defaults.
- **[Inspector](apps/inspector/)** is the first-party browser application. It combines
  chart inspection, audio playback, and section review with source-linked evidence
  and saved human judgments. Its current product priority is 4K–7K; the package
  retains its full 4K–10K boundary. See the [design guide](apps/inspector/DESIGN.md).

This repository also develops agent annotation and dataset production with
Pulsefield. The main workflow joins **whole-chart discovery
and selected-section annotation**, followed by independent agent review and human
corrections. The harness provides inspection tools; the judgment skill owns the
reading guidance. Neither numerical features nor agent agreement create human
judgments.

The annotation code and [research conclusions](docs/README.md#research) are public
so others can reuse the work and understand why the skill changes. Historical
campaigns, raw datasets, runs, and working notes can remain local. Running every
past experiment is not a public maintenance commitment.

Human annotations are published on Hugging Face as
[sed-i/mania-pattern-annotations](https://huggingface.co/datasets/sed-i/mania-pattern-annotations).
The first MIT snapshot, `v0.1.0`, contains 156 human judgments across 117 charts.
Optional agent-reviewed annotations can be selected separately in later versions.
Dataset releases are independent of the npm package.
The [publication pipeline](docs/annotation/dataset-publication.md) builds compact
Parquet snapshots with pinned GitHub artifacts and hash-verified external chart references.

## Repository map

| Location | Responsibility |
| --- | --- |
| `packages/beatmap-lens/` | Independent npm package |
| `apps/inspector/` | Browser UI and its local Review service in `server/` |
| `harness/` | Read-only inspection, queries, rendering, and example retrieval |
| `annotation/pipeline/` | Corpus preparation, discovery, selection, annotation, delivery, and revision |
| `annotation/evaluation/` | Benchmarks and skill/workflow regression gate |
| `annotation/learning/` | Natural-chart exploration and revisable reading experience |
| `annotation/roles/` | Worker role instructions |
| `.agents/skills/` | Judgment and repository-maintenance skills |
| `docs/` | Reusable workflow guides, research conclusions, and design decisions |
| `scripts/` | Repository maintenance and package validation |
| `.local/` | Local datasets, workspaces, generated artifacts, and working notes |

## Development

Use Node.js 22.18+ on the 22.x line or Node.js 24.11+, pnpm 11+, and uv.
Python 3.10 and its project dependencies are managed in the root `.venv`.

```sh
pnpm install
uv sync --locked
pnpm check
pnpm dev
```

`pnpm check` runs engineering checks. `pnpm check:regression` separately evaluates
method changes; missing semantic replay remains missing evidence, not a quality
pass. Dataset publication checks its own frozen snapshot and declared policy.

Paired development with the neighboring Pulsefield checkout is the default for
annotation work. Paths and Python environments are configurable; see the
[annotation workflow](docs/annotation/corpus-annotation.md) and
[contribution guide](CONTRIBUTING.md). The npm package does not depend on Pulsefield.

## License

MIT
