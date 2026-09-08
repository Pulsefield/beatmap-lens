# Learning to read natural beatmaps

Use complete natural charts to learn organization and its variants. Community
difficulty tags and confirmed expert section judgments supply human experience.
Agent-only section predictions and agreeing machine audits are excluded from the
learning evidence. Existing annotation packets remain historical workflow records;
the learning path does not submit claims or count completed section labels.

The [judgment skill](../../.agents/skills/mania-pattern-judgment/SKILL.md) defines three
concurrent views: time, action, and organization. Interpret the same arrangement
across individual actions, groups, recurring cells, passages, and whole-chart
development. Local burst, trill, stream, or jump descriptions can coexist with a
larger technical construction. Inspect what each contributes to that construction.
Keep source milliseconds and beat relationships, full attack groups, LN endpoints,
and entering holds together. Action interpretations are hypotheses calibrated by
human examples, not measured motor experience or gameplay-demand values.

The [reading framework](../research/beatmap-reading-framework.md) develops these views through
positive/negative contrasts, natural variants, and remaining explanatory boundaries.

## Evidence roles

| Material | Learning role | Scope and authority |
| --- | --- | --- |
| Natural `.osu` sources | Observe rhythm, actions, repetition, variation, and development | Exact source bytes and full chart context; no label is required |
| Other difficulties in a beatmapset | Explore existing arrangements of the same work | Each difficulty has its own source identity; shared audio does not imply identical timing or organization |
| Community tags and votes | Guide whole-chart exploration and family discovery | Difficulty-level observations with metadata snapshot and byte-match information; missing tags are unobserved |
| Confirmed expert sections | Calibrate local meanings, scope, and expression strength | Exact final human assessment and optional human comment |
| Source-aligned Mel views | Inspect audio energy, transients, and spectral development alongside chart actions | Audio bytes, frontend configuration, source clock, and window support are recorded; interpretations remain hypotheses |
| Saved agent reading | Retrieve an earlier interpretation and reopen its source | Revisable hypothesis; never a new human example or section training target |

A community tag can direct attention to parts of a chart, but does not label every
section. A local expert negative can coexist with a whole-difficulty community
positive. Confirming a label does not confirm an agent's explanation of it.

## Prepare a learning corpus

The CLI uses the existing annotation runtime and canonical Lens parser. It reads
the dataset without modifying it. Select actual beatmapsets to include all their
4K difficulties. An optional annotation-mode human bundle contributes its natural
chart sources and confirmed examples. Machine proposals, audits, and disposition
histories do not enter the human-example library.

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py prepare \
  --dataset ../Pulsefield-model/dataset \
  --beatmapset 1986822 \
  --out .local/beatmap-learning/corpus
```

Add `--human-bundle PATH` when using a prepared annotation-mode human bundle.
Repeat `--beatmapset` to add sets. Preparation requires a fresh output directory and hashes the source and
metadata snapshots. The manifest records tool provenance; runtime code is the
current checkout. Human bundles with evaluation exclusions cannot be repurposed
to expose their hidden examples.

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py catalog \
  --bundle .local/beatmap-learning/corpus --text 'SYSTEM ERROR'
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py catalog \
  --bundle .local/beatmap-learning/corpus --community-tag tech
```

Catalog cards return `chart:<sha>` handles, readable chart identity, and community
observations. Follow the returned pagination. `context` opens the full-chart
overview, timing, sibling handles, scoped human observations, and available audio
reference. Audio availability is not evidence that an agent listened. An imported
human source can remain inspectable from its frozen normalized chart when its
original file or audio is unavailable; availability is reported separately.

## Study a real arrangement

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py context \
  --bundle .local/beatmap-learning/corpus --handle chart:SOURCE_SHA
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py inspect \
  --bundle .local/beatmap-learning/corpus --handle chart:SOURCE_SHA \
  --start-ms 170400 --end-ms 174300 --view actions
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py render \
  --bundle .local/beatmap-learning/corpus --handle chart:SOURCE_SHA \
  --start-ms 170400 --end-ms 174300 --view time --out .local/reading.png
```

Choose a source handle from the catalog and a range inside that chart. The example
times above are source milliseconds, not a shared crop for every difficulty.
`inspect` supports `rows`, `actions`, and `articulation`, with complete entering
holds and pagination. `context` also pages tempo/SV changes. `render --view time`
preserves elapsed spacing; `rows` compresses spacing to inspect arrangement.
`perspective` offers structural summaries; their selected examples do not replace
complete local inspection.

Retrieve human experience when it helps interpret the observed organization:

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py examples \
  --bundle .local/beatmap-learning/corpus --tag tech --text 'SYSTEM ERROR'
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py example \
  --bundle .local/beatmap-learning/corpus --id HUMAN_EXAMPLE_ID
```

The resulting `example:<id>` handle works with the same source tools. Search is
literal and bounded, not semantic similarity ranking. Open the relevant chart
relationships instead of borrowing a label from a superficially similar example.

Learning can move between a complete chart, one developing passage, repeated
groups, and individual actions. Revisit the larger passage after inspecting a
detail. Follow real variants in the same chart, sibling difficulties, and other
works. No synthetic edit, new expert annotation, fixed curriculum size, or
five-dimension prediction is required for a reading study.

## Read audio through Pulsefield Mel views

The `audio` command uses the neighboring Pulsefield checkout's existing Python
runtime and calls its actual `load_audio_file` and `compute_log_mel_10ms` with
`MUSIC_MEL_CACHE_CONFIG`: mono 24 kHz, 128 Mel bins, 10 ms hop, 40 ms Hann window,
20–12,000 Hz, natural-log power with a `1e-5` floor. It uses the general-music
frontend selected in Pulsefield, not the legacy 16 kHz frontend or the separate
MIR teacher experiment. This reuses a feature extractor without adopting a V3
architecture or changing Pulsefield's caches.

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py audio \
  --bundle .local/beatmap-learning/corpus --handle chart:SOURCE_SHA \
  --start-ms 168400 --end-ms 174400 --out .local/audio-reading
```

Use `--pulsefield-root PATH` or `PULSEFIELD_ROOT` for a different checkout, and
`PULSEFIELD_PYTHON` for its audio runtime. That runtime must provide Pulsefield's
audio dependencies; see [configuration](corpus-annotation.md#local-inputs-and-runtime). The output directory must be
fresh. Open the returned `imagePath` to inspect the Mel spectrum and four-lane
attack/hold/release panel on the same absolute source-time axis. The command also
retains numerical frames in `features.npz` and provenance in `evidence.json`.

Extraction decodes and peak-normalizes the complete audio before selecting frames.
It preserves the original 10 ms grid and full window context, including the
frontend's right padding only at the audio end. With `center=False`, frame `i`
uses `[10i, 10i + 40)` ms and is displayed at `10i + 20` ms. The 10 ms hop is not
10 ms onset precision. Chart milliseconds map to audio-file time zero;
`AudioLeadIn` is not a chart-to-audio offset. Source events keep their exact times.

Use the view to inspect which spectral changes coincide with attacks, releases,
pauses, or phrase development. A chart gap can contain continuing audio. The view
does not identify instruments, mapper intent, or technical style by itself. Record
which views were actually inspected; rendering a file alone is not observation.
An `audioEvidence` reference records Mel inspection rather than literal listening.

## Retain and revise experience

Write a small JSON reading with these fields:

| Field | Content |
| --- | --- |
| `id`, `title` | Stable lowercase ID and a recognizable organization description |
| `time`, `action`, `organization` | Concise parallel interpretations of the same observed arrangement |
| `instances` | Source SHA, half-open `scope`, optional containing `reviewContext`, and witness `sourceLines` for each real instance |
| `humanAnchors` | Exact retrieved human example IDs; may be empty |
| `communityAnchors` | `{sourceSha256, tagId}` references to existing difficulty observations; may be empty |
| `audioEvidence` | Paths to viewed `audio` command `evidence.json` artifacts; optional |
| `limitations` | What remains unexplained or unobserved, and the interpretation's scope |
| `updateReason` | What new source inspection changed; required for a later revision of the same ID |

Each instance concerns its complete arrangement; witness lines explain the reading
without turning it into a cleaned note sequence. The writer resolves full source
notes and exact human/community evidence from the corpus itself. It does not
accept a supplied human verdict or predicted-label field. Audio references are
checked against the corpus, source audio bytes, and generated artifact hashes;
their scopes must overlap an inspected source context. They remain distinct from
human judgments and do not change a reading's hypothesis status.

```sh
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py remember \
  --bundle .local/beatmap-learning/corpus --memory .local/beatmap-learning/experience \
  --input .local/reading.json --producer ACTUAL_AGENT_ID
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py recall \
  --memory .local/beatmap-learning/experience --text 'release'
.local/annotation-venv/bin/python annotation/learning/beatmap-learning.py recall \
  --memory .local/beatmap-learning/experience --id EXPERIENCE_ID
```

Use one coordinating writer for a shared memory. Every revision is a new file,
linked to the previous content hash and corpus snapshot. Recall returns the latest
matching readings, or the complete history for an ID. Every record stays an
`agent-hypothesis`; another agent agreeing with it does not change that status.

Human labels remain fixed while interpretations change. Evaluate a proposed
experience by reopening its sources, checking it against the actual human
judgments, and applying it to other natural arrangements. Learning on existing
gold is permitted and useful; replaying that gold is not held-out accuracy. Code
checks establish source binding, evidence separation, and revision behavior.
Independent reading trials establish whether the workflow is usable and whether
its explanations are supported; they do not establish human-level gameplay skill.
