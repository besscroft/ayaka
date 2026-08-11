import { type LabelHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}
