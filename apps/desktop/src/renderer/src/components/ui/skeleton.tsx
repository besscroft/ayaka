import { type HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="loading"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
