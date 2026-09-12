# Structural queries

Use `harness/annotation-queries.py --help` for factual queries against one chart's
Parquet. NDJSON outputs contain provenance, records, counts, and approved
necessary-condition negatives; they establish neither positive salience nor
independent semantic audit. During learning, use source facts, not weak labels.

| Query | Fact established | Boundary of inference |
| --- | --- | --- |
| `fixed-group` | Complete consecutive rows repeat one column set; counts and gaps. | Extra simultaneous keys break this narrow match; slow broad Jack can still qualify. |
| `repeated-subset --columns 0,1` | A core recurs on every consecutive row; extras retained. | Never skip alternating B rows to manufacture Jack from A↔B. |
| `alternation` | Fixed disjoint A/B groups alternate; all gaps retained. | Four rows are a search minimum, not presence or salience. |
| `roll` | Four singleton rows traverse all four columns; gaps and literal equality. | Rounded unequal gaps can still express a roll; roll strength does not set Stream strength. |
| `ln-events` | Press/release order and complete occupancy, including entering holds. | Two occupied columns are necessary, not sufficient, for LN coordination. |

Group exact same-ms attacks. Preserve note kind, endpoints, column, source line,
identity, and half-open ranges. Derived timing grids name anchor, subdivision,
rounding, and residuals. Harmless 1 ms quantization is not a semantic veto;
do not merge nearby attacks.

Inspect unused notes, interruptions, entering holds, and neighbors. Query-window
edges need not be episode boundaries. Check counterevidence; non-matches leave
structure unreviewed. Annotation reviews every active dimension; learning has no
mandatory label pass.

For requested weak annotation, emit only Foundation/calibration-supported labels
with deterministic-query provenance; otherwise abstain. Before batch use, replay
human counterexamples and evaluate separate beatmapsets, retaining unscreened
windows and related crops. Report precision, coverage/abstention, scope, and
strength errors; exposed replay is not held-out accuracy. Preserve source/Parquet,
query code/version/parameters, skill hashes, actual producer, and human provenance.
New versions never rewrite old records or confer human authority.
