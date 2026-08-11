export type AboutResourceId = "repository" | "documentation" | "issues";

export interface AboutResource {
  id: AboutResourceId;
  href: string;
}

export const ABOUT_RESOURCES: readonly AboutResource[] = [
  { id: "repository", href: "https://github.com/besscroft/void-ai" },
  { id: "documentation", href: "https://github.com/besscroft/void-ai/tree/main/docs" },
  { id: "issues", href: "https://github.com/besscroft/void-ai/issues" },
];

export function normalizeAppVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  if (!version) return null;
  return version.toLowerCase().startsWith("v") ? version : `v${version}`;
}
