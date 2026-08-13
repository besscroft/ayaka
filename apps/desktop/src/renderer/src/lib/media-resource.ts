import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export interface MediaResourcePart {
  type: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  data?: string;
}

export interface MediaResourceState {
  url?: string;
  loading: boolean;
  error: boolean;
}

export function createWorkspaceMediaBlob(data: unknown, mediaType: string): Blob {
  const bytes = normalizeWorkspaceFileData(data);
  if (!bytes || bytes.byteLength === 0) {
    throw new Error("Workspace media data is empty or is not a byte array.");
  }
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  return new Blob([ownedBytes], { type: mediaType || "application/octet-stream" });
}

const objectToString = (value: unknown): string => Object.prototype.toString.call(value);

function isArrayBufferValue(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || objectToString(value) === "[object ArrayBuffer]";
}

function isTypedArrayValue(value: unknown): boolean {
  const tag = objectToString(value);
  return (
    tag === "[object Int8Array]" ||
    tag === "[object Uint8Array]" ||
    tag === "[object Uint8ClampedArray]" ||
    tag === "[object Int16Array]" ||
    tag === "[object Uint16Array]" ||
    tag === "[object Int32Array]" ||
    tag === "[object Uint32Array]" ||
    tag === "[object Float32Array]" ||
    tag === "[object Float64Array]" ||
    tag === "[object BigInt64Array]" ||
    tag === "[object BigUint64Array]"
  );
}

interface ResourceEntry extends MediaResourcePart {
  id: string;
  source?: string;
}

export function normalizeWorkspaceFileData(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (isArrayBufferValue(value)) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value) || isTypedArrayValue(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return new Uint8Array(value as number[]);
  }
  if (value && typeof value === "object") {
    const record = value as { data?: unknown; [key: string]: unknown };
    if (record.data !== undefined) {
      const nested = normalizeWorkspaceFileData(record.data);
      if (nested) return nested;
    }

    const numericKeys = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0 && numericKeys.every((key) => Number.isInteger(record[key]))) {
      return new Uint8Array(numericKeys.map((key) => record[key] as number));
    }
  }
  return null;
}

export function getMediaResourceSignature(
  conversationId: string | undefined,
  parts: readonly MediaResourcePart[],
): string {
  return JSON.stringify([
    conversationId ?? null,
    parts.map((part, index) => [
      `${part.type}-${index}`,
      part.mediaType ?? "",
      part.filename ?? "",
      part.url ?? part.data ?? "",
    ]),
  ]);
}

function createEntries(parts: readonly MediaResourcePart[]): ResourceEntry[] {
  return parts.map((part, index) => ({
    ...part,
    id: `${part.type}-${index}`,
    source: part.url ?? part.data,
  }));
}

function createInitialStates(
  conversationId: string | undefined,
  entries: readonly ResourceEntry[],
): Record<string, MediaResourceState> {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      // A workspace URL must never be passed directly to a media element. If
      // there is no conversation id, report it as unavailable instead of
      // leaving the UI in an endless loading state.
      (() => {
        const isWorkspaceUrl = entry.source?.startsWith("workspace://") === true;
        return {
          url: isWorkspaceUrl ? undefined : entry.source,
          loading: isWorkspaceUrl && Boolean(conversationId),
          error: isWorkspaceUrl && !conversationId,
        };
      })(),
    ]),
  );
}

export function useMediaResourceStates(
  conversationId: string | undefined,
  parts: readonly MediaResourcePart[],
): {
  states: Record<string, MediaResourceState>;
  markFailed: (id: string) => void;
} {
  const signature = getMediaResourceSignature(conversationId, parts);
  const entries = useMemo(() => createEntries(parts), [signature]);
  const entriesRef = useMemo(() => entries, [entries]);
  const [states, setStates] = useState<Record<string, MediaResourceState>>(() =>
    createInitialStates(conversationId, entries),
  );

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];
    setStates(createInitialStates(conversationId, entries));

    const workspaceEntries = entries.filter(
      (entry) => conversationId && entry.source?.startsWith("workspace://"),
    );
    if (workspaceEntries.length === 0) return;

    void Promise.all(
      workspaceEntries.map(async (entry) => {
        try {
          const content = await api.workspace.read({
            conversationId: conversationId!,
            path: entry.source!.slice("workspace://".length),
          });
          const url = URL.createObjectURL(
            createWorkspaceMediaBlob(content.data, content.mediaType),
          );
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          createdUrls.push(url);
          setStates((current) => ({
            ...current,
            [entry.id]: { url, loading: false, error: false },
          }));
        } catch (error) {
          if (cancelled) return;
          console.error("[chat] failed to load workspace media:", {
            conversationId,
            path: entry.source,
            filename: entry.filename,
            error,
          });
          setStates((current) => ({
            ...current,
            [entry.id]: { loading: false, error: true },
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [conversationId, entriesRef]);

  const markFailed = useCallback((id: string) => {
    setStates((current) => ({
      ...current,
      [id]: { ...current[id], url: undefined, loading: false, error: true },
    }));
  }, []);

  return { states, markFailed };
}
