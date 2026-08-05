export type WorkspaceOperation =
  | "open-task"
  | "change-mode"
  | "activate-tag"
  | "canonical-save"
  | "discard-draft"
  | "quality-update"
  | "release-preview"
  | "release-confirm";

export type DraftLifecycle = "clean" | "pending" | "stored" | "write-error" | "cleanup-error";

export interface WorkspaceLifecycleState {
  activeOperation: WorkspaceOperation | undefined;
  draftLifecycle: DraftLifecycle;
}

export interface WorkspaceOperationFlags {
  readonly operationLocked: boolean;
  readonly taskLoading: boolean;
  readonly activationBusy: boolean;
  readonly qualityBusy: boolean;
  readonly releaseBusy: boolean;
}

export class DraftJournalQueue {
  #pending = Promise.resolve();
  #revision = 0;

  constructor(private readonly state: WorkspaceLifecycleState) {}

  get pending(): Promise<void> {
    return this.#pending;
  }

  cleanup(action: () => Promise<void>): Promise<void> {
    return this.#enqueue(action, "clean", "cleanup-error");
  }

  write(action: () => Promise<void>): Promise<void> {
    return this.#enqueue(action, "stored", "write-error");
  }

  #enqueue(
    action: () => Promise<void>,
    success: "clean" | "stored",
    failure: "write-error" | "cleanup-error",
  ): Promise<void> {
    const revision = ++this.#revision;
    this.state.draftLifecycle = "pending";
    const queued = this.#pending
      .catch(() => {})
      .then(action)
      .then(
        () => {
          if (revision === this.#revision) this.state.draftLifecycle = success;
        },
        (error) => {
          if (revision === this.#revision) this.state.draftLifecycle = failure;
          throw error;
        },
      );
    this.#pending = queued;
    return queued;
  }
}

export type WorkspaceOperationResult<T> =
  | { readonly started: false }
  | { readonly started: true; readonly value: T };

export function createWorkspaceLifecycleState(
  draftLifecycle: DraftLifecycle = "clean",
): WorkspaceLifecycleState {
  return {
    activeOperation: undefined,
    draftLifecycle,
  };
}

export async function runWorkspaceOperation<T>(
  state: WorkspaceLifecycleState,
  operation: WorkspaceOperation,
  action: () => T | Promise<T>,
): Promise<WorkspaceOperationResult<T>> {
  if (state.activeOperation !== undefined) return { started: false };

  state.activeOperation = operation;
  try {
    return { started: true, value: await action() };
  } finally {
    state.activeOperation = undefined;
  }
}

export function workspaceOperationFlags(
  activeOperation: WorkspaceOperation | undefined,
): WorkspaceOperationFlags {
  return {
    operationLocked: activeOperation !== undefined,
    taskLoading: activeOperation === "open-task",
    activationBusy: activeOperation === "activate-tag",
    qualityBusy: activeOperation === "quality-update",
    releaseBusy: activeOperation === "release-preview" || activeOperation === "release-confirm",
  };
}
