import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function ScrollArea({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("relative overflow-auto", className)} {...props}>
      {children}
    </div>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      data-orientation={orientation}
      className={cn(
        "pointer-events-none absolute bg-border/60",
        orientation === "vertical" ? "right-0 top-0 h-full w-1" : "bottom-0 left-0 h-1 w-full",
        className,
      )}
      {...props}
    />
  );
}

export { ScrollArea, ScrollBar };
