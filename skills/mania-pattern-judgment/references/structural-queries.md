# Structural queries

Read this when constructing factual queries or routing weak annotation. The local
helper is `scripts/annotation-queries.py`; use its `--help` for arguments. It reads
one chart's Parquet at a time and emits NDJSON provenance, records, and counts.
It does not submit judgments or perform independent semantic audit.
Current outputs supply facts and approved necessary-condition negatives, never
positive salience.

```sh
python scripts/annotation-queries.py alternation CHART.parquet \
  --start-ms 259802 --end-ms 260766 \
  --skill-file skills/mania-pattern-judgment/SKILL.md \
  --skill-file skills/mania-pattern-judgment/references/judgment-guide.md \
  --skill-file skills/mania-pattern-judgment/references/structural-queries.md
```

| Query | Fact established | Boundary of inference |
| --- | --- | --- |
| `fixed-group` | Complete consecutive rows repeat one column set; counts and gaps. | Extra simultaneous keys break this narrow match; slow broad Jack can still qualify. |
| `repeated-subset --columns 0,1` | A core recurs on every consecutive row; extras retained. | Never skip alternating B rows to manufacture Jack from A↔B. |
| `alternation` | Fixed disjoint A/B groups alternate; all gaps retained. | Four rows are a search minimum, not presence or salience. |
| `roll` | Four singleton rows traverse all four columns; gaps and literal equality. | Rounded unequal gaps can still express a roll; roll strength does not set Stream strength. |
| `ln-events` | Press/release order and complete occupancy, including entering holds. | Two occupied columns are necessary, not sufficient, for LN coordination. |

Group only exact same-ms attacks. Preserve original note kind, start/end, column,
source line, source identity, and half-open ranges. A derived timing grid must
name its anchor, subdivision, rounding, and residuals separately. Harmless 1 ms
quantization is not a semantic veto; merging nearby attacks is not authorized.

Inspect all unused notes, interruptions, and neighboring rows before treating a
query range as an episode. A match ending at the query window may continue beyond
it. Positive witness searches need counterevidence checks; non-matches leave
uncovered structure unreviewed. Review every active dimension when inspecting a
selected section, not just the query that found it.

Use deterministic computation for facts. Emit weak labels only where the current
Foundation and calibrated sufficient conditions support them; retain any emitted
necessary-condition negatives as deterministic-query provenance. Otherwise abstain
and use an agent. Model choice and campaign execution belong to the task, not this
reference. Query agreement never creates human confirmation or independent audit.

Before batch semantic use, replay reviewed counterexamples, then evaluate separate
beatmapsets. Report per-target emitted-label precision, coverage/abstention, scope
errors, and strength errors. Zero false positives is the desired acceptance
criterion, not an achieved accuracy claim. Keep unscreened windows and related
crops in evaluation; do not report calibration replay as held-out precision.

Retain source/Parquet identity, query version/code hash/parameters, exact skill
hashes, actual interpreter/producer, and human decision provenance. New query or
skill versions do not alter old weak-label records.
