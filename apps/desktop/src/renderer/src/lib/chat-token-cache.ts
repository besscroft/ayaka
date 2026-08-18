import type { UIMessage } from "ai";
import { estimateTokens } from "../components/ai-elements/context";

interface MessageTokenEntry {
  message: UIMessage;
  parts: UIMessage["parts"];
  tokens: number;
}

export interface IncrementalTokenCache {
  estimate(messages: UIMessage[]): number;
  clear(): void;
}

function estimateMessageTokens(message: UIMessage): number {
  let text = "";
  for (const part of message.parts ?? []) {
    if (part.type === "text") text += part.text;
  }
  return estimateTokens(text);
}

/**
 * Token estimation is intentionally keyed by message and parts references.
 * AI SDK replaces the changed message during a stream, so unchanged history
 * costs only a Map lookup instead of another full text scan.
 */
export function createIncrementalTokenCache(): IncrementalTokenCache {
  let entries = new Map<string, MessageTokenEntry>();

  return {
    estimate(messages) {
      const nextEntries = new Map<string, MessageTokenEntry>();
      let total = 0;
      for (const message of messages) {
        const previous = entries.get(message.id);
        const entry =
          previous && previous.message === message && previous.parts === message.parts
            ? previous
            : {
                message,
                parts: message.parts,
                tokens: estimateMessageTokens(message),
              };
        nextEntries.set(message.id, entry);
        total += entry.tokens;
      }
      entries = nextEntries;
      return total;
    },
    clear() {
      entries = new Map();
    },
  };
}
