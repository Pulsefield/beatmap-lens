# Harness section labeler

Judge only the supplied sections under this job's frozen Foundation and skill.
Read the section brief, output contract, `skill/SKILL.md`, and judgment guide.
Use the job's versions and calibration boundary. Write only job outputs; the
controller handles sealing and submission. Do not restart a campaign or create
human decisions.

## Inspect to answer a question

Start with the metadata and compact rows already supplied. Recognize what a player
follows, then consider every active Foundation dimension over that episode.
Tools are optional: invoke one when missing evidence, unclear organization, or a
strength comparison could change the judgment. There is no per-section tool
checklist, minimum call count, or requirement to retrieve examples.

- Use `inspect_section` for missing rows or entry/exit context. Its `actions` view
  distinguishes presses, releases, and holds continuing across each timestamp.
  Its `articulation` view relates full LN durations to beats and neighboring
  attacks. Use it when tap-like reading versus independent release control is
  unclear; duration and overlap facts alone do not decide that distinction.
  Pagination and coverage describe what was actually returned; a preview cannot
  support a claim about unseen rows. Preserve full entering holds and short LNs.
- Use `chart_context` when tempo, neighboring arrangement, or chart identity needs
  clarification. Metadata describes the chart; a title or mapper is not local
  style evidence.
- Use `section_perspective` when the familiar organization or Tech expression is
  unclear. Its defined player-action view separates recurring press groups, pulse
  changes, and simultaneous duties. Inspect a cited event if it matters. Counts,
  highlighted events, and comparison questions do not provide a verdict.
- Use `query_structure` for a concrete repetition, alternation, roll, or LN-event
  hypothesis. Candidate previews and query misses do not establish style absence.
- Use `render_section` when seeing spatial arrangement would help. `time` preserves
  spacing in source time; `rows` compresses attack/release events and distorts
  rhythm. Inspect another page only if its contents matter.
- Use `find_human_examples` for a needed distinction, such as supporting versus
  prominent Tech. Begin with the small default page or a specific strength/keyword.
  Open a useful card through `get_human_example`; its `sectionId` works with the
  inspection tools. Compare the actual relationships and relevant counterexample.
  Search interleaves labels after filtering, not by relevance. Missing contrast
  labels mean this search did not supply a balanced comparison. For a difficult
  Tech boundary, the small `tech-articulation` and `tech-tapping` contrast sets
  supply curated examples; `ln-held-control` and `ln-articulation` contrast
  tap-like LNs with coordinated control. Inspect only useful records. Do not enumerate the
  library or load calibration ledgers directly.

Reuse evidence already visible. Stop investigating when the section and remaining
distinctions are sufficiently supported. If a semantic boundary remains after
adequate inspection, state that specific uncertainty instead of forcing a label.

## Record the judgment

Assess presence and expression strength independently for all active dimensions.
Supporting does not mean uncertain; prominent does not mean difficult. Explain the ordered rhythm and articulation within cells and across their joins
before judging Tech. A repeated cell may itself carry the expression; do not
require an additional disruption. Follow the frozen guide and exact human examples; raw interval variety,
changing chords, or LN occupancy alone cannot decide the style.

In annotation mode, reuse compatible current human decisions at their actual scope
and record their IDs. Use only the optional `humanComment` for human reasoning. A missing comment
does not authorize borrowing an agent explanation or selected evidence. Rejection is not absence; descriptive mention of another
style does not label another dimension. Evaluation mode exposes only its allowed
calibration pool. Do not seek target answers, other jobs, or outside feedback.

Use the job's output schema. Keep shared episodes under one `sectionId`, include
exact inspected ranges and source references, and justify any separate cuts.
Write each rationale as 2–4 brief bullets, normally at most 80 words. Explain the
organization, decisive relation, and strength; retain calculations and line arrays
in structured evidence. Record a useful comparison's example ID when it influenced
the result. Validate using the job's supplied checker and finish with the output
path and unresolved issues. Self-checking is not independent audit.
