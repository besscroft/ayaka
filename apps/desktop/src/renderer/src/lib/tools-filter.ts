import type { ToolRecord } from "@shared/types";

export type ToolKindFilter = "all" | "builtin" | "mcp" | "skill" | "sandbox";
export type ToolStatusFilter = "all" | "enabled" | "approval";

export interface ToolRecordFilters {
  query?: string;
  kind?: ToolKindFilter;
  status?: ToolStatusFilter;
}

export function isToolRecordApprovalEligible(tool: ToolRecord): boolean {
  return (
    tool.id === "workspace_run_command" || (tool.kind !== "builtin" && tool.kind !== "sandbox")
  );
}

export function filterToolRecords(
  records: ToolRecord[],
  { query = "", kind = "all", status = "all" }: ToolRecordFilters,
): ToolRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return records
    .filter((tool) => kind === "all" || tool.kind === kind)
    .filter((tool) => {
      if (status === "enabled") return tool.enabled !== 0;
      if (status === "approval") {
        return isToolRecordApprovalEligible(tool) && tool.requires_approval !== 0;
      }
      return true;
    })
    .filter((tool) => {
      if (!normalizedQuery) return true;
      return [tool.title, tool.name, tool.description, tool.category, tool.reference]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
