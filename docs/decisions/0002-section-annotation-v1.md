# ADR 0002: Local section annotation contract v1

## Status

Accepted

## Context

Beatmap Lens needs a private expert workflow for producing section-level osu!mania judgments without
changing the published package API. The workflow must preserve exact source identity, keep expert
semantics auditable, remain useful without audio, and write canonical data directly to storage the
annotator controls.

## Decision

The Inspector owns a local-only annotation boundary with four artifacts:

1. A catalog-to-corpus task manifest selected by the annotator.
2. Immutable, content-addressed Judgment Foundation snapshots.
3. One canonical annotation sidecar for each exact `.osu` source hash.
4. Generated releases containing completed human gold annotations.

Chromium's File System Access API is the canonical persistence environment. IndexedDB stores only
recoverable session state such as directory handles, preferences, and draft journals. No annotation
contract is exported from `packages/beatmap-lens`.

Source SHA-256 is calculated from exact `.osu` bytes before decoding. Persisted note references use
the HitObject source line, the SHA-256 of that exact line's bytes, normalized column and kind, and
source timestamps. Runtime note IDs are never persisted.

All ranges use source milliseconds and half-open `[startMs, endMs)` semantics. A normal note belongs
when its onset is inside the range. A long note belongs when its interval overlaps the range. The
chart end is one millisecond after the last normalized note endpoint.

Gold annotations are human-authored, positive-only, multi-label judgments. Each active tag has an
independent salience of `2` for a dominant diagnostic feature or `1` for a supporting, mixed,
partial, or transitional feature. Salience is not confidence, quality, difficulty, or probability.
Missing labels are not negative examples.

Every gold annotation pins an exact immutable Foundation digest. Candidate tags may be suggested but
must be activated with a definition and at least one inclusion cue before use. Existing active tag
meanings and the global salience policy cannot change within Foundation v1.

Canonical JSON uses recursively sorted object keys, deterministic array ordering defined by each
contract, UTF-8, LF endings, two-space indentation, and a final newline. Every write uses optimistic
revision and digest checks, then reads the saved bytes back and validates them before clearing the
corresponding draft.

Audio is optional context. A synthetic playback clock supports the entire annotation workflow.
Media time becomes authoritative only while Music is enabled, and switching clocks preserves the
current source time. Visual falling speed never changes clock or media playback rate.

Release generation scans sidecars and exports only completed gold annotations. It excludes drafts,
predictions, review notes, local paths, source text, audio, and downstream model features.

## Consequences

- BOM or line-ending changes create a new source identity and require a new sidecar.
- Hash or stable-note mismatches block editing instead of attempting fuzzy migration.
- The queue is derived by scanning sidecars, so no mutable annotation index can diverge.
- Overlapping annotations remain valid. Same-tag overlaps are warnings, not save failures.
- Unused immutable Foundation snapshots may remain after a later annotation write fails.
- Unknown future contract versions can be inspected read-only but never overwritten by v1 code.
- Model-ready feature extraction, negative sampling, splits, multi-user review, cloud storage, and
  batch `.osz` annotation remain outside this contract.
