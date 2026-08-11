import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";

import { cn } from "@renderer/lib/utils";

function AlertDialog({
  children,
  ...props
}: Omit<AlertDialogPrimitive.Root.Props, "children"> & { children: ReactNode }) {
  return (
    <AlertDialogPrimitive.Root {...props}>
      <AlertDialogPrimitive.Portal>{children}</AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

function AlertDialogTrigger({ className, ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger className={cn(className)} {...props} />;
}

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Popup
      className={cn(
        "fixed inset-x-4 top-1/2 z-50 mx-auto flex max-w-lg -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-background p-6 text-foreground shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      className={cn("fixed inset-0 z-50 bg-background/80 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogAction({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close className={cn(className)} {...props} />;
}

function AlertDialogCancel({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close className={cn(className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
