import type { AppLanguage } from "@shared/types";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

export function formatRuntimeEventDetail(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2) ?? value;
  } catch {
    return value;
  }
}

export function formatRuntimeEventTime(timestamp: number, locale: AppLanguage): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}
