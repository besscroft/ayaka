import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Badge as ShadcnBadge } from "./badge";
import { Button } from "./button";
import {
  Card as ShadcnCard,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Label } from "./label";
import { Switch } from "./switch";
import { Textarea as TextArea } from "./textarea";
import {
  ToggleGroup as BaseToggleGroup,
  ToggleGroupItem as BaseToggleGroupItem,
} from "./toggle-group";

const Card = Object.assign(ShadcnCard, {
  Header: CardHeader,
  Content: CardContent,
  Footer: CardFooter,
  Title: CardTitle,
  Description: CardDescription,
});
export {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  TextArea,
  Label,
  Checkbox,
  Switch,
};
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { Slider } from "./slider";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectValue,
  SelectTrigger,
} from "./select";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "./dialog";
export { Popover, PopoverTrigger, PopoverContent, PopoverDialog, PopoverHeading } from "./popover";
export { ToggleGroup, ToggleGroupItem } from "./toggle-group";
export { FieldGroup, Field, FieldLabel, FieldDescription, FieldError } from "./field";
export { Alert, AlertTitle, AlertDescription } from "./alert";
export { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./empty";
export { ScrollArea, ScrollBar } from "./scroll-area";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./table";
export {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "./sidebar";
export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./command";

export type ToggleButtonGroupProps = Omit<HTMLAttributes<HTMLDivElement>, "defaultValue"> & {
  selectedKeys?: Iterable<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  selectionMode?: "single" | "multiple";
  disallowEmptySelection?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
};

export function ToggleButtonGroup({
  selectedKeys = [],
  onSelectionChange,
  selectionMode = "single",
  disallowEmptySelection,
  size = "md",
  fullWidth,
  className,
  children,
  ...props
}: ToggleButtonGroupProps): React.JSX.Element {
  const value = Array.from(selectedKeys, String);
  return (
    <BaseToggleGroup
      className={cn("group", fullWidth && "flex w-full", className)}
      data-size={size}
      value={value}
      multiple={selectionMode === "multiple"}
      onValueChange={(next) => {
        if (disallowEmptySelection && next.length === 0) return;
        onSelectionChange?.(new Set(next));
      }}
      {...props}
    >
      {children}
    </BaseToggleGroup>
  );
}

export function ToggleButton({
  id,
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "defaultValue" | "value"> & {
  id: string;
}): React.JSX.Element {
  return (
    <BaseToggleGroupItem
      value={id}
      className={cn(
        "h-9 px-3 text-sm group-data-[size=sm]:h-8 group-data-[size=sm]:px-2.5 group-data-[size=sm]:text-xs",
        className,
      )}
      {...props}
    >
      {children}
    </BaseToggleGroupItem>
  );
}

ToggleButtonGroup.Separator = function ToggleSeparator(): React.JSX.Element {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
};

export function Description({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function TextField({
  className,
  isInvalid,
  ...props
}: HTMLAttributes<HTMLDivElement> & { isInvalid?: boolean }): React.JSX.Element {
  return (
    <div
      data-invalid={isInvalid ? "true" : undefined}
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    />
  );
}

type ChipColor = "default" | "success" | "danger" | "warning" | "accent";
type ChipVariant = "default" | "soft" | "secondary";

export function Chip({
  color = "default",
  size = "md",
  variant = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  color?: ChipColor;
  size?: "sm" | "md";
  variant?: ChipVariant;
}): React.JSX.Element {
  return (
    <ShadcnBadge
      variant={
        variant === "secondary"
          ? "secondary"
          : color === "success"
            ? "success"
            : color === "warning"
              ? "warning"
              : color === "danger"
                ? "destructive"
                : "outline"
      }
      className={cn(
        "max-w-full gap-1",
        size === "sm" ? "min-h-5 px-2 py-0.5 text-[11px]" : "min-h-6 px-2.5 py-1 text-xs",
        variant !== "secondary" &&
          color === "accent" &&
          "border-accent/20 bg-accent/10 text-accent-foreground",
        variant === "soft" && "bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnBadge>
  );
}

Chip.Label = function ChipLabel({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("truncate", className)} {...props} />;
};

interface ColorValue {
  value: string;
  toString: (format?: string) => string;
}
export function parseColor(value: string): ColorValue {
  return { value, toString: () => value };
}

const ColorPickerContext = createContext<{
  selected: string | null;
  onChange?: (color: ColorValue) => void;
} | null>(null);
const ColorItemContext = createContext<{ color: string; selected: boolean } | null>(null);

export const ColorSwatchPicker = Object.assign(
  function ColorSwatchPicker({
    value,
    onChange,
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    value?: ColorValue;
    onChange?: (color: ColorValue) => void;
  }): React.JSX.Element {
    return (
      <ColorPickerContext.Provider
        value={{ selected: value?.toString("hex").toLowerCase() ?? null, onChange }}
      >
        <div role="radiogroup" className={cn("flex flex-wrap", className)} {...props} />
      </ColorPickerContext.Provider>
    );
  },
  {
    Item: function ColorSwatchItem({
      color,
      className,
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { color: string }): React.JSX.Element {
      const context = useContext(ColorPickerContext);
      const selected = context?.selected === color.toLowerCase();
      return (
        <ColorItemContext.Provider value={{ color, selected }}>
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "relative flex size-8 items-center justify-center rounded-full border border-border transition",
              selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
              className,
            )}
            onClick={() => context?.onChange?.(parseColor(color))}
            {...props}
          >
            {children}
          </button>
        </ColorItemContext.Provider>
      );
    },
    Swatch: function ColorSwatch({
      className,
      ...props
    }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
      const context = useContext(ColorItemContext);
      return (
        <span
          className={cn("block size-6 rounded-full border border-border", className)}
          style={{ backgroundColor: context?.color }}
          {...props}
        />
      );
    },
    Indicator: function ColorIndicator({
      className,
      ...props
    }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element | null {
      const context = useContext(ColorItemContext);
      return context?.selected ? (
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center text-primary-foreground",
            className,
          )}
          {...props}
        >
          <Check className="size-3.5" />
        </span>
      ) : null;
    },
  },
);
