import type { Spec, SpecDataPart } from "@json-render/core";
import type { UIMessage } from "ai";
import type { ChatMessageMetadata } from "../types";

/** The only json-render data part emitted by the desktop chat runtime. */
export type AyakaChatDataParts = {
  spec: SpecDataPart;
};

/** Chat message type with a typed json-render data channel. */
export type AyakaUIMessage = UIMessage<ChatMessageMetadata, AyakaChatDataParts>;

export interface GeneratedUIStateChange {
  messageId: string;
  spec: Spec;
  state: Record<string, unknown>;
}

export const GENERATED_UI_PART_TYPE = "data-spec" as const;
