# Query-first corpus labeler

This is a newly authorized annotation campaign under the supplied five-target
Foundation. Finish only the assigned charts (at most 2,400,000 ms of total source
duration). Do not take other assignments, spawn agents, or restart an older campaign.

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
representative sections for **Jack, Stream, Drill, Tech, and LN coordination**.
Continuous structural discovery is required; dense semantic annotation of every
note is not. A source is not complete after looking at only its first crop.

Select the notes that actually witness a pattern and preserve the remaining notes
as context/counterevidence. A repeated core can survive extra chord keys, but
selecting A out of pure disjoint A/B Drill cannot turn it into Jack. Intervening
rows can continue the main pattern or mark a reset; there is no universal skip rule.
Drill presence depends on speed and extent, not four rows alone. Three complete
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

The next reviewer receives your submitted judgments, note evidence, reasoning,
expert feedback and the frozen skill. They do not receive the whole chart or query
corpus. Make each `rationale` self-contained: state the decisive attack groups,
timing and extent, relevant counterevidence and entering holds, and why they support
the chosen salience. Retain enough `contextLines` to assess those facts, and use
`discoverySummary` to explain the regions inspected and the collection's coverage.
Missing evidence goes back to you for revision; it is not an expert semantic question.

## Use old work with its original provenance

`prior-machine-candidates.json` contains old location hints, not accepted new labels.
Check those scopes under the new definition; also discover missing/new Drill cases.
No old completion count transfers into this campaign.

`prior-human-feedback.json` retains exact earlier human decisions and their old
Foundation/observation identities. Apply an explicit compatible human assessment
at its original scope without asking again; explain its reuse and consistency with
the current target. A changed meaning or crop needs a new machine interpretation.
Do not copy an old observation into a new human-confirmed record. Use the human's
decision rationale or later direct clarification, not a retained unresolved machine
explanation. Rejection alone is not an absent observation; its concrete explanation
can support your newly sourced proposal. Old Stream absence does not assign Drill
strength. Preserve current reviewed claims in `bindings.json` without resubmission.

## Output

Write `result.json` with one entry per assigned chart:

```json
{
  "skill": { "name": "COPY", "version": "COPY", "sha256": "COPY" },
  "charts": [{
    "sourceSha256": "ASSIGNED_SHA",
    "inspectedRanges": [{ "startMs": 0, "endMs": 10000 }],
    "discoverySummary": "Complete structural coverage, query results, old-evidence reuse and the local changes found.",
    "claims": [{
      "id": "local-claim-id",
      "sectionId": "episode-id",
      "tagId": "drill-organization",
      "scope": { "startMs": 1000, "endMs": 3000 },
      "reviewContext": { "startMs": 500, "endMs": 3500 },
      "assessment": { "presence": "unresolved" },
      "noteLines": [100, 101],
      "contextLines": [99, 102],
      "rationale": "Source facts, selected structure, counterevidence and what settles or limits the target judgment."
    }],
    "questions": [{ "id": "local-question", "claimIds": ["local-claim-id"], "text": "The concrete remaining semantic distinction." }]
  }]
}
```

Copy the exact skill descriptor. Tags are `jack-organization`, `stream-organization`,
`drill-organization`, `tech`, and `ln-coordination`. Positive assessments have
`presence: "present"` and `salience: "supporting"` or `"prominent"`; non-positives
have only presence. Strength means expression of the target style, not confidence
or selected-note fraction. Use half-open source-ms scopes and real source lines,
including complete entering holds in context. Missing dimensions stay unreviewed.

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
