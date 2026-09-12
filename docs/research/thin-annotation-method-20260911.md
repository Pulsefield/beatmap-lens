# Thin annotation guidance and human reference retrieval

Status: adopted under the user's explicit 21/24 acceptance criterion for this task.
The final candidate scores 21/24: 7/8 in each of three fresh labeler runs. The active
checkout and global role dispatchers now use this version. Foundation definitions,
canonical human records and historical frozen methods are unchanged. This bounded
development replay does not establish full-suite or auditor accuracy.

## Change and rationale

Section workers receive the role, skill and Foundation once. Named case verdicts
have been removed from mandatory guidance. The skill is 443 words; the former
mandatory 1,499-word judgment guide is an optional 289-word reading aid. The agent
identifies the distinction it needs to resolve, retrieves human comparisons and
inspects their original arrangements. This follows the progressive disclosure
approach in the [official skills documentation](https://learn.chatgpt.com/docs/build-skills).

Reference search uses the existing small pages and literal comment/title/difficulty
search. It adds explicit human confidence, confidence counts, key count and tap-only
or LN-containing scope filters. Source-derived cards expose attack-row, tap,
LN-head, entering-hold and chord-size counts. These facts help agents select sources;
they do not rank semantic similarity or decide labels. Ordering remains explicit
and stable. There is no new retrieval service, embedding index or scoring system.

Prefer explicit High references when available. Low remains uncertain and missing
confidence remains unspecified. Human verdicts and exact human comments are reusable
within their original scope and playback rate; human confirmation does not endorse
an inherited machine explanation or note selection. Inspect decisive similarities
and differences before transferring a label, including an opposite-presence example
when the presence boundary is disputed. No fixed example pack or retrieval quota is
required. Existing source/song exclusions and frozen evidence identities still apply.

All actual workers use the existing annotation runtime, through the batch controller
or a small single-job CLI. Native agents dispatch that command. The runtime supplies
the frozen prompt, lens tools, trace and actual producer receipt. Preparation and
launch enforce one to four assigned sections; a shared job lock covers status reads,
execution and recovery. Labeler and auditor each start fresh ephemeral workers.

Stable role/skill/Foundation prefixes support [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
Prior answers and parent analysis are not carried into later jobs to obtain cache
hits. Four sections is a conservative operating limit, not a measured degradation
threshold. The existing 28,000-character brief target permits an intact dense
singleton; it is not a cap on the complete model context.

## Why the first thin version failed

The initial thin candidate scored 18/24, compared with the previous method's 21/24.
Source parsing and frozen instruction mounting were correct. The failures point
to overly permissive transfer from a structural match to label presence. Retrieval
improvements alone did not correct that judgment boundary.

For Aegleseeker, 66132–66774 ms, every initial thin repeat transferred supporting
Trill from *Six trillion years and overnight story*. Both sections contain six
alternating attack groups. The reference continues a nearly constant 161–162 ms
pulse; the target's core intervals are 171/171/85/86/128 ms inside a changing phrase.
The agent treated those differences only as weaker salience and never established
whether a definite repeated exchange was present. The positive reference itself
has no pause or rhythmic reset at its crop boundary, so an independent pause is
not a valid general requirement either.

The allowed bank already contained 48 Trill-absent and 51 Tech-absent records. Initial
workers used empty text queries and first-page results and never inspected a
Trill-absent source. Useful counterexamples were reachable through existing search.
Later attempts found and inspected them, but still overvalued alternating heads.
This did not require a more elaborate retrieval mechanism or evidence that the
human reference labels were wrong.

The user suggested that the target might be too short, have blurred boundaries and
be relatively inconspicuous, then asked for a human perspective. The adopted skill
asks whether a player can recognize and maintain a repeated rhythmic figure within
the surrounding flow. A crop does not create an episode. Entering and leaving fixed
groups alone does not establish one. A short transition can pass through alternating
shapes without establishing definite exchange; supporting requires weak but definite
expression. Brief clearly articulated exchanges remain eligible. No duration,
row-count, dominance, separate-pause or LN-handoff veto was introduced.

When that distinction remains unclear, the agent inspects a time-proportional image
of the review context using the existing renderer. All three final workers did so,
inspected the positive reference's wider context, and used inspected human negative
comparisons. All three changed Aegleseeker Trill to absent. This is evidence for the
combined judgment-and-inspection change; it does not isolate rendering as the cause
or turn the user's tentative explanation into a confirmed canonical rationale.

## Repeated evaluation

One frozen canonical suite contains 171 High cells on 58 source sections. A verified
service capture and an independent canonical cold reader agree on its cells and
732 document identities. Every attempt uses the same original four scopes/eight
gold cells, the same 343 eligible human examples after all 58 target-source/song
exclusions, the same Foundation, model and reasoning settings, and three fresh runs.
Those exclusions leave no explicit High examples in this evaluation bank. Workers
broadened retrieval after the empty High filter rather than treating it as absence.

| Method | Three repeats | Total |
| --- | --- | ---: |
| Previous method | 7/8, 7/8, 7/8 | 21/24 |
| Initial thin candidate | 6/8, 6/8, 6/8 | 18/24 |
| Attempt 01: discriminate reference transfer | 6/8, 6/8, 6/8 | 18/24 |
| Attempt 02: explicit construction search/comparisons | 6/8, 6/8, 6/8 | 18/24 |
| Attempt 03: Tech and Trill judgment checks | 6/8, 6/8, 6/8 | 18/24 |
| Attempt 04: short/blurred episode interpretation | 6/8, 6/8, 5/8 | 17/24 |
| Attempt 05: boundary/context correction; withdraw Tech patch | 6/8, 6/8, 6/8 | 18/24 |
| **Attempt 06: definite rhythmic figure and context image** | **7/8, 7/8, 7/8** | **21/24** |

All attempts and raw outputs are retained; no favorable-repeat selection or output
repair occurred. The final three producers and threads are distinct. Independent
review reproduced the score from the original outputs and verified input hashes,
output seals, tool traces, reference exclusions and Foundation identity. Relative
to the initial thin candidate, only `SKILL.md` changed during these six attempts.

The remaining error is Kanjou no Matenrou ~ World's End, 389914–392610 ms: all final
runs predict Tech prominent against human absent. The attempted general Tech patch
provided no benefit and also produced one White Ceiling false negative, so it was
withdrawn. The previous method explicitly quoted the exact Kanjou answer from its
mandatory guide. Its 21/24 is therefore not a clean unseen comparison. Repeated
development on these same eight cells also limits generalization claims.

| Observed behavior, totals unless noted | Previous method | Initial thin | Adopted |
| --- | ---: | ---: | ---: |
| Actual labeler prompt characters per job | 31,189 | 15,878 | 16,314 |
| Searches / example opens / source inspections | 4 / 1 / 1 | 16 / 11 / 15 | 18 / 12 / 12 |
| Comparison citations with opened and inspected sources | 1 | 9 | 11 |
| Render calls | 0 | 0 | 4 |
| Tool errors | 2 | 0 | 0 |
| Absent judgments selecting source notes | 42/42 | 41/41 | 44/44 |
| Mean job duration | 128 seconds | 154 seconds | 158 seconds |
| Input tokens, including cached input | 538,181 | 673,462 | 731,079 |
| Cached input / output tokens | 428,288 / 9,806 | 561,792 / 12,450 | 616,704 / 13,543 |

The adopted standing prompt is about 48% shorter, but extra retrieval and rendering
increase total usage. These token counts are not a billing calculation. Selected
notes demonstrate recorded evidence, not access to internal reasoning or proof that
a few witnesses establish whole-scope absence. The final outputs pass all mechanical
checks. This change does not add a machine-confidence schema field or alter how
delivery preserves selected versus supplied context; those remain separate work.

## Engineering verification and acceptance scope

The final repository check passed after adoption with two Vitest workers: 515
TypeScript tests, 340 Python tests, source/skill validation, types, builds, package
and corpus smoke checks. The skill and optional guide also meet their reduced
maintenance budgets. Earlier
default-parallel runs timed out in two existing CLI tests; isolated and
limited-parallel reruns passed without changing assertions or timeouts.

The user explicitly authorized adoption at 21/24 for this task. The repository-wide
semantic gate remains unchanged. Its preflight cannot replay auditor or selected
workflow changes, so a labeler pilot does not establish their semantic accuracy.
The 81 prepared full-suite jobs remain unlaunched. Foundation changes and relabeling
human records were not needed to meet the agreed bounded criterion.

Operating contracts: [human reference tools](../annotation/annotation-harness.md),
[worker mounting](../annotation/fine-annotation.md#worker-mounting-protocol), and
[method regression](../../annotation/evaluation/README.md). Local source snapshots,
all attempts, receipts and adoption records are under `.local/thin-agent-20260911/`.
The user's nine pre-existing changed files were preserved byte-for-byte.
