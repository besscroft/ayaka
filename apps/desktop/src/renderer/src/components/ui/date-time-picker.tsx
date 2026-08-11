import * as React from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverDialog, PopoverTrigger } from "./popover";

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: DateTimePickerProps): React.JSX.Element {
  const { date, time } = splitDateTime(value);
  const selectedDate = parseDate(date);
  const displayValue = formatDisplayValue(value, ariaLabel);

  return (
    <div className={cn("grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]", className)}>
      <Popover>
        <PopoverTrigger>
          <Button
            type="button"
            variant="outline"
            isDisabled={disabled}
            aria-label={ariaLabel}
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{displayValue}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <PopoverDialog>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(nextDate) => {
                if (nextDate) onChange(`${formatDate(nextDate)}T${time}`);
              }}
            />
          </PopoverDialog>
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        onChange={(event) => onChange(`${date}T${event.currentTarget.value}`)}
        disabled={disabled}
        aria-label={`${ariaLabel} time`}
        step={60}
      />
    </div>
  );
}

function splitDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : "00:00" };
}

function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate(),
  ).padStart(2, "0")}`;
}

function formatDisplayValue(value: string, fallback: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? fallback
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        parsed,
      );
}
