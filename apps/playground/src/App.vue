<script setup lang="ts">
import {
  type ManiaChart,
  type ManiaNote,
  parseOsu,
  renderSvg,
  toManiaChart,
} from "beatmap-lens";
import type { CSSProperties } from "vue";
import { nextTick, onMounted, ref } from "vue";
import { chartRenderRange } from "./chart-range";

type Fact = {
  label: string;
  value: string;
};

type HealthTone = "ready" | "warn" | "idle" | "error";

type StatusItem = {
  label: string;
  value: string;
  tone: "ready" | "warn" | "error" | "muted";
  detail?: string;
};

type LaneNote = {
  id: string;
  kind: ManiaNote["kind"];
  style: CSSProperties;
  title: string;
};

type Lane = {
  column: number;
  label: string;
  notes: LaneNote[];
};

const sampleMap = `osu file format v14

[General]
AudioFilename: silent-bench.wav
Mode: 3

[Metadata]
Title: Night Switchback
Artist: beatmap-lens
Creator: playground
Version: Original 4K smoke

[Difficulty]
HPDrainRate:6
CircleSize:4
OverallDifficulty:8
ApproachRate:5

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
64,192,250,1,0,0:0:0:0:
192,192,500,1,0,0:0:0:0:
320,192,750,128,0,1125:0:0:0:0:
448,192,1000,1,0,0:0:0:0:
192,192,1375,1,0,0:0:0:0:
64,192,1625,128,0,2050:0:0:0:0:
320,192,1875,1,0,0:0:0:0:
448,192,2250,1,0,0:0:0:0:
64,192,2500,1,0,0:0:0:0:
320,192,2750,128,0,3250:0:0:0:0:
192,192,3375,1,0,0:0:0:0:
448,192,3625,1,0,0:0:0:0:
64,192,3875,1,0,0:0:0:0:
192,192,4125,128,0,4625:0:0:0:0:
320,192,4750,1,0,0:0:0:0:
448,192,5000,1,0,0:0:0:0:
64,192,5250,1,0,0:0:0:0:
320,192,5500,1,0,0:0:0:0:
192,192,5750,1,0,0:0:0:0:
448,192,6000,128,0,6575:0:0:0:0:`;

const source = ref(sampleMap);
const sourceInput = ref<HTMLTextAreaElement | null>(null);
const svgOutput = ref<HTMLDivElement | null>(null);
const runId = ref("run 00");
const healthText = ref("Idle");
const healthTone = ref<HealthTone>("idle");
const facts = ref<Fact[]>([]);
const statuses = ref<StatusItem[]>([]);
const lanes = ref<Lane[]>([]);
const renderTime = ref("0.0 ms");
const rangeMetric = ref("0 ms");
let runCount = 0;

onMounted(runPipeline);

function runPipeline(): void {
  runCount += 1;
  runId.value = `run ${String(runCount).padStart(2, "0")}`;
  setHealth("Running", "idle");

  try {
    const parseStartedAt = performance.now();
    const document = parseOsu(source.value);
    const parseDuration = performance.now() - parseStartedAt;

    const normalizeStartedAt = performance.now();
    const chart = toManiaChart(document);
    const normalizeDuration = performance.now() - normalizeStartedAt;
    const renderRange = chartRenderRange(chart);

    const renderStartedAt = performance.now();
    const svg = renderSvg(chart, {
      startTime: renderRange.startTime,
      endTime: renderRange.endTime,
      width: 640,
      pixelsPerSecond: 45,
    });
    const renderDuration = performance.now() - renderStartedAt;

    mountSvg(svg);
    renderLanePreview(chart.notes);
    facts.value = chartFacts(chart);
    statuses.value = statusItems(
      chart,
      document.hitObjects.length,
      parseDuration,
      normalizeDuration,
      renderDuration,
    );
    renderTime.value = `${renderDuration.toFixed(1)} ms`;
    setHealth(
      chart.diagnostics.length > 0 ? "Warnings" : "Ready",
      chart.diagnostics.length > 0 ? "warn" : "ready",
    );
  } catch (error) {
    const message = formatError(error);
    renderSvgError(message);
    facts.value = [{ label: "Pipeline error", value: message }];
    renderLanePreview([]);
    statuses.value = [{ label: "pipeline", value: message, tone: "error" }];
    renderTime.value = "0.0 ms";
    setHealth("Error", "error");
  }
}

async function resetSource(): Promise<void> {
  source.value = sampleMap;
  runPipeline();
  await nextTick();
  sourceInput.value?.focus();
}

function handleSourceKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runPipeline();
  }
}

function chartFacts(chart: ManiaChart): Fact[] {
  return [
    { label: "Title", value: chart.metadata.title ?? "Untitled" },
    { label: "Version", value: chart.metadata.version ?? "Unknown" },
    { label: "Notes", value: String(chart.notes.length) },
    {
      label: "Long notes",
      value: String(chart.notes.filter((note) => note.kind === "long").length),
    },
    { label: "Lanes", value: String(chart.keyCount) },
    { label: "Diagnostics", value: String(chart.diagnostics.length) },
  ];
}

function statusItems(
  chart: ManiaChart,
  sourceObjectCount: number,
  parseDuration: number,
  normalizeDuration: number,
  renderDuration: number,
): StatusItem[] {
  const items: StatusItem[] = [
    { label: "parseOsu", value: `${parseDuration.toFixed(1)} ms`, tone: "ready" },
    {
      label: "toManiaChart",
      value: `${normalizeDuration.toFixed(1)} ms`,
      tone: chart.notes.length === sourceObjectCount ? "ready" : "warn",
      detail: `${chart.notes.length} normalized objects from ${sourceObjectCount} source rows`,
    },
    { label: "renderSvg", value: `${renderDuration.toFixed(1)} ms`, tone: "ready" },
  ];

  const firstDiagnostic = chart.diagnostics[0];
  if (!firstDiagnostic) {
    items.push({ label: "diagnostics", value: "none", tone: "muted" });
  } else {
    items.push({
      label: firstDiagnostic.code,
      value: chart.diagnostics.length === 1 ? "1 warning" : `${chart.diagnostics.length} warnings`,
      tone: firstDiagnostic.severity === "error" ? "error" : "warn",
      detail: firstDiagnostic.message,
    });
  }

  return items;
}

function mountSvg(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.querySelector("svg");
  if (!svg || parsed.querySelector("parsererror")) {
    throw new Error("renderSvg returned invalid SVG markup.");
  }

  const imported = document.importNode(svg, true);
  imported.classList.add("rendered-svg");
  getSvgOutput().replaceChildren(imported);
}

function renderSvgError(message: string): void {
  const element = document.createElement("div");
  element.className = "empty-state empty-state--error";
  element.textContent = message;
  getSvgOutput().replaceChildren(element);
}

function renderLanePreview(notes: readonly ManiaNote[]): void {
  const range = noteRange(notes);
  rangeMetric.value = `${Math.round(range.endTime - range.startTime).toLocaleString()} ms`;
  lanes.value = Array.from({ length: 4 }, (_, column): Lane => {
    const laneNotes = notes
      .filter((note) => note.column === column)
      .map((note): LaneNote => {
        const top = ((note.startTime - range.startTime) / range.duration) * 92 + 4;
        const height = Math.max(
          ((note.endTime - note.startTime) / range.duration) * 92,
          note.kind === "long" ? 5.5 : 2.2,
        );
        return {
          id: note.id,
          kind: note.kind,
          style: {
            top: `${top}%`,
            height: `${height}%`,
          },
          title: `${Math.round(note.startTime)} ms`,
        };
      });

    return {
      column,
      label: `K${column + 1}`,
      notes: laneNotes,
    };
  });
}

function noteRange(notes: readonly ManiaNote[]): {
  startTime: number;
  endTime: number;
  duration: number;
} {
  if (notes.length === 0) {
    return { startTime: 0, endTime: 1, duration: 1 };
  }

  const startTime = Math.min(...notes.map((note) => note.startTime));
  const endTime = Math.max(...notes.map((note) => note.endTime));
  return {
    startTime,
    endTime,
    duration: Math.max(endTime - startTime, 1),
  };
}

function getSvgOutput(): HTMLDivElement {
  if (!svgOutput.value) {
    throw new Error("Missing SVG output mount point.");
  }
  return svgOutput.value;
}

function setHealth(text: string, tone: HealthTone): void {
  healthText.value = text;
  healthTone.value = tone;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
</script>

<template>
  <main id="main-content" class="bench" tabindex="-1">
    <header class="bench-header">
      <div class="title-block">
        <p class="eyebrow">beatmap-lens playground</p>
        <h1>Mania inspection bench</h1>
      </div>
      <div class="run-stack">
        <span class="health-pill" :class="`health-pill--${healthTone}`">{{ healthText }}</span>
        <span class="run-id">{{ runId }}</span>
      </div>
    </header>

    <div class="workspace">
      <section class="source-pane" aria-labelledby="source-heading">
        <div class="pane-head">
          <div>
            <h2 id="source-heading">osu! source</h2>
            <p>Original 4K sample</p>
          </div>
          <div class="editor-actions">
            <button class="button button--quiet" type="button" @click="resetSource">Reset</button>
            <button
              class="button button--primary"
              type="button"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              @click="runPipeline"
            >
              Run
            </button>
          </div>
        </div>
        <label class="sr-only" for="source-input">osu! beatmap source</label>
        <textarea
          id="source-input"
          ref="sourceInput"
          v-model="source"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          @keydown="handleSourceKeydown"
        ></textarea>
      </section>

      <section class="output-pane" aria-label="Rendered output and facts">
        <div class="preview-grid">
          <section class="svg-surface" aria-labelledby="preview-heading">
            <div class="surface-head">
              <h2 id="preview-heading">renderSvg output</h2>
              <span class="metric">{{ renderTime }}</span>
            </div>
            <div
              ref="svgOutput"
              class="svg-output"
              role="img"
              aria-label="SVG preview"
            ></div>
          </section>

          <aside class="facts-pane" aria-labelledby="facts-heading">
            <div class="surface-head">
              <h2 id="facts-heading">Chart facts</h2>
            </div>
            <dl class="facts-list">
              <div v-for="fact in facts" :key="fact.label" class="fact-item">
                <dt>{{ fact.label }}</dt>
                <dd>{{ fact.value }}</dd>
              </div>
            </dl>
          </aside>
        </div>

        <section class="lane-surface" aria-labelledby="lane-heading">
          <div class="surface-head">
            <h2 id="lane-heading">Four-lane timing</h2>
            <span class="metric">{{ rangeMetric }}</span>
          </div>
          <div class="lane-preview">
            <div
              v-for="lane in lanes"
              :key="lane.column"
              class="lane"
            >
              <span class="sr-only">Lane {{ lane.column + 1 }}</span>
              <span class="lane-label">{{ lane.label }}</span>
              <span
                v-for="note in lane.notes"
                :key="note.id"
                class="note"
                :class="{ 'note--hold': note.kind === 'long' }"
                :style="note.style"
                :title="note.title"
              ></span>
            </div>
          </div>
        </section>
      </section>
    </div>

    <section class="diagnostic-strip" aria-labelledby="diagnostic-heading">
      <h2 id="diagnostic-heading" class="sr-only">Diagnostics</h2>
      <div class="diagnostic-items">
        <div
          v-for="(item, index) in statuses"
          :key="`${item.label}-${index}`"
          class="diagnostic"
          :class="`diagnostic--${item.tone}`"
          :title="item.detail"
        >
          <span class="diagnostic-label">{{ item.label }}</span>
          <span class="diagnostic-value">{{ item.value }}</span>
        </div>
      </div>
    </section>
  </main>
</template>
