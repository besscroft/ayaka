import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}

function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-xs text-destructive", className)} {...props} />;
}

export { FieldGroup, Field, FieldLabel, FieldDescription, FieldError };
