# ADR 0003: Section annotation v1 canonical revision

## Status

Accepted

Supersedes the candidate tag, Foundation exemplar, and per-HitObject line digest decisions in
[ADR 0002](0002-section-annotation-v1.md).

## Context

The section annotation workflow stores current expert observations for exact `.osu` sources. The
initial v1 design put candidate tag lifecycle and exemplar backlinks in the Foundation, and stored a
per-note line SHA-256 in each stable note reference. Those choices made editable gold annotations
look more permanent than they are and added note-reference work that does not improve identity once
the whole source file is already content-addressed.

## Decision

Foundation tags have only `active` and `retired` status. Catalog categories remain suggestions and
are not written as candidate tags. When an expert first uses a suggested or custom tag, Inspector
creates a new Foundation revision containing that tag directly as `active`, with its canonical ID,
display name, definition, and inclusion cues.

Gold annotations are current, revisable human observations. Exemplar semantics belong to the gold
annotation as `exemplarRoles`, keyed by tag ID with kind `strong`, `weak`, or `counterexample`.
Foundation snapshots no longer store exemplar references or annotation backlinks.

Codex output is prediction provenance, not tag state. A Codex section judgment remains a
`SilverPredictionV1` with producer, skill, model, confidence, and review fields. Accepted or modified
predictions create human gold annotations linked by `derivedFromPredictionIds`.

Stable note references are source-bound five-field tuples: `sourceLine`, `column`, `kind`,
`startMs`, and `endMs`. The annotation document source identity already pins the exact `.osu` bytes
by SHA-256 and byte length, so per-note `objectSha256` is removed. Loading first validates exact
source identity, then resolves refs against the normalized chart by all five fields.

## Consequences

- Editing or deleting gold annotations cannot leave Foundation exemplar backlinks behind.
- Changing labels or adding/changing exemplar roles adopts the current Foundation and requires the
  relevant tags to be active; range, note, judgment-note, and role-removal edits keep the old pin.
- `strong` and `weak` roles require the same tag label on the gold annotation. `counterexample`
  roles require an active pinned tag that is absent from the gold labels.
- Runtime note IDs can change across sessions without affecting persisted refs.
- Source hash or byte-length mismatches still block loading or saving; no fuzzy migration is added.
- Legacy candidate tags, Foundation exemplars, and `objectSha256` sidecars require a one-time data
  decision outside product runtime if they are ever found in a real dataset.
