export type RichContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; depth: 1 | 2 | 3 | 4; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "html"; html: string }
  | { type: "hr" };

export type UrlKind = "link" | "image" | "media";
export type MediaKind = "image" | "audio" | "video";

export const RICH_CONTENT_COLLAPSE_LINE_LIMIT = 20;
export const RICH_CONTENT_COLLAPSE_CHAR_LIMIT = 1200;

export function isLongRichContent(value: string): boolean {
  return (
    value.length > RICH_CONTENT_COLLAPSE_CHAR_LIMIT ||
    value.split(/\r?\n/).length > RICH_CONTENT_COLLAPSE_LINE_LIMIT
  );
}

const HTML_BLOCK_TAGS =
  "address|article|aside|audio|blockquote|br|details|div|figure|figcaption|h[1-6]|hr|img|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|video";

export function parseRichContentBlocks(value: string): RichContentBlock[] {
  const lines = value.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const blocks: RichContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = /^```([^\s`]*)?.*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1]?.trim() || undefined;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const { block, nextIndex } = parseTable(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    const listItem = parseListItem(line);
    if (listItem) {
      const ordered = listItem.ordered;
      const items: Array<{ text: string; checked?: boolean }> = [];
      while (index < lines.length) {
        const item = parseListItem(lines[index] ?? "");
        if (!item || item.ordered !== ordered) break;
        items.push({ text: item.text, checked: item.checked });
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    if (looksLikeHtmlBlock(trimmed)) {
      const htmlLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim()) {
        htmlLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "html", html: htmlLines.join("\n") });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      const nextLine = lines[index] ?? "";
      if (paragraphLines.length > 0 && isBlockStart(lines, index)) break;
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks.length > 0 ? blocks : [{ type: "paragraph", text: "" }];
}

export function sanitizeRichContentUrl(value: string, kind: UrlKind): string | null {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeUrlCharacter(trimmed)) return null;
  if (kind === "link" && trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("ayaka-media://asset/")) return trimmed;

  if (trimmed.startsWith("blob:")) {
    return kind === "image" || kind === "media" ? trimmed : null;
  }

  if (trimmed.startsWith("data:")) {
    return isSafeDataUrl(trimmed, kind) ? trimmed : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol === "http:" || protocol === "https:") return trimmed;
  if (kind === "link" && protocol === "mailto:") return trimmed;
  return null;
}

export function getMediaKindFromUrl(value: string): MediaKind | null {
  const lower = value.trim().toLowerCase().split(/[?#]/, 1)[0] ?? "";
  if (lower.startsWith("data:image/")) return "image";
  if (lower.startsWith("data:audio/")) return "audio";
  if (lower.startsWith("data:video/")) return "video";
  if (/\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/.test(lower)) return "image";
  if (/\.(?:mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return "audio";
  if (/\.(?:mp4|webm|mov|m4v|ogv)$/.test(lower)) return "video";
  return null;
}

function parseListItem(line: string): { ordered: boolean; text: string; checked?: boolean } | null {
  const match = /^\s{0,3}([-*+]|\d+[.)])\s+(.+)$/.exec(line);
  if (!match) return null;
  const ordered = /^\d/.test(match[1]);
  let text = match[2].trim();
  let checked: boolean | undefined;
  const task = /^\[([ xX])\]\s+(.+)$/.exec(text);
  if (task) {
    checked = task[1].toLowerCase() === "x";
    text = task[2].trim();
  }
  return { ordered, text, checked };
}

function isTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return current.includes("|") && isTableSeparator(next);
}

function parseTable(
  lines: string[],
  index: number,
): { block: Extract<RichContentBlock, { type: "table" }>; nextIndex: number } {
  const headers = splitTableRow(lines[index] ?? "");
  index += 2;
  const rows: string[][] = [];
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || !line.includes("|")) break;
    rows.push(splitTableRow(line));
    index += 1;
  }
  return { block: { type: "table", headers, rows }, nextIndex: index };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const trimmed = line.trim();
  return (
    !trimmed ||
    trimmed.startsWith("```") ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    parseListItem(line) !== null ||
    trimmed.startsWith(">") ||
    isTableStart(lines, index) ||
    looksLikeHtmlBlock(trimmed)
  );
}

function looksLikeHtmlBlock(trimmed: string): boolean {
  return new RegExp(`^</?(?:${HTML_BLOCK_TAGS})(?:\\s|>|/)`, "i").test(trimmed);
}

function hasUnsafeUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isSafeDataUrl(value: string, kind: UrlKind): boolean {
  if (kind === "image") {
    return /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(value);
  }
  if (kind === "media") {
    return /^data:(?:audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value);
  }
  return false;
}
