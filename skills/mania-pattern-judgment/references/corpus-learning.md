# Learn organization from real beatmaps

Learn organization and variants from actual difficulties and beatmapsets, including
unlabeled passages. Human sections are calibration scopes, not learning boundaries.

## Three concurrent views

| View | Interpretation to develop |
| --- | --- |
| Time | How attacks and releases unfold: pulse, grouping, pace, pauses, continuation, acceleration, and restart. Retain actual milliseconds alongside beat-relative rhythm. Counts and gap lists alone are not temporal understanding. |
| Action | How fingers press, hold, release, repeat, and exchange roles; which events can be organized together and which need independent control. Explain specific relationships, not generic difficulty or coordination claims. |
| Organization | Familiar motifs, their variants and connections, read simultaneously across attack groups, cells, phrases, and longer passages. Explain each motif's range and function: continuing body, insertion, development, transition, or closure. |

Revisit each view as evidence changes. A jump can belong to a burst, a trill can
close a stream, and both can participate in larger Tech expression. Ranges may
overlap without nesting. Recognizing constituents does not explain composition;
successive episodes do not establish simultaneous organization.

For short LNs, compare *Who?* and *Materialize Anything* negatives with *Your
Soulmate* and *End Time*: which roles persist into later actions? Preserve every
endpoint even in a tap-like reading. Grouped attacks and changing tail contours
can coexist. No duration cutoff follows. Deliberate judgment-window tolerance is
a separate practice hypothesis, outside an exact-execution profile unless extended.

## Evidence roles

- **Natural chart data** supplies arrangements and variants. Read unannotated
  passages and sibling difficulties; shared songs imply neither identical
  organization nor aligned timestamps.
- **Community tags** are human descriptions of whole difficulties. Use their
  original identity, votes, and provenance to guide attention and retrieve styles;
  examine how the chart supports that description. They neither assign every
  section nor make untagged sections negative.
- **Confirmed expert sections** constrain interpretation at the recorded source,
  scope, and Foundation. Preserve exact assessments and human comments separately.
  A label-only confirmation is useful evidence without an approved explanation;
  do not fill its missing rationale with agent text.

Agent-only annotations, audit agreement, weak query labels, and historical machine
packs are excluded as learning targets and semantic authority. Prior experiences
may suggest where to look; they are not additional confirmation. Keep observations,
human judgments, and agent interpretations distinct.

## Exploration and revision

Start from a chart, community description, or confirmed section. Read surrounding
organization, then inspect rows, actions, articulation, or time-scaled views.
Use `beatmap-learning.py audio` for Pulsefield Mel views aligned with chart actions.
Read frame support alongside hop spacing; spectral evidence does not establish
literal listening or embodied experience. Tools are perspectives, not a checklist.

For exhaustive study, reconcile the current canonical human inventory before
claiming coverage. Preserve each verdict, original comment, source facts, and
interpretation separately. Human shorthand can describe a body or perceived group;
record literal exceptions and unresolved causal discrepancies without rewriting gold.

Ask what a timing change does to the action path, what a retained core leaves as
background, and which relationships survive natural variation. Challenge an
explanation with an opposite human case it also fits; revise the relationship or
leave the distinction unresolved. Familiar constituents do not explain composition.

Follow motifs, transitions, and variants. Retrieve human anchors by relationships,
not matching labels. Persist a useful hypothesis, inspect another real occurrence,
and narrow it where it fails. Retain contradictions while continuing exploration.

## Persistent experience

Use the checkout's `scripts/beatmap-learning.py` (`--help`) and
`docs/beatmap-learning.md` and `docs/beatmap-reading-framework.md` when available.
Portable studies can keep the same
fields in a task-local record. One experience captures a reusable relationship,
not a five-label prediction:

| Input | Content |
| --- | --- |
| `id`, `title` | Stable identity and recognizable organization/relationship. |
| `time`, `action`, `organization` | Concise concurrent interpretations; include relevant scales and functional roles. |
| `instances` | Actual `sourceSha256`, half-open `scope` (`startMs`, `endMs`), and inspected `sourceLines`. |
| `humanAnchors` | Exact public example IDs; empty when no relevant human section exists. |
| `communityAnchors` | Exact `sourceSha256`/`tagId` references; optional. |
| `audioEvidence` | Viewed Mel artifact `evidence.json` paths; optional. |
| `limitations` | Uncertainty, unsupported generalization, and contradictory occurrences. |
| `updateReason` | Required when revising an existing identity; explain changed evidence or interpretation. |

```sh
python scripts/beatmap-learning.py remember --bundle BUNDLE --memory MEMORY --input experience.json --producer ACTUAL_AGENT_ID
python scripts/beatmap-learning.py recall --memory MEMORY --text motif --limit 5
```

The writer binds source/human/community evidence and appends revisions marked
`agent-hypothesis`; it never changes human records. Reopen referenced sources when
reusing an experience. A hypothesis revised to fit exposed gold is a learning
record, not held-out accuracy. Check source fidelity, scope, explanatory coverage,
and transfer to other real arrangements; self-consistency alone does not validate
style precision or a gameplay frontier.
