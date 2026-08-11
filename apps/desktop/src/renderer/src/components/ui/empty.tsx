import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-6 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col items-center gap-1.5", className)} {...props} />;
}

function EmptyTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-medium", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("max-w-sm text-sm text-muted-foreground", className)} {...props} />;
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription };
