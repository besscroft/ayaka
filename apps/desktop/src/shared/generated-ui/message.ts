import { createStateStore, type Spec, type StateModel, type StateStore } from "@json-render/core";
import type { UIMessage } from "ai";
import type { AyakaUIMessage } from "./types";
import type { GeneratedUIStateChange } from "./types";

type GeneratedUISpecPart = Extract<AyakaUIMessage["parts"][number], { type: "data-spec" }>;

export function isGeneratedUISpecPart(part: unknown): part is GeneratedUISpecPart {
  if (!part || typeof part !== "object") return false;
  const candidate = part as { type?: unknown; data?: unknown };
  if (candidate.type !== "data-spec" || !candidate.data || typeof candidate.data !== "object") {
    return false;
  }
  const data = candidate.data as { type?: unknown };
  return data.type === "patch" || data.type === "flat" || data.type === "nested";
}

/**
 * Replace a streamed patch sequence with one complete flat spec while keeping
 * the first data part's position in the mixed chat message.
 */
export function canonicalizeGeneratedUISpecMessage(message: UIMessage, spec: Spec): UIMessage {
  const parts = message.parts ?? [];
  let inserted = false;
  const nextParts = parts.flatMap((part) => {
    if (!isGeneratedUISpecPart(part)) return [part];
    if (inserted) return [];
    inserted = true;
    const id = "id" in part && typeof part.id === "string" ? part.id : undefined;
    return [
      {
        ...(id ? { id } : {}),
        type: "data-spec",
        data: { type: "flat", spec },
      } as UIMessage["parts"][number],
    ];
  });

  return inserted ? { ...message, parts: nextParts } : message;
}

export function withGeneratedUISpecState(spec: Spec, state: StateModel): Spec {
  return { ...spec, state: { ...state } };
}

export function persistGeneratedUIStateChange(
  message: UIMessage,
  change: GeneratedUIStateChange,
): UIMessage {
  return canonicalizeGeneratedUISpecMessage(message, change.spec);
}

/** A StateStore wrapper that reports the live snapshot after each mutation. */
export function createGeneratedUIStateStore(
  initialState: StateModel,
  onChange: (state: StateModel) => void,
): StateStore {
  const inner = createStateStore({ ...initialState });
  return {
    get: inner.get,
    getSnapshot: inner.getSnapshot,
    getServerSnapshot: inner.getServerSnapshot,
    subscribe: inner.subscribe,
    set(path, value) {
      inner.set(path, value);
      onChange(inner.getSnapshot());
    },
    update(updates) {
      inner.update(updates);
      onChange(inner.getSnapshot());
    },
  };
}
