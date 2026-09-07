# Maintain the skill from human feedback

Use this procedure when feedback changes future annotation guidance. Edit the
tracked skill; leave canonical human records, old packets, and frozen worker
copies intact. A correction's authority comes from the human record, not from
how often machines repeat it.

## Update cycle

1. Read current canonical decisions and their linked observations. Collect exact
   source, scope/context, assessment, decision/observation IDs, Foundation pins,
   rationale provenance, and snapshot hash. Resolve machine replacement chains.
   Preserve original and migrated pins separately if they differ.
2. Group feedback by the mistaken inference: boundary, presence, strength,
   recognizability, or incomplete evidence. Separate explicit general clarification
   from a scoped example. A confirmation without new reasoning validates the case;
   it does not independently approve every sentence of the old machine rationale.
3. Compare the nearest existing positive and counterexample. State one proposed
   discrimination, the records supporting it, and any remaining conflict. Human
   words naming another style do not supply that dimension's salience. Do not turn
   one difficult crop into a new universal threshold or prohibition.
4. **Replace or merge** the relevant paragraph in the guide. Remove superseded
   shortcuts and repetition. Keep one home for each rule. Store selected exact
   records in the calibration ledger; keep full histories in the canonical dataset
   and version history, outside the prescriptive core. Do not append a new prose
   subsection for each feedback batch.
5. Replay affected positive, negative, mixed/boundary, and strength comparisons
   against source evidence, using an independent agent where interpretation changed.
   Check that the new rule explains the correction without breaking its countercase.
   Record IDs, actual outcomes, and unresolved choices in the task's calibration
   report. Exposed replay is a regression check, not held-out accuracy.
6. Run the budget checker and skill validator. Record changed guidance, evidence
   IDs, validation, and before/after lengths in the task result. Freeze a new skill
   bundle only when preparing new work; a semantic Foundation change requires its
   own human workflow and never follows automatically from a skill edit.

## Length budget

Run from the checkout:

```sh
python3 skills/mania-pattern-judgment/scripts/check_budget.py
```

Limits include frontmatter, tables, and examples:

| Text | Maximum whitespace words | Maximum Unicode characters |
| --- | ---: | ---: |
| `SKILL.md` | 650 | 5,200 |
| `references/judgment-guide.md` | 1,500 | 12,000 |
| All Markdown in the skill combined | 3,500 | 28,000 |

These are ceilings, not targets. The combined limit catches moving excess prose
into another reference. Character limits also bound Chinese text. Structured
calibration records are evidence, retrieved by relevant case; do not hide new
instructions in JSON or load the whole ledger by default. If guidance will not
fit, consolidate examples and rules before proposing a deliberate budget change.
