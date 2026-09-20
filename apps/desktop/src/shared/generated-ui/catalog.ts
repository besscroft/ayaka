import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";

/**
 * Shared catalog definition. This module intentionally imports only the
 * server-safe schema/catalog entrypoints so it can be used by the main
 * process without pulling React into the prompt-building path.
 */
export const generatedUICatalog = defineCatalog(schema, {
  components: shadcnComponentDefinitions,
  actions: {},
});

export const generatedUIComponentCount = Object.keys(shadcnComponentDefinitions).length;

export const generatedUICatalogPrompt = generatedUICatalog.prompt({
  mode: "inline",
  customRules: [
    "Generate UI only when a compact interactive component improves the answer; otherwise reply with normal prose only.",
    "Use the complete available component catalog, but keep every generated UI compact enough for an in-chat message bubble.",
    "Use only local state bindings, visibility, repeat, watch, and built-in state/validation actions.",
    "Never generate custom code, HTML, iframe content, custom directives, computed functions, network requests, file operations, IPC calls, tool calls, or external action names.",
    "Use the catalog's spec fence format for UI patches and keep each valid RFC 6902 patch on its own line after any prose.",
    "Prefer Card or Stack as the root for grouped content and include accessible labels for interactive controls.",
  ],
});

export const GENERATED_UI_SYSTEM_RULES = [
  "Generated UI is presentation-only and must not replace the root agent's normal orchestration or tool policy.",
  "Child agents do not emit json-render patches; only the root agent's final conversational stream may include them.",
  "The UI may collect local values, but those values are not submitted to the chat or external services automatically.",
];
