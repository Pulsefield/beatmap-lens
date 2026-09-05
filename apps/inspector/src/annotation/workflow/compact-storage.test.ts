import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { serializeCanonicalJson } from "../canonical-json";
import { WorkflowConflictError, WorkflowDirectoryV2 } from "./directory";
import { hashWorkflowValueV2 } from "./domain";
import { workflowFixture } from "./test-fixtures";

const adapterUrl = pathToFileURL(resolve("scripts/workflow-local-directory.mjs")).href;
const { LocalDirectoryHandle, compactReviewWorkspace } = await import(
  /* @vite-ignore */ adapterUrl
);
const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const f = await workflowFixture();
  const workspace = await mkdtemp(join(tmpdir(), "workflow-storage-"));
  workspaces.push(workspace);
  const root = new LocalDirectoryHandle(workspace);
  const workflow = await root.getDirectoryHandle("workflow", { create: true });
  const filename = `${f.inspected.source.sha256}.v2.json`;
  const canonical = serializeCanonicalJson(f.registered);
  await writeFile(join(workspace, "workflow", filename), canonical);
  const file = await workflow.getFileHandle(filename);
  return {
    ...f,
    workspace,
    root,
    file,
    filename,
    canonical,
    directory: new WorkflowDirectoryV2(root),
  };
}

describe("compact local workflow storage", () => {
  it("reads legacy bytes and shares immutable Foundation/source objects across exact document views", async () => {
    const f = await fixture();
    expect(await (await f.file.getFile()).text()).toBe(f.canonical);
    const before = await f.directory.read(f.inspected.source.sha256);
    const result = await compactReviewWorkspace(f.workspace);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    const shared = await f.directory.read(f.inspected.source.sha256);
    expect(shared).toEqual(before);
    expect(shared?.document.foundation).toBe(shared?.document.tasks[0]?.foundation);
    expect(shared?.document.foundation.calibrationExamples[0]?.sourceBytes).toBe(
      shared?.document.tasks[0]?.sourceBytes,
    );
    const file = await f.file.getFile();
    expect(await file.text()).toBe(f.canonical);
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe(f.canonical);
    const physical = JSON.parse(await readFile(join(f.workspace, "workflow", f.filename), "utf8"));
    expect(physical.storage).toBe("beatmap-lens-local-compact-v1");
    expect(physical.document.foundation.$localBlob.kind).toBe("json");
    expect(physical.document.tasks[0].$localBlob.kind).toBe("json");
    expect(
      await readFile(join(f.workspace, ".workflow-objects", `${f.inspected.source.sha256}.bin`)),
    ).toEqual(Buffer.from(f.sourceBytes));

    const secondBytes = new TextEncoder().encode(
      new TextDecoder().decode(f.sourceBytes).replace("Version: Mixed", "Version: Another"),
    );
    const second = await f.directory.registerSourceFromApprovedFoundation(secondBytes, {
      sourceSha256: f.inspected.source.sha256,
      foundationSha256: await hashWorkflowValueV2(f.registered.foundation),
    });
    const secondPhysical = JSON.parse(
      await readFile(join(f.workspace, "workflow", `${second.task.source.sha256}.v2.json`), "utf8"),
    );
    expect(secondPhysical.document.foundation).toEqual(physical.document.foundation);
    expect(await f.directory.read(second.task.source.sha256)).toEqual(second.stored);
    const names = await readdir(join(f.workspace, ".workflow-objects"));
    expect(names.filter((name) => name.endsWith(".json.gz"))).toHaveLength(3); // One Foundation, two tasks.
    expect(names.filter((name) => name.endsWith(".bin"))).toHaveLength(2);
    const objectTimes = await Promise.all(
      names.map((name) => stat(join(f.workspace, ".workflow-objects", name))),
    );
    const again = await compactReviewWorkspace(f.workspace);
    expect(again.beforeBytes).toBe(again.afterBytes);
    expect(
      await Promise.all(names.map((name) => stat(join(f.workspace, ".workflow-objects", name)))),
    ).toEqual(objectTimes);
  });

  it("preserves the canonical writer, frozen task history, and compare-and-swap conflicts", async () => {
    const f = await fixture();
    const original = await f.directory.read(f.inspected.source.sha256);
    if (!original) throw new Error("Fixture review missing");
    await compactReviewWorkspace(f.workspace);
    const imported = await f.directory.importHandoff(f.sourceBytes, original.version, f.handoff);
    expect(imported.stored.document.tasks[0]).toEqual(f.task);
    expect(imported.stored.document.handoffs[0]?.handoff).toEqual(f.handoff);
    const reopened = new WorkflowDirectoryV2(new LocalDirectoryHandle(f.workspace));
    expect(await reopened.read(f.inspected.source.sha256)).toEqual(imported.stored);
    await expect(
      reopened.importHandoff(f.sourceBytes, original.version, f.handoff),
    ).rejects.toBeInstanceOf(WorkflowConflictError);
    const duplicate = await reopened.importHandoff(
      f.sourceBytes,
      imported.stored.version,
      f.handoff,
    );
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.stored).toEqual(imported.stored);
  });

  it("detects changed source blobs before exposing reconstructed canonical content", async () => {
    const f = await fixture();
    await compactReviewWorkspace(f.workspace);
    const path = join(f.workspace, ".workflow-objects", `${f.inspected.source.sha256}.bin`);
    const bytes = await readFile(path);
    const first = bytes[0];
    if (first === undefined) throw new Error("Fixture source is empty");
    bytes[0] = first ^ 1;
    await writeFile(path, bytes);
    await expect(f.file.getFile()).rejects.toThrow("Local workflow object hash differs");
    await expect(f.directory.read(f.inspected.source.sha256)).rejects.toThrow(
      "Local workflow object hash differs",
    );
  });

  it("verifies the compact envelope canonical hash on shared-object reads", async () => {
    const f = await fixture();
    await compactReviewWorkspace(f.workspace);
    const path = join(f.workspace, "workflow", f.filename);
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.canonicalSha256 = "0".repeat(64);
    await writeFile(path, JSON.stringify(envelope));
    await expect(f.directory.read(f.inspected.source.sha256)).rejects.toThrow(
      "stored hash differs",
    );
  });
});
