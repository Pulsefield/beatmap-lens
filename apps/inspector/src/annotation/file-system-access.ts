import type { ReadableDirectoryHandle, ReadableFileHandle } from "./catalog";
import type { DatasetDirectoryHandle } from "./dataset-directory";

export type BrowserDirectoryHandle = DatasetDirectoryHandle &
  ReadableDirectoryHandle &
  PermissionCapableHandle;

export type BrowserFileHandle = ReadableFileHandle &
  PermissionCapableHandle & {
    readonly name: string;
  };

interface PermissionCapableHandle {
  queryPermission(options?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(options?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemHandlePermissionDescriptor {
  readonly mode?: "read" | "readwrite";
}

interface FilePickerAcceptType {
  readonly description?: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

interface PickerWindow extends Window {
  showDirectoryPicker(options?: {
    readonly id?: string;
    readonly mode?: "read" | "readwrite";
  }): Promise<BrowserDirectoryHandle>;
  showOpenFilePicker(options?: {
    readonly id?: string;
    readonly multiple?: boolean;
    readonly types?: readonly FilePickerAcceptType[];
  }): Promise<readonly BrowserFileHandle[]>;
}

export function supportsFileSystemAccess(): boolean {
  return "showDirectoryPicker" in window && "showOpenFilePicker" in window;
}

export async function pickDatasetDirectory(): Promise<BrowserDirectoryHandle> {
  return pickerWindow().showDirectoryPicker({
    id: "beatmap-lens-annotation-dataset",
    mode: "readwrite",
  });
}

export async function pickCorpusDirectory(): Promise<BrowserDirectoryHandle> {
  return pickerWindow().showDirectoryPicker({
    id: "beatmap-lens-annotation-corpus",
    mode: "read",
  });
}

export async function pickCatalogManifest(): Promise<BrowserFileHandle> {
  const [handle] = await pickerWindow().showOpenFilePicker({
    id: "beatmap-lens-annotation-catalog",
    multiple: false,
    types: [
      {
        description: "Beatmap Lens catalog manifest",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  if (!handle) throw new Error("No catalog manifest was selected.");
  return handle;
}

export async function ensureHandlePermission(
  handle: PermissionCapableHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  const options = { mode } as const;
  return (
    (await handle.queryPermission(options)) === "granted" ||
    (await handle.requestPermission(options)) === "granted"
  );
}

export async function hasHandlePermission(
  handle: PermissionCapableHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  return (await handle.queryPermission({ mode })) === "granted";
}

function pickerWindow(): PickerWindow {
  if (!supportsFileSystemAccess()) {
    throw new Error("Section annotation requires Chromium's File System Access API.");
  }
  return window as unknown as PickerWindow;
}
