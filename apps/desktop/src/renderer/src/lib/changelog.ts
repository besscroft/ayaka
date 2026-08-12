import type { AppLanguage } from "@shared/types";

const LANGUAGE_HEADING = /^###\s+(中文|English)\s*$/i;
const RELEASE_HEADING = /^##\s+.+$/;

export function selectChangelogLanguage(markdown: string, locale: AppLanguage): string {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const selectedLabel = locale === "zh-CN" ? "中文" : "English";
  const fallbackLabel = locale === "zh-CN" ? "English" : "中文";
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!RELEASE_HEADING.test(line.trim())) {
      output.push(line);
      index += 1;
      continue;
    }

    const releaseLines: string[] = [line];
    index += 1;
    while (index < lines.length && !RELEASE_HEADING.test((lines[index] ?? "").trim())) {
      releaseLines.push(lines[index] ?? "");
      index += 1;
    }
    output.push(...selectReleaseLanguage(releaseLines, selectedLabel, fallbackLabel));
  }

  return output.join("\n").trim();
}

function selectReleaseLanguage(
  lines: string[],
  selectedLabel: string,
  fallbackLabel: string,
): string[] {
  const languageSections = new Map<string, string[]>();
  let currentLabel: string | null = null;

  for (const line of lines.slice(1)) {
    const heading = LANGUAGE_HEADING.exec(line.trim());
    if (heading) {
      currentLabel = heading[1].toLowerCase() === "english" ? "English" : "中文";
      languageSections.set(currentLabel, []);
      continue;
    }
    if (currentLabel) languageSections.get(currentLabel)?.push(line);
  }

  if (languageSections.size === 0) return lines;

  const selected = languageSections.get(selectedLabel) ?? languageSections.get(fallbackLabel);
  return [lines[0] ?? "", ...(selected ?? [])];
}
