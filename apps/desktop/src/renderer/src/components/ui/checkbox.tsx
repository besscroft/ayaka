import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@renderer/lib/utils";

interface CheckboxProps extends Omit<
  CheckboxPrimitive.Root.Props,
  "checked" | "disabled" | "onCheckedChange" | "indeterminate"
> {
  isSelected?: boolean;
  isIndeterminate?: boolean;
  isDisabled?: boolean;
  onChange?: (selected: boolean) => void;
}

const CheckboxContent = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("inline-flex min-w-0 items-center gap-2", className)} {...props} />
);

const CheckboxControl = ({ className, children, ...props }: React.ComponentProps<"span">) => (
  <span
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-primary-foreground data-checked:border-primary data-checked:bg-primary",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

function CheckboxIndicator({ className, ...props }: CheckboxPrimitive.Indicator.Props) {
  return (
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center", className)}
      {...props}
    >
      <Check className="size-3" />
    </CheckboxPrimitive.Indicator>
  );
}

function CheckboxRoot({
  isSelected = false,
  isIndeterminate = false,
  isDisabled,
  onChange,
  className,
  children,
  ...props
}: CheckboxProps): React.JSX.Element {
  const compound = React.Children.count(children) > 0;
  return (
    <CheckboxPrimitive.Root
      checked={isSelected}
      indeterminate={isIndeterminate}
      disabled={isDisabled}
      onCheckedChange={onChange}
      className={cn("inline-flex min-w-0 items-center gap-2 text-sm", className)}
      {...props}
    >
      {compound ? (
        children
      ) : (
        <CheckboxContent>
          <CheckboxControl>
            <CheckboxIndicator />
          </CheckboxControl>
          {children}
        </CheckboxContent>
      )}
    </CheckboxPrimitive.Root>
  );
}

export const Checkbox = Object.assign(CheckboxRoot, {
  Content: CheckboxContent,
  Control: CheckboxControl,
  Indicator: CheckboxIndicator,
});

export { Minus };
