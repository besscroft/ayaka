import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function Command({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="command"
      role="listbox"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}
function CommandInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="command-input"
      className={cn(
        "flex h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
function CommandList({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="command-list"
      className={cn("max-h-72 overflow-y-auto p-1", className)}
      {...props}
    />
  );
}
function CommandEmpty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
function CommandGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="command-group"
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    />
  );
}
function CommandItem({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      data-slot="command-item"
      role="option"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
