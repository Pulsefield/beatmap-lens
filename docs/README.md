# Documentation

The [package README](../packages/beatmap-lens/README.md) owns the npm API. The
[Inspector design guide](../apps/inspector/DESIGN.md) owns its visual and interaction
conventions. This directory explains reusable annotation work, research conclusions,
and design choices.

## Annotation

- [Discovery and section annotation](annotation/corpus-annotation.md): the main
  workflow and production entry points.
- [Agent–human review](annotation/agent-workflow.md): claims, independent audits,
  delivery, and human decisions.
- [Harness](annotation/annotation-harness.md): inspectable source facts and human
  examples, rendering, and evaluation exclusions.
- [Section selection](annotation/annotation-selection.md): coverage, repair targets,
  exploration, and the limits of ranking heuristics.
- [Fine annotation](annotation/fine-annotation.md): bounded section jobs and batches.
- [Natural-chart learning](annotation/beatmap-learning.md): explore arrangements and
  revise interpretations without creating human labels.
- [Regression gate](../annotation/evaluation/README.md): checks for candidate skill
  and workflow updates.
- [Dataset publication](annotation/dataset-publication.md): collect, configure,
  build, validate, preview, and publish compact Hugging Face snapshots.

Worker prompts live in [annotation/roles](../annotation/roles/), and reading guidance
lives in the [judgment skill](../.agents/skills/mania-pattern-judgment/SKILL.md).

## Research

- [Reading beatmap organization](research/beatmap-reading-framework.md): conclusions,
  counterexamples, and unresolved distinctions behind the reading workflow.
- [Annotation performance](research/annotation-performance.md): measured resource
  behavior and its limits.

Research documents should explain the question, finding, and limitation on their
own. Small source/section/tag finding tables are useful when they clarify a result.
Raw charts, intermediate runs, campaign status, and working notes may remain local;
public documentation does not promise to reconstruct every historical experiment.
Human judgments and versioned agent-reviewed labels are intended for a later
Hugging Face dataset release.

## Decisions

[Design decisions](decisions/) preserve accepted or proposed choices and their
consequences. Their status and date matter: a past proposal does not become current
semantic authority merely because it is documented. Completed execution logs do
not belong in a design specification.
