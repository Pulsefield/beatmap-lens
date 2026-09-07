<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { type InboxClaimV2, type InboxSourceV2, type RemoteSourceV2, type ReviewInboxV2, reviewRequest } from "./annotation/workflow/remote-workspace";
import { assessmentStrength, drawReviewSample, REVIEW_TARGETS, type ReviewSampleBatch, type ReviewSampleItem, type SampleStrength, sampleCandidates, sampleKey, sampleRef } from "./annotation/workflow/review-sampling";
import ReviewWorkspace from "./ReviewWorkspace.vue";

const inbox = shallowRef<ReviewInboxV2>();
const connectionError = ref("");
const loadError = ref("");
const activeSource = shallowRef<RemoteSourceV2>();
const openClaim = shallowRef<{ handoffId: string; claimId: string }>();
const showingInbox = ref(true);
const loading = ref(false);
const lastSynced = ref("");
const showingSampler = ref(false);
const sampleTag = ref("");
const sampleStrength = ref<SampleStrength>("all");
const sampleLimit = ref(10);
const sampleBatch = shallowRef<ReviewSampleBatch>();
const activeSampleKey = ref("");
const candidates = computed(() => sampleCandidates(inbox.value?.sources ?? [], sampleTag.value, sampleStrength.value));
const sampleItems = computed(() => new Map((inbox.value?.sources ?? []).flatMap(source => source.reviews.map(claim => {
  const item = { source, claim };
  return [sampleKey(sampleRef(item)), item] as const;
}))));
const sampleRows = computed(() => (sampleBatch.value?.claims ?? []).map(reference => ({
  key: sampleKey(reference), item: sampleItems.value.get(sampleKey(reference)),
})));
const sampleReviewed = computed(() => sampleRows.value.filter(row => row.item && ["accepted", "modified", "rejected"].includes(row.item.claim.status)).length);
const nextSample = computed(() => {
  const rows = sampleRows.value;
  const current = rows.findIndex(row => row.key === activeSampleKey.value);
  return [...rows.slice(current + 1), ...rows.slice(0, current)].find(row => row.item?.claim.status === "agent-reviewed")?.item;
});
const sampleStorageKey = computed(() => `beatmap-lens-review-sample:${inbox.value?.workspace}`);
watch(() => inbox.value?.workspace, workspace => {
  if (!workspace) return;
  const saved = localStorage.getItem(sampleStorageKey.value);
  sampleBatch.value = saved ? JSON.parse(saved) : undefined;
  if (sampleBatch.value) {
    sampleTag.value = sampleBatch.value.tagId;
    sampleStrength.value = sampleBatch.value.strength;
    showingSampler.value = true;
  }
});
let timer: ReturnType<typeof setTimeout>;
let stopped = false;
let refreshing = false;
let selection = 0;
const tasks = computed(() => (inbox.value?.sources ?? []).flatMap(source => [
  ...(source.requests ?? []).filter(request => request.pendingClaimIds.length).map(request => ({
    id: request.requestId, source, title: "Review spot-check", question: request.question,
    claims: source.reviews.filter(review => request.handoffId === review.handoffId && request.pendingClaimIds.includes(review.claimId)),
  })),
  ...source.expertQueue.filter(review => !(source.requests ?? []).some(request => request.handoffId === review.handoffId && request.pendingClaimIds.includes(review.claimId))).map(review => ({
    id: `${review.handoffId}:${review.claimId}`, source, title: "Expert judgment needed", question: review.question ?? review.rationale, claims: [review],
  })),
]));
const counts = computed(() => {
  const total: Record<string, number> = {};
  for (const source of inbox.value?.sources ?? []) for (const [status, count] of Object.entries(source.counts)) total[status] = (total[status] ?? 0) + count;
  return total;
});
const failedDeliveries = computed(() => inbox.value?.receipts.filter(receipt => receipt.status === "error") ?? []);
const humanAssessments = computed(() => (inbox.value?.sources ?? []).reduce((total, source) => ({
  settled: total.settled + (source.humanAssessmentCounts?.settled ?? 0),
  unresolved: total.unresolved + (source.humanAssessmentCounts?.unresolved ?? 0),
  unreviewed: total.unreviewed + (source.humanAssessmentCounts?.unreviewed ?? 0),
}), { settled: 0, unresolved: 0, unreviewed: 0 }));

function reviewLabel(claim: InboxClaimV2): string {
  if (!claim.assessment || !["accepted", "modified"].includes(claim.status)) return claim.status;
  return `${claim.status} · ${claim.assessment.presence}${claim.assessment.presence === "present" ? ` · ${claim.assessment.salience}` : ""}`;
}

function strengthLabel(claim: InboxClaimV2): string {
  const strength = assessmentStrength(claim);
  return strength === "absent" ? "absent · 0" : strength;
}

function drawSample(): void {
  sampleBatch.value = {
    createdAt: new Date().toISOString(), tagId: sampleTag.value, strength: sampleStrength.value,
    claims: drawReviewSample(candidates.value, sampleLimit.value),
  };
  activeSampleKey.value = "";
  localStorage.setItem(sampleStorageKey.value, JSON.stringify(sampleBatch.value));
}

function openSample(item: ReviewSampleItem): Promise<void> {
  return open(item.source, item.claim, sampleKey(sampleRef(item)));
}

async function refresh(): Promise<void> {
  if (refreshing || stopped) return;
  refreshing = true;
  try {
    const next = await reviewRequest<ReviewInboxV2>("inbox");
    if (stopped) return;
    inbox.value = next;
    connectionError.value = "";
    lastSynced.value = new Date().toLocaleTimeString();
    const current = activeSource.value;
    const summary = next.sources.find(source => source.source.sha256 === current?.document.source.sha256);
    if (current && summary && summary.version.revision > current.version.revision) {
      const source = await reviewRequest<RemoteSourceV2>(`source/${summary.source.sha256}`);
      if (activeSource.value?.document.source.sha256 === source.document.source.sha256 && source.version.revision > activeSource.value.version.revision) activeSource.value = source;
    }
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : String(error);
  } finally {
    refreshing = false;
  }
}

async function poll(): Promise<void> {
  await refresh();
  if (!stopped) timer = setTimeout(poll, 1200);
}

async function open(source: InboxSourceV2, claim?: InboxClaimV2, sample = ""): Promise<void> {
  const request = ++selection;
  loading.value = true;
  loadError.value = "";
  try {
    if (activeSource.value?.document.source.sha256 !== source.source.sha256) {
      const loaded = await reviewRequest<RemoteSourceV2>(`source/${source.source.sha256}`);
      if (request !== selection) return;
      activeSource.value = loaded;
    }
    openClaim.value = claim ? { handoffId: claim.handoffId, claimId: claim.claimId } : undefined;
    activeSampleKey.value = sample;
    showingInbox.value = false;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (request === selection) loading.value = false;
  }
}

onMounted(poll);
onBeforeUnmount(() => { stopped = true; clearTimeout(timer); });
</script>

<template>
  <div v-show="showingInbox" class="inbox-page">
    <header class="inbox-header"><div><p class="inbox-kicker">Beatmap Lens</p><h1>Review inbox</h1><p>Review expert requests or sample machine-reviewed sections.</p></div><p class="inbox-connection" role="status">{{ connectionError ? 'Connection interrupted · last inbox retained' : inbox ? `Connected · ${lastSynced}` : 'Connecting…' }}</p></header>
    <p v-if="connectionError" class="inbox-error" role="alert">{{ connectionError }}</p>
    <p v-if="loadError" class="inbox-error" role="alert">{{ loadError }}</p>
    <div class="inbox-summary"><strong>{{ tasks.length }} pending {{ tasks.length === 1 ? 'task' : 'tasks' }}</strong><span>{{ counts['agent-reviewed'] ?? 0 }} machine-reviewed</span><span>{{ humanAssessments.settled }} explicit human judgments</span><span v-if="humanAssessments.unresolved || humanAssessments.unreviewed">{{ humanAssessments.unresolved + humanAssessments.unreviewed }} uncertain or unreviewed human records</span><span>{{ counts.deferred ?? 0 }} deferred</span></div>
    <div class="inbox-sample-entry"><button type="button" :aria-expanded="showingSampler" aria-controls="review-sampler" @click="showingSampler = !showingSampler">Sample machine-reviewed sections <span>{{ showingSampler ? '−' : '+' }}</span></button><span>Optional expert spot-check</span></div>
    <section v-if="showingSampler" id="review-sampler" class="inbox-sampler">
      <h2>Sample section labels</h2>
      <p>Random section labels. Identical judgments are sampled once per batch; human-reviewed, superseded and pending expert claims are excluded.</p>
      <form class="inbox-sample-controls" @submit.prevent="drawSample">
        <label>Label type<select v-model="sampleTag"><option value="">All five labels</option><option v-for="(name, id) in REVIEW_TARGETS" :key="id" :value="id">{{ name }}</option></select></label>
        <label>Strength<select v-model="sampleStrength"><option value="all">All strengths</option><option value="absent">Absent · 0</option><option value="supporting">Supporting · weak</option><option value="prominent">Prominent · strong</option></select></label>
        <label>Sample count<input v-model.number="sampleLimit" type="number" min="1" max="100" step="1" required></label>
        <button type="submit" class="inbox-sample-draw" :disabled="!candidates.length || !!connectionError || loading">{{ sampleBatch ? 'Draw new sample' : 'Draw sample' }}</button>
      </form>
      <p class="inbox-sample-count" role="status">{{ candidates.length }} matching sections · up to {{ sampleLimit }} will be drawn</p>
      <template v-if="sampleBatch">
        <div class="inbox-sample-heading"><h2>Current sample · {{ sampleReviewed }}/{{ sampleRows.length }} reviewed</h2><span>{{ REVIEW_TARGETS[sampleBatch.tagId] ?? 'All labels' }} · {{ sampleBatch.strength }} · saved in this browser</span></div>
        <p class="inbox-sample-help">Modify judgment to save the correct label, strength or range with your reason. Reject only if you cannot provide a replacement. A stale item waits for the agent to reread your feedback.</p>
        <div class="inbox-sample-list"><template v-for="(row, index) in sampleRows" :key="row.key">
          <button v-if="row.item" type="button" :disabled="loading || ['stale', 'superseded', 'awaiting-audit', 'needs-revision'].includes(row.item.claim.status)" @click="openSample(row.item)">
            <span><span class="inbox-sample-number">{{ index + 1 }}.</span> {{ row.item.source.source.title }} <small>[{{ row.item.source.source.difficulty }}] · {{ (row.item.claim.scope.startMs / 1000).toFixed(3) }}–{{ (row.item.claim.scope.endMs / 1000).toFixed(3) }} s</small></span>
            <span>{{ REVIEW_TARGETS[row.item.claim.tagId] ?? row.item.claim.tagId }} · {{ strengthLabel(row.item.claim) }}<small>{{ row.item.claim.status === 'stale' ? 'Awaiting agent reread' : reviewLabel(row.item.claim) }} →</small></span>
          </button>
          <p v-else>Sample {{ index + 1 }} is no longer available in this workspace.</p>
        </template></div>
      </template>
    </section>
    <section v-if="inbox && !tasks.length" class="inbox-empty"><h2>No requests waiting</h2><p>New requests arrive here automatically. Machine review results remain available below.</p></section>
    <section v-for="task in tasks" :key="`${task.source.source.sha256}:${task.id}`" class="inbox-task">
      <div><p class="inbox-kicker">{{ task.title }}</p><h2>{{ task.source.source.title }} <span>[{{ task.source.source.difficulty }}]</span></h2><p class="inbox-question">{{ task.question }}</p></div>
      <div class="inbox-claims"><button v-for="claim in task.claims" :key="claim.claimId" type="button" :disabled="loading" @click="open(task.source, claim)"><span>{{ claim.tagId }}<small>{{ (claim.scope.startMs / 1000).toFixed(3) }}–{{ (claim.scope.endMs / 1000).toFixed(3) }} s · {{ claim.status }}</small></span><span>Review →</span></button></div>
    </section>
    <details v-if="inbox?.sources.length" class="inbox-history"><summary>All agent work · {{ counts.total ?? 0 }} claims</summary><p>Awaiting audit {{ counts['awaiting-audit'] ?? 0 }} · Needs revision {{ counts['needs-revision'] ?? 0 }} · Stale {{counts.stale ?? 0 }} · Rejected {{ counts.rejected ?? 0 }}</p><section v-for="source in inbox.sources" :key="source.source.sha256"><h2>{{ source.source.title }} · {{ source.source.difficulty }}</h2><button type="button" :disabled="loading" @click="open(source)"><span>Open chart</span><span>{{ source.source.noteCount }} notes →</span></button><button v-for="claim in source.reviews" :key="`${claim.handoffId}:${claim.claimId}`" type="button" :disabled="loading" @click="open(source, claim)"><span>{{ claim.tagId }} · {{ (claim.scope.startMs / 1000).toFixed(3) }} s</span><span>{{ reviewLabel(claim) }} →</span></button></section></details>
    <details v-if="failedDeliveries.length" class="inbox-history"><summary>Delivery issues · {{ failedDeliveries.length }}</summary><p v-for="receipt in failedDeliveries" :key="receipt.id">{{ receipt.error }}</p></details>
    <footer v-if="inbox">Decisions are saved to the connected workspace and returned to the agent outbox automatically.</footer>
  </div>
  <div v-if="activeSource" v-show="!showingInbox" class="inbox-active">
    <div class="inbox-navigation"><button type="button" @click="showingInbox = true">{{ activeSampleKey ? `Sample · ${sampleReviewed}/${sampleRows.length}` : `Inbox · ${tasks.length}` }}{{ connectionError ? ' · offline' : '' }}</button><button v-if="activeSampleKey && nextSample" type="button" :disabled="loading" @click="openSample(nextSample)">Next sample →</button></div>
    <p v-if="loadError" class="inbox-active-error" role="alert">{{ loadError }}</p>
    <ReviewWorkspace :active="!showingInbox" :remote-source="activeSource" v-bind="openClaim ? { openClaim } : {}" @back-to-inbox="showingInbox = true" @saved="refresh" />
  </div>
</template>

<style scoped>
.inbox-page { max-width: 1100px; margin: 0 auto; padding: 48px 32px; color: var(--ink); }
.inbox-header { display: flex; justify-content: space-between; gap: 32px; align-items: flex-start; }
h1 { margin: 8px 0 12px; font-size: 32px; letter-spacing: -.025em; }
h2 { font-size: 17px; margin: 6px 0 12px; }
h2 span { font-size: 14px; font-weight: 400; color: var(--ink-secondary); }
p { line-height: 1.65; margin: 0; }
.inbox-kicker, .inbox-connection { font: 11px var(--font-data); color: var(--ink-secondary); }
.inbox-connection { padding-top: 8px; white-space: nowrap; }
.inbox-summary { display: flex; gap: 24px; flex-wrap: wrap; padding: 24px 0; margin-top: 24px; border-block: 1px solid var(--line); font-size: 13px; }
.inbox-summary span { color: var(--ink-secondary); }
.inbox-empty { padding: 56px 0; }
.inbox-empty p, footer { color: var(--ink-secondary); font-size: 13px; }
.inbox-task { padding: 28px 0; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.inbox-question { font-size: 14px; white-space: pre-line; }
button { display: flex; justify-content: space-between; gap: 16px; align-items: center; width: 100%; min-height: 44px; padding: 12px; border: 0; border-radius: 10px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-control); text-align: left; cursor: pointer; }
button:hover { background: var(--surface-quiet); }
button:disabled { opacity: .5; }
button small { display: block; margin-top: 6px; font: 11px var(--font-data); color: var(--ink-secondary); }
.inbox-claims { display: grid; gap: 8px; align-content: start; }
.inbox-history { border-top: 1px solid var(--line); padding: 20px 0; }
summary { cursor: pointer; min-height: 40px; font-size: 14px; }
.inbox-history section { margin-top: 20px; }
.inbox-history button { border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--line); font-size: 12px; }
.inbox-history p { font-size: 12px; color: var(--ink-secondary); }
footer { padding-top: 28px; }
.inbox-error { color: var(--danger); margin-top: 16px; }
.inbox-navigation { position: fixed; z-index: 40; top: 8px; left: 280px; display: flex; gap: 8px; }
.inbox-navigation button { width: auto; padding: 8px 12px; min-height: 40px; font-size: 12px; }
.inbox-active-error { position: fixed; z-index: 40; top: 56px; left: 280px; max-width: 380px; padding: 12px; background: var(--surface); color: var(--danger); box-shadow: var(--shadow-control); border-radius: 10px; font-size: 13px; }
.inbox-sample-entry { display: flex; align-items: center; gap: 16px; padding: 20px 0; }
.inbox-sample-entry button { width: auto; font-size: 13px; }
.inbox-sample-entry > span, .inbox-sampler > p, .inbox-sample-heading > span { font-size: 12px; color: var(--ink-secondary); }
.inbox-sampler { padding: 8px 0 24px; border-bottom: 1px solid var(--line); }
.inbox-sample-controls { display: grid; grid-template-columns: 1.3fr 1.3fr .7fr auto; gap: 16px; align-items: end; margin: 20px 0 8px; }
.inbox-sample-controls label { display: grid; gap: 8px; font-size: 12px; }
.inbox-sample-controls select, .inbox-sample-controls input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px; border: 0; border-radius: 10px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-control); font: inherit; }
.inbox-sample-controls .inbox-sample-draw { background: var(--ink); color: var(--surface); justify-content: center; }
.inbox-sample-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-top: 28px; }
.inbox-sample-list { margin-top: 16px; }
.inbox-sample-list button { border-radius: 0; box-shadow: none; border-top: 1px solid var(--line); font-size: 13px; }
.inbox-sample-list button > span:last-child { text-align: right; flex-shrink: 0; }
.inbox-sample-number { font: 11px var(--font-data); color: var(--ink-secondary); }
@media (max-width: 920px) { .inbox-page { padding: 28px 20px; } .inbox-header, .inbox-task { display: block; } .inbox-connection, .inbox-claims { margin-top: 20px; } .inbox-navigation, .inbox-active-error { left: auto; right: 8px; } }
@media (max-width: 600px) { .inbox-sample-controls { grid-template-columns: 1fr 1fr; } .inbox-sample-entry, .inbox-sample-heading { align-items: flex-start; flex-direction: column; gap: 8px; } .inbox-sample-list button { align-items: flex-start; flex-direction: column; gap: 4px; } .inbox-sample-list button > span:last-child { text-align: left; } }
</style>
