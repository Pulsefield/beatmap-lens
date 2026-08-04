import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceLifecycleState,
  DraftJournalQueue,
  runWorkspaceOperation,
  type WorkspaceOperation,
  workspaceOperationFlags,
} from "./workspace-lifecycle";

describe("workspace lifecycle", () => {
  it("acquires an operation synchronously and keeps it through async completion", async () => {
    const lifecycle = createWorkspaceLifecycleState("stored");
    const pending = deferred<void>();
    const operation = runWorkspaceOperation(lifecycle, "canonical-save", async () => {
      await pending.promise;
      return "saved";
    });

    expect(lifecycle).toEqual({
      activeOperation: "canonical-save",
      draftLifecycle: "stored",
    });

    pending.resolve();

    await expect(operation).resolves.toEqual({ started: true, value: "saved" });
    expect(lifecycle.activeOperation).toBeUndefined();
  });

  it("rejects a nested operation without running its action", async () => {
    const lifecycle = createWorkspaceLifecycleState();
    const pending = deferred<void>();
    const nestedAction = vi.fn();
    const outer = runWorkspaceOperation(lifecycle, "activate-tag", () => pending.promise);

    await expect(runWorkspaceOperation(lifecycle, "change-mode", nestedAction)).resolves.toEqual({
      started: false,
    });
    expect(nestedAction).not.toHaveBeenCalled();
    expect(lifecycle.activeOperation).toBe("activate-tag");

    pending.resolve();
    await outer;
  });

  it("holds a canonical operation through the final draft reconcile", async () => {
    const lifecycle = createWorkspaceLifecycleState("stored");
    const reconcile = deferred<void>();
    const secondSave = vi.fn();
    const firstSave = runWorkspaceOperation(lifecycle, "canonical-save", async () => {
      lifecycle.draftLifecycle = "pending";
      await reconcile.promise;
      lifecycle.draftLifecycle = "stored";
    });

    await expect(runWorkspaceOperation(lifecycle, "canonical-save", secondSave)).resolves.toEqual({
      started: false,
    });
    expect(secondSave).not.toHaveBeenCalled();

    reconcile.resolve();
    await firstSave;
    expect(lifecycle.activeOperation).toBeUndefined();
    expect(lifecycle.draftLifecycle).toBe("stored");
  });

  it("keeps failed cleanup visible until a later cleanup succeeds", async () => {
    const lifecycle = createWorkspaceLifecycleState("stored");
    const journal = new DraftJournalQueue(lifecycle);

    await expect(
      journal.cleanup(async () => Promise.reject(new Error("delete failed"))),
    ).rejects.toThrow("delete failed");
    expect(lifecycle.draftLifecycle).toBe("cleanup-error");

    await journal.cleanup(async () => {});
    expect(lifecycle.draftLifecycle).toBe("clean");
  });

  it("keeps failed writes recoverable and serializes the retry", async () => {
    const lifecycle = createWorkspaceLifecycleState();
    const journal = new DraftJournalQueue(lifecycle);
    const events: string[] = [];

    await expect(
      journal.write(async () => {
        events.push("write-failed");
        throw new Error("put failed");
      }),
    ).rejects.toThrow("put failed");
    expect(lifecycle.draftLifecycle).toBe("write-error");

    await journal.write(async () => {
      events.push("write-retried");
    });
    expect(events).toEqual(["write-failed", "write-retried"]);
    expect(lifecycle.draftLifecycle).toBe("stored");
  });

  it("releases the operation when its action throws", async () => {
    const lifecycle = createWorkspaceLifecycleState();
    const failure = new Error("canonical write failed");

    await expect(
      runWorkspaceOperation(lifecycle, "canonical-save", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(lifecycle.activeOperation).toBeUndefined();
  });

  it.each([
    [undefined, false, false, false, false, false],
    ["open-task", true, true, false, false, false],
    ["change-mode", true, false, false, false, false],
    ["activate-tag", true, false, true, false, false],
    ["canonical-save", true, false, false, false, false],
    ["discard-draft", true, false, false, false, false],
    ["quality-update", true, false, false, true, false],
    ["release-preview", true, false, false, false, true],
    ["release-confirm", true, false, false, false, true],
  ] satisfies readonly [
    WorkspaceOperation | undefined,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
  ][])(
    "derives busy flags from %s",
    (operation, operationLocked, taskLoading, activationBusy, qualityBusy, releaseBusy) => {
      expect(workspaceOperationFlags(operation)).toEqual({
        operationLocked,
        taskLoading,
        activationBusy,
        qualityBusy,
        releaseBusy,
      });
    },
  );
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
