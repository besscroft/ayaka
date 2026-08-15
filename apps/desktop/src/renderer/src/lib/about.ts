export type AboutResourceId = "repository";

export interface AboutResource {
  id: AboutResourceId;
  href: string;
}

export const ABOUT_RESOURCES: readonly AboutResource[] = [
  { id: "repository", href: "https://ai.zzzvoid.com/" },
];

export function normalizeAppVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  if (!version) return null;
  return version.toLowerCase().startsWith("v") ? version : `v${version}`;
}
