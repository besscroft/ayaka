import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@renderer/lib/utils";

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ className, ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger className={cn(className)} {...props} />;
}

interface PopoverContentProps extends PopoverPrimitive.Positioner.Props {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: number;
  placement?: "top start" | "bottom start" | "top" | "bottom";
  offset?: number;
  children?: React.ReactNode;
}

function PopoverContent({
  className,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  placement,
  offset,
  ...props
}: PopoverContentProps) {
  const placementSide = placement?.startsWith("top")
    ? "top"
    : placement?.startsWith("bottom")
      ? "bottom"
      : side;
  const placementAlign = placement?.includes("start") ? "start" : placement ? "center" : align;
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={placementSide}
        align={placementAlign}
        sideOffset={offset ?? sideOffset}
        {...props}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "z-50 min-w-32 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none transition data-closed:translate-y-1 data-closed:opacity-0 data-open:translate-y-0 data-open:opacity-100",
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverDialog({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("outline-none", className)} {...props} />;
}

function PopoverHeading({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title className={cn("font-semibold", className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverDialog, PopoverHeading };
