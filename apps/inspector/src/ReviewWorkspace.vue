<script setup lang="ts">
import { parseBeatmap, renderSvgPages } from "beatmap-lens";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import AnnotationTimeline from "./AnnotationTimeline.vue";
import { BufferedSceneController, projectSceneRange } from "./annotation/buffered-scene";
import { serializeCanonicalJson } from "./annotation/canonical-json";
import type { StableNoteRefV1, TimeRangeV1 } from "./annotation/contracts";
import { pickDatasetDirectory } from "./annotation/file-system-access";
import { chartEndMs } from "./annotation/range";
import { type InspectedOsuSourceV1, inspectOsuSourceV1 } from "./annotation/source-identity";
import { createStableNoteRefV1, stableNoteRefKey } from "./annotation/stable-note-ref";
import type { AgentReviewV2, ClaimV2, CommunityAlignmentV2, FoundationTagV2, FoundationV2, HumanDecisionV2, ReviewBaseV2, TaskPacketV2 } from "./annotation/workflow/contracts";
import { type StoredReviewV2, WorkflowDirectoryV2 } from "./annotation/workflow/directory";
import { assertTaskPacketV2, handoffBaseStatusV2, readAgentReviewsV2, readDispositionsV2, sameBase } from "./annotation/workflow/domain";
import { createExperimentalFoundationV2 } from "./annotation/workflow/experimental-campaign";
import { createRemoteReviewStore, type RemoteSourceV2, type ReviewStoreV2 } from "./annotation/workflow/remote-workspace";
import FallingNoteViewport from "./FallingNoteViewport.vue";
import WorkflowClaimEditor from "./WorkflowClaimEditor.vue";
import WorkspaceModeSwitch from "./WorkspaceModeSwitch.vue";
import type { WorkspaceMode } from "./workspace-mode";

const props = defineProps<{ remoteSource?: RemoteSourceV2; openClaim?: { handoffId: string; claimId: string } }>();
const emit = defineEmits<{ "change-mode": [mode: WorkspaceMode]; "back-to-inbox": []; saved: [] }>();
const source = shallowRef<InspectedOsuSourceV1>();
const sourceBytes = shallowRef<Uint8Array>();
const files = shallowRef<readonly File[]>([]);
const selectedFile = ref(0);
const directory = shallowRef<ReviewStoreV2>();
const directoryName = ref("");
const stored = shallowRef<StoredReviewV2>();
const pendingTask = shallowRef<TaskPacketV2>();
const proposalEditing = ref(false);
const foundation = shallowRef<FoundationV2>(createExperimentalFoundationV2(new Date().toISOString()));
const humanId = ref(localStorage.getItem("beatmap-lens-review-human") ?? "");
const status = ref("Open a difficulty or a frozen task to begin.");
const error = ref("");
const busy = ref(false);
const sourceLoading = ref(false);
let pendingOpenClaim = false;
const mobilePanel = ref("preview");
const playhead = ref(0);
const speed = ref(240);
const size = ref({ width: 640, height: 900 });
const timelineRange = ref<TimeRangeV1>({ startMs: 0, endMs: 1000 });
const drafts = ref<readonly ClaimV2[]>([]);
const activeClaimId = ref("");
const editorOrigin = ref<"direct" | "proposal" | "observation" | "calibration">("direct");
const activeHandoffId = ref("");
const decisionNote = ref("");
const evidenceMode = ref<"noteRefs" | "contextNoteRefs">("noteRefs");
const selectionAnchor = ref<number>();
const gestureClaim = shallowRef<ClaimV2>();
const gestureEdge = ref("select");
const notePage = ref(0);
const restoring = ref(false);
const editorBase = shallowRef<ReviewBaseV2>();
const editorReviewRevision = ref<number>();
const handoffStatuses = ref<Record<string, string>>({});
const agentReviews = shallowRef<readonly AgentReviewV2[]>([]);
const expertLimit = ref(5);
const calibrationId = ref("");
const document = computed(() => stored.value?.document);
const activeFoundation = computed(() => document.value?.foundation ?? foundation.value);
const activeClaim = computed(() => drafts.value.find(claim => claim.id === activeClaimId.value));
const expertQueue = computed(() => agentReviews.value.filter(review => review.status === "needs-expert"));
const activeReview = computed(() => agentReviews.value.find(review => review.handoffId === activeHandoffId.value && review.claimId === activeClaimId.value));
const routineCount = computed(() => agentReviews.value.filter(review => review.status === "agent-reviewed").length);
const agentActionCount = computed(() => agentReviews.value.filter(review => ["awaiting-audit", "needs-revision", "stale"].includes(review.status)).length);
const endMs = computed(() => source.value ? chartEndMs(source.value.chart) : 1000);
const controller = computed(() => source.value ? new BufferedSceneController(source.value.chart, {
  viewportHeight: size.value.height, width: size.value.width, pixelsPerSecond: speed.value,
}) : undefined);
const frame = computed(() => controller.value?.frame(playhead.value));
const selectedNotes = computed(() => new Set((activeClaim.value?.evidence.noteRefs ?? []).concat(activeClaim.value?.evidence.contextNoteRefs ?? []).map(stableNoteRefKey)));
const selectedNoteIds = computed(() => new Set(source.value?.chart.notes.filter(note => selectedNotes.value.has(stableNoteRefKey(createStableNoteRefV1(note)))).map(note => note.id) ?? []));
const candidateNotes = computed(() => source.value?.chart.notes.filter(note => {
  const range = activeClaim.value?.reviewContext ?? frame.value?.viewportRange;
  return range && note.startMs < range.endMs && (note.kind === "long" ? note.endMs > range.startMs : note.startMs >= range.startMs);
}) ?? []);
const candidateIds = computed(() => new Set(candidateNotes.value.map(note => note.id)));
const visibleNotes = computed(() => candidateNotes.value.slice(notePage.value * 80, (notePage.value + 1) * 80));
const selectionBand = computed(() => {
  if (!activeClaim.value || !frame.value) return undefined;
  const band = projectSceneRange(frame.value.scene.projection, activeClaim.value.scope);
  return band ? { ...band, x: 0, width: size.value.width } : undefined;
});
const canEdit = computed(() => !busy.value && !sourceLoading.value && (editorOrigin.value === "direct" || editorOrigin.value === "proposal"));
const approved = computed(() => activeFoundation.value.approval.status === "human-approved");
const decisionsForClaim = computed(() => document.value?.decisions.filter(decision => decision.handoffId === activeHandoffId.value && decision.claimId === activeClaimId.value) ?? []);
const draftIsStale = computed(() => editorReviewRevision.value === undefined
  ? Boolean(editorBase.value && stored.value && !sameBase(editorBase.value, stored.value.version))
  : editorReviewRevision.value !== document.value?.reviewRevision);
const calibrationExample = computed(() => activeFoundation.value.calibrationExamples.find(example => example.id === calibrationId.value));
const calibrationPages = computed(() => {
  const example = calibrationExample.value;
  if (!example) return [];
  const chart = parseBeatmap(new TextDecoder().decode(Uint8Array.from(example.sourceBytes))).chart;
  return renderSvgPages(chart, { range: example.claim.reviewContext, page: { size: { widthPx: 1200, heightPx: 900 }, columns: "auto" }, panel: { playfield: { laneWidthPx: 48 }, maxNoteRows: 32 }, scale: { type: "row-aware" } });
});

function draftKey(kind = editorOrigin.value === "proposal" ? `proposal:${activeHandoffId.value}:${activeClaimId.value}` : "direct"): string {
  return `beatmap-lens-review-draft:${source.value?.source.sha256}:${stored.value?.document.documentId ?? "unbound"}:${activeFoundation.value.foundationId}:${activeFoundation.value.revision}:${kind}`;
}

function stashDraft(): void {
  if (restoring.value || !source.value || !drafts.value.length || !["direct", "proposal"].includes(editorOrigin.value)) return;
  localStorage.setItem(draftKey(), serializeCanonicalJson({
    drafts: drafts.value, activeClaimId: activeClaimId.value, editorOrigin: editorOrigin.value,
    activeHandoffId: activeHandoffId.value, decisionNote: decisionNote.value, base: editorBase.value, reviewRevision: editorReviewRevision.value, proposalEditing: proposalEditing.value,
  }));
}

function restoreSection(): void {
  stashDraft();
  const text = localStorage.getItem(draftKey("direct"));
  if (!text) { newSection(); return; }
  const saved = JSON.parse(text);
  drafts.value = saved.drafts;
  activeClaimId.value = saved.activeClaimId;
  editorOrigin.value = "direct";
  activeHandoffId.value = "";
  decisionNote.value = saved.decisionNote;
  editorBase.value = saved.base;
  editorReviewRevision.value = saved.reviewRevision;
}

watch(() => props.remoteSource, async (remote, _previous, onCleanup) => {
  if (!remote) return;
  let superseded = false;
  onCleanup(() => { superseded = true; });
  if (source.value?.source.sha256 !== remote.document.source.sha256) {
    stashDraft();
    sourceLoading.value = true;
    try {
      const bytes = Uint8Array.from(remote.sourceBytes);
      const inspected = await inspectOsuSourceV1(bytes);
      if (superseded) return;
      restoring.value = true;
      directory.value = createRemoteReviewStore(remote.document.source.sha256);
      directoryName.value = "Connected inbox";
      sourceBytes.value = bytes;
      source.value = inspected;
      foundation.value = remote.document.foundation;
      if (!humanId.value && remote.document.foundation.approval.status === "human-approved") humanId.value = remote.document.foundation.approval.humanId;
      stored.value = { document: remote.document, version: remote.version };
      pendingTask.value = undefined;
      calibrationId.value = "";
      timelineRange.value = { startMs: 0, endMs: chartEndMs(inspected.chart) };
      playhead.value = inspected.chart.notes[0]?.startMs ?? 0;
      restoreSection();
      openRequestedClaim();
      status.value = "Connected to review inbox. Decisions return to the agent automatically.";
    } catch (cause) {
      if (!superseded) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!superseded) { restoring.value = false; sourceLoading.value = false; }
    }
  } else {
    sourceLoading.value = false;
    if (!stored.value || remote.version.revision > stored.value.version.revision) stored.value = { document: remote.document, version: remote.version };
    if (pendingOpenClaim) openRequestedClaim();
  }
}, { immediate: true });
watch(() => props.openClaim, openRequestedClaim);

function openRequestedClaim(): void {
  const target = props.openClaim;
  if (!target) return;
  pendingOpenClaim = true;
  if (!document.value) return;
  const claim = document.value.handoffs.find(entry => entry.handoff.handoffId === target.handoffId)?.handoff.proposals.find(claim => claim.id === target.claimId);
  if (claim) { openProposal(target.handoffId, claim); pendingOpenClaim = false; }
}

watch(humanId, value => localStorage.setItem("beatmap-lens-review-human", value));
watch([drafts, activeClaimId, editorOrigin, activeHandoffId, decisionNote], stashDraft, { deep: true, flush: "post" });
watch(activeClaimId, () => { notePage.value = 0; });
watch(document, async current => {
  if (!current) { handoffStatuses.value = {}; agentReviews.value = []; return; }
  const [statuses, reviews] = await Promise.all([
    Promise.all(current.handoffs.map(async entry => [entry.handoff.handoffId, await handoffBaseStatusV2(current, entry.handoff.handoffId)])),
    readAgentReviewsV2(current),
  ]);
  if (document.value === current) { handoffStatuses.value = Object.fromEntries(statuses); agentReviews.value = reviews; }
});

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value || sourceLoading.value) return;
  busy.value = true;
  error.value = "";
  try { await action(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

async function initialize(): Promise<void> {
  if (!directory.value || !sourceBytes.value) return;
  stored.value = await directory.value.initialize(sourceBytes.value, { ...foundation.value, approval: { status: "proposed" } });
  if (pendingTask.value) {
    stored.value = await directory.value.registerTask(sourceBytes.value, stored.value.version, pendingTask.value);
    pendingTask.value = undefined;
  }
  status.value = `Saved workspace · revision ${stored.value.document.revision}`;
}

async function loadSource(bytes: Uint8Array, task?: TaskPacketV2): Promise<void> {
  const inspected = await inspectOsuSourceV1(bytes);
  stashDraft();
  restoring.value = true;
  drafts.value = [];
  activeClaimId.value = "";
  calibrationId.value = "";
  source.value = inspected;
  sourceBytes.value = bytes;
  stored.value = undefined;
  pendingTask.value = task;
  if (task) foundation.value = task.foundation;
  timelineRange.value = { startMs: 0, endMs: chartEndMs(inspected.chart) };
  playhead.value = inspected.chart.notes[0]?.startMs ?? 0;
  try {
    if (directory.value) await initialize();
    restoreSection();
  } finally { restoring.value = false; }
  status.value = stored.value ? `Reopened · ${document.value?.observations.length} observations · ${document.value?.decisions.length} decisions` : "Choose a workspace folder to save and exchange tasks.";
}

function openFiles(event: Event): void {
  const selected = Array.from((event.target as HTMLInputElement).files ?? []);
  void run(async () => {
    files.value = selected;
    selectedFile.value = 0;
    const file = selected[0];
    if (file) await loadSource(new Uint8Array(await file.arrayBuffer()));
  });
}

function changeDifficulty(): void {
  void run(async () => {
    const file = files.value[selectedFile.value];
    if (file) await loadSource(new Uint8Array(await file.arrayBuffer()));
  });
}

function chooseDirectory(): void {
  void run(async () => {
    const handle = await pickDatasetDirectory();
    stashDraft();
    restoring.value = true;
    directory.value = new WorkflowDirectoryV2(handle);
    directoryName.value = handle.name;
    stored.value = undefined;
    drafts.value = [];
    try { await initialize(); restoreSection(); }
    finally { restoring.value = false; }
  });
}

function importJson(event: Event, kind: "task" | "handoff" | "audit" | "foundation"): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void run(async () => {
    const value: unknown = JSON.parse(await file.text());
    if (kind === "task") {
      await assertTaskPacketV2(value);
      const task = value as TaskPacketV2;
      await loadSource(Uint8Array.from(task.sourceBytes), task);
    } else if (kind === "foundation") {
      if (!directory.value || !sourceBytes.value || !stored.value) throw new Error("Choose a source and workspace folder first.");
      stored.value = await directory.value.replaceProposedFoundation(sourceBytes.value, stored.value.version, value as FoundationV2);
      foundation.value = stored.value.document.foundation;
      status.value = "Calibration proposal loaded. Review definitions and every example before approving.";
      newSection();
    } else if (kind === "audit") {
      if (!directory.value || !sourceBytes.value || !stored.value) throw new Error("Choose a source and workspace folder first.");
      const result = await directory.value.importAudit(sourceBytes.value, stored.value.version, value);
      stored.value = result.stored;
      const reviews = await readAgentReviewsV2(result.stored.document);
      const expert = reviews.find(review => review.status === "needs-expert");
      status.value = `${result.status} independent audit · ${reviews.filter(review => review.status === "needs-expert").length} expert cases · ${reviews.filter(review => review.status === "agent-reviewed").length} agent-reviewed`;
      if (expert) openProposal(expert.handoffId, expert.claim);
    } else {
      if (!directory.value || !sourceBytes.value || !stored.value) throw new Error("Choose a source and workspace folder first.");
      const result = await directory.value.importHandoff(sourceBytes.value, stored.value.version, value);
      stored.value = result.stored;
      status.value = `${result.status} · task base ${result.baseStatus} · independent audit pending`;
      const id = (value as { handoffId: string }).handoffId;
      const handoff = result.stored.document.handoffs.find(entry => entry.handoff.handoffId === id)?.handoff;
      if (handoff?.proposals[0]) openProposal(handoff.handoffId, handoff.proposals[0]);
    }
  });
}

function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([serializeCanonicalJson(value)], { type: "application/json" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTask(): void {
  void run(async () => {
    if (!directory.value || !sourceBytes.value || !stored.value) return;
    const result = await directory.value.exportTask(sourceBytes.value, stored.value.version);
    stored.value = result.stored;
    download(`task-${result.task.taskId}.json`, result.task);
    status.value = "Frozen task exported with the full difficulty, exact source and Foundation.";
  });
}

function exportDecisions(): void {
  void run(async () => {
    if (!stored.value) return;
    const dispositions = await readDispositionsV2(stored.value.document);
    download(`dispositions-${stored.value.document.source.sha256.slice(0, 12)}.json`, dispositions);
    status.value = "Human dispositions and separate machine review states exported.";
  });
}

function approveFoundation(): void {
  void run(async () => {
    if (!directory.value || !sourceBytes.value || !stored.value) return;
    stored.value = await directory.value.approveFoundation(sourceBytes.value, stored.value.version, humanId.value);
    status.value = "Foundation and calibration examples approved by the named human.";
  });
}

function newSection(): void {
  const sectionId = crypto.randomUUID();
  const startMs = Math.max(0, Math.min(playhead.value, endMs.value - 1));
  const scope = { startMs, endMs: Math.min(endMs.value, startMs + 4000) };
  drafts.value = activeFoundation.value.tags.map(tag => ({
    id: crypto.randomUUID(), sectionId, tagId: tag.id, scope,
    reviewContext: { startMs: Math.max(0, scope.startMs - 2000), endMs: Math.min(endMs.value, scope.endMs + 1000) },
    assessment: { presence: "unreviewed" }, evidence: { noteRefs: [], contextNoteRefs: [], rationale: "" },
  }));
  activeClaimId.value = drafts.value[0]?.id ?? "";
  editorOrigin.value = "direct";
  activeHandoffId.value = "";
  decisionNote.value = "";
  editorBase.value = stored.value?.version;
  editorReviewRevision.value = document.value?.reviewRevision;
  calibrationId.value = "";
}

function updateClaim(claim: ClaimV2): void {
  drafts.value = drafts.value.map(current => current.id === claim.id ? claim : current);
}

function focus(range: TimeRangeV1): void {
  playhead.value = Math.max(0, Math.min(endMs.value, range.startMs));
  mobilePanel.value = "preview";
}

function openProposal(handoffId: string, claim: ClaimV2): void {
  stashDraft();
  const cached = localStorage.getItem(draftKey(`proposal:${handoffId}:${claim.id}`));
  const saved = cached ? JSON.parse(cached) : undefined;
  drafts.value = saved?.drafts ?? [JSON.parse(serializeCanonicalJson(claim))];
  activeClaimId.value = claim.id;
  activeHandoffId.value = handoffId;
  editorOrigin.value = "proposal";
  proposalEditing.value = saved?.proposalEditing ?? false;
  decisionNote.value = saved?.decisionNote ?? "";
  editorBase.value = saved?.base ?? stored.value?.version;
  editorReviewRevision.value = saved?.reviewRevision ?? document.value?.reviewRevision;
  calibrationId.value = "";
  focus(claim.reviewContext);
}

function openObservation(claim: ClaimV2): void {
  stashDraft();
  drafts.value = [claim];
  activeClaimId.value = claim.id;
  editorOrigin.value = "observation";
  activeHandoffId.value = "";
  calibrationId.value = "";
  focus(claim.reviewContext);
}

function toggleNote(noteId: string): void {
  if (!canEdit.value || !activeClaim.value) return;
  const note = source.value?.chart.notes.find(note => note.id === noteId);
  if (!note) return;
  const ref = createStableNoteRefV1(note);
  const key = evidenceMode.value;
  const refs = activeClaim.value.evidence[key];
  const next = refs.some(item => stableNoteRefKey(item) === stableNoteRefKey(ref))
    ? refs.filter(item => stableNoteRefKey(item) !== stableNoteRefKey(ref)) : [...refs, ref];
  updateClaim({ ...activeClaim.value, evidence: { ...activeClaim.value.evidence, [key]: next } });
}

function selectScopeNotes(): void {
  if (!source.value || !activeClaim.value) return;
  const range = activeClaim.value.scope;
  const noteRefs: StableNoteRefV1[] = source.value.chart.notes.filter(note => note.startMs < range.endMs && (note.kind === "long" ? note.endMs > range.startMs : note.startMs >= range.startMs)).map(createStableNoteRefV1);
  updateClaim({ ...activeClaim.value, evidence: { ...activeClaim.value.evidence, noteRefs } });
}

function beginRange(anchorMs: number, kind = "select"): void {
  selectionAnchor.value = anchorMs;
  gestureClaim.value = activeClaim.value;
  gestureEdge.value = kind;
}

function cancelRange(): void {
  if (gestureClaim.value) updateClaim(gestureClaim.value);
  gestureClaim.value = undefined;
  selectionAnchor.value = undefined;
}

function dragRange(timeMs: number): void {
  if (!canEdit.value || !activeClaim.value || selectionAnchor.value === undefined) return;
  const before = gestureClaim.value?.scope ?? activeClaim.value.scope;
  const delta = timeMs - selectionAnchor.value;
  const kind = gestureEdge.value;
  const startMs = kind === "move-range" ? before.startMs + delta : kind === "resize-end" ? before.startMs : kind === "resize-start" ? timeMs : Math.min(selectionAnchor.value, timeMs);
  const endMs = kind === "move-range" ? before.endMs + delta : kind === "resize-start" ? before.endMs : kind === "resize-end" ? timeMs : Math.max(selectionAnchor.value, timeMs);
  if (endMs > startMs) updateClaim({ ...activeClaim.value, scope: { startMs, endMs }, reviewContext: {
    startMs: Math.min(activeClaim.value.reviewContext.startMs, startMs), endMs: Math.max(activeClaim.value.reviewContext.endMs, endMs),
  } });
}

function saveSection(): void {
  void run(async () => {
    if (!directory.value || !sourceBytes.value || !stored.value) return;
    const sourceSha = stored.value.document.source.sha256;
    const key = draftKey("direct");
    const claimId = activeClaimId.value;
    const saved = await directory.value.addObservations(sourceBytes.value, stored.value.version, { claims: drafts.value, humanId: humanId.value });
    localStorage.removeItem(key);
    if (source.value?.source.sha256 === sourceSha) {
      if (saved.version.revision >= stored.value.version.revision) stored.value = saved;
      if (activeClaimId.value === claimId) {
        status.value = "Section judgments saved. Unreviewed dimensions remain unreviewed.";
        editorOrigin.value = "observation";
      }
    }
    emit("saved");
  });
}

function decide(disposition: HumanDecisionV2["disposition"]): void {
  void run(async () => {
    if (!directory.value || !sourceBytes.value || !stored.value || !activeClaim.value) return;
    const sourceSha = stored.value.document.source.sha256;
    const claimId = activeClaim.value.id;
    const rationale = decisionNote.value.trim() || ({ accepted: "Human confirmed the original proposal.", rejected: "Human rejected the original proposal.", deferred: "Human deferred this review.", modified: "" }[disposition]);
    const saved = await directory.value.decide(sourceBytes.value, stored.value.version, {
      handoffId: activeHandoffId.value, claimId: activeClaim.value.id, disposition,
      humanId: humanId.value, rationale,
      ...(disposition === "modified" ? { modifiedClaim: activeClaim.value } : {}),
    });
    if (source.value?.source.sha256 === sourceSha) {
      if (saved.version.revision >= stored.value.version.revision) stored.value = saved;
      if (activeClaimId.value === claimId) {
        editorBase.value = stored.value.version;
        editorReviewRevision.value = stored.value.document.reviewRevision;
        status.value = `${disposition} · decision saved; original proposal retained.`;
      }
    }
    emit("saved");
  });
}

function latestDecision(handoffId: string, claimId: string): string {
  return agentReviews.value.find(review => review.handoffId === handoffId && review.claimId === claimId)?.status ?? "awaiting-audit";
}

function communityAlignments(tag: FoundationTagV2): readonly CommunityAlignmentV2[] {
  return tag.communityAlignment ? [tag.communityAlignment] : tag.communityAlignments ?? [];
}

function openQuestion(handoffId: string, claimId: string): void {
  const claim = document.value?.handoffs.find(entry => entry.handoff.handoffId === handoffId)?.handoff.proposals.find(claim => claim.id === claimId);
  if (claim) openProposal(handoffId, claim);
}

function reload(): void {
  void run(async () => {
    if (!directory.value || !source.value) return;
    stored.value = await directory.value.read(source.value.source.sha256, sourceBytes.value) ?? undefined;
    status.value = "Canonical workspace reloaded. Editor draft retained.";
  });
}

onBeforeUnmount(stashDraft);
</script>

<template>
  <main class="review-workspace" :class="{ 'has-source': source }">
    <nav class="review-mobile-switch" aria-label="Review view">
      <button v-for="panel in ['source', 'preview', 'details']" :key="panel" type="button" :aria-pressed="mobilePanel === panel" @click="mobilePanel = panel">{{ panel }}</button>
    </nav>
    <aside class="review-source review-rail" :class="{ 'mobile-active': mobilePanel === 'source' }">
      <h1>Beatmap Lens</h1>
      <button v-if="remoteSource" type="button" @click="emit('back-to-inbox')">← Back to inbox</button>
      <WorkspaceModeSwitch v-else model-value="review" :disabled="busy || sourceLoading" @update:model-value="emit('change-mode', $event)" />
      <p class="review-kicker">Agent–human review · V2</p>
      <p class="review-copy">Partial observations. Each concept has its own evidence and decision.</p>
      <template v-if="!remoteSource">
      <label class="review-file">Open .osu difficulties<input type="file" accept=".osu" multiple :disabled="busy || sourceLoading" @change="openFiles"></label>
      <label v-if="files.length > 1">Difficulty<select v-model="selectedFile" :disabled="busy || sourceLoading" @change="changeDifficulty"><option v-for="(file, index) in files" :key="file.name" :value="index">{{ file.name }}</option></select></label>
      <label class="review-file">Open frozen task<input type="file" accept=".json" :disabled="busy || sourceLoading" @change="importJson($event, 'task')"></label>
      <button type="button" :disabled="busy || sourceLoading" @click="chooseDirectory">{{ directoryName || 'Choose workspace folder' }}</button>
      </template>
      <template v-if="source">
        <h2>{{ source.source.title }}</h2>
        <p class="review-copy">{{ source.source.artist }} · {{ source.source.difficulty }}</p>
        <dl class="review-facts"><dt>Beatmapset</dt><dd>{{ source.source.beatmapSetId ?? 'Local' }}</dd><dt>Difficulty</dt><dd>{{ source.source.beatmapId ?? 'Local' }}</dd><dt>Structure</dt><dd>{{ source.source.keyCount }}K · {{ source.source.noteCount }} notes</dd><dt>Source SHA</dt><dd :title="source.source.sha256">{{ source.source.sha256.slice(0, 12) }}</dd><dt>Foundation</dt><dd>{{ activeFoundation.approval.status }}</dd></dl>
        <label>Human reviewer<input v-model="humanId" autocomplete="off" placeholder="Your reviewer ID"></label>
        <p v-if="remoteSource" class="review-copy">Your saved decision returns to the agent automatically. New arrivals keep your current draft intact.</p>
        <template v-else>
        <div class="review-actions"><button type="button" :disabled="busy || sourceLoading || !stored" @click="exportTask">Export frozen task</button><button type="button" :disabled="busy || sourceLoading || !stored" @click="exportDecisions">Export dispositions</button></div>
        <label class="review-file">Import agent handoff<input type="file" accept=".json" :disabled="busy || sourceLoading || !stored" @change="importJson($event, 'handoff')"></label>
        <label class="review-file">Import independent audit<input type="file" accept=".json" :disabled="busy || sourceLoading || !stored" @change="importJson($event, 'audit')"></label>
        <button type="button" :disabled="busy || sourceLoading || !stored" @click="reload">Reload saved workspace</button>
        </template>
      </template>
      <section v-if="!remoteSource && document?.handoffs.length" class="review-section">
        <h2>Expert review · {{ expertQueue.length }}</h2>
        <p class="review-copy">{{ routineCount }} agent-reviewed · {{ agentActionCount }} awaiting agent work. Machine review is separate from human confirmation.</p>
        <p v-if="!expertQueue.length" class="review-copy">No open expert cases. All submissions remain available below for inspection.</p>
        <template v-for="entry in document.handoffs" :key="entry.handoff.handoffId">
          <div v-if="!entry.handoff.proposals.length && entry.handoff.questions.length" class="review-question">
            <strong>Legacy questions · curator review</strong>
            <p v-for="question in entry.handoff.questions" :key="question.id">{{ question.text }}</p>
            <p class="review-copy">These questions have no section claim and are outside the claim review queue.</p>
          </div>
        </template>
        <div v-for="review in expertQueue.slice(0, expertLimit)" :key="`${review.handoffId}:${review.claimId}`" class="review-question">
          <strong>{{ review.claim.tagId }} · {{ review.expertReason }}</strong>
          <p>{{ review.question }}</p><p class="review-copy">{{ review.rationale }}</p>
          <button type="button" @click="openProposal(review.handoffId, review.claim)">Review {{ review.claim.tagId }} · {{ review.claim.scope.startMs }}–{{ review.claim.scope.endMs }} ms</button>
        </div>
        <button v-if="expertQueue.length > expertLimit" type="button" @click="expertLimit += 5">Show more · {{ expertQueue.length - expertLimit }} remaining</button>
        <details class="review-all-agent-work"><summary>All agent work · {{ agentReviews.length }}</summary>
        <div v-for="entry in document.handoffs" :key="entry.handoff.handoffId" class="review-handoff">
          <strong>{{ entry.handoff.agent.producerId }} · {{ entry.handoff.agent.role }}</strong>
          <p class="review-copy">Task base: {{ handoffStatuses[entry.handoff.handoffId] ?? entry.baseStatus }} · {{ entry.handoff.handoffId.slice(0, 12) }}</p>
          <button v-for="claim in entry.handoff.proposals" :key="claim.id" type="button" class="review-list-row" @click="openProposal(entry.handoff.handoffId, claim)"><span>{{ claim.tagId }}<small>{{ claim.scope.startMs }}–{{ claim.scope.endMs }} ms</small></span><span>{{ latestDecision(entry.handoff.handoffId, claim.id) }}</span></button>
          <details v-if="entry.handoff.audit.length"><summary>Submission self-checks · {{ entry.handoff.audit.length }}</summary><p v-for="audit in entry.handoff.audit" :key="audit.id">{{ audit.finding }}</p></details>
          <details v-if="entry.handoff.questions.length"><summary>Original questions · {{ entry.handoff.questions.length }}</summary><div v-for="question in entry.handoff.questions" :key="question.id" class="review-question"><p>{{ question.text }}</p><button v-for="claimId in question.claimIds" :key="claimId" type="button" @click="openQuestion(entry.handoff.handoffId, claimId)">Open {{ entry.handoff.proposals.find(claim => claim.id === claimId)?.tagId }}</button></div></details>
        </div>
        </details>
      </section>
      <section v-if="document?.observations.length" class="review-section"><h2>Human observations · {{ document.observations.length }}</h2><button v-for="observation in document.observations" :key="observation.id" type="button" class="review-list-row" @click="openObservation(observation.claim)"><span>{{ observation.claim.tagId }}<small>{{ observation.claim.scope.startMs }}–{{ observation.claim.scope.endMs }} ms</small></span><span>{{ observation.claim.assessment.presence }}</span></button></section>
      <p class="review-copy review-legacy">Existing Annotate records retain V1 positive-only semantics. Review V2 writes separate workflow files.</p>
    </aside>
    <div v-if="source && frame && !calibrationExample" class="review-preview" :class="{ 'mobile-active': mobilePanel === 'preview' }">
      <FallingNoteViewport :annotation-bands="[]" :candidate-note-ids="candidateIds" :chart-artist="source.source.artist" :chart-difficulty="source.source.difficulty" :chart-end-ms="endMs" :chart-title="source.source.title" :frame="frame" :frame-p95-ms="0" :key-count="source.chart.keyCount" :locked="busy" :playhead-ms="playhead" :selected-note-ids="selectedNoteIds" v-bind="selectionBand ? { selectionBand } : {}" :size="size" :visual-speed="speed" @resize="size = $event" @seek="playhead = $event" @viewport-navigate="playhead = $event" @note-toggle="toggleNote" @range-start="beginRange($event.anchorMs)" @range-preview="dragRange($event.focusMs)" @range-commit="dragRange($event.focusMs); selectionAnchor = undefined; gestureClaim = undefined" @range-cancel="cancelRange" />
    </div>
    <div v-else-if="!calibrationExample" class="review-empty"><h2>One source. Independent judgments.</h2><p>Open a difficulty to inspect its full structure, or open a task to review agent evidence.</p></div>
    <div v-if="source && frame && !calibrationExample" class="review-timeline" :class="{ 'mobile-active': mobilePanel === 'preview' }">
      <AnnotationTimeline :chart="source.chart" :chart-end-ms="endMs" :main-viewport-range="frame.viewportRange" :playhead-ms="playhead" :saved-annotations="[]" v-bind="activeClaim ? { selection: activeClaim.scope } : {}" :view-range="timelineRange" :disabled="busy || sourceLoading" @seek="playhead = $event" @viewport-pan="playhead = $event.startMs" @view-range-change="timelineRange = $event" @range-start="beginRange($event.anchorMs, $event.kind)" @range-preview="dragRange($event.focusMs)" @range-commit="dragRange($event.focusMs); selectionAnchor = undefined; gestureClaim = undefined" @range-cancel="cancelRange" />
    </div>
    <section v-if="calibrationExample" class="review-calibration" :class="{ 'mobile-active': mobilePanel === 'preview' }">
      <button type="button" @click="calibrationId = ''">Return to difficulty review</button>
      <h2>{{ calibrationExample.claim.tagId }} · {{ calibrationExample.source.title }} [{{ calibrationExample.source.difficulty }}]</h2>
      <p>Claim {{ calibrationExample.claim.scope.startMs }}–{{ calibrationExample.claim.scope.endMs }} ms · Context {{ calibrationExample.claim.reviewContext.startMs }}–{{ calibrationExample.claim.reviewContext.endMs }} ms</p>
      <p>{{ calibrationExample.explanation }}</p>
      <div v-for="page in calibrationPages" :key="page.index" v-html="page.svg" />
    </section>
    <aside class="review-details review-rail" :class="{ 'mobile-active': mobilePanel === 'details' }">
      <div class="review-status" role="status">{{ busy || sourceLoading ? 'Working…' : status }}</div>
      <p v-if="error" class="review-error" role="alert">{{ error }}</p>
      <template v-if="source">
        <div class="review-controls"><label>Source time · ms<input v-model.number="playhead" type="number" min="0" :max="endMs"></label><label>Visual speed<input v-model.number="speed" type="number" min="30" max="2000" step="30"></label></div>
        <div class="review-actions"><button type="button" :disabled="busy || sourceLoading" @click="newSection">New section at playhead</button><button type="button" :disabled="busy || sourceLoading" @click="restoreSection">Restore section draft</button></div>
        <p v-if="draftIsStale && editorOrigin === 'direct'" class="review-copy">This draft was based on an earlier saved human review. Compare it with the saved observations before continuing.<button type="button" @click="editorBase = stored?.version; editorReviewRevision = document?.reviewRevision; stashDraft()">I reviewed this draft against the current revision</button></p>
        <details class="review-section"><summary>Foundation · {{ activeFoundation.tags.length }} concepts · {{ activeFoundation.calibrationExamples.length }} examples</summary>
          <p class="review-copy">Section judgments use local definitions. Community correspondences do not establish training equivalence.</p>
          <div v-for="tag in activeFoundation.tags" :key="tag.id" class="review-definition">
            <strong>{{ tag.displayName }}</strong><p>{{ tag.definition }}</p><p>Include: {{ tag.inclusionCues.join(' · ') }}</p><p>Exclude: {{ tag.exclusionCues.join(' · ') }}</p>
            <div v-for="(alignment, index) in communityAlignments(tag)" :key="index">
              <a :href="alignment.catalogueUrl" target="_blank" rel="noreferrer">{{ alignment.externalTagId }}</a>
              <p>{{ alignment.relation }} · {{ alignment.scope }}</p>
            </div>
            <p v-if="!communityAlignments(tag).length" class="review-copy">No community correspondence declared.</p>
          </div>
          <p v-if="!activeFoundation.calibrationExamples.length" class="review-copy">Initial examples are still proposed. Import a source-backed calibration Foundation before human approval.</p>
          <div v-for="example in activeFoundation.calibrationExamples" :key="example.id" class="review-definition"><strong>{{ example.claim.tagId }} · {{ example.claim.exemplarRole }}</strong><p>{{ example.source.title }} · {{ example.source.difficulty }} · {{ example.claim.scope.startMs }}–{{ example.claim.scope.endMs }} ms</p><p>{{ example.explanation }}</p><button type="button" @click="calibrationId = example.id; mobilePanel = 'preview'">View exact source evidence</button><details><summary>Exact evidence</summary><pre>{{ serializeCanonicalJson(example.claim) }}</pre></details></div>
          <label v-if="!approved" class="review-file">Import calibration Foundation<input type="file" accept=".json" :disabled="busy || sourceLoading || !stored" @change="importJson($event, 'foundation')"></label>
          <button v-if="!approved" type="button" :disabled="busy || sourceLoading || !stored || !humanId.trim() || !activeFoundation.calibrationExamples.length" @click="approveFoundation">Approve these definitions and examples</button>
        </details>
        <div v-if="drafts.length > 1" class="review-assessments"><button v-for="claim in drafts" :key="claim.id" type="button" :class="{ 'is-active': activeClaimId === claim.id }" @click="activeClaimId = claim.id"><span>{{ claim.tagId }}</span><span>{{ claim.assessment.presence === 'present' ? claim.assessment.salience : claim.assessment.presence }}</span></button></div>
        <p class="review-kicker">{{ editorOrigin === 'proposal' ? 'Agent proposal · review each claim' : editorOrigin === 'observation' ? 'Saved human observation' : 'Human section draft' }}</p>
        <template v-if="activeClaim">
          <section v-if="editorOrigin === 'proposal' && activeReview" class="review-section review-audit-result">
            <h2>{{ activeReview.status }}</h2>
            <p v-if="activeReview.question">{{ activeReview.question }}</p>
            <p class="review-copy">{{ activeReview.rationale }}</p>
            <details v-if="activeReview.audits.length"><summary>Independent findings · {{ activeReview.audits.length }}</summary><p v-for="finding in activeReview.audits" :key="finding.auditId" class="review-decision"><strong>{{ finding.producerId }} · {{ finding.result.outcome }}</strong><br>{{ finding.result.rationale }}</p></details>
          </section>
          <section v-if="remoteSource && editorOrigin === 'proposal' && !proposalEditing" class="review-section review-proposed-judgment">
            <h2>{{ activeFoundation.tags.find(tag => tag.id === activeClaim?.tagId)?.displayName }}</h2>
            <p>{{ activeClaim.assessment.presence }}{{ activeClaim.assessment.presence === 'present' ? ` · ${activeClaim.assessment.salience}` : '' }}</p>
            <p class="review-kicker">{{ (activeClaim.scope.startMs / 1000).toFixed(3) }}–{{ (activeClaim.scope.endMs / 1000).toFixed(3) }} s</p>
            <div class="review-actions"><button type="button" @click="focus(activeClaim.scope)">View claim range</button><button type="button" @click="focus(activeClaim.reviewContext)">View context</button></div>
            <p>{{ activeClaim.evidence.rationale }}</p>
          </section>
          <template v-else>
            <WorkflowClaimEditor :model-value="activeClaim" :tags="activeFoundation.tags" :disabled="!canEdit" @update:model-value="updateClaim" @focus="focus" />
            <details class="review-section"><summary>Choose source-backed evidence</summary><label>Click notes to toggle<select v-model="evidenceMode"><option value="noteRefs">Witness for this claim</option><option value="contextNoteRefs">Necessary context</option></select></label><button type="button" :disabled="!canEdit" @click="selectScopeNotes">Use arrangement in claim scope</button><p class="review-copy">Notes crossing the start retain their original LN start and end. Select witnesses independently for each concept.</p><div class="review-note-list"><label v-for="note in visibleNotes" :key="note.id"><input type="checkbox" :checked="activeClaim.evidence[evidenceMode].some(ref => ref.sourceLine === note.sourceLine)" :disabled="!canEdit" @change="toggleNote(note.id)"><span>L{{ note.sourceLine }} · C{{ note.column + 1 }} · {{ note.startMs }}{{ note.kind === 'long' ? `–${note.endMs}` : '' }} ms</span></label></div><div class="review-actions"><button type="button" :disabled="notePage === 0" @click="notePage--">Previous notes</button><button type="button" :disabled="(notePage + 1) * 80 >= candidateNotes.length" @click="notePage++">Next notes</button></div></details>
          </template>
          <button v-if="editorOrigin === 'direct'" class="review-primary" type="button" :disabled="busy || sourceLoading || !stored || !approved || !humanId.trim() || draftIsStale" @click="saveSection">Save section judgments</button>
          <template v-if="editorOrigin === 'proposal'">
            <label>Human decision rationale<textarea v-model="decisionNote" rows="3" placeholder="Optional for confirmation, rejection or deferral. Explain a modification."></textarea></label>
            <div class="review-actions"><button type="button" :disabled="busy || sourceLoading || !approved || !humanId.trim() || handoffStatuses[activeHandoffId] === 'stale'" @click="decide('accepted')">Accept original</button><button v-if="remoteSource && !proposalEditing" type="button" @click="proposalEditing = true">Modify judgment</button><button v-else type="button" :disabled="busy || sourceLoading || !approved || !humanId.trim() || !decisionNote.trim() || handoffStatuses[activeHandoffId] === 'stale'" @click="decide('modified')">Save modified</button><button type="button" :disabled="busy || sourceLoading || !humanId.trim()" @click="decide('rejected')">Reject proposal</button><button type="button" :disabled="busy || sourceLoading || !humanId.trim()" @click="decide('deferred')">Defer</button></div>
            <p v-for="decision in decisionsForClaim" :key="decision.id" class="review-decision">{{ decision.disposition }} · {{ decision.humanId }} · {{ decision.decidedAt }}<br>{{ decision.rationale }}</p>
          </template>
        </template>
      </template>
    </aside>
  </main>
</template>

<style scoped>
.review-workspace { display: grid; grid-template-columns: 260px minmax(0, 1fr) 64px 380px; height: 100dvh; background: var(--surface); font-size: 13px; }
.review-rail { min-width: 0; overflow-y: auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 16px; }
.review-source { border-right: 1px solid var(--line); }
.review-details { border-left: 1px solid var(--line); }
h1 { margin: 0; font-size: 23px; letter-spacing: -.022em; }
h2 { margin: 0; font-size: 14px; line-height: 1.5; }
p { margin: 0; line-height: 1.6; }
.review-kicker { font: 11px var(--font-data); color: var(--ink-secondary); }
.review-copy { font-size: 12px; color: var(--ink-secondary); line-height: 1.65; }
.review-facts { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 0; padding: 12px 0; border-block: 1px solid var(--line); font-size: 11px; }
dd { margin: 0; text-align: right; font-family: var(--font-data); overflow-wrap: anywhere; }
.review-preview, .review-timeline { min-width: 0; height: 100dvh; overflow: hidden; }
.review-timeline { border-left: 1px solid var(--line); }
.review-preview > svg { height: 100%; }
.review-empty { grid-column: 2 / 4; display: grid; align-content: center; padding: 48px; gap: 16px; background: var(--surface-quiet); }
.review-empty h2 { font-size: 24px; }
.review-calibration { grid-column: 2 / 4; grid-row: 1; overflow: auto; padding: 24px; display: grid; align-content: start; gap: 16px; }
.review-calibration > div { width: 100%; }
button { padding: 8px 12px; border: 0; border-radius: 10px; color: var(--ink); background: var(--surface); box-shadow: var(--shadow-control); text-align: left; cursor: pointer; transition: transform 120ms, background-color 120ms; }
button:hover { background: var(--surface-quiet); }
button:active { transform: scale(.96); }
button:disabled { opacity: .45; cursor: default; }
button.review-primary { background: var(--ink); color: white; }
input, select, textarea { width: 100%; min-width: 0; min-height: 40px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-quiet); color: var(--ink); font: inherit; }
input:focus-visible, select:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
input[type=file] { font-size: 11px; }
label { display: grid; gap: 6px; font-size: 12px; }
.review-section { border-top: 1px solid var(--line); padding-top: 16px; }
summary { min-height: 40px; cursor: pointer; }
.review-definition { padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.review-definition p { margin-top: 6px; }
.review-definition pre { max-height: 240px; overflow: auto; font-size: 10px; }
.review-controls, .review-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.review-status { padding-bottom: 12px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--ink-secondary); }
.review-status::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--signal); }
.review-error { color: var(--danger); overflow-wrap: anywhere; }
.review-assessments { display: grid; gap: 1px; background: var(--line); }
.review-assessments button { display: flex; justify-content: space-between; gap: 8px; border-radius: 0; box-shadow: none; font-size: 12px; }
.review-assessments .is-active { color: var(--signal); background: var(--surface-quiet); }
.review-note-list { max-height: 300px; overflow: auto; margin: 12px 0; }
.review-note-list label { display: flex; align-items: center; gap: 8px; min-height: 40px; font: 10px var(--font-data); border-bottom: 1px solid var(--line); }
.review-note-list input { width: 18px; min-height: 18px; }
.review-list-row { display: flex; justify-content: space-between; width: 100%; gap: 8px; padding: 12px 0; border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--line); font-size: 11px; }
.review-list-row small { display: block; padding-top: 4px; color: var(--ink-secondary); font-size: 10px; }
.review-question { padding: 12px 0; font-size: 12px; }
.review-proposed-judgment { display: grid; gap: 12px; }
.review-decision { padding: 12px 0; border-top: 1px solid var(--line); font-size: 12px; }
.review-legacy { margin-top: auto; }
.review-mobile-switch { display: none; }
@media (max-width: 1160px) and (min-width: 921px) { .review-workspace { grid-template-columns: 220px minmax(0, 1fr) 56px 340px; } }
@media (max-width: 920px) {
  .review-workspace { grid-template-columns: minmax(0, 1fr) 48px; }
  .review-mobile-switch { position: fixed; top: 8px; left: 8px; z-index: 30; display: flex; gap: 4px; }
  .review-rail, .review-preview, .review-timeline { display: none; }
  .review-rail.mobile-active { display: flex; grid-column: 1 / 3; padding-top: 64px; }
  .review-preview.mobile-active, .review-timeline.mobile-active { display: block; }
  .review-empty { grid-column: 1 / 3; }
  .review-calibration { display: none; }
  .review-calibration.mobile-active { display: grid; grid-column: 1 / 3; padding-top: 64px; }
}
</style>
