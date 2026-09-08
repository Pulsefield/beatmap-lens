# Learning beatmap organization from expert judgments

Reading experience should explain an arrangement and identify where that explanation
fails. Exact human section judgments constrain local meanings and strength; natural
charts supply repetition, development, and variants; community tags supply
whole-difficulty context. Revising an explanation does not rewrite the source,
approved vocabulary, or expert judgment.

This document summarizes findings from a study of 139 expert judgments and related
natural charts. It explains the reasoning behind the reading workflow without
requiring the study's local reports. The examples are observations and counterexamples,
not new sufficient conditions, thresholds, or a published evaluation dataset.
For tools and operation, see [natural-chart learning](../annotation/beatmap-learning.md).

## Read time, action, and organization together

| View | What to understand | Useful question |
| --- | --- | --- |
| Time | Milliseconds, beat positions, attack grouping, continuation, gaps, and restarts | Does a subdivision change continue a path, emphasize a landing, or change the connection between actions? |
| Action | Which fingers enter, remain occupied, release, and rejoin; which events form an attack group | With the same attacks, do different LN tails change which columns remain occupied at the next action? |
| Organization | The role of local components in cells, phrases, foreground/background, and larger development | Is a trill the subject, a closing gesture, or an incidental crop? How do familiar components connect across the whole passage? |

These views constrain each other. A geometry count followed by a decorative
“timing” or “feel” explanation is insufficient. Follow the relationship that
actually distinguishes the current cases instead of filling a fixed checklist.

Human tap-like descriptions can inform an action hypothesis while the source
retains every LN head and tail. An attack group is not necessarily one hit object,
and grouping does not merge original timestamps. A play strategy that exploits
judgment-window tolerance is a separate execution hypothesis; it does not silently
change an exact source-action description.

## Counterexamples constrain explanations

An explanation of one known positive is weak if it also explains a known negative.
Use that conflict to revise the relationship, narrow its scope, or state what
remains unresolved. Times below are source milliseconds.

| Simplification challenged | Scoped human observations in the study | What the comparison supports |
| --- | --- | --- |
| LN coordination: short duration or real overlap determines the label | Who? 97595–98913 absent; Your Soulmate 1404510–1405260 supporting; End Time 21425–22592 prominent | Compare attack grouping, roles retained into later actions, and release order; there is no established universal duration cutoff. |
| LN coordination: short notes under a long anchor imply independent holding | Materialize Anything 48104–48904 absent; finorza 12135–14268 supporting | Distinguish one long background with short attacks from another independently continuing hold role. |
| LN coordination: holding must continually introduce new LN heads | Highscore 153281–153554 absent; Eviternity 50137–53977 supporting; Nibelungen 179933–182600 supporting | Initial groups and later release-only passages still require a complete role comparison; “no new heads means absent” fails. |
| LN coordination: slow, sparse, or regular passages can only be weak | Go Beyond!! 32420–34820 absent; Overkill 32522–34937 prominent; A Fool Moon Night 167706–169445 prominent | Strength is not event rate. Explain decomposition, redistribution, foreground/background, and the whole section's expression. |
| Every full attack row must always equal one of two fixed groups | Tear Rain 112953–113968 prominent Trill; Senbonzakura 63932–65304 absent Trill | A persistent core can coexist with background holds, but extra events must be explained rather than deleted to manufacture regularity. |
| Multiple subdivisions, turns, or LN role changes establish Tech | Kanjou no Matenrou 389914–392610 absent; Pentiment 97007–98360 absent; OOPARTS 210998–212708 supporting | Explain how changes affect connections between actions. A list of changes does not establish style. |
| Familiar components limit a whole passage's strength | Hysteric Night Girl 245000–255000 prominent; Arche 240000–250000 prominent; local Jack/Stream negatives | The judged scope determines a component's role. A whole-passage positive does not transfer to every crop. |

These case descriptions summarize comparisons rather than supplying complete
source evidence. Exact judgments and optional human comments retain their own
records. Where a human supplied no explanation, the explanation remains the
agent's hypothesis; an old machine rationale cannot stand in for expert reasoning.

The Kanjou / Search And Destroy comparison forced one concrete revision. The
negative Kanjou case also contains “half-beat wait → three sixth-beat steps →
chord,” so a post-pause burst landing cannot explain the positive/negative boundary.
A natural variant also preserves a similar turning path with regular timing.
A narrower candidate is unequal internal timing recurring across different column
paths in Search. That identifies a more specific family, but still does not prove
that it explains the human boundary.

## Natural variants test transfer

State which relationship an explanation predicts will remain before inspecting
variants. Follow the next phrase, another difficulty in the same set, or another
community-tagged chart. This exploration does not require assigning new section labels.

- **SYSTEM ERROR:** EXTREME, EXTRA, and HYPER retain a roughly 300 ms larger rhythm
  while changing from staggered releases followed by a chord, to a jointly released
  pair and chord, to LN+tap followed by two singles. Difficulty changes include
  changes in action organization.
- **Tententengoku:** within an approximately 107 ms skeleton, later holds sometimes
  outlive background tails and sometimes release with them. One family admits
  different ending contours.
- **BIKE:** short-LN clusters repeat attack grouping and audio-energy regions while
  changing internal tail length and order. Preserve both attack grouping and release
  contour; equal versus unequal lengths alone do not decide the action interpretation.
- **deathpiano:** a denser later passage develops more continuous quarter-beat flow.
  Higher density does not supply a stronger local Tech label.
- **Blue Zenith / Synthesis:** fixed-group alternation can include deliberate long
  waits, and connections between local cells can have an organizational role.
  Unequal spacing is not always interruption; removing a connection cannot justify
  claiming a longer continuous trill.

Repeated material helps discover variants but is not independent accuracy evidence.
Some boundaries remain unresolved, including Kanjou versus Search And Destroy and
Symphony of the Night versus Airborne Robots. Preserve the actual unresolved
relationship instead of replacing it with a generic request for more examples.

## Human words, source facts, and audio

A judgment, original comment, source fact, and interpretation are different evidence.
Brief human descriptions may describe the dominant organization: Touhou Last Boss
Rush's “all LN” comment has an entry tap; Who?'s nearly equal short LNs include a
78 ms exception. Retain both the description and the source. A literal exception
does not by itself invalidate the scoped human judgment.

A factual conflict should remain explicit. The Tech-absent comment for Machinegun
225000–235000 attributes gap changes to a redline, but the source review context
223000–237000 contains no tempo change. The study retained the judgment while
leaving that causal explanation unresolved. An imagined audio-speed change cannot
repair a contradicted timing-point claim.

Source-aligned Mel views provide energy, spectrum, and development evidence. They
can show continuing music during an action gap and help compare clusters with
phrases. The current frontend has 40 ms frame support and a 10 ms hop; that hop
is not 10 ms onset precision. Audio and action boundaries need not correspond
one-to-one. A spectrum alone does not establish mapper intent or finger independence.

## What an iteration must establish

Check source accuracy first, then whether the explanation accommodates known
positive/negative and strength contrasts, then whether it transfers to another
natural organization. A complete study index establishes coverage of that study,
not mastery. Replaying known human examples is calibration, not held-out accuracy.
The [regression gate](../../annotation/evaluation/README.md) checks candidate updates
against previous cases; reasoning still needs evidence review.

These findings also suggest questions for Pulsefield's history representation:
with the same next action, what changes when prior holding, alternation, adjacent
repetition, or a gap differs? Does a gap remain LN-occupied? Does a released column
become free while others remain held? The observations motivate these questions
but do not provide calibrated demand values or response labels. A whole-chart
reader can use later context to explain structure; a generation-time history
representation must only consume the already committed prefix.
