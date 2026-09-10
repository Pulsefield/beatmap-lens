# Evidence provenance and missing selections

Agents select notes while making a style judgment under the existing annotation
skill. They do not perform a separate retrospective explanation review or invent
reasons for every unselected note. A human label remains usable under its existing
authority rules; neither a separate notes review nor a rationale review is an
additional label gate.

The earlier supplemental-review procedure introduced mandatory explanation
checks and omitted-note contrast tasks. The user rejected that extension on
2026-09-10. It is withdrawn. Historical annotations, the frozen release, and old
local plan artifacts are preserved, but that plan is not the current work queue.

## What the existing evidence means

`noteRefs` identifies source-backed witnesses selected for a judgment. It can
contain a whole arrangement, a disconnected set, or selected members of chords.
Those shapes do not establish a defect, minimality, or sufficiency. Do not require
a smaller set or infer salience from a coverage threshold.

`contextNoteRefs` retains context. The section annotation delivery packager fills
it with the supplied review-context notes minus witnesses. That operation does
not select negative examples. The release has no per-note omission judgments;
their absence is not a missing annotation requirement. Preserve the full section
and review context, including intervening rows and the original endpoints of
entering long notes. Source coordinates remain original milliseconds at every
playback rate.

`auxiliary_evidence_status` concerns referenced human examples and their
snapshot-relative compatibility. It does not say whether this claim's rationale
explains its current assessment. A new human observation can change that status
through an exact dependency mismatch even when its label is unchanged. Do not
silently retarget a historical exemplar reference.

Selection origin and a specific review of the selection are different facts.
Human confirmation or revision of a label with inherited agent notes is not
independent human note selection. The automatic empty-witness section fill and
the explicit whole-arrangement operation also have different origins, even when
their resulting sets match. Missing historical metadata remains unknown. An
independent machine audit does not establish human note-level gold.

## Supplement genuinely missing selections

The read-only plan identifies two human-label candidate types:

1. A literal empty witness selection.
2. A present human label whose unchanged witnesses came from an ancestor judgment
   that was absent or unresolved. Those notes were not selected as part of a
   positive judgment for this target; they may nevertheless be suitable.

A changed label or scope alone, inherited prose, an empty rationale, whole-scope
selection, or omission of entering holds does not create a task. The second
candidate type calls for another judgment with simultaneous note selection; it
does not prove the old set is wrong.

Give each agent a short, standalone job with the exact source, interval, tag,
playback rate, and complete section/context notes. Keep the previous human and
agent assessments, rationales, and selected sets out of the case input. The
unchanged skill can contain relevant human calibration examples; disclose that
exposure and do not describe this repair as a held-out evaluation.
Use at most four fixed sections per job. The agent makes its judgment and chooses
notes together. Existing notes may turn out to be the same appropriate selection.
No extra rationale or omitted-note output is required by this repair procedure.

After the agent finishes, compare its assessment with the human target. Preserve
the human label. An agreeing judgment can supply an additive agent selection
proposal; a disagreement remains separate and unresolved, without forcing the
agent to justify the label. Record the agent method, source, scope, rate, judgment
and selection together, referencing the exact human observation and release
records. A proposal does not silently replace a human observation or become human
note-level gold.

## Keep release and research claims precise

Export the label and its attached notes from the same effective observation,
including revision identity and provenance. Preserve historical record identities
and supersession links. Deduplicate agreeing exact source/scope/tag/rate cells
under the chosen authority policy so one cell is not counted twice. Missing tag
assessments remain missing, never absent.

For salience prediction, keep the full section context and exclude answer-bearing
rationale from model inputs. Account for song/audio identity and consulted human
exemplars when splitting data. These controls describe research consumption;
they do not add explanation or omission annotation tasks to the workflow.

See the [v0.2.0 findings and selection candidates](../research/evidence-quality-v020.md)
and [publication contract](dataset-publication.md).
