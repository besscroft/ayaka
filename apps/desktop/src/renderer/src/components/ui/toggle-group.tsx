import { Toggle, ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react";

import { cn } from "@renderer/lib/utils";

function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props<string>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-border bg-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: Toggle.Props<string>) {
  return (
    <Toggle
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
