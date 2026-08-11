import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

function Sidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      data-slot="sidebar"
      className={cn("flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground", className)}
      {...props}
    />
  );
}
function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-3", className)} {...props} />;
}
function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-auto px-2", className)} {...props} />;
}
function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-3", className)} {...props} />;
}
function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />;
}
function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("px-2 py-1 text-xs font-medium text-sidebar-foreground/70", className)}
      {...props}
    />
  );
}
function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />;
}
function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("min-w-0", className)} {...props} />;
}
function SidebarMenuButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className,
      )}
      {...props}
    />
  );
}

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
};
