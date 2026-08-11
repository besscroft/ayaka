import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function Command({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
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
      className={cn(
        "flex h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
function CommandList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("max-h-72 overflow-y-auto p-1", className)} {...props} />;
}
function CommandEmpty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("py-6 text-center text-sm text-muted-foreground", className)} {...props} />
  );
}
function CommandGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("overflow-hidden p-1 text-foreground", className)} {...props} />;
}
function CommandItem({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
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
