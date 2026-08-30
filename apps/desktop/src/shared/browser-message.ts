import type { UIMessage } from "ai";

const SCREENSHOT_PREFIX = "browser/screenshots/";

export function redactBrowserInput(input: unknown): unknown {
  const record = asRecord(input);
  return record && typeof record.text === "string" ? { ...record, text: "[redacted]" } : input;
}

/** Remove browser secrets from a UI message before it is persisted or resent. */
export function sanitizeBrowserScreenshotMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      const record = asRecord(part);
      const toolName =
        part.type === "dynamic-tool"
          ? typeof record?.toolName === "string"
            ? record.toolName
            : ""
          : part.type.startsWith("tool-")
            ? part.type.slice("tool-".length)
            : "";
      if (toolName === "browser_type") {
        const input = asRecord(record?.input);
        if (typeof input?.text !== "string") return part;
        return { ...part, input: redactBrowserInput(input) } as typeof part;
      }
      if (toolName !== "browser_screenshot") return part;
      const screenshotPath = readScreenshotPath(record?.output);
      if (!screenshotPath) return part;
      return {
        ...part,
        output: replaceScreenshotContent(record?.output, screenshotPath),
      } as typeof part;
    }),
  };
}

function replaceScreenshotContent(output: unknown, screenshotPath: string): unknown {
  const record = asRecord(output);
  if (!record || record.type !== "content" || !Array.isArray(record.value)) return output;
  return {
    ...record,
    value: record.value.map((value) => {
      const item = asRecord(value);
      if (item?.type !== "file") return value;
      return {
        ...item,
        data: { type: "url", url: `workspace://${screenshotPath}` },
      };
    }),
  };
}

export function readScreenshotPath(output: unknown): string | null {
  const record = asRecord(output);
  if (!record || record.type !== "content" || !Array.isArray(record.value)) return null;
  for (const value of record.value) {
    const item = asRecord(value);
    const rawText = typeof item?.text === "string" ? item.text : item?.value;
    if (typeof rawText !== "string") continue;
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const screenshot = asRecord(asRecord(parsed)?.screenshot);
      const screenshotPath = screenshot?.path;
      if (
        typeof screenshotPath === "string" &&
        screenshotPath.startsWith(SCREENSHOT_PREFIX) &&
        !screenshotPath.includes("..")
      ) {
        return screenshotPath;
      }
    } catch {
      // Not browser screenshot metadata.
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
