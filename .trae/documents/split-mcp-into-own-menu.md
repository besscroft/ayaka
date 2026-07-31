# 将 MCP 从工具菜单拆分为独立顶级菜单

## Summary

当前 MCP 管理位于 `ToolsPanel` 内的一个 Tab（与 `registry` Tab 并列）。本次变更将 MCP 拆出为侧边栏独立顶级菜单，新增 `McpPanel.tsx` 承载 MCP 管理界面，并将 IPC 通道从 `tools:mcp:*` 重命名为 `mcp:*`、API 命名空间从 `api.tools.mcp.*` 提升为 `api.mcp.*`。主进程业务逻辑（mcp-manager / db / schema）零改动。

### UI 变更示意（ASCII）

```
变更前侧边栏:                    变更后侧边栏:
[💬 对话]                       [💬 对话]
[🤖 智能体]                     [🤖 智能体]
[🔧 工具]  ← 含 registry+mcp    [🔧 工具]  ← 仅 registry
[✨ Skills]                     [🌐 MCP]   ← 新独立菜单
[⏰ 自动化]                     [✨ Skills]
[💾 记忆]                       [⏰ 自动化]
                                [💾 记忆]
```

## Current State Analysis

### 渲染层路由（无 react-router，state 驱动）

- [AppShell.tsx:38-46](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/AppShell.tsx#L38-L46) `primaryNav` 数组定义侧边栏项；`AppView` 类型（行 25）= `"chat" | MainSection`
- [MainPanelView.tsx:47](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/MainPanelView.tsx#L47) `MainSection` 类型；行 97-103 `section === "tools"` 分发到 `<ToolsPanel />`
- [ToolsPanel.tsx:58](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/ToolsPanel.tsx#L58) `type ToolsTab = "registry" | "mcp"`；行 169-174 渲染两个 TabsTrigger；行 228-241 按 tab 切换 `RegistrySection` / `McpSection`

### MCP 相关组件（均定义在 ToolsPanel.tsx）

- `InstalledToolsPanel`（行 89-272）：Tabs 容器，同时加载 registry + mcp 数据
- `McpSection`（行 449-483）：MCP 卡片网格
- `McpCard`（行 485-562）：单个 MCP 服务器卡片
- `AddMcpModal`（行 845-1012）：新建 MCP 表单
- `ToolDetailModal`（行 694-843）：MCP/Skill 详情弹窗（共用，按 `detail.type` 分支）
- `EMPTY_MCP_FORM`（行 59-74）、`formatEndpoint`（行 1736-1742）、`groupByServer`（行 1727-1734）

### IPC / Preload / API 三层

- [preload/index.ts:158-176](file:///c:/github/void-ai/apps/desktop/src/preload/index.ts#L158-L176) `api.tools.mcp.*`（14 个方法，通道名 `tools:mcp:*`）
- [preload/index.d.ts:232-250](file:///c:/github/void-ai/apps/desktop/src/preload/index.d.ts#L232-L250) 类型声明
- [api.ts:271-293](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/api.ts#L271-L293) 渲染层封装
- [ipc/index.ts:418-466](file:///c:/github/void-ai/apps/desktop/src/main/ipc/index.ts#L418-L466) 14 个 `tools:mcp:*` handler（薄层，业务在 mcp-manager.ts / db.ts）

### 调用方（`api.tools.mcp.*` 的使用点）

- `ToolsPanel.tsx`：5 处（delete / setEnabled / create / discover / t("tools.mcp.add")）
- `SettingsDialog.tsx` TrashTab：5 处（行 2889-2891, 2926, 3028, 3087, 3118）

### 不受影响的部分

- `mcp-manager.ts` / `db.ts` / `schema.ts`：主进程业务逻辑，与通道名/菜单结构解耦
- `chat-tools.ts`：主进程内部直接 import mcp-manager，不走 IPC
- `SettingsDialog.tsx` 的 `TrashKind = "mcp"`：回收站分类，与菜单拆分独立
- 测试文件 `ToolsPanel.test.tsx`：只测 helper 函数（filterToolRecords / buildMcpInput），不测组件渲染，不受影响

### i18n 结构

- [i18n.messages.ts:5](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/i18n.messages.ts#L5) `entries` 对象（`{ zh, en }` 双语，主源）
- 行 2148-2156 组装：`zhCN = entries.zh + zhOverrides`，`en = entries.en + enOverrides`
- 现有 `main.title.tools`（行 1370）、`main.subtitle.tools`（行 1364）、`tools.mcp.*`（行 1177-1182）

## Proposed Changes

### 1. 新建 `McpPanel.tsx`（MCP 独立面板）

**文件**：`apps/desktop/src/renderer/src/components/McpPanel.tsx`（新建）

**内容**：从 `ToolsPanel.tsx` 迁移 MCP 相关逻辑，组装为独立面板：

- `McpPanel`（导出，对应原 `ToolsPanel` 的标题壳 + `InstalledToolsPanel` 的 mcp 部分）
  - 标题用新 key `main.title.mcp` / `main.subtitle.mcp`
  - 只保留 MCP 列表 + Add MCP 按钮 + 刷新（移除 Tabs、registry 过滤器、registry Section）
  - 顶部 MetricCard 只保留 `tools.metric.mcp`（或保留两个，视情况）
- 迁移组件：`McpSection`、`McpCard`、`AddMcpModal`
- 迁移常量/辅助：`EMPTY_MCP_FORM`
- 复用（从 ToolsPanel import）：`ToolDetailModal`、`DetailTarget` 类型、`formatEndpoint`、`groupByServer`、`ReadStat`、`EmptyTools`、`MetricCard`（见变更 3）
- 数据加载：调用 `api.tools.snapshot()` 获取快照（snapshot 是工具注册表通用接口，保留在 tools 下），过滤 `server.kind === "mcp"`；MCP 操作走新 `api.mcp.*`

**Why**：MCP 独立菜单需要独立入口组件；复用共用件避免代码重复。

### 2. `AppShell.tsx`（新增导航项）

**文件**：[AppShell.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/AppShell.tsx)

- 行 25 `AppView` 类型：无需改（`AppView = "chat" | MainSection`，扩展 MainSection 即可）
- 行 38-46 `primaryNav` 数组：在 `tools` 之后插入 `{ id: "mcp", labelKey: "main.title.mcp", Icon: IconGlobe }`
- 行 12-17 图标 import：`IconGlobe` 已存在于 icons.tsx（行 99），需在 AppShell 的 import 中添加

**Why**：注册新菜单项。`IconGlobe` 与 `McpCard` 用的图标一致，语义贴切。

### 3. `MainPanelView.tsx`（新增分发分支）

**文件**：[MainPanelView.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/MainPanelView.tsx)

- 行 47 `MainSection` 类型：新增 `"mcp"`，变为 `"agents" | "tools" | "skills" | "memory" | "automations" | "mcp"`
- 行 97-103 之后新增分支：
  ```tsx
  if (section === "mcp") {
    return (
      <main className="flex min-h-0 flex-1 overflow-hidden p-6">
        <McpPanel />
      </main>
    );
  }
  ```
- 顶部 import：新增 `import { McpPanel } from "./McpPanel";`

### 4. `ToolsPanel.tsx`（移除 MCP，export 共用件）

**文件**：[ToolsPanel.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/ToolsPanel.tsx)

- **移除 MCP Tab**：
  - 行 58 `type ToolsTab = "registry" | "mcp"` → `type ToolsTab = "registry"`（或直接移除 tab 状态，简化为单视图）
  - 行 95 `tab` state 及 `toToolsTab`（行 1764）移除
  - 行 169-173 Tabs 组件移除（不再需要 tab 切换，直接渲染 RegistrySection）
  - 行 175-180 "Add MCP" 按钮移除
  - 行 230-241 `McpSection` 渲染移除
  - 行 244-256 `AddMcpModal` 移除
  - 行 99-105 `mcpOpen` / `detailTarget`（mcp 部分）state 移除
  - 行 128-135 `mcpServers` / `mcpToolsByServer` useMemo 移除
  - 行 154 `confirmDelete`（mcp）移除
  - 行 258 `ToolDetailModal`（mcp 用途）移除
  - 行 260-268 `ConfirmDialog`（mcp 删除确认）移除
  - 行 164 `MetricCard` 的 `tools.metric.mcp` 移除（仅保留 `tools.metric.tools`）
- **移除 MCP 专属组件**：`McpSection`（行 449-483）、`McpCard`（行 485-562）、`AddMcpModal`（行 845-1012）、`EMPTY_MCP_FORM`（行 59-74）
- **export 共用件**（供 McpPanel import）：
  - `ToolDetailModal`（行 694）+ `DetailTarget` 类型（行 690-692）：加 `export`
  - `formatEndpoint`（行 1736）、`groupByServer`（行 1727）：加 `export`
  - `ReadStat`、`EmptyTools`、`MetricCard`：加 `export`（McpPanel 复用）
- **保留**：`RegistrySection`、`InstalledSkillsPanel`、`AddSkillModal`、Skills 相关组件、`ToolDetailModal`（Skill 详情仍用）、`safeJsonArray`/`safeJsonObject`（SkillCard 用）
- **更新 `main.subtitle.tools`**：i18n 中移除"MCP"字样（见变更 8）

**Why**：ToolsPanel 只保留工具注册表（registry）和 Skills 相关组件（用户未要求拆 Skills）。共用件 export 避免代码重复。

### 5. `ipc/index.ts`（通道改名）

**文件**：[ipc/index.ts](file:///c:/github/void-ai/apps/desktop/src/main/ipc/index.ts)

行 418-466 的 14 个 handler 通道名 `tools:mcp:*` → `mcp:*`：

- `tools:mcp:create` → `mcp:create`
- `tools:mcp:update` → `mcp:update`
- `tools:mcp:delete` → `mcp:delete`
- `tools:mcp:listDeleted` → `mcp:listDeleted`
- `tools:mcp:restore` → `mcp:restore`
- `tools:mcp:permanentDelete` → `mcp:permanentDelete`
- `tools:mcp:permanentDeleteBatch` → `mcp:permanentDeleteBatch`
- `tools:mcp:purgeExpired` → `mcp:purgeExpired`
- `tools:mcp:setEnabled` → `mcp:setEnabled`
- `tools:mcp:test` → `mcp:test`
- `tools:mcp:discover` → `mcp:discover`
- `tools:mcp:updateTool` → `mcp:updateTool`
- `tools:mcp:setSecret` → `mcp:setSecret`
- `tools:mcp:deleteSecret` → `mcp:deleteSecret`

**保留不动**：`tools:snapshot`、`tools:updateTool`（工具注册表通用，非 MCP 专属）。

**Why**：用户确认同步改名，使通道名与菜单结构一致。主进程业务函数（createToolServer / discoverMcpServer 等）不变，只改通道字符串。

### 6. `preload/index.ts`（API 命名空间提升）

**文件**：[preload/index.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.ts)

行 155-195 重构：

- `api.tools.mcp.*`（行 158-176）提升为顶层 `api.mcp.*`
- 通道名同步改为 `mcp:*`
- `api.tools` 保留 `snapshot` 和 `updateTool`（行 156-157）
- `api.tools.skills`（行 177-194）不动

新结构：

```ts
tools: {
  snapshot: () => ipcRenderer.invoke("tools:snapshot"),
  updateTool: (id, patch) => ipcRenderer.invoke("tools:updateTool", id, patch),
  skills: { /* 不变 */ },
},
mcp: {
  create: (input) => ipcRenderer.invoke("mcp:create", input),
  // ... 其余 13 个方法，通道名 mcp:*
},
```

### 7. `preload/index.d.ts`（类型声明同步）

**文件**：[preload/index.d.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.d.ts)

行 226-266 重构：

- `VoidAIApi.tools.mcp`（行 232-250）移出为顶层 `VoidAIApi.mcp`
- `VoidAIApi.tools` 保留 `snapshot` / `updateTool` / `skills`

### 8. `api.ts`（渲染层封装同步）

**文件**：[api.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/api.ts)

行 265-316 重构：

- `api.tools.mcp.*`（行 271-293）提升为 `api.mcp.*`，`assertApi().tools.mcp.*` → `assertApi().mcp.*`
- `api.tools` 保留 `snapshot` / `updateTool` / `skills`

### 9. `SettingsDialog.tsx`（调用方更新）

**文件**：[SettingsDialog.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/SettingsDialog.tsx)

TrashTab 中 5 处调用改名：

- 行 2889-2891 `api.tools.mcp.purgeExpired()` / `api.tools.mcp.listDeleted()` → `api.mcp.*`
- 行 3028 `api.tools.mcp.restore(row.id)` → `api.mcp.restore(row.id)`
- 行 3087 `api.tools.mcp.permanentDelete(item.id)` → `api.mcp.*`
- 行 3118 `api.tools.mcp.permanentDeleteBatch(ids)` → `api.mcp.*`

**Why**：回收站的 MCP 分类逻辑不变，仅跟随 API 命名空间改名。

### 10. `i18n.messages.ts`（新增菜单文案 + 更新工具副标题）

**文件**：[i18n.messages.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/i18n.messages.ts)

在 `entries` 对象中（行 1364-1370 附近）新增：

```ts
"main.title.mcp": { zh: "MCP", en: "MCP" },
"main.subtitle.mcp": {
  zh: "管理 MCP 服务器：连接、发现工具、启用/禁用、密钥。",
  en: "Manage MCP servers: connect, discover tools, enable/disable, secrets.",
},
```

更新现有 key（行 1364-1366）：

```ts
"main.subtitle.tools": {
  zh: "管理内置工具、沙箱工具与审批策略。",  // 移除"MCP、技能、密钥"
  en: "Manage built-in tools, sandbox tools, and approval policy.",
},
```

**保留不动**：`tools.mcp.*`（行 1177-1182）、`tools.metric.mcp`、`tools.tab.mcp`、`trash.tab.mcp` 等 key（文案通用，改名 key 收益小于风险）。

**Why**：`main.title.mcp` / `main.subtitle.mcp` 是新菜单必需；`tools.mcp.*` key 仅是字符串标识，与菜单结构无技术耦合，保留可避免大面积文案迁移。`main.subtitle.tools` 需同步移除 MCP 描述以保持文案准确。

## Assumptions & Decisions

1. **拆分范围：仅拆 MCP，不动 Skills**。用户两次就"是否同步清理 Skills 耦合"留空，按最小变更原则处理：Skills 相关组件保留在 ToolsPanel.tsx，不迁出。如后续需清理可单独提案。

2. **IPC 通道改名 `tools:mcp:*` → `mcp:*`**：用户明确选择。主进程业务函数不变，IPC 通道名不持久化（runtime events 存的是事件类型而非通道名），改名安全。`tools:snapshot` / `tools:updateTool` 保留（工具注册表通用）。

3. **`api.tools.mcp` → `api.mcp`（顶层）**：用户明确选择。`api.tools.snapshot` / `api.tools.updateTool` / `api.tools.skills` 保留原位。

4. **ToolDetailModal 共用，不拆**：用户明确选择。ToolDetailModal + DetailTarget 留在 ToolsPanel.tsx 并 export，McpPanel import 使用。

5. **共用辅助件从 ToolsPanel export**：`formatEndpoint`、`groupByServer`、`ReadStat`、`EmptyTools`、`MetricCard` 在 ToolsPanel.tsx 加 export，McpPanel import。不新建独立 shared 文件（遵循"不创建不必要文件"原则）。

6. **MCP 菜单图标用 `IconGlobe`**：与 McpCard 内的图标一致，已存在于 icons.tsx（行 99）。

7. **i18n key 不改名**：`tools.mcp.*` / `tools.tab.mcp` / `tools.metric.mcp` 等 key 保留，仅新增 `main.title.mcp` / `main.subtitle.mcp` 并更新 `main.subtitle.tools`。Key 是字符串标识，改名收益小于风险。

8. **McpPanel 数据加载**：仍调用 `api.tools.snapshot()`（工具注册表快照，含 mcp servers + records），过滤 `kind === "mcp"` 后渲染。snapshot 是通用接口，保留在 tools 下合理。

9. **ToolsPanel 的 Tabs 简化**：移除 MCP Tab 后，ToolsPanel 只剩 registry 单视图，Tabs 组件可移除，直接渲染 RegistrySection（简化为单视图面板）。

## Verification Steps

1. **类型检查**：

   ```bash
   vp run desktop#typecheck:web
   vp run desktop#typecheck:node
   ```

   确认 AppShell / MainPanelView / McpPanel / ToolsPanel / preload / api / SettingsDialog 全部通过。

2. **格式与 lint**：

   ```bash
   vp check
   ```

3. **测试**：

   ```bash
   vp run desktop#test
   ```

   重点关注 `ToolsPanel.test.tsx`（helper 测试，应不受影响）和 preload/api 相关测试。

4. **构建**：

   ```bash
   vp run desktop#build
   ```

   确认 Electron 打包通过（preload 改名涉及 contextBridge）。

5. **手动验证（dev 模式）**：

   ```bash
   vp run dev:desktop
   ```
   - 侧边栏出现新的 MCP 菜单项（IconGlobe），点击进入 McpPanel
   - McpPanel 能加载已有 MCP 服务器列表、切换启用/禁用、查看详情、删除、新增（AddMcpModal 表单提交 + discover）
   - ToolsPanel 仅显示 registry Tab（无 MCP Tab），工具注册表正常显示
   - Settings → 回收站 → MCP 分类：能列出已删除 MCP、恢复、永久删除、批量删除、清理过期
   - Chat 中 MCP 工具调用正常（验证 chat-tools 主进程链路未受影响）

6. **回归点**：
   - SettingsDialog TrashTab 的 5 处 `api.mcp.*` 调用
   - ToolsPanel 中残留的 `api.tools.mcp.*` 引用（应全部清除或迁移到 McpPanel）
   - 预加载脚本的 `api.mcp` 在渲染层 `window.api.mcp` 可访问
