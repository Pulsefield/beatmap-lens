# Selection run diagnosis and human revision, 2026-09-10

The 39-case selection supplement used a different execution prompt from the
production annotation workflow. It must not be treated as a replay of the
published method or as evidence that every disagreement was a recent skill
regression. Historical machine labels, final human labels and inherited note
selections are distinct facts.

## Human decisions

The user reviewed all 21 displayed disagreements. Items 14, 15, 16, 17, 19 and 21
adopt the new judgment; the other 15 retain the old human assessment.

| Item | Chart | Tag | Latest human assessment |
| --- | --- | --- | --- |
| 14 | PURE FURY | Stream | Absent |
| 15 | Autonomous | LN coordination | Absent |
| 16 | IRIS OUT | LN coordination | Absent |
| 17 | Akari ga Yattekita zo (android52 Edit) | Trill | Prominent |
| 19 | Miku (Cut Ver.) | Trill | Prominent |
| 21 | REGGAETON BUT IT HAS AMEN BREAKS | Trill | Prominent |

Six new human observations were appended through the canonical Review service.
They retain exact scope/rate, carry the selected agent result's notes, and clear
inherited evidence prose. The decision record identifies the user's choice and
agent selection identity; it does not assert an independent human note-selection
review. The 15 unchanged observations remain current. Every earlier observation,
handoff and audit is retained; the published v0.2.0 snapshot is unchanged.

The exact old/new observation IDs and canonical hashes are recorded locally in
`.local/selection-supplement-20260910/human-review/receipts.json`. That file also
records all 21 explicit user choices against stable case identities; display
indices alone are not dataset keys.

## What changed

The original production skill manifest is `73e8007c…` for the four disputed Tech
cases. `SKILL.md` is identical to the supplement's copy (`cef9d727…`). The old guide
`f3e0a214…` became `c45a8b906…` in commit `80ebb0c`. Stream, Trill, LN and surrounding
reading guidance changed. The complete Tech block is byte-for-byte identical,
and Foundation definitions are identical. Unchanged Tech text does not imply
that surrounding prompt changes have no behavioral effect.

The supplement changed more than guide text:

- The production labeler role was omitted, including its explicit reading of
  relationships within repeated cells and across their joins.
- Structured attack-row briefs with chart metadata and timing points were
  replaced with anonymous flat note tuples. All supplied review-context notes
  remained complete; this was a presentation/context change, not truncation.
- Lens example retrieval, wider context, action/articulation inspection and
  rendering were unavailable. Historical logs show example retrieval in one
  relevant production job, although tool availability alone never guarantees a
  correct judgment.
- One assigned tag replaced joint consideration of the five active dimensions.
- Output was restricted to judgment and notes, with no rationale. That restriction
  followed the user's instruction; its isolated effect has not been established.

Treating this as only an output-format change was a workflow mistake. The existing
regression gate explicitly covers judgment-affecting execution inputs, whereas
`pnpm check` verifies engineering behavior. Passing those engineering checks did
not validate this new annotation method. Removing post-hoc explanation obligations
was appropriate; removing the established inspection facilities was an additional,
unvalidated change. This diagnosis does not restore a requirement for generated
explanations or omitted-note reasons.

## Tech errors existed before the latest revision

All four Tech disagreements that the user retained as supporting were already
absent in their historical ancestor machine proposals:

| Chart | Exact source scope, ms | Old agent | Human | Supplement agent |
| --- | --- | --- | --- | --- |
| Split EX | [100244, 105891) | Absent | Supporting | Absent |
| cyanine | [151337, 156612) | Absent | Supporting | Absent |
| Quite Contrary | [308280, 311280) | Absent | Supporting | Absent |
| MEGALOVANIA | [145819, 149786) | Absent | Supporting | Absent |

Thus the current errors do not show that these cells were once recognized and
then forgotten. Human corrections produced the positive labels; the attached
notes still came from the nonpositive machine judgments. Quite Contrary has a
historical handoff but no located original run receipt. The entire 39-case pool
also spans four old skill manifests, so it is not one uniform historical baseline.

The earlier [skill comparison](human-feedback-skill-tuning.md) nevertheless did
record specific Tech regressions. Original-suite Tech presence agreement changed
from 42/48 to 43/48, while feedback-suite Tech presence agreement fell from 20/21
to 18/21: one additional absence each on Yolomania and Destiny. These were accepted
as explicit noncritical failures, not proven noise. Aggregate gains and protected
case passes therefore did not establish reliable recognition of supporting Tech.

## Guide-only diagnostic

All six Tech cases in the supplement were rerun under the simplified execution,
with only the embedded guide text changed. Each condition had three independent
repeats, configured `gpt-6-astra` / medium, at most four cases per context and
three concurrent jobs: 36 judgments from 12 fresh processes. Case data, Foundation,
output contract and other instructions were identical between paired conditions.

| Chart | Old guide, three repeats | New guide, three repeats |
| --- | --- | --- |
| Split EX | Absent / absent / absent | Absent / absent / absent |
| cyanine | Absent / absent / absent | Absent / absent / absent |
| d e a t h p i a n o | Supporting / supporting / supporting | Supporting / supporting / supporting |
| davay rasskazhem | Prominent / prominent / prominent | Prominent / prominent / prominent |
| Quite Contrary | Absent / supporting / absent | Absent / absent / absent |
| MEGALOVANIA | Absent / absent / absent | Absent / absent / absent |

Present counts were 7/18 with the old guide and 6/18 with the new guide. There was
one paired assessment difference. Switching back did not restore the four weak
positive boundaries: three remained absent in every run, and Quite Contrary was
recognized once under the old guide. This does not establish zero version effect,
statistical noise, or a population-level error rate. All six targets are human
positives, so the experiment cannot measure false positives. Two are named
calibration judgments in both guides; labels were withheld from case files,
not removed from the normal guide. This is exposed diagnosis, not held-out testing.

Root readback confirmed 36 valid responses, 12 unique threads, unchanged frozen
inputs and identical paired case/skill/Foundation/schema files. Output references
remain source-backed and each trace reads only its complete case file. Artifacts
are under `.local/selection-supplement-20260910/skill-ab/`.

## Earlier revisions and conclusion

The history is not a single monotonic tightening. `f8d82bf` and `cbf2269` introduced
human counterexamples to permissive positive inferences. The latter also retained
pure-tap positives. `24bd870` compressed the guide from 4,769 to 1,203 words and the
Tech section from 791 to 210 words; inline pure-tap positive contrasts disappeared
while conservative cues and two strong LN examples remained. That contrast
imbalance is a plausible investigation target, not an established cause.
`27979a0` subsequently restored pure-tap positive/negative contrasts and the
supporting SYSTEM ERROR example, while explicitly rejecting readability or
regularity alone as grounds for absence. The current Tech block descends unchanged
from that restored text. No controlled replay or earlier correct machine receipts
for these four exact cells establish which earlier revision caused a loss.

The supported conclusion is persistent weakness around some supporting Tech,
specific already-recorded regressions, and an unvalidated change to execution.
Do not claim a newly introduced Tech definition, general loss of style detection,
or causal proof from the aggregate gate. Preserve the latest human judgments and
leave skill text unchanged during diagnosis. Future production annotation should
use the existing inspection harness and its calibration access; reducing output
to concurrent judgment and selection should not remove those facilities. Any
judgment-affecting replacement still needs the existing regression comparison,
including weak positives and negatives, before adoption. No new retrospective
explanation or omitted-note review stage is introduced.
