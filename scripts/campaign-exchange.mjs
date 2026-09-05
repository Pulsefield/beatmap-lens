import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

// Controller-only transport. Workers receive note tables and pinned task bindings,
// and never need the corpus ranking or the original metadata-bearing .osu bytes.
const [command, campaignPath, jobPath] = process.argv.slice(2);
const root = resolve(campaignPath);
const job = resolve(jobPath);
const config = await json(join(root, "controller/config.json"));
const assignment = await json(join(job, "assignment.json"));
const taskPath = (sha) =>
  join(root, "controller/tasks", `${assignment.assignmentId}-${sha}.json.gz`);
const outputPath = join(job, "exchange.json");
const existing = await json(outputPath).catch((error) => {
  if (error.code === "ENOENT") return { charts: [] };
  throw error;
});

if (assignment.durationMs > config.maxDurationMs)
  throw new Error("Assignment exceeds the source-duration limit.");

if (command === "refresh") {
  for (const chart of assignment.charts) {
    const sha = chart.sourceSha256;
    const feedback = await request(`feedback/${sha}`);
    await save(join(job, "feedback", `${sha}.json.gz`), gzipSync(JSON.stringify(feedback)));
  }
} else if (command === "prepare") {
  const sources = await json(join(root, "admin/source-map.json"));
  const inbox = await request("inbox");
  const bindings = [];
  for (const chart of assignment.charts) {
    const sha = chart.sourceSha256;
    let task;
    let reviews = [];
    if (inbox.sources.some((entry) => entry.source.sha256 === sha)) {
      const view = await request(`feedback/${sha}`);
      reviews = view.agentReviews.map(({ summary, modifiedClaim, status, decision }) => ({
        claim: modifiedClaim ?? summary,
        status,
        decision,
      }));
    }
    try {
      task = JSON.parse(gunzipSync(await readFile(taskPath(sha))).toString());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (inbox.sources.some((entry) => entry.source.sha256 === sha))
        task = await request(`task/${sha}`, {});
      else {
        const source = sources.find((entry) => entry.source.sha256 === sha);
        const sourceBytes = await readFile(source.sourcePath);
        if (createHash("sha256").update(sourceBytes).digest("hex") !== sha)
          throw new Error("Selected source bytes changed.");
        task = await request("source", {
          sourceBytes: Array.from(sourceBytes),
          foundationSourceSha256: config.foundationSourceSha256,
          foundationSha256: config.foundationSha256,
        });
      }
      await save(taskPath(sha), gzipSync(JSON.stringify(task)));
    }
    if (task.source.sha256 !== sha || task.foundationSha256 !== config.foundationSha256)
      throw new Error("Task binding differs from assignment.");
    bindings.push({
      sourceSha256: sha,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      foundationSha256: task.foundationSha256,
      base: task.base,
      existingReviews: reviews,
    });
  }
  await save(join(job, "bindings.json"), JSON.stringify(bindings, null, 2));
} else {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const require = createRequire(new URL("../apps/inspector/package.json", import.meta.url));
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({
    root: repo,
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "beatmap-lens": join(repo, "packages/beatmap-lens/src/index.ts") } },
  });
  try {
    const domain = await vite.ssrLoadModule("/apps/inspector/src/annotation/workflow/domain.ts");
    const run = await json(join(job, "run.json"));
    const results = await json(join(job, "result.json"));
    if (["name", "version", "sha256"].some((key) => results.skill?.[key] !== config.skill[key]))
      throw new Error("Worker did not report the pinned skill.");
    if (
      results.charts.length !== assignment.charts.length ||
      new Set(results.charts.map((entry) => entry.sourceSha256)).size !== assignment.charts.length
    )
      throw new Error("Worker chart coverage differs from assignment.");
    for (const chart of assignment.charts) {
      const sha = chart.sourceSha256;
      const result = results.charts.find((entry) => entry.sourceSha256 === sha);
      if (!result) throw new Error("Assigned chart missing from worker result.");
      if (existing.charts.some((entry) => entry.sourceSha256 === sha)) continue;
      const task = await domain.assertTaskPacketV2(
        JSON.parse(gunzipSync(await readFile(taskPath(sha))).toString()),
      );
      const agent = {
        producerId: run.producerId,
        role: command === "label" ? "labeler" : "auditor",
        toolVersion: run.toolVersion,
        skill: config.skill,
      };
      let packet;
      if (command === "label") {
        if (!result.discoverySummary?.trim() || !result.inspectedRanges?.length)
          throw new Error("Chart needs retained discovery evidence, not only a delivered claim.");
        let inspectedThrough = task.structure.range.startMs;
        for (const range of [...result.inspectedRanges].sort((a, b) => a.startMs - b.startMs)) {
          if (range.startMs > inspectedThrough || range.endMs <= range.startMs)
            throw new Error("Full-chart structural discovery contains an uninspected gap.");
          inspectedThrough = Math.max(inspectedThrough, range.endMs);
        }
        if (inspectedThrough < task.structure.range.endMs)
          throw new Error("Full-chart structural discovery ends before the chart.");
        const byLine = new Map(task.structure.notes.map((note) => [note.sourceLine, note]));
        const refs = (lines) =>
          lines.map((line) => {
            if (!byLine.has(line)) throw new Error(`No source note at line ${line}.`);
            return byLine.get(line);
          });
        const proposals = result.claims.map((claim) => ({
          id: claim.id,
          sectionId: claim.sectionId,
          tagId: claim.tagId,
          scope: claim.scope,
          reviewContext: claim.reviewContext,
          assessment: claim.assessment,
          evidence: {
            noteRefs: refs(claim.noteLines),
            contextNoteRefs: refs(claim.contextLines),
            rationale: claim.rationale,
          },
        }));
        packet = await domain.sealHandoffV2(task, {
          handoffId: `${run.producerId}-${sha.slice(0, 12)}`,
          createdAt: run.startedAt,
          agent,
          proposals,
          audit: [],
          questions: result.questions,
        });
      } else if (command === "audit") {
        if (
          !result.coverageReview?.rationale?.trim() ||
          !["supported", "needs-revision"].includes(result.coverageReview.outcome)
        )
          throw new Error("Auditor must independently assess chart discovery coverage.");
        const handoff = await json(join(job, "handoffs", `${sha}.json`));
        packet = await domain.sealAuditV2(task, handoff, {
          auditId: `${run.producerId}-${sha.slice(0, 12)}`,
          createdAt: run.startedAt,
          agent,
          claims: result.claims,
          questions: result.questions,
        });
      } else throw new Error("Expected prepare, label or audit.");
      const packetFile = join(job, "packets", `${sha}.json`);
      await save(packetFile, JSON.stringify(packet, null, 2));
      const receipt = await request("submit", {
        kind: command === "label" ? "handoff" : "audit",
        packet,
      });
      if (!["imported", "duplicate"].includes(receipt.status) || receipt.baseStatus === "stale")
        throw new Error(`Unsettled delivery: ${JSON.stringify(receipt)}`);
      const feedback = await request(`feedback/${sha}`);
      await save(join(job, "feedback", `${sha}.json.gz`), gzipSync(JSON.stringify(feedback)));
      existing.charts.push({
        sourceSha256: sha,
        packetFile,
        receipt,
        ...(command === "label"
          ? { inspectedRanges: result.inspectedRanges, discoverySummary: result.discoverySummary }
          : { coverageReview: result.coverageReview }),
        statuses: feedback.agentReviews.map(({ handoffId, claimId, status }) => ({
          handoffId,
          claimId,
          status,
        })),
      });
      await save(outputPath, JSON.stringify(existing, null, 2));
    }
  } finally {
    await vite.close();
  }
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
async function request(path, body) {
  const response = await fetch(
    `${config.server}/api/review/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
  return result;
}
