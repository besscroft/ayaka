# 工作流模块（Orchestration + Handoffs）设计与实现

> 范围：基于 OpenAI Agents orchestration 范式（Handoffs / Agents-as-tools），在 ayaka 中交付一个真正可执行的工作流引擎。后端完整，渲染层只做只读可视化与历史查看；触发方式以「Ayaka 工具」为主。

## 1. Summary

把项目里散落的 `workflows` / `workflow_runs` 表 + `ToolSkillStep` 占位执行器升级为一套真正的工作流执行引擎：

- **DAG 工作流定义**：节点 + 边（`dependsOn`），支持 `prompt / tool / approval / memory / handoff / parallel / branch / delay` 八种节点类型。
- **状态机**：`queued → running → waiting_approval / waiting_handoff → succeeded / failed / cancelled`，每个节点独立追踪。
- **异常处理**：每节点可配 `retryPolicy`（次数 + 退避）、`timeoutMs`、`onError: fail | continue | compensate | fallback`。
- **Handoffs 落地**：`handoff` 节点直接桥接到现有 `agent-runtime.runChildAgent(... handoff)`，复用 OpenAI 范式中"控制权转移给子代理"的语义。
- **状态共享**：`WorkflowRun.contextJson` 承载节点间共享的 KV 上下文，前置节点 output 自动注入到下游 `prompt` / `tool` / `branch`。
- **可观测性**：每次状态迁移写入 `workflow_transitions` 表 + `runtime_events`，与现有 `runtime_steps` 关联。
- **触发**：注册为 Ayaka 的 `run_workflow` 工具，由 Ayaka 决定何时调用；同时保留手动 IPC 入口。

不引入新第三方依赖，不动 `package.json`，不打破现有 chat / skill 行为。

## 2. Current State Analysis

### 已存在

- **DB** (`apps/desktop/src/main/lib/schema.ts`):
  - `workflows(id, name, description, status, steps_json, trigger, created_at, updated_at)`
  - `workflow_runs(id, workflow_id, runtime_run_id, status, input_json, output_json, started_at, finished_at)`
  - `runtime_runs.workflow_id`, `RuntimeStepKind = ... | "workflow"`
- **类型** (`apps/desktop/src/shared/types.ts`):
  - `WorkflowDefinition`, `WorkflowStep`（仅 5 种 type）, `WorkflowRun`, `WorkflowStatus`
- **执行器（占位）** (`apps/desktop/src/main/lib/skill-runtime.ts`):
  - `runToolSkill` 已经会建 `WorkflowRun`，但 `executeStep` **只返回占位 JSON**，不真跑 LLM / 工具。
- **OpenAI 编排范式已实现** (`apps/desktop/src/main/lib/agent-runtime.ts`):
  - `createHandoffTool` / `createConsultTool`，子代理通过 `handoff_*` / `consult_*` 工具接入
  - `runChildAgent(... "handoff")` 转移所有权
  - Tool approval, runtime events, agent runtime state 全部齐全
- **渲染层** (`apps/desktop/src/renderer/src/components/MainPanelView.tsx`):
  - `WorkflowsPanel`：只读卡片列表，缺运行历史、缺节点详情、缺状态可视化
- **Hono server** (`apps/desktop/src/main/server/index.ts`):
  - `/api/chat`, `/api/media/generate`, `/api/title`, `/api/followups`, `/api/health`, `/api/models`
  - **没有工作流相关 endpoint**

### 缺失

1. 真正的执行引擎（DAG、并行、状态机、补偿）
2. 任务分配：节点 ↔ 代理 / 工具的映射
3. 异常处理：重试、退避、超时、降级、补偿
4. 节点间上下文传递与分支条件求值
5. Handoffs 在工作流节点级别的落地
6. 工作流运行的实时状态可见（步骤进度、迁移历史、输出）
7. 工作流管理 IPC + HTTP API
8. Ayaka 工具：让主代理主动调度工作流
9. 任何针对工作流引擎的单元测试

## 3. Proposed Changes

### 3.1 数据模型（`apps/desktop/src/shared/types.ts`）

扩展 `WorkflowDefinition`，新增节点与运行时类型。**保持向后兼容**：`steps_json` 里的 `ToolSkillStep` 仍可解析（自动转换为对应 `WorkflowNode`）。

```ts
// 新增节点类型与状态机
export type WorkflowNodeKind =
  | "prompt"
  | "tool"
  | "approval"
  | "memory"
  | "handoff"
  | "parallel"
  | "branch"
  | "delay";

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "waiting_approval"
  | "waiting_handoff";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_handoff"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface WorkflowRetryPolicy {
  maxAttempts: number; // 0 = 不重试
  backoffMs: number; // 首次退避
  backoffMultiplier: number; // 指数退避倍率
}

export interface WorkflowNodeConfig {
  // 通用
  agentId?: string; // prompt/handoff/approval 指定执行代理
  // prompt
  systemPrompt?: string;
  promptTemplate?: string; // 支持 {{context.key}} 插值
  // tool
  toolRef?: string; // "skill:xxx" / "web_search" / "mcp:serverId:toolName"
  toolInput?: JsonObject;
  // approval
  approvalPrompt?: string;
  // memory
  memoryQuery?: string;
  memoryKind?: MemoryKind;
  memoryWrite?: { title: string; content: string; kind: MemoryKind };
  // handoff
  targetAgentId?: string;
  handoffTask?: string;
  handoffExpectedOutput?: string;
  // parallel
  parallelNodes?: string[];
  // branch
  conditionExpression?: string; // 极简 JS 表达式，求值为 truthy 选择第一条 truthy 分支
  branches?: { nodeId: string; when?: string }[];
  // delay
  delayMs?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  description?: string;
  dependsOn: string[]; // DAG 边
  config: WorkflowNodeConfig;
  retryPolicy: WorkflowRetryPolicy;
  onError: "fail" | "continue" | "compensate" | "fallback";
  fallbackNodeId?: string;
  timeoutMs?: number;
}

// 扩展 WorkflowDefinition
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus; // "enabled" | "paused" | "draft"
  trigger: string; // "manual" | "ayaka-tool" | "skill:<id>" ...
  version: number;
  entryNodeId: string;
  nodes: WorkflowNode[]; // 取代/并列于旧的 steps_json
  steps_json?: string; // 保留旧字段做向后兼容
  created_at: number;
  updated_at: number;
}

// 运行时
export interface WorkflowStepRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: WorkflowNodeStatus;
  attempt: number;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  assigned_agent_id: string | null;
  metadata_json: string;
}

export interface WorkflowTransition {
  id: string;
  workflow_run_id: string;
  from_node_id: string | null;
  to_node_id: string;
  reason: string;
  created_at: number;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  runtime_run_id: string | null;
  status: WorkflowRunStatus;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  context_json: string; // 节点间共享 KV
  started_at: number;
  finished_at: number | null;
  triggered_by: "ayaka-tool" | "manual" | "schedule" | "skill";
  triggered_by_agent_id: string | null;
  conversation_id: string | null;
}
```

### 3.2 DB Schema（`apps/desktop/src/main/lib/schema.ts` + 新 migration）

- 改 `workflows`：把 JSON 内容提升为 `nodes_json`、`entry_node_id`、`version`；保留 `steps_json` 列兼容老 skill。
- 扩 `workflow_runs`：加 `context_json` / `triggered_by` / `triggered_by_agent_id` / `conversation_id`。
- 加 `workflow_step_runs`：
  - `id, workflow_run_id (fk cascade), node_id, status, attempt, input_json, output_json, error, started_at, finished_at, duration_ms, assigned_agent_id, metadata_json`
  - 索引：`(workflow_run_id, started_at)`
- 加 `workflow_transitions`：
  - `id, workflow_run_id (fk cascade), from_node_id, to_node_id, reason, created_at`
  - 索引：`(workflow_run_id, created_at)`
- **新 migration 文件** `apps/desktop/drizzle/0002_workflow_orchestration.sql`：所有变更用 `ALTER TABLE` + `CREATE TABLE` 做加法，不破坏现有数据。

### 3.3 核心引擎（新增 `apps/desktop/src/main/lib/workflow-engine.ts`）

```
executeWorkflow(opts) -> AsyncIterable<EngineEvent>
```

- **入口校验**：加载定义 → 校验 DAG（无环、`entryNodeId` 存在、所有 `dependsOn` 解析得到）→ 建 `WorkflowRun` 记录。
- **执行循环**：
  1. 计算"ready 节点"集合（`pending` 状态且所有前置 `succeeded`）。
  2. 对每个 ready 节点：
     - 写入 `workflow_step_runs` + `workflow_transitions` (`from=null, to=node, reason=ready`)。
     - 派发到对应 `StepExecutor`（`kind -> executor` 映射）。
     - 节点级超时由 `AbortController.timeout(node.timeoutMs)` 强制。
     - 失败时按 `retryPolicy` 退避重试；超过 `maxAttempts` 后按 `onError` 处置：
       - `fail` → 标记 `failed`，级联下游为 `skipped`，终止 run。
       - `continue` → 标记 `succeeded`（无 output），继续。
       - `compensate` → 向上游已 `succeeded` 的节点调用注册的 `Compensator`（默认 = 标记下游 `skipped`），然后 fail。
       - `fallback` → 派发到 `fallbackNodeId`（仅一次）。
  3. `parallel` 节点：`Promise.all(parallelNodes.map(runNode))`，全部完成才算完成。
  4. `branch` 节点：对 `branches[].when` 顺序求值，第一个 truthy 即派发对应节点，其余跳过。
  5. `approval` 节点：状态切到 `waiting_approval`、emit event，run 挂起；外部 `resolveApproval(runId, nodeId, decision)` 后恢复。
  6. `handoff` 节点：调用 `agent-runtime.runChildAgent(... "handoff")`，等待 output 注入 `context.outputs[handoffNodeId]`。
  7. 节点完成 → emit event → 写 transition → 检查下游 ready。
- **终止条件**：无 ready 节点 + 所有节点 `terminal`（succeeded/failed/skipped/cancelled）→ 写 `workflow_runs.status`。
- **可观测**：
  - 每次状态变化 `insertRuntimeEvent({ kind: "workflow", ... })`
  - 创建对应 `runtime_steps` 记录（关联 `runtime_runs`），便于现有 UI 复用。
- **可取消**：维护 `AbortController`，IPC 收到 `workflow:cancel` 时调用；每个节点在 `signal` 触发时尝试 throw `AbortError`。

### 3.4 DAG 工具（新增 `apps/desktop/src/main/lib/workflow-dag.ts`）

- `validateWorkflowDefinition(def): { ok: boolean; errors: string[] }`
  - 检查 `entryNodeId` 唯一、每个 `dependsOn` 目标存在
  - DFS 检测环
  - 检查 `parallel` / `branch` 内部节点都有效
- `topologicalOrder(def): string[]`
- `initialReady(def): string[]`
- `nextReady(def, completedSet, failedSet): string[]`
- 配套测试 `workflow-dag.test.ts`：环检测、并行组、孤立节点、空定义。

### 3.5 步骤执行器（新增 `apps/desktop/src/main/lib/workflow-executor.ts`）

```ts
type StepExecutor = (node, context, signal) => Promise<NodeResult>;
const executors: Record<WorkflowNodeKind, StepExecutor> = {
  prompt: executePrompt, // AI SDK generateText，model 来自 node.config.agentId
  tool: executeTool, // 走 tool-registry.ts / chat-tools 的解析
  approval: executeApproval, // 写 waiting_approval + 等外部 resolve
  memory: executeMemory, // listMemories / saveMemory
  handoff: executeHandoff, // agent-runtime.runChildAgent(... "handoff")
  parallel: executeParallel, // 调度并行子节点
  branch: executeBranch, // 简单表达式求值
  delay: executeDelay, // setTimeout + signal
};
```

- `executePrompt` 使用 `chat-agent.buildChatAgent` 复用模型解析。
- `executeHandoff` 通过 `agent-runtime` 暴露的 `runChildAgent(ctx, child, "handoff", { task, reason, expectedOutput })`，把 child output 写入 `context.outputs[nodeId]`。
- `executeTool` 复用 `chat-tools.ts` 的 `createSkillToolSet` / `createChatToolDescriptors`，按 `node.config.toolRef` 调度。

### 3.6 Ayaka 工具：作为触发入口（修改 `agent-runtime.ts`）

在 `buildRootToolRuntime` 中追加：

- `run_workflow` 工具（仅当 `agentId === root` 即 Ayaka 时注册，child 不挂）：
  - `description: "Run a saved workflow by id. Use when a multi-step process fits the user's request better than direct orchestration."`
  - `inputSchema`: `{ workflowId: string, input: JsonObject }`
  - `execute`: `executeWorkflow({ ... , triggeredBy: "ayaka-tool", triggeredByAgentId: rootAgent.id, conversationId, runtimeRunId })`
  - 输出首个 yield 后的 `engine.started` + runId + 节点清单（控制流回到 Ayaka 时 Ayaka 可读 run 状态）。
- 把它放进 `executors` 后，Ayaka 在 chat 中就能主动 "用 workflow X 跑一遍"，符合项目约束"主代理统一选人"。

### 3.7 Hono HTTP 端点（修改 `server/index.ts`）

新增路由（均需 `x-ayaka-session` 鉴权）：

- `GET  /api/workflows` → 列表
- `GET  /api/workflows/:id` → 详情（含 nodes）
- `POST /api/workflows` → 创建
- `PUT  /api/workflows/:id` → 更新
- `POST /api/workflows/:id/run` body `{ input, conversationId? }` → 启动 run，返回 `{ runId }`
- `POST /api/workflows/runs/:runId/cancel`
- `POST /api/workflows/runs/:runId/resolve-approval` body `{ nodeId, decision }`
- `GET  /api/workflows/runs?limit=50` → 历史
- `GET  /api/workflows/runs/:runId` → run + 关联 step_runs + transitions

响应 SSE 推送（可选，v1 用轮询）：先不引入 SSE，渲染层 1s 轮询即可。

### 3.8 IPC（修改 `main/ipc/index.ts` + `preload/index.ts`）

注册 channel：

- `workflow:list` / `workflow:get` / `workflow:create` / `workflow:update` / `workflow:run` / `workflow:cancel` / `workflow:list-runs` / `workflow:get-run`
- preload `index.ts` 白名单导出；`index.d.ts` 同步签名

### 3.9 渲染层（只读可视化）

修改 `apps/desktop/src/renderer/src/components/MainPanelView.tsx`，把现有 `WorkflowsPanel` 拆成三个子区域：

- `WorkflowsPanel`（更新）
  - 列表卡片：状态（enabled/paused/draft）+ 节点数 + 最近一次运行
  - 点击 → 抽屉式详情（节点列表 read-only：title/kind/dependsOn/agentId）
- `WorkflowRunsPanel`（新增）
  - 按 workflow 分组或全部平铺
  - 行：workflow 名、状态徽章、startedAt、durationMs、错误摘要
  - 点击 → `WorkflowRunDetail`
- `WorkflowRunDetail`（新增）
  - 顶部：状态 + 总耗时 + input/output
  - 节点时间轴：每个节点一行，状态色 + durationMs + 错误
  - 节点点击 → 弹出 `metadata_json` + 关联 `runtime_steps` 列表

样式沿用 HeroUI v3 + `agent-orb` 视觉语言；不引入新组件库。

`apps/desktop/src/renderer/src/lib/api.ts` 新增 `workflows.*` 客户端。

`apps/desktop/src/renderer/src/lib/i18n.messages.ts` 加键：

- `workflow.title` / `workflow.empty` / `workflow.status.*`
- `workflow.node.kind.*`（8 种 kind）
- `workflow.run.status.*`（8 种状态）
- `workflow.detail.started` / `workflow.detail.duration` / `workflow.detail.nodes` / ...

### 3.10 单元测试（新增）

- `apps/desktop/src/main/lib/workflow-dag.test.ts`：环、孤立节点、并行组、空定义、topo 顺序
- `apps/desktop/src/main/lib/workflow-engine.test.ts`：
  - 线性 prompt→tool→handoff 全成功
  - 节点失败触发重试后成功
  - 节点最终失败触发 `onError=fail` 级联跳过下游
  - `onError=fallback` 切到 fallback 节点
  - parallel 节点等待所有子节点完成
  - branch 节点按条件选路
  - approval 节点 `waiting_approval` → resolve → 继续
  - handoff 节点调用 `runChildAgent` 并把 output 写入 context
  - cancel：跑一半的节点被 abort，run 标 `cancelled`
- `apps/desktop/src/main/lib/workflow-runs.test.ts`：CRUD、状态迁移记录

### 3.11 i18n 与设置

- `apps/desktop/src/renderer/src/lib/i18n.messages.ts` 加中英文键（保持与现有 zh-CN/en 双语风格）
- 设置无新增（保留默认）

## 4. 关键文件清单

### 新增

- `apps/desktop/drizzle/0002_workflow_orchestration.sql`
- `apps/desktop/src/main/lib/workflow-engine.ts`
- `apps/desktop/src/main/lib/workflow-dag.ts`
- `apps/desktop/src/main/lib/workflow-executor.ts`
- `apps/desktop/src/main/lib/workflow-runs.ts`
- `apps/desktop/src/main/lib/workflow-types.ts`（main 侧再导出 + 校验）
- `apps/desktop/src/main/lib/workflow-dag.test.ts`
- `apps/desktop/src/main/lib/workflow-engine.test.ts`
- `apps/desktop/src/main/lib/workflow-runs.test.ts`
- `apps/desktop/src/renderer/src/components/WorkflowRunsPanel.tsx`
- `apps/desktop/src/renderer/src/components/WorkflowRunDetail.tsx`
- `apps/desktop/src/renderer/src/components/WorkflowStepViewer.tsx`
- `apps/desktop/src/renderer/src/lib/workflow-format.ts`

### 修改

- `apps/desktop/src/shared/types.ts`：扩展 `WorkflowDefinition`，新增 `WorkflowNode*` / `WorkflowStepRun` / `WorkflowTransition` / `WorkflowRunStatus`
- `apps/desktop/src/main/lib/schema.ts`：扩 `workflows` / `workflow_runs`，加 `workflow_step_runs` / `workflow_transitions`
- `apps/desktop/src/main/lib/db.ts`：新增/调整 CRUD + 兼容旧 `steps_json`
- `apps/desktop/src/main/lib/agent-runtime.ts`：在 root runtime 注册 `run_workflow` 工具
- `apps/desktop/src/main/server/index.ts`：新增 8 个 workflow endpoint
- `apps/desktop/src/main/ipc/index.ts`：注册 8 个 IPC channel
- `apps/desktop/src/preload/index.ts` + `index.d.ts`：白名单 + 类型
- `apps/desktop/src/renderer/src/lib/api.ts`：`workflows.*` 客户端
- `apps/desktop/src/renderer/src/components/MainPanelView.tsx`：把 `WorkflowsPanel` 升级为 `WorkflowsPanel` + `WorkflowRunsPanel` + `WorkflowRunDetail`
- `apps/desktop/src/renderer/src/lib/i18n.messages.ts`：新键
- `apps/desktop/drizzle/0001_bumpy_deathbird.sql`（仅记录，不要改老 migration）

## 5. Assumptions & Decisions

- **DAG 而非自由嵌套 FSM**：和 OpenAI agents 的「handoff 接管一段对话」模型匹配，复杂度可控。如未来需要子工作流，节点 `kind=workflow` 引用另一个 `workflowId`。
- **不使用三方状态机库**（如 xstate）：项目偏好"项目已有依赖优先"，且手写状态机 ~300 行内可控。
- **不引入 DAG 画布 UI**：按用户选择，渲染层只做只读可视化。
- **不引入新事件总线 / cron**：触发以 Ayaka 工具为主，IPC 手动为辅，schedule 留接口但 v1 不实现。
- **Handoff 节点语义**：按用户选择 = 转交控制权给子代理；不实现"挂起等待用户"。
- **approval 节点**：用户没选此项但 skill-runtime 已有 `approval` 占位，保留并完善（实现为异步等待，IPC 提供 resolve）。
- **不破坏现有 `ToolSkillStep` 占位**：`createSkillTool` 仍然走 `runToolSkill` 路径，迁移时 `db.ts` 内的 `ensureSkillWorkflow` 把旧 `steps_json` 升级为新 `nodes` 结构（一次性脚本）。
- **schema 迁移是加法**：所有 `ALTER TABLE` 加列 / `CREATE TABLE`，不删列；老客户端/老数据继续工作。
- **测试**遵循项目"核心业务逻辑、易回归边界、外部集成"的判据，覆盖状态机 + 异常路径。
- **可执行命令**：实现完成后跑 `vp install`（如果新增了 deps，但其实没新增）→ `vp check` → `vp test` → `pnpm run build:desktop:win`（按 Windows 构建经验，注意 Windows Defender 扫描与 `dist-v2` 输出目录）。

## 6. Verification Steps

1. `vp install` 同步依赖（理论上不需要新增，但安全起见）
2. `vp check`：format + lint + typecheck（`typecheck:web` + `typecheck:node`）
3. `vp test`：所有 vitest 套件通过，重点看 `workflow-dag.test.ts` / `workflow-engine.test.ts` / `workflow-runs.test.ts`
4. 手动冒烟（开发态 `vp dev`）：
   - 在 `WorkflowsPanel` 创建一条工作流 `wf-smoke`（节点 A：prompt，节点 B：tool `web_search`，节点 C：handoff `agent-researcher`，边 A→B→C）
   - 在主聊天里说"用 wf-smoke 跑一遍：foo bar"，Ayaka 应能调起 `run_workflow`
   - 在 `WorkflowRunsPanel` 看到 run 出现、状态变化、节点逐步 succeeded
   - 打开 `WorkflowRunDetail` 检查 context.outputs、step_runs、transitions
5. 异常路径：
   - 故意把 `tool` 节点指向不存在的 `toolRef`，验证 `onError=fail` + 重试 3 次后级联
   - 改 `onError=fallback` + 指定 fallback 节点，验证跳转
   - 运行中 `workflow:cancel`，验证 `cancelled` + 未完成节点标记
6. Handoff 路径：handoff 节点配置 `targetAgentId=agent-researcher`，chat 视角下应能看到 child agent 接管一段流（现有 agent-runtime 行为）
7. 桌面端构建：`pnpm run build:desktop:win`（沿用 project memory 中记录的已知坑，输出到 `dist-v2` 绕过 Windows Defender `EBUSY`）
