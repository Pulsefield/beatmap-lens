# Compositional pattern judgments and local episodes

- Status: Compositional representation proposed; four-dimension pilot approved
- Date: 2026-09-05
- Scope: annotation semantics and Inspector review, not automatic pattern detection

Later corpus feedback and the approved roll/Stream distinction are recorded in
[decision 0006](0006-query-assisted-style-recognition.md). The original pilot's
three-group-to-Stream-prominent implication below is historical, not the rule for
new query-assisted recognition.

The [experimental supervision decision](0005-experimental-style-supervision.md)
sets the consumer-facing priority: a small useful section vocabulary, separate from
selected community map targets. The analytical views here organize expert reasoning;
they do not define a hierarchy of model outputs or require one target per descriptor.

## Problem

The initial flat nine-tag campaign conflates simultaneous note groups, temporal
relations, run extent, local organization, and expert characterization. Calibration
also mislabeled successive patterns inside one review crop as uniform section
examples. More renderer primitives do not resolve these mistakes.

The expert distinguished initial jumpstream from following jumptrill and rolls;
fixed-group long jump jacks from chordjack; minijacks from longjack; source LN kind
from tapping articulation; staggered releases from incidental or simultaneous
endings; and tricky organization from regular chordstream-like activity. These
distinctions are recorded in the
[judgment guide](../../skills/mania-pattern-judgment/references/judgment-guide.md).

## Proposed model

Use composable views of the same source episode rather than an exclusive tree or
an ever-growing list of compound labels.

| View | Question | Example |
| --- | --- | --- |
| Source facts | What attacks, holds, and releases happen? | Two keys attack together; another remains held |
| Temporal structure | How do successive events relate? | Same-column recurrence, alternating groups, ordered motion |
| Extent and timing | How long and how closely spaced? | Two attacks, extended even run, measured source intervals |
| Local organization | What pattern describes the episode? | Jumpstream, jumptrill, long jump jack, chordjack, inverse |
| Expert characterization | What properties of the arrangement matter? | Tech, LN coordination, LN release; independent salience |

These views are not mandatory parent classes. `Jump` describes chord arity;
`jack` describes repetition; `long` describes extent. **Long jump jack** can be
represented or displayed without asserting that chordjack is its parent. A broad
stream-family name must not reuse the meaning of a narrowly judged `streams`
pattern. No parent positives or negatives follow automatically from names or grouping.

An **episode** is a locally described span of organization. A review context can
contain several episodes and gaps. Each claim still binds one concept to an
explicit scope and judges the complete arrangement there. Several independently
supported claims may share scope; a temporal sequence does not automatically
establish their simultaneous prominence throughout a larger scope.

A broader section summary must state that it summarizes a sequence and identify
the episodes involved. That differs from a uniform local pattern claim. A transition
cannot hide uncertainty, and a few known episodes do not require exhaustive segmentation.

## Candidate vocabulary organization

The previously approved nine-target set remains historical context. This proposal
does not approve additions or remove existing records.

| Term | Proposed treatment | Approval state |
| --- | --- | --- |
| Jump, hand | Structural descriptors: two and three simultaneous keys | Expert meanings supplied; representation proposed |
| Jack, trill, roll | Temporal relationships | Expert examples supplied; no exhaustive subtype theory inferred |
| Minijack, longjack | Extent-sensitive jack forms | Expert supplied two attacks and at least four fast even attacks respectively |
| Jumpstream, jumptrill, long jump jack, chordjack | Distinguishable local organizations / compounds | Reviewed distinctions supplied; chordjack anchor boundary pending |
| Stream organization | The later four-dimension calibration includes jumpstream and roll/burst and excludes the reviewed grouped jumpdrill | Local pilot interpretation approved; historical narrower criticism remains in its original record |
| Roll/burst | Four-note directional groups with equal adjacent spacing and no chord bridge between bursts; burst is the faster description | Three or more consecutive complete groups establish local prominent Stream organization; no numerical speed threshold supplied |
| Tech | Tricky, expectation-disrupting organization | Four-dimension local definition and reviewed positive/negative approved |
| LN coordination, LN release, LN inverse | Related, independently judged hold organizations | Preserve expert distinctions and weak examples |
| Speedjack | Potential speed qualification on jack structure | Independent target versus qualifier versus retirement pending |

Example typicality and section salience remain separate: a weaker example is not
automatically uncertain or supporting-salience. Clarify what the expert means when
that distinction changes the saved record.

## Minimal implementation path

1. Preserve original proposals and expert feedback, including approximate cuts and
   which part of a review context is discussed.
2. Use the judgment skill for labeler and auditor reasoning. Revise source-backed
   candidate episodes under the expert's actual distinctions.
3. Record the approved four-dimension calibration through the human workflow.
   Further campaigns require their own bounded target selection and semantic
   approval; this does not reopen the pilot's resolved choices.
4. Keep generic `ClaimV2` scopes, evidence, assessment, salience, and immutable
   provenance. Narrower claims and `sectionId` support a new real review without
   requiring an ontology editor.
5. If machine-readable composition is approved, add versioned Foundation metadata
   for descriptors and explicit relationships. Change the exchange contract only
   for approved relationships actual cases need. Keep vocabulary and hierarchy out
   of the renderer and generic validator.

The current V2 contract does not encode an episode graph, inheritance, or a compound
label grammar. UI grouping alone must not be described as implementing them. The
initial nine-concept campaign remains proposed; the later four-dimension Foundation
was approved with explicit expert corrections. See the
[experimental decision](0005-experimental-style-supervision.md) for its resolved
calibration and separate community-alignment questions. Pinned tasks and V1
records keep their meanings.

## Acceptance consequences

The mixed-judgment test proves that the contract retains two prominent positives,
negative, unresolved, and unreviewed dimensions. It does not prove that a real
example supports any specific pair of judgments.

For milestones 1 and 2, choose a real scope with two independently justified
positives under the revised rules, or preserve the actual sequence with separate
scopes and use another valid mixed episode. Do not stretch expert boundaries or
force a second positive to satisfy a demo checklist. Actual expert decisions,
not generated fixtures or skill text, establish the human-confirmed handoff.

For the selected four-dimension pilot, the five assessment cases span two scopes,
as explained in the [experimental supervision proposal](0005-experimental-style-supervision.md).
This retains the semantic checks while keeping the experimental inventory small.
