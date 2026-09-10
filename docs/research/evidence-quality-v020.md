# v0.2.0 evidence quality and selection repair

The released section labels remain usable under their existing authority rules.
The release does **not** provide independently selected human note-level gold,
per-note omission judgments, or evidence certified as minimal or sufficient.
The repair preserves evidence provenance and revision identity, and supplements
missing selections through concurrent agent judgment and note selection. It does
not add retrospective explanation or omitted-note annotation requirements.

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
| Changed scope relative to ancestor | 3 | 0 | Preserve final interval and notes from the same observation. |
| Empty evidence rationale | 7 | 0 | No invalid label or missing selection follows from empty prose. |

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

## Corrected scope and selection candidates

The user rejected the earlier retrospective review extension on 2026-09-10.
Its **102 explanation/selection review tasks and 75 optional shape studies are
withdrawn**. The old local artifacts remain historical outputs, not the current
queue. Agents select notes while making a judgment under the existing skill;
they are not asked to add retrospective explanations or omitted-note reasons.
Separate selection or rationale review is not a condition for using a human label.

The replacement plan contains **39 exact-cell candidates across 39 human records
and 39 charts**. All are present human labels whose witnesses are unchanged from
an absent or unresolved ancestor judgment. This identifies a positive target
without a corresponding positive agent judgment-and-selection pair; it does not
prove the inherited notes are unsuitable. There are **zero literal empty witness
sets** in this release.

Other human revisions, empty rationale, whole-section selection, and entering-hold
omissions do not independently create candidates. Old notes may be retained when
a new concurrent judgment selects the same arrangement. There is no required
selection size, explanation rewrite, or salience coverage threshold.

Follow the [selection repair procedure](../annotation/evidence-review.md). Give
fresh agents short, standalone inputs with at most four fixed sections per job.
The case file contains the exact source, scope, tag, rate and full notes/context,
without the prior human/agent label, rationale or selected set. Agents produce
their style judgments and note selections together. Compare with the human label
only after the judgment is complete; do not ask agents to fit a selection or
explanation to a preannounced target.

An agreeing result can become an additive agent selection proposal linked to the
human observation. A disagreement remains distinct and unresolved; the existing
human label is preserved. No result is independent human note-level gold, and
no plan item or machine audit proves minimality or sufficiency. No task is
inserted into the human `needs-expert` inbox merely by generating the plan.

Each supervisor task retains original/final claims, all section/context notes,
original long-note endpoints, left-boundary releases and record/claim/handoff/
decision/observation identities. The final label and evidence are verified against
**one local observation claim**. This lineage artifact is not the worker's case
input. The plan generator records zero completed re-annotations; completion must
be established from actual agent results, not from task creation.

## Concurrent selection run, 2026-09-10

The subsequent [human review and execution diagnosis](selection-run-diagnosis-20260910.md)
records six new canonical human revisions, 15 retained judgments, historical Tech
misses and the guide-only comparison. The counts below describe the initial run
against its pre-review snapshot.

All 39 candidates were annotated in 10 fresh agent contexts, with at most four
fixed sections per context and three jobs running concurrently. The configured
labeler was `gpt-6-astra` at medium reasoning effort, using the existing frozen
skill and complete source/context notes. Its output contained only the case,
tag, assessment and selected source lines. It generated no explanation or
omitted-note reasons. Historical assessments and selections were withheld from
the case files. The unchanged calibration guide nevertheless includes four
exact target tag/scope judgments; this was annotation work, not a held-out
accuracy evaluation.

| Comparison with the human assessment | Cases | Treatment |
| --- | ---: | --- |
| Same presence and salience | 18 | Separate agent selection supplements bound to the human observation |
| Same positive presence, different salience | 10 | Keep the independent judgment separate |
| Agent absent, human present | 11 | Keep the independent judgment separate |

Of the 18 agreeing annotations, 15 independently returned the original selection,
one selected a superset and two selected overlapping but different sets. Thus
this run does not establish that inherited selections were defective. It supplies
three changed selection proposals and 15 concurrent positive judgments selecting
the same notes. Agreement alone is not a semantic audit or a sufficiency claim.

Independent verification found all 39 cases, 70 unchanged input hashes, complete
case-file reads in every job, valid source-backed notes and original LN endpoints.
There were no structural or provenance errors. Nine jobs made one tool call;
one made two. Aggregate input-token usage is not a measurement of peak context.
No human observation or published record was rewritten.

Local outputs are under `.local/selection-supplement-20260910/`:
`judgments.jsonl` retains all 39 results; `label-compatible-selections.jsonl`
contains the 18 agreeing agent selections; `disagreements.jsonl` retains the
other 21. Each result binds source/scope/tag/rate, original human record and
canonical observation hash, agent assessment, selection, complete review context,
producer and frozen input/output hashes. `result-summary.json` and
`independent-qa.json` record verification and calibration exposure. These are
opt-in additions with agent selection authority, not a replacement human table
or a new published release.

## Provenance and version safeguards

Selection operation provenance distinguishes inherited notes, automatic section
filling, explicit whole-arrangement selection, manual edits and range filtering.
The set shape cannot reconstruct missing historical operation metadata. Historical
observations are preserved, including their original prose; text inheritance and
revision changes are factual relations, not semantic alignment certificates.

Publication schema v3 retains the effective observation hash, a shared exact cell
identity, selection provenance, differences from the agent proposal, and the
immediately preceding human observation identity/hash and claim changes. Labels
and attached notes come from the same effective observation. An agent selection
supplement remains a separately identified proposal until explicitly applied
through the human revision workflow. The frozen v0.2.0 bytes remain unchanged.

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
not a salience-prediction input. Textual identity does not certify that prose explains its current
claim. This limitation does not create retrospective explanation tasks. Compare
an evidence-based predictor with a full-section baseline, and preserve unselected
intervening rows and entering holds as available context. The release does not supply
semantic-negative selection labels. Its complement must not be relabeled as such;
creating additional omitted-note judgments is outside this annotation procedure.

## Reproduce the plan

Run from the Beatmap Lens repository with the frozen release, workflow journals,
exact source bytes referenced by the hygiene provenance, and the Pulsefield
hygiene artifact available:

```sh
uv run --locked python -m annotation.evidence_review.plan \
  --release .local/releases/mania-pattern-annotations/v0.2.0 \
  --workflow .local/corpus-500-v2/workspace/workflow \
  --hygiene ../Pulsefield-model/artifacts/evidence_hygiene/20260910-v020/valid-data-final \
  --output .local/selection-supplement-20260910/candidates
```

The output directory must be new. Change the output name for another run. No
command writes to the release, source charts or workflow. Outputs are:

- `review_tasks.jsonl`: grouped selection candidates, original/final claims and
  full source context for the supervisor, nonblocking label status and acceptance
  criteria. Do not pass this unredacted lineage artifact as a worker case input.
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
canonical engines or perform semantic review. Twelve deterministic tests cover
concurrent re-annotation candidate rules, literal missing selections, rejection of
shape/rationale/salience-only task triggers, boundary holds, duplicate weighting
and conflicts, separate rates, source tuple errors, immutable input checks, and
rejection of mismatched final observation claims. These tests validate the planning tool, not annotation correctness.
