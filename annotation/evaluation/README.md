# Annotation regression gate

The gate protects previously learned judgments when the judgment skill, labeler role,
evidence tools, or selected-section execution inputs change. It does not certify
whole-chart discovery or independent audit quality.

`cases.json` contains 28 exact human judgments across all five dimensions. Fourteen
cells are protected: established pilot anchors and four explicit Trill corrections.
Historical completed-output receipts identify formerly correct judgments where that
evidence exists. The Trill corrections are newly protected and make no prior-success
claim. Generic human confirmations establish a label, not the correctness of an
earlier agent's explanation. These are development-exposed regression examples,
not a held-out accuracy benchmark.

## Enforcement

Prepare the root project environment with `uv sync --locked`. Python commands use
its `.venv` and locked dependencies:

```sh
uv run --locked python annotation/evaluation/regression_gate.py check
uv run --locked python -m unittest discover -s annotation/evaluation/tests -p 'test_regression_gate.py'
```

The normal repository check runs the first command. An unchanged source snapshot
passes without local datasets, model calls, or historical research artifacts. A
judgment change needs fresh baseline and candidate evidence. The command exits
nonzero for missing or stale evidence, incomplete output, reused repeat workers,
different model settings or source sections, any protected error, or an unreviewed
broader regression. Foundation content and the source/example input pool must also
match between sides; intentionally changed tool code and contrast policy remain
part of the candidate being tested.

Both sides need at least three independent repeats. Every protected cell must match
its exact human assessment in every candidate repeat, even if a baseline repeat was
also wrong. For other cells, every paired correct-to-wrong change is listed and needs
a named accepted disposition with its reason. A higher aggregate score cannot hide
these losses. A named review of source evidence and reasoning is also required;
matching labels alone do not establish correct reasoning.

CI sets `ANNOTATION_REGRESSION_BASE` to the pull request base SHA or push's prior SHA
and fetches that Git history. The checker computes sources from that tree, so editing
`source-baseline.json` cannot erase a regression in the same change. A first push
with an all-zero prior SHA uses the reviewed initial snapshot. The initial migration
snapshot records unchanged annotation semantics, not a successful model replay.
There is no reset or unconditional acceptance command. After a reviewed update,
the source baseline may advance in the same commit as its accepted evidence; CI
still checks that commit against its prior tree.

Direct auditor-role, discovery workflow, selected-workflow controller, Foundation,
or corpus changes currently fail with explicit unsupported coverage. They need a
corresponding replay adapter or a separately reviewed expansion of this gate before
adoption. Shared judgment-guide and harness changes are covered by selected-section
judgment replay; passing it makes no claim about unmeasured roles.

## Preparing a comparison

Use the adopted source checkout for one side and the candidate checkout for the
other. Run the following from each checkout with different output directories:

```sh
uv run --locked python annotation/evaluation/run_regression.py prepare \
  --root /path/to/local-comparison/baseline \
  --campaign /path/to/campaign \
  --feedback-dir /path/to/feedback
```

Preparation uses the project Python environment and locally available campaign
source files. It creates three repeats, with bounded jobs of up to five sections.
The same production `prepare_job`, role, skill, and `common_prompt` build each job.
The evaluation harness excludes every target source and its known song group from
human-example retrieval. Target review records and earlier repair questions are
absent from section inputs; gold stays with the controller. The skill contains its
ordinary guidance, so this remains exposed regression testing. Source access outside
the job is forbidden by worker instructions, not by an OS read sandbox.

Preparation does not start workers. This command consumes model usage:

```sh
uv run --locked python annotation/evaluation/run_regression.py run \
  --root /path/to/local-comparison/baseline --concurrency 3
```

Repeat preparation and execution for the candidate with the same model settings and
source campaign. Existing production delivery is never called; evaluation outputs
do not submit or replace human review records.

## Reviewing and retaining results

```sh
uv run --locked python annotation/evaluation/regression_gate.py compare \
  --baseline /path/to/local-comparison/baseline \
  --candidate /path/to/local-comparison/candidate \
  --out /path/to/local-comparison/evidence.json
```

This first comparison writes compact evidence and deliberately exits nonzero until
reviewed. It validates completed runs with the existing section scorer, verifies
frozen input and output hashes, and retains per-cell assessments and output receipts.
The complete raw jobs can remain local; keeping the research execution history is
not a publishing requirement.

Copy the generated evidence's `review` object to a review JSON file. Retain its
`comparisonSha256`, fill in `reviewer` and `rationaleReview`, and add a disposition
for each broader regression reported by the checker:

```json
{
  "comparisonSha256": "copy from the generated evidence",
  "reviewer": "reviewer name",
  "rationaleReview": "What source facts and explanations were checked, with remaining limits.",
  "regressions": {
    "probe-01:tech": {
      "decision": "accept",
      "reason": "The specific reason this observed regression is acceptable."
    }
  }
}
```

Rerun `compare` with `--review /path/to/review.json` and write the reviewed compact
artifact to `annotation/evaluation/accepted-evidence.json`. Then `check` verifies the
artifact against the current source and corpus identities and recomputes its pass
conditions. A review of earlier outputs cannot be silently applied to new outputs.
For an exploratory comparison, use `check --evidence /path/to/evidence.json` instead.

The older section and optional-harness benchmark commands remain useful for
experiments. Their historical reports do not constitute current adoption evidence.
