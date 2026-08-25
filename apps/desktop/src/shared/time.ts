const BEIJING_TIME_ZONE = "Asia/Shanghai";

interface DateTimeParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const beijingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const beijingDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getParts(formatter: Intl.DateTimeFormat, timestamp: number): DateTimeParts {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  ) as Partial<DateTimeParts>;

  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: parts.hour ?? "00",
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

export function getBeijingDateKey(timestamp = Date.now()): string {
  const { year, month, day } = getParts(beijingDateFormatter, timestamp);
  return `${year}-${month}-${day}`;
}

export function formatBeijingTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const { year, month, day, hour, minute, second } = getParts(beijingDateTimeFormatter, timestamp);
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}+08:00`;
}
