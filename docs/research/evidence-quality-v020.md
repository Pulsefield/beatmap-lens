# v0.2.0 evidence quality and supplemental review

The released section labels remain usable under their existing authority rules.
The release does **not** provide independently selected human note-level gold,
per-note omission judgments, or evidence certified as minimal or sufficient.
The main repair is to make evidence provenance and review targets explicit,
then obtain the missing judgments without rewriting history.

This audit pins the v0.2.0 manifest to
`d662dc74f6171518707f83186521f57786910569ffaa62fbb0dc568eaac336c3`.
It covers 2,886 records: 467 human records and 2,419 independently audited
machine records, spanning 332 annotated charts. The frozen release and historical
observations are inputs only. The plan generator creates a separate local
artifact; it does not modify the human review inbox or mark tasks completed.

## Findings and their meaning

| Measured property | Human | Machine | Interpretation |
| --- | ---: | ---: | --- |
| Records | 467 | 2,419 | Human records represent 466 exact cells; machine records represent 2,419. |
| Witness/context sets identical to ancestor proposal | 467 | 2,419 | Human labels have agent-origin evidence. Historical explicit selection review is not recorded. |
| Full-section witness sets | 115 | 20 | Valid arrangement-level evidence shape; positive subsets contain 66 and 3 records respectively. |
| Every attack selected, only entering holds omitted | 6 | 1 | A strict subset does not establish deliberate note contrast. This shape is not an error. |
| Context equals review-context complement of witnesses | 466 | 2,419 | The packager creates this complement; it is not a set of semantic negatives. |
| Changed assessment relative to ancestor | 102 | 0 | The human target remains authoritative even if attached prose explains the old target. |
| Changed scope relative to ancestor | 3 | 0 | Check the explanation against the final interval as well as the label. |
| Empty evidence rationale | 7 | 0 | A missing explanation is an evidence research gap, not an invalid label. |

All 2,886 main witness/context selections pass the independently repeated source
note tuple, duplicate-reference, range, and nonempty-witness checks. The upstream
hygiene audit also reports no structural or lineage errors. Partial chords,
disconnected witnesses, unselected rows between witnesses, and entering long
notes remain legitimate source arrangements.

Of 103 human-modified records, 96 retain the ancestor evidence rationale and
seven clear it. The changes comprise 93 assessment-only, three scope plus
assessment, one rationale-only, and six assessment plus rationale changes. The
seven empty rationales include four positive supporting targets: three Trill and
one Stream. These counts establish textual inheritance, not semantic agreement
or disagreement. In particular, `auxiliary_evidence_status=current` checks
referenced human exemplars; it does not certify the current rationale against the
current label. The human layer contains 260 `current` and 207 `untracked` records.

The repeated exact cell is Stream supporting at source
`3776ea42cd9c8d63288e215d77197dac5e16327590b0a8a3bce706d12c872637`,
`[181454, 189454)` milliseconds, 1×. Both human-modified records retain the same
26 witnesses. Both identities remain in the plan; their combined label weight is
one, with 0.5 per record if consumed as rows. A cell is identified by exact source
hash, start, end, tag, and playback rate. A duplicate is not an additional
independent judgment. Differing labels in one cell fail plan generation for
explicit resolution rather than being silently averaged or chosen.

## Supplemental tasks and acceptance

The generated plan contains **177 exact-cell tasks**, preserving 178 record
identities:

- **102 current-evidence review tasks**, covering all 103 human-modified records.
  These are required before treating the inherited or missing explanation as
  supervision for the final claim. They do not block use or publication of the
  existing human labels. Ninety-five cells contain unchanged ancestor prose after
  a label/scope change; seven have empty prose. Those two reasons cover all 102.
- **75 additional optional shape studies** examine arrangement-level selection or
  entering-hold omissions. Across both priorities there are 135 full-section and
  seven entering-hold-omission cells; many also belong to the first group. Shape
  studies are research questions, not defects or mandatory human label reviews.

No task is inserted into the existing `needs-expert` inbox. The plan describes
missing work and currently records zero completed semantic reviews. Merely
creating this plan, adding UI review metadata, or rerunning a machine audit does
not complete the supplemental human judgments.

Follow the [evidence review procedure](../annotation/evidence-review.md). Each task
contains its original and final label, scope, context, rationale and witnesses;
all section/context notes; original long-note endpoints; left-boundary releases;
unselected section lines; and all record, claim, handoff, decision and observation
identities. The final label and final evidence are checked against the **same**
local observation claim before a task is emitted. Ancestor comparison fields and
rationale semantic status remain separate. The generator never pairs a revised
label with notes taken from another observation.

A supplemental result is acceptable only when it:

1. Identifies the exact source, scope, tag, rate, observation and every grouped
   release record. A later observation requires reconciliation before application.
2. Explicitly records whether the witness selection was inspected and retained
   or revised, and whether the explanation was checked against the final claim.
   Selection origin and selection review are different facts.
3. Explains the selected arrangement under the final target and records
   uncertainty. Whole-section evidence can be retained with an arrangement-level
   reason; no coverage threshold determines salience.
4. Separately records any contrast judgment about omitted note groups. A generic
   selection-review checkbox does not answer why each other note was omitted.
   `Not separately assessed` is honest but leaves omission supervision unresolved.
5. Preserves historical records through an additive, source-bound review. Any
   changed label requires a new human judgment; an agent evidence proposal cannot
   override it. A subsequent release must take label and evidence from one
   effective observation, publish its provenance, and retain supersession links.

Human selection review still does not prove minimality, uniqueness or sufficiency.
Those properties need an explicitly evaluated removal/replacement experiment.
Agent follow-up can prepare evidence and rationale proposals, but it cannot
retroactively become an independent human selection.

## Implemented safeguards

Review now records optional evidence-selection provenance and separate explicit
selection/explanation review. Automatic section filling, explicit whole-arrangement
selection, manual note edits and range filtering remain distinguishable. Editing
the assessment, scope or notes invalidates the unchanged draft explanation;
historical observations are preserved. Existing single-label human sections can
save evidence review without completing unrelated dimensions, while the exact
label cell and assessment must remain unchanged for that action.

Future publication schema v3 retains the current observation hash, a shared exact
cell identity, explicit evidence-review metadata, cumulative differences from the
agent proposal, and the immediately preceding human observation ID/hash with its
claim changes. These are factual revision relations, not semantic alignment
certificates. Labels and notes always come from the same effective observation.
Legacy schemas v1/v2 remain readable, and published v0.2.0 bytes remain unchanged.

The complete repository check passed 503 TypeScript and 303 Python tests, builds,
package checks and corpus smokes. Actual Review-page verification used an isolated
copy of one legacy source: evidence-only save appended one observation with an
identical claim, retained its predecessor unchanged, kept four other dimensions
unreviewed, and a repeated save did not append another observation. This verifies
the workflow rather than the quality of a new human judgment. No supplemental
semantic review was performed by that UI test.

## Other measured quality limits

The release contains 682 distinct source/scope/rate sections: 550 have all five
tags, 131 have one, and one has four. The human layer has 198 sections, of which
131 have one tag and 67 have five. The machine layer has 484 sections, of which
483 have five and one has four. Missing tags mean unreviewed, never absent.
Distinct section scopes do not overlap on the same source/rate in this snapshot;
the per-tag overlap check also finds zero pairs after exact-cell grouping. This
reduces one local duplication concern, but does not establish independent songs
or independent examples.

All published records are at 1×, on 4K charts, under the same Foundation identity.
The 336 source metadata rows are also all 4K; 332 sources have annotations.
Section durations range from 260 to 135,217 milliseconds. These are selected
sections at very different scales. The release cannot establish population style
prevalence, rate invariance, player-profile invariance, or generalization to other
key counts. Compare strength within a specified scope and gameplay setting;
do not explain it using raw witness fraction alone.

The exact-cell label distribution is uneven:

| Tag | Absent | Supporting | Prominent |
| --- | ---: | ---: | ---: |
| Stream | 73 | 174 | 310 |
| Jack | 157 | 304 | 97 |
| Trill | 461 | 99 | 22 |
| Tech | 440 | 102 | 66 |
| LN | 470 | 80 | 30 |

These are dataset counts, not estimates of gameplay frequencies. Rare positive
Trill/LN cells, authority-layer differences, section selection, and unequal scope
lengths can affect a learned relationship between evidence and salience. No new
sampling weights or class thresholds are imposed by this audit.

The pinned dependency artifact contains **22,974 exemplar edges** involving
45 exemplar sources; 122 edges have no published example record identity. Keep
those edges, including references outside the published human layer. Future
splits must account for consulted human examples as well as source/song/audio
identity. A random record split or exact-cell deduplication alone would not
control this leakage. This work measures dependencies but does not construct or
certify an evaluation split.

Rationale often discloses the target class or strength. It is inspection material,
not a salience-prediction input. Whether prose accurately explains its current
claim still needs semantic review; textual identity cannot certify it. Compare
an evidence-based predictor with a full-section baseline, and preserve unselected
intervening rows and entering holds as available context. The release lacks
negative selection labels, so omission prediction requires the separate contrast
judgments above.

## Reproduce the plan

Run from the Beatmap Lens repository with the frozen release, workflow journals,
exact source bytes referenced by the hygiene provenance, and the Pulsefield
hygiene artifact available:

```sh
uv run --locked python -m annotation.evidence_review.plan \
  --release .local/releases/mania-pattern-annotations/v0.2.0 \
  --workflow .local/corpus-500-v2/workspace/workflow \
  --hygiene ../Pulsefield-model/artifacts/evidence_hygiene/20260910-v020/valid-data-final \
  --output .local/evidence-quality-20260910/review-plan-final
```

The output directory must be new. Change the output name for another run. No
command writes to the release, source charts or workflow. Outputs are:

- `review_tasks.jsonl`: grouped tasks, original/final evidence and full source
  context, purpose, nonblocking label status, and acceptance criteria.
- `cells.jsonl`: one label weight per exact cell, with every record identity.
- `record_flags.jsonl`: factual ancestor relations, unrecorded review status,
  purpose limits, and explicit label/evidence same-claim verification.
- `summary.json`, `inputs.json`, `checksums.json`: counts, verification scope,
  exact input hashes and output checksums.

Cell IDs reuse the publication exporter's `judgment_cell_id`; the shorter
Pulsefield hygiene identity is retained separately as `upstream_cell_id` for
cross-project joins.

The generator verifies the release manifest and all release file bytes, checks
all 332 original source byte hashes, checks the hygiene input hashes, compares
all published columns, binds final claim cores and decision identities to their
workflow records, and independently recalculates ancestor and note-set facts.
All selected tuples are checked against the complete pinned source note tables.
It relies on the separately pinned hygiene audit for note parsing and full
cryptographic handoff/audit-body verification; it does not reimplement those
canonical engines or perform semantic review. Nine deterministic tests cover
boundary holds, whole-section and attack-only selections, empty and inherited
rationales, duplicate weighting and conflicts, separate rates, source tuple
errors, immutable input checks, and rejection of mismatched final observation
claims. These tests validate the planning tool, not annotation correctness.
