import type { ReleaseMetadata } from "../../workers/update-api";

export function formatReleaseSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatReleaseDate(value: string | null): string {
  if (!value) return "发布日期待定";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "发布日期待定";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function releaseSummary(release: ReleaseMetadata) {
  return {
    version: `v${release.version}`,
    date: formatReleaseDate(release.publishedAt),
    size: formatReleaseSize(release.size),
  };
}
