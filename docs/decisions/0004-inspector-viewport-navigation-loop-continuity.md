# ADR 0004: Settled selection state and persistent loop intent

## Status

Accepted

This decision supersedes two interaction rules in the
[section annotation system design](../section-annotation-system-design.zh-CN.md): pausing playback
when a range gesture begins, and applying range and note-selection state on every animation frame
during a gesture. All other v1 annotation semantics remain in force.

## Context

The Annotate workspace currently treats selection editing, viewport navigation, and transport state
as if they shared one transaction boundary.

Range gestures call the edit-pause path before changing a selection. Both playback clocks clear
selection playback when paused, so an ordinary edit can permanently discard an active loop. A seek
does not have this behavior. The lost loop is caused by the edit pause, not by viewport movement
itself.

Gesture preview also enters the committed selection path once per animation frame. That path
updates the range, selected note IDs, manual exclusions, candidate notes, overlap warnings, and
other domain state before the user has settled the gesture.

These are two manifestations of the same missing boundary. Viewport and pointer input are
transient interaction state. Transport mode and committed selection are durable session state.

## Decision

### Loop is a session-scoped transport intent

Once loop mode is active, non-transport interactions must not pause it, clear it, or replace it.
This includes viewport navigation and seek, selection creation or editing, other annotation edits,
undo, draft persistence, and save.

Only an explicit transport command may stop or replace the loop. Such commands include turning
Loop off, Pause, normal Play, and one-shot Selection playback. Replacing the task or chart,
clearing the workspace, or disposing the playback session also ends the loop because these
operations cross a session lifecycle boundary.

A selection gesture does not pause playback. While its preview is active, playback continues to
loop over the last committed selection. When a valid selection settles, the workspace atomically
commits the selection, binds the active loop to the new range, and restarts from the new
`startMs`. Observers must not see an intermediate paused transport state.

Cancellation or an invalid final range discards the preview. The previous committed selection and
loop range remain active.

### Selection has transient and committed layers

The gesture transaction owns transient interaction state: its anchor, last pointer position,
working viewport time, and visual `previewRange`. It may update this state at most once per
animation frame.

`AnnotateWorkspace` remains the single owner of committed selection state. A preview must not
update the committed range, selected note IDs, manual exclusions, candidate notes, overlap
warnings, undo history, draft state, autosave state, persistence, or the active loop range.

A pointer gesture settles on `pointerup`. Manual time input settles on `Enter` or blur. Wheel or
arrow-key navigation during an active pointer gesture remains part of that gesture and settles on
the same `pointerup`.

At a successful settle, the workspace performs one domain transaction:

1. Resolve the final snapped range.
2. Calculate note membership and manual exclusions.
3. Update the committed selection and its derived state.
4. Create one undo entry and one final draft and persistence transition.
5. If loop mode is active, bind it to the committed range and restart from `startMs`.

`Escape`, `pointercancel`, and `lostpointercapture` discard the transient layer without a
domain commit.

### Wheel and arrow keys are viewport navigation inputs

`FallingNoteViewport` exposes one viewport-navigation operation for unmodified vertical wheel
input while hovered and for focused `ArrowUp` and `ArrowDown` input. Pointerdown makes the
viewport focusable without scrolling the page.

Both inputs produce a signed visual displacement, convert it to source milliseconds with the
current visual speed, and clamp the result to `0..chartEndMs`. Time runs upward:
`ArrowUp` and negative `deltaY` move later, while `ArrowDown` and positive `deltaY` move
earlier.

One key step represents `40` CSS pixels. Wheel delta modes are normalized as pixels, `16`
pixels per line, or one viewport height per page. Wheel input is accumulated and applied at most
once per animation frame. Wheel input with Control, Meta, Alt, or Shift is not consumed.

Without an active selection gesture, navigation uses the existing seek semantics and preserves the
transport mode. During a gesture, navigation changes only its working viewport time and
`previewRange`. The anchor remains fixed in source time, so reprojecting the last pointer
coordinate naturally expands or contracts the preview. This is not a separate keyboard selection
mode.

## Consequences

- Transport mode no longer depends on whether an editor operation temporarily needs stable input.
- A loop over the previous committed selection remains audible while a new selection is previewed.
- Note membership and other selection-derived state update once at settle instead of once per
  preview frame.
- Pointer, wheel, and arrow-key input remain one gesture transaction and produce one undo entry and
  one final persistence transition.
- The existing committed selection remains the only canonical selection store. The preview is
  component or workspace transient state, not a second domain model.
- The change is confined to Inspector interaction and playback orchestration. It requires no data
  migration, new runtime dependency, public package API, or persisted loop preference.
- This decision changes state semantics. It makes no unmeasured performance claim.

## Non-goals

This decision does not split the viewport camera from the playback playhead, add global arrow-key
shortcuts, move keyboard focus on hover, add a standalone keyboard range editor, add configurable
navigation steps or wheel inertia, change timeline zoom behavior, or alter annotation schemas.
