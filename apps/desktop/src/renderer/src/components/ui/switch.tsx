import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@renderer/lib/utils";

interface SwitchProps extends Omit<
  SwitchPrimitive.Root.Props,
  "checked" | "disabled" | "onCheckedChange"
> {
  isSelected?: boolean;
  isDisabled?: boolean;
  onChange?: (selected: boolean) => void;
  size?: "sm" | "md";
}

const SwitchSizeContext = React.createContext<"sm" | "md">("md");

const SwitchContent = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn("inline-flex select-none items-center gap-2", className)} {...props} />
);

function SwitchControl({ className, ...props }: React.ComponentProps<"span">) {
  const size = React.useContext(SwitchSizeContext);
  return (
    <span
      data-slot="switch-control"
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full bg-muted-foreground/35 transition-colors group-data-checked:bg-primary",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        className,
      )}
      {...props}
    />
  );
}

function SwitchThumb({ className, ...props }: SwitchPrimitive.Thumb.Props) {
  const size = React.useContext(SwitchSizeContext);
  return (
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      className={cn(
        "block rounded-full bg-background shadow-sm transition-transform",
        size === "sm" ? "size-4 data-checked:translate-x-4" : "size-5 data-checked:translate-x-5",
        className,
      )}
      {...props}
    />
  );
}

function SwitchRoot({
  isSelected = false,
  isDisabled,
  onChange,
  size = "md",
  className,
  children,
  ...props
}: SwitchProps): React.JSX.Element {
  const childArray = React.Children.toArray(children);
  const compound = childArray.some(
    (child) => React.isValidElement(child) && child.type === SwitchContent,
  );
  return (
    <SwitchSizeContext.Provider value={size}>
      <SwitchPrimitive.Root
        {...props}
        data-slot="switch"
        data-size={size}
        checked={isSelected}
        disabled={isDisabled}
        onCheckedChange={onChange}
        className={cn(
          "group inline-flex items-center gap-2 rounded-md text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {compound ? (
          children
        ) : (
          <SwitchContent>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
            {children}
          </SwitchContent>
        )}
      </SwitchPrimitive.Root>
    </SwitchSizeContext.Provider>
  );
}

export const Switch = Object.assign(SwitchRoot, {
  Content: SwitchContent,
  Control: SwitchControl,
  Thumb: SwitchThumb,
});
