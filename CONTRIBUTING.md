# Contributing

Beatmap Lens is in early development. Design choices are still being made, so issues and pull requests should explain the workflow they support before jumping to an implementation.

## Project Direction

The first stable path should be:

```text
.osu source -> source document -> normalized mania chart -> render scene -> SVG
```

Keep that path small and testable. CLI commands, Canvas rendering, watch mode, textual query syntax, Python bindings, and native acceleration belong on the roadmap until the core library has stable behavior.

## Expected Stack

The stack is TypeScript, ESM, pnpm workspaces, tsdown, Vitest, Biome, Changesets, Vue 3, and Vite for the playground. Commands are defined in the root `package.json`.

## Contribution Guidelines

- Keep parser, model, analysis, and rendering changes separate when possible.
- Add or update tests near the behavior being changed.
- Prefer typed APIs and structured results over stringly-typed protocols.
- Keep the public API usable without a UI framework or browser DOM.
- Do not document CLI, Canvas, watch mode, textual query syntax, Python bindings, or native acceleration as implemented before they exist.
- Include benchmark evidence for performance-driven complexity.
- Keep corpus validation opt-in and pass local dataset paths at runtime. Do not commit corpus
  files, filenames, or generated indexes.

## Documentation Changes

Documentation should be explicit about status. Use "planned", "intended", or "roadmap" for behavior that is not implemented. Project documentation should stay in English.

## Pull Requests

For a significant change, include:

- the user workflow or development workflow being improved;
- the public behavior that should change;
- tests or fixtures that prove the behavior;
- compatibility notes if an API shape changes;
- benchmark results when performance is the reason for the change.

Small documentation fixes do not need a long proposal. Keep them focused and avoid changing unrelated files.

## License

Contributions are expected to be compatible with the MIT License.
