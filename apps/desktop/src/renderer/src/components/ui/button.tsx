import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@renderer/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        success: "bg-success text-success-foreground shadow-xs hover:bg-success/90",
        info: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        warning: "bg-warning text-warning-foreground shadow-xs hover:bg-warning/90",
        ether: "bg-accent text-accent-foreground shadow-xs hover:bg-accent/90",
        fire: "bg-danger text-danger-foreground shadow-xs hover:bg-danger/90",
        electric: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        ice: "bg-accent text-accent-foreground shadow-xs hover:bg-accent/90",
        physical: "bg-warning text-warning-foreground shadow-xs hover:bg-warning/90",
        secondary:
          "border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        outline: "border border-border bg-background text-foreground shadow-xs hover:bg-muted",
        ghost: "text-foreground/75 hover:bg-muted hover:text-foreground",
        tertiary: "text-foreground/70 hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        danger: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        md: "h-9 px-3.5",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-4",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled">,
    VariantProps<typeof buttonVariants> {
  isDisabled?: boolean;
  isPending?: boolean;
  isIconOnly?: boolean;
  plain?: boolean;
  hollow?: boolean;
  highlight?: boolean;
  circle?: boolean;
  round?: boolean;
  onPress?: () => void;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    children,
    variant,
    size,
    isDisabled,
    isPending,
    isIconOnly,
    plain = false,
    hollow = false,
    highlight = false,
    circle = false,
    round = true,
    onPress,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  const disabled = isDisabled || isPending;
  const implicitDefault = variant == null;
  const iconOnly = isIconOnly || size === "icon";
  const effectivePlain = plain && !hollow;
  const effectiveRound = round && !circle;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(buttonVariants({ variant, size: iconOnly ? "icon" : size }), className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onPress?.();
      }}
      {...props}
      data-slot="button"
      data-variant={variant ?? "secondary"}
      data-size={iconOnly ? "icon" : (size ?? "default")}
      data-icon-only={iconOnly ? "true" : undefined}
      data-implicit-default={implicitDefault ? "true" : undefined}
      data-plain={effectivePlain ? "true" : undefined}
      data-hollow={hollow ? "true" : undefined}
      data-highlight={highlight ? "true" : undefined}
      data-circle={circle ? "true" : undefined}
      data-round={effectiveRound ? "true" : "false"}
      data-loading={isPending ? "true" : undefined}
      aria-busy={isPending || undefined}
    >
      {isPending ? (
        <Loader2
          data-slot="button-loader"
          data-icon="inline-start"
          className="animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {children != null ? (
        <span data-slot="button-content" className="relative z-[1] inline-flex items-center gap-2">
          {children}
        </span>
      ) : null}
    </button>
  );
});

export { buttonVariants };
