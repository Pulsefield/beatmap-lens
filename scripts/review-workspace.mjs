import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { atomicWrite, LocalDirectoryHandle } from "./workflow-local-directory.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/inspector/package.json", import.meta.url));
const packetContracts = {
  handoff: "beatmap-lens-agent-handoff",
  audit: "beatmap-lens-independent-audit",
};

/** One local writer owns both HTTP commands and filesystem exchange delivery. */
export async function startReviewWorkspace(options) {
  const workspace = resolve(options.workspace);
  const exchange = join(workspace, "exchange");
  const staticRoot = resolve(options.staticRoot ?? join(repo, "apps/inspector/dist"));
  for (const name of ["inbox", "outbox", "receipts", "requests"]) {
    await mkdir(join(exchange, name), { recursive: true });
  }
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({
    root: repo,
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "beatmap-lens": join(repo, "packages/beatmap-lens/src/index.ts") } },
  });
  const domain = await vite.ssrLoadModule("/apps/inspector/src/annotation/workflow/domain.ts");
  const { WorkflowDirectoryV2 } = await vite.ssrLoadModule(
    "/apps/inspector/src/annotation/workflow/directory.ts",
  );
  const { serializeCanonicalJson } = await vite.ssrLoadModule(
    "/apps/inspector/src/annotation/canonical-json.ts",
  );
  const directory = new WorkflowDirectoryV2(new LocalDirectoryHandle(workspace));
  const receipts = new Map();
  const requests = new Map();
  // Full documents include large frozen source/Foundation snapshots; inbox summaries never do.
  const sources = new Map();
  const summaries = new Map();
  let fullSourceReads = 0;
  const errors = [];
  let pending = Promise.resolve();
  const exclusive = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
  const json = (value) => serializeCanonicalJson(value);
  const digest = (value) => createHash("sha256").update(value).digest("hex");

  async function sourceStamp(sha) {
    if (!/^[a-f\d]{64}$/.test(sha)) throw httpError(400, "Invalid source SHA-256.");
    const filename = join(workspace, "workflow", `${sha}.v2.json`);
    const info = await stat(filename).catch((error) => {
      if (error.code === "ENOENT")
        throw httpError(404, "Source is not registered in this workspace.");
      throw error;
    });
    return `${info.mtimeMs}:${info.size}`;
  }

  async function source(sha) {
    const stamp = await sourceStamp(sha);
    const cached = sources.get(sha);
    if (cached?.stamp === stamp) {
      sources.delete(sha);
      sources.set(sha, cached);
      return cached;
    }
    const stored = await directory.read(sha);
    fullSourceReads++;
    const task = stored.document.tasks.at(-1);
    if (!task)
      throw httpError(400, "This source has no registered task containing its exact bytes.");
    const value = {
      stamp,
      stored,
      sourceBytes: Uint8Array.from(task.sourceBytes),
      task,
    };
    const { document, version } = stored;
    const agentReviews = await domain.readAgentReviewsV2(document);
    const reviews = agentReviews.map(
      ({ handoffId, claimId, claim, status, rationale, question, expertReason }) => ({
        handoffId,
        claimId,
        tagId: claim.tagId,
        scope: claim.scope,
        status,
        rationale,
        ...(question ? { question } : {}),
        ...(expertReason ? { expertReason } : {}),
      }),
    );
    const counts = { total: reviews.length };
    for (const row of reviews) counts[row.status] = (counts[row.status] ?? 0) + 1;
    const currentSummary = {
      stamp,
      row: {
        source: document.source,
        version,
        updatedAt: document.updatedAt,
        latestTaskId: task.taskId,
        counts,
        expertQueue: reviews.filter((row) => row.status === "needs-expert"),
        reviews,
      },
      decidedClaims: new Set(
        document.decisions.map((decision) => json([decision.handoffId, decision.claimId])),
      ),
      handoffs: new Map(
        document.handoffs.map((entry) => [
          entry.handoff.handoffId,
          {
            sha256: entry.handoffSha256,
            claimIds: new Set(entry.handoff.proposals.map((claim) => claim.id)),
          },
        ]),
      ),
    };
    currentSummary.feedback = await createFeedback(value, agentReviews, currentSummary);
    summaries.set(sha, currentSummary);
    await saveSummary(sha, currentSummary);
    sources.delete(sha);
    sources.set(sha, value);
    while (sources.size > 1) sources.delete(sources.keys().next().value);
    return value;
  }

  async function summary(sha) {
    const stamp = await sourceStamp(sha);
    if (summaries.get(sha)?.stamp !== stamp) {
      const saved = await readFile(
        join(exchange, "outbox", `${sha}.feedback-cache.json`),
        "utf8",
      ).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      const cached = saved ? JSON.parse(saved) : undefined;
      if (cached?.stamp === stamp && cached.row.source.sha256 === sha) {
        summaries.set(sha, {
          ...cached,
          restored: true,
          decidedClaims: new Set(cached.decidedClaims),
          handoffs: new Map(
            cached.handoffs.map(([id, value]) => [
              id,
              { ...value, claimIds: new Set(value.claimIds) },
            ]),
          ),
        });
      } else await source(sha);
    }
    return summaries.get(sha);
  }

  async function saveSummary(sha, current) {
    await atomicWrite(
      join(exchange, "outbox", `${sha}.feedback-cache.json`),
      json({
        ...current,
        decidedClaims: [...current.decidedClaims],
        handoffs: [...current.handoffs].map(([id, value]) => [
          id,
          { ...value, claimIds: [...value.claimIds] },
        ]),
      }),
    );
  }

  function reviewRequests(current) {
    return [...requests.values()]
      .filter((request) => request.sourceSha256 === current.row.source.sha256)
      .map((request) => ({
        ...request,
        pendingClaimIds: request.claimIds.filter(
          (claimId) => !current.decidedClaims.has(json([request.handoffId, claimId])),
        ),
      }));
  }

  async function dispositions(sha) {
    const { stored } = await source(sha);
    const value = {
      ...(await domain.readDispositionsV2(stored.document)),
      documentVersion: stored.version,
      reviewRequests: reviewRequests(summaries.get(sha)),
    };
    await atomicWrite(join(exchange, "outbox", `${sha}.dispositions.json`), json(value));
    return value;
  }

  async function feedback(sha) {
    const current = await summary(sha);
    return { ...current.feedback, reviewRequests: reviewRequests(current) };
  }

  async function createFeedback({ stored, task }, reviews, current) {
    const { document, version } = stored;
    const observations = new Map(document.observations.map((entry) => [entry.id, entry]));
    const baseStatuses = new Map(reviews.map((row) => [row.handoffId, row.baseStatus]));
    return {
      contract: "beatmap-lens-agent-feedback",
      version: 2,
      sourceSha256: document.source.sha256,
      documentVersion: version,
      reviewBase: await domain.baseForTaskV2(document),
      taskBinding: taskBinding(task),
      counts: current.row.counts,
      agentReviews: reviews.map((row) => ({
        handoffId: row.handoffId,
        claimId: row.claimId,
        status: row.status,
        baseStatus: row.baseStatus,
        summary: claimSummary(row.claim),
        audits: row.audits.map(({ auditId, result }) => ({ auditId, result })),
        ...(row.decision ? { decision: row.decision } : {}),
        ...(row.decision?.disposition === "modified"
          ? { modifiedClaim: observations.get(row.decision.observationId).claim }
          : {}),
        ...(row.expertReason ? { expertReason: row.expertReason } : {}),
        ...(row.question ? { question: row.question } : {}),
      })),
      handoffs: await Promise.all(
        document.handoffs.map(async ({ handoff, handoffSha256, baseStatus }) => ({
          handoffId: handoff.handoffId,
          handoffSha256,
          ...taskBinding(handoff),
          agent: handoff.agent,
          baseStatus:
            baseStatuses.get(handoff.handoffId) ??
            (await domain.handoffBaseStatusV2(document, handoff.handoffId)),
          importedBaseStatus: baseStatus,
          embeddedAudit: handoff.audit,
          questions: handoff.questions,
        })),
      ),
      audits: (document.audits ?? []).map(({ audit, auditSha256, baseStatus }) => ({
        auditId: audit.auditId,
        auditSha256,
        handoffId: audit.handoffId,
        handoffSha256: audit.handoffSha256,
        ...taskBinding(audit),
        agent: audit.agent,
        importedBaseStatus: baseStatus,
        questions: audit.questions,
      })),
      directObservations: document.observations
        .filter((entry) => entry.origin.kind === "direct-human")
        .map(({ claim, ...entry }) => ({ ...entry, summary: claimSummary(claim) })),
    };
  }

  function taskBinding(packet) {
    return {
      taskId: packet.taskId,
      taskSha256: packet.taskSha256,
      foundationSha256: packet.foundationSha256,
      base: packet.base,
    };
  }

  function claimSummary(claim) {
    const { evidence, transition, ...fields } = claim;
    const summarizeEvidence = ({ rationale, noteRefs, contextNoteRefs }) => ({
      rationale,
      witnessCount: noteRefs.length,
      contextNoteCount: contextNoteRefs.length,
    });
    return {
      ...fields,
      ...summarizeEvidence(evidence),
      ...(transition
        ? {
            transition: {
              range: transition.range,
              description: transition.description,
              ...summarizeEvidence(transition.evidence),
            },
          }
        : {}),
    };
  }

  async function saveReceipt(receipt) {
    await atomicWrite(join(exchange, "receipts", `${receipt.id}.json`), json(receipt));
    receipts.set(receipt.id, receipt);
    return receipt;
  }

  async function validateRequest(input) {
    exactKeys(input, [
      "requestId",
      "sourceSha256",
      "handoffId",
      "handoffSha256",
      "claimIds",
      "reason",
      "question",
      "requestedBy",
      "createdAt",
    ]);
    for (const key of ["requestId", "question", "createdAt"]) nonempty(input[key], key);
    if (!Number.isFinite(Date.parse(input.createdAt)))
      throw new Error("Invalid request createdAt.");
    if (input.reason !== "spot-check")
      throw new Error("Only explicit spot-check delivery is supported.");
    exactKeys(input.requestedBy, ["producerId", "role"]);
    nonempty(input.requestedBy.producerId, "requestedBy.producerId");
    if (!["labeler", "auditor", "curator"].includes(input.requestedBy.role)) {
      throw new Error("Unsupported review requester role.");
    }
    const original = (await summary(input.sourceSha256)).handoffs.get(input.handoffId);
    if (!original) return null;
    if (original.sha256 !== input.handoffSha256) {
      throw new Error("Review request targets different immutable handoff content.");
    }
    if (
      !Array.isArray(input.claimIds) ||
      !input.claimIds.length ||
      new Set(input.claimIds).size !== input.claimIds.length ||
      input.claimIds.some((id) => !original.claimIds.has(id))
    )
      throw new Error("Review request must name existing unique claims in the original handoff.");
    return input;
  }

  async function processPacket(envelope, receiptId, receivedAt) {
    const previous = receipts.get(receiptId);
    if (previous && previous.status !== "pending") return previous;
    const { kind, packet } = envelope;
    const receipt = {
      id: receiptId,
      kind,
      receivedAt,
      ...(typeof packet.sourceSha256 === "string" ? { sourceSha256: packet.sourceSha256 } : {}),
      ...((
        kind === "audit"
          ? packet.auditId
          : kind === "handoff"
            ? packet.handoffId
            : packet.requestId
      )
        ? {
            packetId:
              kind === "audit"
                ? packet.auditId
                : kind === "handoff"
                  ? packet.handoffId
                  : packet.requestId,
          }
        : {}),
    };
    try {
      exactKeys(envelope, ["kind", "packet"]);
      if (!["handoff", "audit", "review-request"].includes(kind))
        throw new Error("Unsupported machine submission kind.");
      if (kind !== "review-request" && packet.contract !== packetContracts[kind]) {
        throw new Error("Submission kind and sealed packet contract disagree.");
      }
      if (kind === "review-request") {
        const request = await validateRequest(packet);
        if (!request)
          return saveReceipt({
            ...receipt,
            status: "pending",
            error: "Waiting for the original handoff.",
          });
        const existing = requests.get(request.requestId);
        if (existing && json(existing) !== json(request))
          throw new Error("Request ID already has different immutable content.");
        if (!existing) {
          await atomicWrite(
            join(exchange, "requests", `${digest(request.requestId)}.json`),
            json(request),
          );
          requests.set(request.requestId, request);
        }
        await dispositions(packet.sourceSha256);
        return saveReceipt({
          ...receipt,
          status: existing ? "duplicate" : "imported",
          processedAt: new Date().toISOString(),
        });
      }
      if (
        kind === "audit" &&
        !(await summary(packet.sourceSha256)).handoffs.has(packet.handoffId)
      ) {
        return saveReceipt({
          ...receipt,
          status: "pending",
          error: "Waiting for the original handoff.",
        });
      }
      const current = await source(packet.sourceSha256);
      const result = await directory[kind === "handoff" ? "importHandoff" : "importAudit"](
        current.sourceBytes,
        current.stored.version,
        packet,
      );
      sources.delete(packet.sourceSha256);
      await dispositions(packet.sourceSha256);
      return saveReceipt({
        ...receipt,
        status: result.status,
        baseStatus: result.baseStatus,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      return saveReceipt({
        ...receipt,
        status: "error",
        error: error.message,
        processedAt: new Date().toISOString(),
      });
    }
  }

  async function processInbox() {
    const incoming = [];
    for (const name of (await readdir(join(exchange, "inbox")))
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const text = await readFile(join(exchange, "inbox", name), "utf8");
      try {
        const value = JSON.parse(text);
        const envelope =
          value.kind && value.packet
            ? value
            : {
                kind:
                  value.contract === packetContracts.handoff
                    ? "handoff"
                    : value.contract === packetContracts.audit
                      ? "audit"
                      : "review-request",
                packet: value,
              };
        const id = digest(json(envelope));
        if (receipts.has(id) && receipts.get(id).status !== "pending") continue;
        incoming.push({
          envelope,
          id,
          receivedAt: receipts.get(id)?.receivedAt ?? new Date().toISOString(),
          name,
        });
      } catch (error) {
        const id = digest(text);
        if (!receipts.has(id))
          await saveReceipt({
            id,
            filename: name,
            status: "error",
            error: error.message,
            receivedAt: new Date().toISOString(),
            processedAt: new Date().toISOString(),
          });
      }
    }
    const rank = { handoff: 0, audit: 1, "review-request": 2 };
    incoming.sort(
      (a, b) =>
        (rank[a.envelope.kind] ?? 3) - (rank[b.envelope.kind] ?? 3) || a.name.localeCompare(b.name),
    );
    for (const item of incoming) await processPacket(item.envelope, item.id, item.receivedAt);
  }

  async function inbox(exportDispositions = false) {
    const rows = [];
    const files = await readdir(join(workspace, "workflow")).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const filename of files.filter((name) => /^[a-f\d]{64}\.v2\.json$/.test(name)).sort()) {
      try {
        const current = await summary(filename.slice(0, 64));
        rows.push({ ...current.row, requests: reviewRequests(current) });
        if (exportDispositions && !current.restored) await dispositions(filename.slice(0, 64));
      } catch (error) {
        if (!errors.some((entry) => entry.filename === filename && entry.error === error.message))
          errors.push({ filename, error: error.message });
      }
    }
    return { workspace, sources: rows, receipts: [...receipts.values()], errors };
  }

  for (const name of (await readdir(join(exchange, "receipts"))).filter((name) =>
    name.endsWith(".json"),
  )) {
    const receipt = JSON.parse(await readFile(join(exchange, "receipts", name), "utf8"));
    receipts.set(receipt.id, receipt);
  }
  for (const name of (await readdir(join(exchange, "requests"))).filter((name) =>
    name.endsWith(".json"),
  )) {
    const request = await validateRequest(
      JSON.parse(await readFile(join(exchange, "requests", name), "utf8")),
    );
    if (request) requests.set(request.requestId, request);
  }

  async function api(request, response, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const action = parts[2];
    const sha = parts[3];
    if (request.method === "GET") {
      if (action === "inbox") return send(response, 200, await inbox());
      if (action === "source") {
        const current = await source(sha);
        return send(response, 200, {
          ...current.stored,
          sourceBytes: Array.from(current.sourceBytes),
        });
      }
      if (action === "task") return send(response, 200, (await source(sha)).task);
      if (action === "dispositions") return send(response, 200, await dispositions(sha));
      if (action === "feedback") return send(response, 200, await feedback(sha));
    }
    if (request.method === "POST") {
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw httpError(400, "Expected application/json.");
      const body = JSON.parse(await readBody(request));
      if (action === "source" && !sha) {
        exactKeys(body, ["sourceBytes", "foundationSourceSha256", "foundationSha256"]);
        if (
          !Array.isArray(body.sourceBytes) ||
          !body.sourceBytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
        )
          throw httpError(400, "sourceBytes must contain exact byte values.");
        const result = await directory.registerSourceFromApprovedFoundation(
          Uint8Array.from(body.sourceBytes),
          { sourceSha256: body.foundationSourceSha256, foundationSha256: body.foundationSha256 },
        );
        sources.delete(result.task.source.sha256);
        await dispositions(result.task.source.sha256);
        return send(response, 200, result.task);
      }
      if (action === "task") {
        exactKeys(body, "taskId" in body ? ["taskId"] : []);
        if ("taskId" in body) nonempty(body.taskId, "taskId");
        const current = await source(sha);
        if (current.stored.document.foundation.approval.status !== "human-approved") {
          throw httpError(
            400,
            "The current Foundation needs human approval before agent task issuance.",
          );
        }
        const result = await directory.exportTask(
          current.sourceBytes,
          current.stored.version,
          body,
        );
        sources.delete(sha);
        await dispositions(sha);
        return send(response, 200, result.task);
      }
      if (action === "submit") {
        exactKeys(body, ["kind", "packet"]);
        if (!body.packet || typeof body.packet !== "object")
          throw httpError(400, "Expected a sealed packet.");
        const id = digest(json(body));
        const filename = `${id}.json`;
        await atomicWrite(join(exchange, "inbox", filename), json(body));
        const receipt = await processPacket(
          body,
          id,
          receipts.get(id)?.receivedAt ?? new Date().toISOString(),
        );
        await processInbox();
        return send(response, receipt.status === "error" ? 400 : 200, receipts.get(id));
      }
      if (action === "human") {
        exactKeys(body, ["expectedBase", "input"]);
        const current = await source(sha);
        const operation = parts[4];
        let result;
        if (operation === "decide" || operation === "addObservations")
          result = await directory[operation](current.sourceBytes, body.expectedBase, body.input);
        else if (operation === "exportTask")
          result = await directory.exportTask(current.sourceBytes, body.expectedBase, body.input);
        else if (operation === "approveFoundation") {
          exactKeys(body.input, ["humanId"]);
          result = await directory.approveFoundation(
            current.sourceBytes,
            body.expectedBase,
            body.input.humanId,
          );
        } else throw httpError(400, "Unsupported human command.");
        sources.delete(sha);
        await dispositions(sha);
        return send(response, 200, result);
      }
    }
    throw httpError(404, "Unknown review endpoint.");
  }

  function send(response, status, value) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(json(value));
  }

  const server = createHttpServer((request, response) => {
    exclusive(async () => {
      const port = server.address().port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
        throw httpError(403, "Only the local Review service host is allowed.");
      }
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/review/")) {
        // Same-origin browser writes and explicit local HTTP clients use separate machine/human routes.
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}`)
          throw httpError(403, "Cross-origin review access is not allowed.");
        return api(request, response, url);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw httpError(405, "Read-only static content.");
      const requested =
        url.pathname === "/" || url.pathname === "/review"
          ? "index.html"
          : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filename = resolve(staticRoot, requested);
      if (!filename.startsWith(`${staticRoot}${sep}`)) throw httpError(404, "Unknown static file.");
      let content;
      try {
        content = await readFile(filename);
      } catch (error) {
        if (error.code === "ENOENT")
          throw httpError(404, "Inspector build is missing. Build apps/inspector first.");
        throw error;
      }
      const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".png": "image/png",
        ".json": "application/json",
      };
      response.writeHead(200, {
        "Content-Type": `${mime[extname(filename)] ?? "application/octet-stream"}; charset=utf-8`,
        "Cache-Control": "no-cache",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    }).catch((error) => {
      if (response.headersSent) return response.end();
      send(response, error.name === "WorkflowConflictError" ? 409 : (error.status ?? 400), {
        error: error.message,
        ...(error.name === "WorkflowConflictError" ? { actual: error.actual } : {}),
      });
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4176, "127.0.0.1", resolveListen);
  });
  await exclusive(async () => {
    await processInbox();
    // Keep startup hydration serialized with already connected browser polling.
    await inbox(true);
  });
  let scanning = false;
  const timer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    exclusive(processInbox)
      .catch((error) => errors.push({ error: error.message }))
      .finally(() => {
        scanning = false;
      });
  }, options.pollIntervalMs ?? 1000);
  timer.unref();
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    cacheInfo: () => ({ fullSources: sources.size, summaries: summaries.size, fullSourceReads }),
    processInbox: () => exclusive(processInbox),
    close: async () => {
      clearInterval(timer);
      await pending;
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
      await vite.close();
    },
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  ) {
    throw httpError(400, `Expected only ${keys.join(", ")}.`);
  }
}

function nonempty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be nonempty text.`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { workspace: { type: "string" }, port: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help || !values.workspace) {
    process.stdout.write(
      "Local Review writer\n  node scripts/review-workspace.mjs --workspace PATH [--port 4176]\n\nOpen /review. Agents submit handoff, audit or review-request packets through\n/api/review/submit or exchange/inbox/*.json, and read exchange/outbox dispositions.\n",
    );
    process.exit(values.help ? 0 : 1);
  }
  const service = await startReviewWorkspace({
    workspace: values.workspace,
    port: values.port ? Number(values.port) : 4176,
  });
  process.stdout.write(
    `${JSON.stringify({ url: `${service.url}/review`, workspace: resolve(values.workspace) })}\n`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => service.close().then(() => process.exit(0)));
}
