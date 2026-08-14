import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_URL_LENGTH = 2_048;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 40_000;
const REQUEST_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HTML_ELEMENTS =
  /<(script|style|noscript|template|svg|nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_ELEMENTS =
  /<\/?(?:address|article|blockquote|br|dd|div|dl|dt|h[1-6]|header|hr|li|main|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi;

export interface WebPageSource {
  type: "url";
  url: string;
  title: string;
}

export interface WebPageReadResult {
  source: "host_page";
  requestedUrl: string;
  finalUrl: string;
  title: string;
  description?: string;
  text: string;
  truncated: boolean;
  contentType: string;
  fetchedAt: string;
  sources: WebPageSource[];
}

export type WebPageReadErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_failure"
  | "request_failed"
  | "timeout"
  | "redirect_limit"
  | "invalid_content_type"
  | "response_too_large"
  | "empty_content"
  | "parse_failed";

export class WebPageReadError extends Error {
  readonly code: WebPageReadErrorCode;

  constructor(code: WebPageReadErrorCode, message: string) {
    super(message);
    this.name = "WebPageReadError";
    this.code = code;
  }
}

export interface WebPageReaderDependencies {
  fetch?: typeof fetch;
  lookup?: AddressLookup;
}

type AddressLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export async function readWebPage(
  rawUrl: string,
  dependencies: WebPageReaderDependencies = {},
): Promise<WebPageReadResult> {
  const requestedUrl = normalizePageUrl(rawUrl);
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const lookup = dependencies.lookup ?? (defaultLookup as AddressLookup);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let currentUrl = requestedUrl;
    let redirectCount = 0;

    while (true) {
      await assertPublicUrl(currentUrl, lookup);

      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": "Ayaka/1.0 (+https://github.com/void-ai)",
          },
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new WebPageReadError("timeout", "Web page request timed out.");
        }
        throw new WebPageReadError(
          "request_failed",
          `Web page request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new WebPageReadError("redirect_limit", "Web page redirect limit exceeded.");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new WebPageReadError("request_failed", "Web page redirect has no location.");
        }
        currentUrl = normalizePageUrl(location, currentUrl);
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        throw new WebPageReadError(
          "request_failed",
          `Web page request failed with HTTP ${response.status}.`,
        );
      }

      const contentType = response.headers.get("content-type")?.trim() ?? "";
      if (!isHtmlContentType(contentType)) {
        throw new WebPageReadError(
          "invalid_content_type",
          "The provided URL did not return an HTML page.",
        );
      }

      const contentLength = response.headers.get("content-length");
      if (
        contentLength &&
        Number.isFinite(Number(contentLength)) &&
        Number(contentLength) > MAX_RESPONSE_BYTES
      ) {
        throw new WebPageReadError("response_too_large", "The web page response is too large.");
      }

      const html = await readResponseText(response, controller.signal);
      const extracted = extractHtmlContent(html);
      if (!extracted.text) {
        throw new WebPageReadError("empty_content", "The web page did not contain readable text.");
      }

      return {
        source: "host_page",
        requestedUrl,
        finalUrl: currentUrl,
        title: extracted.title || currentUrl,
        ...(extracted.description ? { description: extracted.description } : {}),
        text: extracted.text,
        truncated: extracted.truncated,
        contentType,
        fetchedAt: new Date().toISOString(),
        sources: [{ type: "url", url: currentUrl, title: extracted.title || currentUrl }],
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePageUrl(rawUrl: string, baseUrl?: string): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new WebPageReadError("invalid_url", "url is required.");
  }
  const value = rawUrl.trim();
  if (value.length > MAX_URL_LENGTH) {
    throw new WebPageReadError("invalid_url", "url is too long.");
  }

  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new WebPageReadError("invalid_url", "url must be a valid HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebPageReadError("invalid_url", "url must use http or https.");
  }
  if (url.username || url.password) {
    throw new WebPageReadError("invalid_url", "url credentials are not allowed.");
  }
  return url.toString();
}

async function assertPublicUrl(url: string, lookup: AddressLookup): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new WebPageReadError("blocked_address", "Local network addresses are not allowed.");
  }

  if (isIP(hostname)) {
    if (isPrivateOrNonPublicIp(hostname)) {
      throw new WebPageReadError(
        "blocked_address",
        "Private or local network addresses are not allowed.",
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebPageReadError("dns_failure", "The web page hostname could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrNonPublicIp(address))) {
    throw new WebPageReadError(
      "blocked_address",
      "The web page resolves to a private or local network address.",
    );
  }
}

function isPrivateOrNonPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && b >= 18 && b <= 19) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isPrivateOrNonPublicIp(mappedIpv4);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isHtmlContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(";", 1)[0].trim();
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}

async function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new WebPageReadError("response_too_large", "The web page response is too large.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new WebPageReadError("timeout", "Web page request timed out.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new WebPageReadError("response_too_large", "The web page response is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WebPageReadError) throw error;
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new WebPageReadError("timeout", "Web page request timed out.");
    }
    throw new WebPageReadError(
      "request_failed",
      `Failed to read web page response: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function extractHtmlContent(html: string): {
  title: string;
  description: string;
  text: string;
  truncated: boolean;
} {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const title = cleanHtmlText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(withoutComments)?.[1]);
  const description = extractMetaDescription(withoutComments);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(withoutComments)?.[1];
  const article = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(withoutComments)?.[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(withoutComments)?.[1];
  const content = main || article || body || withoutComments;
  const text = cleanHtmlText(
    content.replace(BLOCKED_HTML_ELEMENTS, " ").replace(BLOCK_ELEMENTS, "\n"),
  );
  const truncated = text.length > MAX_TEXT_LENGTH;
  return { title, description, text: truncated ? text.slice(0, MAX_TEXT_LENGTH) : text, truncated };
}

function extractMetaDescription(html: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.name?.toLowerCase() === "description" && attributes.content) {
      return cleanHtmlText(attributes.content);
    }
  }
  return "";
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[3]);
  }
  return attributes;
}

function cleanHtmlText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}
