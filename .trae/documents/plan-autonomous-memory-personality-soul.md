# 自动记忆、个性与 SOUL 系统设计实施计划

## 摘要

将 ayaka 从「用户确认式记忆」改造为「智能体自动管理记忆」：

- **无感自动保存**：聊天结束后由 Ayaka 自动判断并保存记忆，不再进入 pending 队列，不需要用户确认。
- **无工具依赖**：`memory_save` / `memory_update` / `memory_delete` 不再默认启用，记忆操作由后台服务完成。
- **有界整理**：引入 `SOUL.md` / `USER.md` / `MEMORY.md` 三层文件，带字符上限，由 LLM 定期整理、合并、去重。
- **本地加密**：所有记忆文件使用项目已有的 AES-256-GCM 加密，满足数据本地安全约束。
- **跨会话持久**：SQLite `memories` 表 + 加密 Markdown 文件双轨持久化；会话开始时从文件加载冻结快照注入系统提示词。
- **SOUL 自演化**：从用户对话中提炼持久个性到 `SOUL.md`，从用户偏好中提炼到 `USER.md`，从环境与约定中提炼到 `MEMORY.md`。

后端继续采用已集成的 `mem0ai` OSS 本地版，不走 Mem0 Cloud，确保用户数据不离开本地。

## 当前状态分析

### 已具备基础

| 模块                                           | 现状                                                                  | 与目标关系                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| `mem0ai@3.0.13`（`apps/desktop/package.json`） | 已安装，使用 `mem0ai/oss` 本地嵌入                                    | 继续复用，不新增 `@mem0/vercel-ai-provider` |
| `mem0-service.ts`                              | 封装 Mem0 OSS：语义搜索、记忆抽取、重水合、向量同步                   | 作为自动提取核心，增强分类/有界能力         |
| `agent-learning.ts`                            | 聊天结束后触发，目前把提取结果放入内存 `pendingMemories`              | 需要改造为直接保存                          |
| `db.ts`                                        | `memories` 表、`saveMemory`/`searchMemories`/`buildAgentSystemPrompt` | 作为结构化持久层，需与文件层双向同步        |
| `crypto.ts`                                    | AES-256-GCM 加密/解密                                                 | 直接复用加密记忆文件                        |
| `chat-tools.ts`                                | `memory_save`/`memory_update`/`memory_delete` 默认启用                | 改为默认不启用                              |
| `MainPanelView.tsx`                            | 有 `MemoryPanel`，展示记忆列表与 pending 确认区                       | 移除 pending 区，改为展示自动学习状态       |
| `AgentsPanel.tsx` / `SettingsDialog.tsx`       | 可编辑 `persona`/`instructions`                                       | 调整为展示/编辑 `SOUL.md` 内容              |
| `ChatView.tsx`                                 | `onFinish` 调用 `api.agents.queueLearning`                            | 触发点保留                                  |

### 关键文件与行号

- `apps/desktop/src/main/lib/agent-learning.ts`：学习入口与 pending 队列（L21-L183）
- `apps/desktop/src/main/lib/mem0-service.ts`：Mem0 OSS 封装（L1-L203）
- `apps/desktop/src/main/lib/db.ts`：`buildAgentSystemPrompt`（L1851-L1883）、`saveMemory`（L949-L983）、`updateAyakaLearningState`（L1828-L1849）
- `apps/desktop/src/main/lib/chat-tools.ts`：工具定义 `memory_save/update/delete`（L202-L228）
- `apps/desktop/src/main/lib/runtime-defaults.ts`：默认工具种子（L83-L103）
- `apps/desktop/src/shared/types.ts`：`MemoryRecord`、`MemoryScope`、`MemoryKind`（L178-L207）
- `apps/desktop/src/renderer/src/components/MainPanelView.tsx`：记忆面板 UI
- `apps/desktop/src/renderer/src/components/ChatView.tsx`：`onFinish` 触发学习（L323-L328）

### 当前流程

```
聊天结束
  → ChatView.onFinish()
    → api.agents.queueLearning(conversationId)
      → agent-learning.queueAgentLearning()
        → runLearning() 提取候选
          → 入队 pendingMemories（需用户确认）
          → 正则降级时追加到 agent.soul_prompt
```

### 需要移除/改造的部分

1. `pendingMemories` 队列与确认 API。
2. `updateAyakaLearningState` 中直接修改 `agent.soul_prompt` 的旁门。
3. `memory_save/update/delete` 默认启用。
4. 系统提示词只从 `agent.soul_prompt/personality` 加载，缺少文件层有界整理。

## 参考文档核心启示

### Hermes Agent

- 三层文件：`SOUL.md`（身份/语气）、`MEMORY.md`（环境/约定/日记）、`USER.md`（用户画像）。
- 有界字符：`MEMORY.md` 约 2200 字符，`USER.md` 约 1375 字符。
- 冻结快照：会话开始时注入，会话中修改磁盘但不实时生效，保护前缀缓存。
- Agent 用 `memory` 工具自我管理记忆；本项目目标是无工具自动完成。

### OpenClaw

- `MEMORY.md` + `memory/YYYY-MM-DD.md` + `DREAMS.md`。
- 自动记忆刷新（compaction 前静默保存）。
- Dreaming：后台把短期信号提升为长期记忆。
- 对操作敏感的记忆需记录边界（审批/过期/权限）。

### 本项目采纳

- 采用 Hermes 的 `SOUL.md` / `USER.md` / `MEMORY.md` 三层文件作为「有界整理层」。
- 采用 OpenClaw 的「自动记忆刷新」思想：在聊天结束或会话压缩时自动整理。
- 保持 `memories` SQLite 表作为「全量结构化仓库」，文件层作为「有界提示词层」。
- 由于无工具自动完成，不再暴露 memory 工具给模型。

## 方案决策

### 决策 1：文件层与字符上限

在 `userData/data/agent-memories/` 下维护三个加密 Markdown 文件：

| 文件        | 用途                                     | 字符上限 | 来源                                                |
| ----------- | ---------------------------------------- | -------- | --------------------------------------------------- |
| `SOUL.md`   | Agent 身份、语气、沟通默认值、价值观     | 4 000    | 从 `agent.instructions` 初始化，后续由 LLM 自动整理 |
| `USER.md`   | 用户画像：偏好、沟通风格、反感、工作流   | 2 000    | 从用户对话自动提取                                  |
| `MEMORY.md` | 环境事实、项目约定、经验教训、已完成工作 | 4 000    | 从用户对话自动提取                                  |

文件超过上限时，由后台整理任务调用 LLM 合并/删除/压缩。

### 决策 2：数据安全

- 文件内容使用 `crypto.ts` 的 `encrypt()` / `decrypt()` 进行 AES-256-GCM 加密后落盘。
- 文件名不加密，文件扩展名 `.md.enc`。
- 完全本地存储，不调用 Mem0 Cloud。

### 决策 3：双轨持久化

- **SQLite `memories` 表**：全量、结构化、可搜索，保存每条原始记忆。
- **加密 Markdown 文件**：有界、整理后、用于系统提示词注入。
- **同步方向**：
  - 自动学习时：先写 SQLite + Mem0 向量索引，再触发文件层整理。
  - 文件整理时：读取 SQLite 中相关记忆，生成/更新 Markdown 文件。
  - 系统提示词：从文件读取冻结快照，不从 SQLite 全量读取。

### 决策 4：移除用户确认

- `agent-learning.ts` 中 `runLearning` 直接调用 `saveMemory`，不再写入 `pendingMemories`。
- 删除 `pendingMemories` 相关 IPC、API、UI。
- 保留失败/降级路径：无 OpenAI Key 时回退到正则提取并直接保存。

### 决策 5：移除记忆工具默认启用

- `runtime-defaults.ts` 中 `memory_save`/`memory_update`/`memory_delete` 的 `requiresApproval` 和 `defaultAuto` 都改为 `false`。
- `chat-tools.ts` 中保留工具实现，但默认不加入 `activeTools`。
- 用户仍可在工具选择面板中手动启用。

### 决策 6：SOUL 自演化

- 初始化时从 `agents.instructions` 写入 `SOUL.md`。
- 每次后台整理时，LLM 根据最近对话和 `MEMORY.md`/`USER.md` 评估是否需要更新 `SOUL.md`。
- 更新条件：出现新的稳定语气偏好、价值观、沟通边界。
- `SOUL.md` 更新也受字符上限约束。

### 决策 7：自动整理触发策略

- **即时整理**：每次 `runLearning` 保存新记忆后，异步触发一次轻量整理（只处理新增相关条目）。
- **定时整理**：应用启动后每 30 分钟检查一次文件容量，超过 80% 时触发深度整理。
- **会话压缩整理**：当单条会话消息数超过阈值时，在压缩前触发记忆刷新。

### 决策 8：Mem0 OSS 角色

- 继续用于语义搜索（`searchMemoriesSemantic`）。
- 继续用于 LLM 驱动的记忆提取（`addMemoriesFromConversation`）。
- 提取结果直接持久化到 SQLite，不再经过 pending。

## 实施步骤

### 步骤 1：安装依赖并验证环境

**文件**：`apps/desktop/package.json`、`pnpm-workspace.yaml`

- 确保 `vp install` 已执行（`node_modules` 当前缺失）。
- 无需新增 `@mem0/vercel-ai-provider`。
- 保持 `mem0ai: ^3.0.13`。

**验证**：

```bash
vp install
vp run typecheck:node
```

### 步骤 2：新增 `agent-memory-files.ts` 模块

**文件**：`apps/desktop/src/main/lib/agent-memory-files.ts`（新建）

核心职责：

- 读写加密的 `SOUL.md.enc` / `USER.md.enc` / `MEMORY.md.enc`。
- 提供文件内容到系统提示词的格式化。
- 调用 LLM 整理文件内容（合并、去重、压缩、过期清理）。
- 与 SQLite `memories` 表同步。

关键函数设计：

```typescript
export type MemoryFileKind = "soul" | "user" | "memory";

export interface AgentMemoryFiles {
  soul: string;
  user: string;
  memory: string;
}

export interface AgentMemoryFileSnapshot {
  kind: MemoryFileKind;
  content: string;
  charLimit: number;
  charCount: number;
  updatedAt: number;
  userLocked: boolean;
}

/** 文件字符上限常量 */
export const MEMORY_FILE_LIMITS: Record<MemoryFileKind, number> = {
  soul: 4000,
  user: 2000,
  memory: 4000,
};

/** 获取或创建加密记忆文件（解密后返回明文） */
export function readMemoryFile(kind: MemoryFileKind): string;

/** 加密并写入记忆文件 */
export function writeMemoryFile(
  kind: MemoryFileKind,
  content: string,
  options?: { userLocked?: boolean },
): void;

/** 获取单个文件快照（含字符统计与锁定状态） */
export function getMemoryFileSnapshot(kind: MemoryFileKind): AgentMemoryFileSnapshot;

/** 返回格式化的系统提示词块 */
export function buildMemoryFilePromptBlock(): Promise<string>;

/** 根据 SQLite 记忆条目整理文件层 */
export async function consolidateMemoryFiles(): Promise<void>;

/** 轻量追加整理：把新增记忆合并到对应文件 */
export async function incorporateNewMemories(records: MemoryRecord[]): Promise<void>;

/** 首次启动时从 agent.instructions 等初始化 SOUL.md */
export function ensureMemoryFiles(agent: AgentProfile): void;
```

实现要点：

- 目录：`join(resolveDataDir(), "agent-memories")`。
- 加密：`encrypt(content)` → 写 JSON；读 JSON → `decrypt(payload)`。
- 整理提示词模板：要求 LLM 输出三个文件的新内容，保持字符上限，去重合并。
- 安全扫描：写入前检查敏感信息（密码、API key 等），参考 `agent-learning.ts` 的 `isSafeDurableMemory`。
- 用户锁定：
  - 每次 `writeMemoryFile` 若由用户触发，设置 `userLocked = true`。
  - 自动整理 `consolidateMemoryFiles` 对 `userLocked` 文件只做保守合并（不删除、不大幅改写），或在整理后保持 `userLocked = true`。
  - 在 UI 中提供「解锁并允许自动整理」按钮，清除锁定标记。

### 步骤 3：改造 `agent-learning.ts`

**文件**：`apps/desktop/src/main/lib/agent-learning.ts`

改造要点：

1. 删除 `pendingMemories` 数组及 `listPendingMemories` / `confirmPendingMemory` / `rejectPendingMemory` / `confirmAllPendingMemories` / `rejectAllPendingMemories`。
2. `runLearning` 改为直接保存：
   - Mem0 路径：`addMemoriesFromConversation(..., persist = true)` 直接写入 SQLite + 向量索引。
   - 正则降级：`extractMemoryCandidates` + `saveMemory` 直接保存。
3. 保存成功后调用 `incorporateNewMemories(records)` 异步更新文件层。
4. 移除 `updateAyakaLearningState` 的 `soulPromptAppend` 副作用。
5. 更新 `insertRuntimeEvent` 的 `detail` 增加 `savedCount` 字段。

改造后核心流程：

```typescript
async function runLearning(conversationId: string): Promise<void> {
  // ... 状态更新 ...
  const mem0Messages = messages.slice(-12).map(...).filter(...);
  let records: MemoryRecord[] = [];
  let source = "regex";

  if (mem0Messages.length > 0) {
    const result = await addMemoriesFromConversation(mem0Messages, DEFAULT_AGENT_ID, conversationId, true);
    records = result.records;
    if (records.length > 0) source = "mem0";
  }

  if (records.length === 0) {
    records = extractMemoryCandidates(messages)
      .slice(0, MAX_MEMORIES_PER_RUN)
      .map((content) => buildMemoryRecord(content, conversationId));
    for (const r of records) saveMemory(r);
  }

  // 异步整理到文件层（不阻塞）
  if (records.length > 0) {
    import("./agent-memory-files")
      .then(({ incorporateNewMemories }) => incorporateNewMemories(records))
      .catch((err) => console.warn("[agent-learning] incorporate failed:", err));
  }

  updateAyakaLearningState({ status: "idle", lastLearningAt: Date.now() });
  // ... 事件记录 ...
}
```

### 步骤 4：IPC / Preload / API 调整

**文件**：

- `apps/desktop/src/main/ipc/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`
- `apps/desktop/src/renderer/src/lib/api.ts`
- `apps/desktop/src/shared/types.ts`

改造要点：

- 删除 `agents:pendingList` / `agents:pendingConfirm` / `agents:pendingReject` / `agents:pendingConfirmAll` / `agents:pendingRejectAll` IPC handler。
- 删除 preload 暴露的 pending API。
- 删除 `api.agents.pending.*`。
- 保留 `MemoryPendingSuggestion` 类型（用于向后兼容）或标记为 deprecated，但 UI 中不再使用。
- **新增记忆文件 IPC 接口**：
  - `agents:memoryFiles:list()` → 返回 `{ soul: string; user: string; memory: string; limits: Record<...> }`
  - `agents:memoryFiles:save({ kind, content })` → 保存用户编辑后的文件内容
  - `agents:memoryFiles:reload(kind)` → 强制从磁盘重新读取
- 对应 preload 与 renderer API：
  - `api.agents.memoryFiles.list()`
  - `api.agents.memoryFiles.save(kind, content)`
  - `api.agents.memoryFiles.reload(kind)`
- 新增共享类型：
  - `AgentMemoryFileSnapshot { kind: MemoryFileKind; content: string; charLimit: number; charCount: number; updatedAt: number; }`
  - `MemoryFileKind = "soul" | "user" | "memory"`

### 步骤 4.5：记忆页面支持查看/编辑 SOUL / USER / MEMORY 文件

**文件**：`apps/desktop/src/renderer/src/components/MainPanelView.tsx`

改造要点：

- 在 `MemoryPanel` 顶部增加「记忆文件」标签页切换（Tab：记忆条目 / SOUL / USER / MEMORY）。
- 「记忆条目」标签保留现有搜索、筛选、编辑、删除功能。
- 「SOUL」「USER」「MEMORY」三个标签页分别展示对应 `.md.enc` 解密后的明文内容。
- 每个文件标签页包含：
  - 字符计数与上限（如 `1 245 / 4 000`）。
  - 只读/编辑切换按钮。
  - 编辑模式使用 `TextArea`，保存前校验字符上限；超限时不允许保存并提示。
  - 「刷新」按钮：调用 `api.agents.memoryFiles.reload(kind)` 重新加载。
  - 最近更新时间。
- 用户手动保存文件后：
  - 调用 `api.agents.memoryFiles.save(kind, content)`。
  - 后台把内容写回加密文件，并同步更新 SQLite 中对应分类的摘要记忆（可选，保持文件与数据库一致）。
  - 设置一个「用户锁定」标记，下次自动整理时跳过该文件或仅做保守合并。
- 文件查看区域使用等宽字体或 Markdown 预览，确保格式可读。
- 保持与现有 `MainPanelView` 的加载/刷新模式一致。

UI 示意：

```
┌─────────────────────────────────────────────────────────────┐
│  记忆管理      [记忆条目] [SOUL] [USER] [MEMORY]   [刷新]    │
├─────────────────────────────────────────────────────────────┤
│  SOUL.md                                                编辑 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ # Personality                                      │   │
│  │ You are a pragmatic senior engineer...             │   │
│  │ ...                                                │   │
│  └─────────────────────────────────────────────────────┘   │
│  1 245 / 4 000 字符      上次更新：2026-07-11 14:32          │
└─────────────────────────────────────────────────────────────┘
```

### 步骤 5：更新 `db.ts` 系统提示词构建

**文件**：`apps/desktop/src/main/lib/db.ts`

改造要点：

1. `buildAgentSystemPrompt` 改为从文件层加载：
   - 读取 `SOUL.md`、`USER.md`、`MEMORY.md`。
   - 语义搜索作为补充（可选，当文件层为空或需要动态召回时）。
2. 保留 `agent.name` / `agent.role` 作为身份基础。
3. 不再把 `agent.soul_prompt` 直接拼接到系统提示词；如果 `SOUL.md` 不存在，回退到 `agent.soul_prompt` 并初始化文件。
4. `updateAyakaLearningState` 删除 `soulPromptAppend` 参数和修改 `agent.soul_prompt` 的逻辑。

改造后示例：

```typescript
export async function buildAgentSystemPrompt(agentId, conversationId): Promise<string> {
  const agent = getAgent(agentId || DEFAULT_AGENT_ID) ?? getAgent(DEFAULT_AGENT_ID);
  if (!agent) return "You are Ayaka, a local AI assistant.";

  const { buildMemoryFilePromptBlock, ensureMemoryFiles } = await import("./agent-memory-files");
  await ensureMemoryFiles(agent); // 首次从 agent 初始化 SOUL.md
  const fileBlock = await buildMemoryFilePromptBlock();

  // 可选：语义搜索补充最近 2 条相关记忆
  const recentMessages = conversationId ? listMessages(conversationId) : [];
  const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");
  let extraMemories = "";
  if (lastUserMsg) {
    const query = extractMessageTextFromContent(lastUserMsg.content).slice(0, 200);
    const { searchMemoriesSemantic } = await import("./mem0-service");
    const hits = await searchMemoriesSemantic(query, agent.id, conversationId, 3);
    if (hits.length > 0) {
      extraMemories =
        "\n\nRecently relevant memories:\n" +
        hits.map((m) => `- ${m.title}: ${m.content}`).join("\n");
    }
  }

  return [`You are ${agent.name}.`, `Role: ${agent.role}`, fileBlock, extraMemories]
    .filter(Boolean)
    .join("\n\n");
}
```

### 步骤 6：改造 `mem0-service.ts` 增强提取质量

**文件**：`apps/desktop/src/main/lib/mem0-service.ts`

改造要点：

1. 在 `addMemoriesFromConversation` 中为 Mem0 `add()` 增加 `metadata`，帮助后续分类到 `SOUL` / `USER` / `MEMORY`：
   - 可以保留当前实现，分类由文件层整理 LLM 决定。
2. 优化重水合：使用 `infer: false` 直接嵌入已有记忆，已完成。
3. 确保提取失败时返回空数组，调用方降级到正则。

### 步骤 7：新增后台整理调度

**文件**：`apps/desktop/src/main/lib/agent-memory-files.ts`（步骤 2 已新建）

在应用启动时注册定时整理：

- 在 `main/index.ts` 或 `db.ts` 初始化后调用 `scheduleMemoryFileConsolidation()`。
- 每 30 分钟检查一次容量；超过 80% 触发 `consolidateMemoryFiles()`。
- 使用 Node.js `setInterval`，清理逻辑在应用退出时清除。

### 步骤 8：更新 `runtime-defaults.ts`

**文件**：`apps/desktop/src/main/lib/runtime-defaults.ts`

将 `memory_save`、`memory_update`、`memory_delete` 的 `defaultAuto` 和 `requiresApproval` 改为 `false`：

```typescript
{ id: "memory_save", title: "Save memory", category: "memory", requiresApproval: 0, defaultAuto: 0 },
{ id: "memory_update", title: "Update memory", category: "memory", requiresApproval: 0, defaultAuto: 0 },
{ id: "memory_delete", title: "Delete memory", category: "memory", requiresApproval: 0, defaultAuto: 0 },
```

### 步骤 9：更新 `chat-tools.ts` 工具定义

**文件**：`apps/desktop/src/main/lib/chat-tools.ts`

- 保留 `memory_save` / `memory_update` / `memory_delete` 的实现，供手动启用时使用。
- 在 `createChatToolDescriptors` 中确保它们的 `defaultAuto` 为 `false`（与 runtime-defaults 一致）。
- 保留 `memory_search` 默认启用，因为用户仍可能需要显式搜索记忆。

### 步骤 10：前端 UI 调整

#### 10.1 `MainPanelView.tsx`

**文件**：`apps/desktop/src/renderer/src/components/MainPanelView.tsx`

- 移除 `pending` 状态、待确认列表、「全部确认/拒绝」按钮。
- 新增展示最近一次自动学习状态（`AgentRuntimeState.last_learning_at`、`status`、`last_error`）。
- 保留记忆搜索/筛选/编辑/删除功能。

#### 10.2 `AgentsPanel.tsx`

**文件**：`apps/desktop/src/renderer/src/components/AgentsPanel.tsx`

- 在 Agent 编辑页增加「SOUL」标签页，展示/编辑 `SOUL.md` 内容。
- 保留 `persona` 字段作为只读展示或短期覆盖，但明确告知用户持久 SOUL 由文件层维护。
- 初始化 Agent 时，如果 `SOUL.md` 不存在，从 `instructions` 生成。

### 步骤 11：类型与 IPC 更新

**文件**：`apps/desktop/src/shared/types.ts`

- 新增 `MemoryFileKind` 相关类型（也可仅在 main 进程内部使用，不暴露给 shared）。
- 删除 `MemoryPendingSuggestion` 在 preload d.ts 中的使用；保留类型定义避免破坏旧数据序列化。

### 步骤 12：测试与验证

**文件**：

- `apps/desktop/src/main/lib/chat-tools.test.ts`
- `apps/desktop/src/main/server/index.test.ts`
- `apps/desktop/src/main/lib/agent-learning.test.ts`（如不存在则新建）

更新要点：

- 移除 pending 相关测试。
- 补充自动保存测试：模拟 Mem0 可用/不可用场景。
- 补充文件层测试：读写加密文件、字符上限、整理逻辑。
- 更新 `runtime-defaults` 测试：确认记忆工具 `defaultAuto` 为 `false`。

## 改造后数据流

```
用户发送消息
  │
  ├─▶ /api/chat
  │     ├─▶ buildAgentSystemPrompt(agentId, conversationId)
  │     │     ├─▶ 读取 SOUL.md / USER.md / MEMORY.md（解密后冻结快照）
  │     │     └─▶ 可选语义搜索补充 3 条相关记忆
  │     └─▶ runAgentChat({ system: 文件层提示词 })
  │           └─▶ ToolLoopAgent 生成回复（无 memory_save/update/delete 默认工具）
  │
  └─▶ 回复完成后
        └─▶ ChatView.onFinish()
              └─▶ api.agents.queueLearning(conversationId)
                    └─▶ agent-learning.runLearning()
                          ├─▶ Mem0 LLM 提取记忆
                          ├─▶ saveMemory() 写入 SQLite + 向量索引
                          └─▶ incorporateNewMemories(records) 异步整理文件层
                                ├─▶ 更新 USER.md（用户偏好）
                                ├─▶ 更新 MEMORY.md（环境/约定）
                                └─▶ 评估是否更新 SOUL.md（身份/语气）

定时整理
  └─▶ 每 30 分钟检查容量
        └─▶ consolidateMemoryFiles()
              ├─▶ LLM 合并/去重/压缩
              └─▶ 写回加密文件
```

## 假设与决策表

| #   | 假设/决策                                                | 依据                                                          |
| --- | -------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | 继续用 `mem0ai` OSS，不走 `@mem0/vercel-ai-provider`     | 用户确认数据安全优先，Cloud 方案违反 AES-256-GCM 本地加密约束 |
| 2   | 记忆文件使用 AES-256-GCM 加密存储                        | 项目 `crypto.ts` 已有实现，满足 hard constraint               |
| 3   | 字符上限：SOUL 4000 / USER 2000 / MEMORY 4000            | 参考 Hermes 比例，结合模型上下文预算调整                      |
| 4   | `memory_save/update/delete` 不再默认启用                 | 用户要求「不需要通过 tools」                                  |
| 5   | 保留 `memory_search` 默认启用                            | 用户仍可能需要显式搜索，且与「自动」不冲突                    |
| 6   | 自动保存移除 pending 确认                                | 用户要求「不需要用户审批」                                    |
| 7   | SQLite 表保留作为全量仓库                                | 已有实现，避免破坏历史数据和搜索能力                          |
| 8   | 文件层从 SQLite 整理而来                                 | 保证文件层有界且经过整理                                      |
| 9   | `SOUL.md` 从 `agent.instructions` 初始化                 | 平滑迁移现有 agent 配置                                       |
| 10  | 定时整理 30 分钟一次，容量阈值 80%                       | 经验值，可在设置中后续调整                                    |
| 11  | 文件整理调用 LLM（gpt-5-mini）                           | Mem0 默认模型，复用已有 OpenAI key                            |
| 12  | 无 OpenAI Key 时回退正则提取并直接保存                   | 保证可用性                                                    |
| 13  | 用户可在记忆页面查看/编辑 SOUL / USER / MEMORY 文件      | 用户明确要求                                                  |
| 14  | 用户编辑的文件设置 `userLocked` 标记，自动整理时保守处理 | 保护用户手动编辑成果                                          |

## 风险与缓解

| 风险                                        | 缓解                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| 文件层整理 LLM 调用可能失败或产生低质量内容 | 失败时保留旧文件；整理提示词包含严格格式要求；安全扫描过滤敏感信息                    |
| SOUL.md 被 LLM 写坏                         | 写入前校验字符上限；保留上一次版本作为 `.bak`；仅在整理任务中更新，不在每轮聊天中更新 |
| 自动保存引入噪音记忆                        | Mem0 LLM 抽取已优于正则；定期整理会合并/删除低价值条目；用户可在记忆管理页手动删除    |
| 多 Agent 共享 SOUL/USER 文件                | 当前默认只有 Ayaka 一个主 Agent；后续可为每个 agent 创建子目录 `{agentId}/SOUL.md`    |
| 升级后旧 `agent.soul_prompt` 不再生效       | 首次启动时从 `instructions` 初始化 `SOUL.md`，用户可在设置中查看/编辑                 |

## 验证步骤

1. **依赖安装**：

   ```bash
   vp install
   vp run typecheck:node
   vp run typecheck:web
   ```

2. **单元测试**：

   ```bash
   vp test
   ```
   - 重点验证 `chat-tools.test.ts` 中 memory 工具默认状态。
   - 验证新的 `agent-memory-files` 模块测试（如新建）。
   - 验证 `agent-learning` 不再产生 pending。

3. **手动验证-自动保存**：
   - 进行多轮对话，说出明确偏好（如「我喜欢简洁回答」）。
   - 检查 `userData/data/agent-memories/` 下 `USER.md.enc` 是否被创建/更新。
   - 检查 `MEMORY.md.enc` 是否记录环境/约定。
   - 检查 `MainPanelView` 不再显示 pending 确认区。

4. **手动验证-记忆文件查看/编辑**：
   - 打开记忆管理页面，切换 SOUL / USER / MEMORY 标签。
   - 确认能查看解密后的明文内容、字符计数、更新时间。
   - 编辑 USER.md 保存后，确认文件内容持久化且设置 `userLocked`。
   - 触发自动整理后，确认被锁定的文件内容不被大幅改写。

5. **手动验证-系统提示词**：
   - 新会话开始时，确认 `SOUL.md` / `USER.md` / `MEMORY.md` 内容注入系统提示词。
   - 确认模型能引用之前自动保存的记忆。

6. **手动验证-工具默认状态**：
   - 进入聊天工具选择，确认 `memory_save/update/delete` 默认未选中。
   - 确认 `memory_search` 仍默认选中。

7. **安全验证**：
   - 打开 `agent-memories/` 目录，确认文件内容为加密形态，无法直接阅读。
   - 确认应用内能正常解密读取。

8. **降级验证**：
   - 不配置 OpenAI Key，确认正则提取仍可直接保存记忆，无报错。

## 后续可选增强

- 为每个 Agent 维护独立文件目录。
- 引入 `memory/YYYY-MM-DD.md` 每日笔记层（OpenClaw 风格）。
- 支持用户手动锁定/解锁某条记忆不被整理删除。
- 在 UI 中展示 SOUL/USER/MEMORY 三个文件的内容与容量百分比。
