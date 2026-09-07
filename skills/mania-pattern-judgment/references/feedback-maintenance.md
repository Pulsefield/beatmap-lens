# Maintain the skill from human feedback

Update tracked guidance from human feedback; preserve canonical records and
frozen packets. Agent experiences remain hypotheses regardless of repetition.

## Update cycle

1. Read canonical source, scope/context, assessment, IDs, Foundation pins, rationale
   provenance, and snapshot hash. Resolve replacement chains; preserve migrated pins
   separately.
2. Identify the mistaken inference and whether human feedback is general or scoped.
   Confirmation without reasoning approves the case, not the old agent explanation.
   Mentioning another style supplies no salience for it.
3. Reinspect human positives and counterexamples; explain evidence and conflicts.
   Avoid universal thresholds from one crop.
4. Replace superseded guidance. Keep selected human records in the ledger and full
   histories outside prescriptive prose.
5. Replay affected positive, negative, mixed/boundary, and strength cases against
   source, with an independent agent when interpretation changes. Record evidence
   IDs, outcomes, and unresolved choices. Exposed replay is regression checking,
   not held-out accuracy.
6. Run budget/skill validation; report changes and before/after lengths. Freeze new
   bundles for new work. Skill/experience edits cannot approve Foundation semantics.

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

These are ceilings. Retrieve relevant structured records; do not hide instructions
in JSON or load whole ledgers. Consolidate before proposing a budget change.
