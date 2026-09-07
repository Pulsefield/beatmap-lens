# Query-first corpus labeler

Work under the supplied five-target Foundation. Finish only the assigned charts
or explicitly assigned section ranges. Whole-chart assignments retain their
2,400,000 ms total source-duration limit. Do not take other assignments, spawn agents, or restart an older campaign.

Read the frozen `skill/SKILL.md`, its judgment guide and structural-query reference,
`foundation.json`, `skill-provenance.json`, `assignment.json`, `bindings.json`, and
`query-index.json`. Use the supplied versions. Work only with this job's Parquets,
queries, and references; do not seek ranking, votes, filenames, community tags, or
the parent conversation. Write only in this job. The controller submits results.

## Start with the inexpensive evidence

The controller has scanned every assigned Parquet with frozen deterministic tools.
Use `query-index.json` to find each source's compressed NDJSON evidence. Inspect
the compact index first; read only the relevant records from the gzip files instead
of dumping whole charts into model context. `annotation-facts.py overview` covers
the whole arrangement, and `rows --start MS --end MS` supplies local attack rows and
entering holds. Use `annotation-queries.py repeated-subset --columns 0,1` when
extra simultaneous keys decorate a repeated core. The prompt supplies Python.

Query matches are source facts. A missing match is not an absent style. Most
presence and strength judgments still need your contextual interpretation.
The explicitly enabled full-chart LN rule is an exception: if the complete source
never has two columns occupied by LNs simultaneously, the supplied Foundation's
necessary condition proves LN coordination absent. Reuse that query-origin result;
cite its rule ID, source-wide coverage, and hash provenance in the rationale.
Do not manufacture an agent or human judgment in its place. If the rule abstains,
inspect the actual LN organization. Two occupied columns alone do not prove a positive.

Inspect query-uncovered portions and changes of organization. Discover useful
representative sections for **Jack, Stream, Trill, Tech, and LN coordination**.
For a whole-chart assignment, continuous structural discovery remains required.
For an assignment with `coverageMode: "selected-sections"`, inspect each chart's
`targetRanges` and the surrounding context; report only the ranges actually read.
Completing these sections does not complete the chart.

Treat the selected episode as the unit of work. Inspect its complete arrangement
once, then assess **all five dimensions independently** in that same pass. Emit
present/supporting, present/prominent, absent, or unresolved with a concrete question.
Use unreviewed only with a brief reason that inspection was insufficient. Do not
turn missing labels into negatives. Keep related claims under one `sectionId`,
with narrower scopes only where organization genuinely changes. Reuse exact current
human judgments from bindings and record their identities in `discoverySummary`;
do not resubmit them merely to fill five slots. Successive episodes do not establish
co-occurrence, and five considered dimensions do not require five positives.

Select the notes that actually witness a pattern and preserve the remaining notes
as context/counterevidence. A repeated core can survive extra chord keys, but
selecting A out of pure disjoint A/B Trill cannot turn it into Jack. Intervening
rows can continue the main pattern or mark a reset; there is no universal skip rule.
Trill presence depends on speed and extent, not four rows alone. Three complete
roll groups establish roll structure, not automatic Stream prominence. Harmless
1 ms quantization does not require an expert question. Tech need not first match
a perfect template, and LN coordination needs independent control beyond overlap.

Work on one chart at a time and save that chart's result before moving on. Read
the index once; it already contains each chart's overview and LN rule result.
Filter compressed records by query and local bounds, printing compact candidate
bounds/groups/gaps first. Expand only the chosen candidate and its neighborhood.
Do not print every full query record or recompute an existing overview merely to
copy it. For uncovered regions, inspect compact attack rows and retain a brief
region-by-region account in `discoverySummary`; include actual ranges and
organization changes so the independent auditor can check coverage.

Build witness/context line lists from the current chart's Parquet or exact query
record in code. Never carry line numbers or timings over from another candidate
or chart. Re-read each final scope and context together before describing it:
changed chord groups alone are not Stream, and a roll elsewhere cannot supply the
facts for a mixed-chord crop. Check all claims against the actual notes, including
old claims retained in a repair attempt; correcting line lists alone cannot repair
an unsupported interpretation.

The next reviewer receives your selected exact evidence and reasoning, but not the
whole chart. Keep complete relevant `noteLines`/`contextLines` and entering holds.
Write `rationale` as **2–4 short Markdown bullets, normally at most 80 words**:

- Name the organizing pattern in ordinary language: what repeats, flows, or changes.
- Explain the decisive relation to this dimension and why its strength fits.
- Add a useful contrast with an exact human example, or the remaining boundary.

Start from the human's reading of the passage: recognizable flow, interruptions,
and independent hold/release control. Raw complexity is not a substitute. Put exact
line arrays, calculations, and provenance in structured evidence or `analysis.json`;
keep only numbers needed for the judgment in the bullets. The submitted references
and bullets together must suffice for an audit; an unavailable sidecar cannot carry
a decisive premise. `discoverySummary` is a brief bullet list of inspected ranges,
organization changes, reused human judgments, and remaining gaps. Do not narrate
command history. Insufficient source evidence goes back for revision.

## Use old work with its original provenance

`prior-machine-candidates.json` contains old location hints, not accepted new labels.
Check those scopes under the new definition; also discover missing/new Trill cases.
No old completion count transfers into this campaign.

`prior-human-feedback.json` exposes final `humanJudgments` with source/scope
identity and optional exact `humanComment`. Apply a compatible human assessment
at its original scope without asking again; explain its reuse and consistency with
the current target. A changed meaning or crop needs a new machine interpretation.
Do not copy an old observation into a new human-confirmed record. Use the human's
optional comment or later direct clarification; missing comments do not authorize
substituting machine reasoning. Separate `humanDecisions` preserve human
rejection/deferral without an inherited assessment. Rejection alone is not an
absent observation; its concrete human comment
can support your newly sourced proposal. Old Stream absence does not assign Trill
strength. Preserve current `humanJudgments` in `bindings.json` without resubmission.
Worker Foundation views omit calibration claim bodies; canonical definitions and
their original pin remain unchanged.

## Output

Write `result.json` with one entry per assigned chart. This abbreviated example
shows one claim; include the remaining considered dimensions or explain their
exact human reuse/omission in the complete result:

```json
{
  "skill": { "name": "COPY", "version": "COPY", "sha256": "COPY" },
  "charts": [{
    "sourceSha256": "ASSIGNED_SHA",
    "inspectedRanges": [{ "startMs": 0, "endMs": 10000 }],
    "discoverySummary": "- Inspected 0–10 s: alternating groups give way to a moving run.\n- All five dimensions considered; no prior human claims reused.",
    "claims": [{
      "id": "local-claim-id",
      "sectionId": "episode-id",
      "tagId": "trill-organization",
      "scope": { "startMs": 1000, "endMs": 3000 },
      "reviewContext": { "startMs": 500, "endMs": 3500 },
      "assessment": { "presence": "unresolved" },
      "noteLines": [100, 101],
      "contextLines": [99, 102],
      "rationale": "- Two disjoint groups alternate through this episode.\n- The pattern is clear, but the supplied evidence leaves its local strength unresolved."
    }],
    "questions": [{ "id": "local-question", "claimIds": ["local-claim-id"], "text": "The concrete remaining semantic distinction." }]
  }]
}
```

Copy the exact skill descriptor. Tags are `jack-organization`, `stream-organization`,
`trill-organization`, `tech`, and `ln-coordination`. Positive assessments have
`presence: "present"` and `salience: "supporting"` or `"prominent"`; non-positives
have only presence. Strength means expression of the target style, not confidence
or selected-note fraction. Use half-open source-ms scopes and real source lines,
including complete entering holds in context. An omitted dimension stays unreviewed;
explain omissions instead of claiming a complete dimension pass.

Run the supplied Python with `check-annotation-result.py .` after writing the
complete result, and fix every reported error before finishing. This inexpensive
check verifies source identities, coverage intervals, assessments and half-open
evidence references. It does not verify that your semantic interpretation is
correct. Preserve each reused rule label's full rule/Foundation/code provenance
in `analysis.json`, and cite the rule and source coverage in its claim rationale.

Check ordinary factual/scope issues yourself. Ask only a specific semantic question
that remains after inspecting the evidence; the independent auditor is the next
agent stage before an expert handoff. Do not force positives or claim zero false
positives for your own semantic judgments. If no claim is defensible, explain the
problem instead of inventing a label. The final message states `result.json`'s path
and any unresolved issues; self-checking does not establish independent approval.
