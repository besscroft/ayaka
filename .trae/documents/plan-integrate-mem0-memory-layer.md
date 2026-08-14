# Mem0 记忆层集成实施计划

## 摘要

将 Mem0 OSS（自托管开源版）集成到 ayaka 桌面应用，替换现有的正则关键词记忆提取，引入 LLM 驱动抽取与向量语义搜索。采用"全量注入"策略：系统提示词 + memory_search 工具 + agent-learning 三条路径全部升级为 Mem0 语义化。

## 当前状态分析

### 现有记忆架构（三条路径）

```
路径1：agent-learning.ts（记忆提取）
  queueAgentLearning() 防抖 1200ms
    → runLearning()
      → extractMemoryCandidates() 正则匹配 /I prefer|like|want|need/
      → buildMemory() 构造 MemoryRecord
      → saveMemory() 写入 SQLite memories 表

路径2：db.ts buildAgentSystemPrompt（系统提示词注入）
  buildAgentSystemPrompt(agentId, conversationId) 同步
    → listMemories() 全量读取 SQLite
    → 过滤 scope/agent_id/conversation_id
    → 按 pinned DESC, salience DESC 排序，取前 8 条
    → 拼接到系统提示词

路径3：chat-tools.ts memory_search 工具（按需搜索）
  searchMemories(query, limit) 同步
    → listMemories() 全量读取
    → splitTerms() 分词 + scoreText() TF 评分
    → 按 score DESC 排序
```

### 关键文件与行号

| 文件                                          | 行号             | 内容                              |
| --------------------------------------------- | ---------------- | --------------------------------- |
| `apps/desktop/src/main/lib/agent-learning.ts` | 全文             | 正则抽取 + 防抖队列               |
| `apps/desktop/src/main/lib/db.ts`             | L939-944         | `listMemories()` 全量查询         |
| `apps/desktop/src/main/lib/db.ts`             | L947-974         | `saveMemory()` upsert             |
| `apps/desktop/src/main/lib/db.ts`             | L1627-1649       | `buildAgentSystemPrompt()` 同步   |
| `apps/desktop/src/main/lib/chat-tools.ts`     | L865-895         | `searchMemories()` TF 评分        |
| `apps/desktop/src/main/lib/chat-tools.ts`     | L965-996         | `saveChatMemory()` 直写 SQLite    |
| `apps/desktop/src/main/lib/chat-tools.ts`     | L582-597         | `memory_search` 工具定义          |
| `apps/desktop/src/main/lib/agent-runtime.ts`  | L76, L92         | `buildAgentSystemPrompt` 类型签名 |
| `apps/desktop/src/main/lib/agent-runtime.ts`  | L1079-1110       | `createRootInstructions` 调用     |
| `apps/desktop/src/main/lib/agent-runtime.ts`  | L1112-1126       | `createChildInstructions` 调用    |
| `apps/desktop/src/main/lib/agent-runtime.ts`  | L233, L536       | 两个调用点                        |
| `apps/desktop/src/main/server/index.ts`       | L311-312         | server 层 wrapper                 |
| `apps/desktop/src/main/server/index.test.ts`  | L152, L193, L243 | 3 处同步断言                      |
| `apps/desktop/src/main/lib/schema.ts`         | L446-472         | `memories` 表 schema（保持不变）  |
| `apps/desktop/src/main/lib/providers.ts`      | L1-24            | `getApiKey("openai")` 可复用      |
| `apps/desktop/src/main/lib/db.ts`             | L137-157         | 数据目录 `userData/data/`         |
| `pnpm-workspace.yaml`                         | L8-36            | pnpm catalog                      |

## 方案决策

### 决策1：向量存储——内存索引 + SQLite 镜像

Mem0 OSS 无原生 SQLite 向量存储后端（支持 `memory`/qdrant/redis/pgvector）。采用：

- **向量索引**：Mem0 内存向量存储（`provider: "memory"`），延迟 <50ms
- **持久化**：SQLite `memories` 表作为镜像，应用启动时从中重水合到内存索引
- **写入**：双写——Mem0 `add()` 提取+嵌入+存入内存向量，同时写入 SQLite 持久化

### 决策2：LLM/Embedder——复用 OpenAI API Key

通过 `getApiKey("openai")` 读取项目已有的加密 OpenAI Key：

- LLM：`gpt-5-mini`（Mem0 默认，用于记忆抽取）
- Embedder：`text-embedding-3-small`（1536 维）
- 无 API Key 时降级到现有关键词/正则逻辑

### 决策3：Mem0 History 独立 DB 文件

Mem0 OSS 内部用 SQLite 记录记忆变更历史（ADD/UPDATE/DELETE）。使用独立文件 `userData/data/mem0-history.db`，与主库 `ayaka.db` 隔离，避免 schema 冲突。

### 决策4：全量注入——buildAgentSystemPrompt 改为 async

用户选择全量注入。async 连锁影响：

```
db.ts buildAgentSystemPrompt → async
  ↓
agent-runtime.ts 类型签名 (L76, L92) → Promise<string>
  ↓
agent-runtime.ts createRootInstructions (L1079) → async
agent-runtime.ts createChildInstructions (L1112) → async
  ↓
agent-runtime.ts L233 → await createRootInstructions(...)
agent-runtime.ts L536 → await createChildInstructions(...)
  ↓
server/index.ts L311 → async wrapper
  ↓
server/index.test.ts L152, L193, L243 → await
```

### 决策5：Scope 映射

| 项目 MemoryScope | Mem0 过滤                | 说明         |
| ---------------- | ------------------------ | ------------ |
| `global`         | 无 userId 过滤           | 全局共享记忆 |
| `agent`          | `userId: agent_id`       | 按智能体隔离 |
| `conversation`   | `runId: conversation_id` | 按会话隔离   |

## 实施步骤

### 步骤1：安装 mem0ai 依赖

**文件**：`pnpm-workspace.yaml`、`apps/desktop/package.json`

在 `pnpm-workspace.yaml` 的 catalog 中添加：

```yaml
catalog:
  mem0ai: "^3.0.13" # npm registry 最新稳定版（含 ./oss 子路径导出）
```

在 `apps/desktop/package.json` 的 dependencies 中添加：

```json
"mem0ai": "catalog:"
```

执行 `vp install`。

### 步骤2：新建 mem0-service.ts 模块

**文件**：`apps/desktop/src/main/lib/mem0-service.ts`（新建）

核心职责：封装 Mem0 OSS 实例管理、语义搜索、记忆提取、重水合。

```typescript
import { Memory } from "mem0ai/oss";
import { app } from "electron";
import { join } from "node:path";
import { getApiKey, listMemories, saveMemory } from "./db";
import { DEFAULT_AGENT_ID, type MemoryRecord } from "../../shared/types";

let memoryInstance: Memory | null = null;
let rehydrated = false;

/** 获取 Mem0 实例，无 OpenAI Key 时返回 null（降级模式） */
export async function getMemory(): Promise<Memory | null> {
  if (memoryInstance) return memoryInstance;

  const apiKey = getApiKey("openai");
  if (!apiKey) return null;

  const historyDbPath = join(
    process.env.AYAKA_USER_DATA_DIR || app.getPath("userData"),
    "data",
    "mem0-history.db",
  );

  memoryInstance = new Memory({
    llm: { provider: "openai", config: { apiKey, model: "gpt-5-mini" } },
    embedder: { provider: "openai", config: { apiKey, model: "text-embedding-3-small" } },
    vectorStore: {
      provider: "memory",
      config: { collectionName: "ayaka-memories", dimension: 1536 },
    },
    historyDbPath,
  });

  if (!rehydrated) {
    await rehydrateFromSQLite();
    rehydrated = true;
  }

  return memoryInstance;
}

/** 启动时从 SQLite 重水合到 Mem0 内存向量索引 */
async function rehydrateFromSQLite(): Promise<void> {
  if (!memoryInstance) return;
  const existing = listMemories();
  for (const mem of existing) {
    await memoryInstance.add([{ role: "user", content: `${mem.title}: ${mem.content}` }], {
      userId: mem.agent_id ?? "global",
      runId: mem.conversation_id ?? undefined,
      metadata: { sqliteId: mem.id, scope: mem.scope, kind: mem.kind },
    });
  }
}

/** 语义搜索记忆，降级到全量查询 */
export async function searchMemoriesSemantic(
  query: string,
  agentId?: string | null,
  conversationId?: string,
  limit = 8,
): Promise<MemoryRecord[]> {
  const memory = await getMemory();
  if (!memory) {
    // 降级：无 API Key，回退到全量过滤
    return listMemories()
      .filter(
        (m) =>
          m.scope === "global" ||
          m.agent_id === agentId ||
          (conversationId && m.conversation_id === conversationId),
      )
      .slice(0, limit);
  }

  const results = await memory.search(query, {
    filters: agentId ? { userId: agentId } : undefined,
  });

  return results.results.slice(0, limit).map((r) => ({
    id: (r.metadata?.sqliteId as string) ?? r.id,
    scope: (r.metadata?.scope as MemoryRecord["scope"]) ?? "agent",
    kind: (r.metadata?.kind as MemoryRecord["kind"]) ?? "fact",
    title: r.memory.slice(0, 36),
    content: r.memory,
    agent_id: agentId ?? null,
    conversation_id: null,
    source_run_id: null,
    salience: 70,
    pinned: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  }));
}

/** 通过 Mem0 LLM 抽取记忆并双写 */
export async function addMemoriesFromConversation(
  messages: Array<{ role: string; content: string }>,
  agentId?: string | null,
  conversationId?: string,
): Promise<number> {
  const memory = await getMemory();
  if (!memory) return 0; // 降级：由调用方回退到正则

  const result = await memory.add(messages, {
    userId: agentId ?? DEFAULT_AGENT_ID,
    runId: conversationId ?? undefined,
  });

  // 双写：将抽取的记忆同步到 SQLite
  const extracted = result?.results ?? [];
  for (const item of extracted) {
    if (!item.memory) continue;
    const record: MemoryRecord = {
      id: item.id,
      scope: "agent",
      kind: "fact",
      title: item.memory.slice(0, 33) + (item.memory.length > 33 ? "..." : ""),
      content: item.memory,
      agent_id: agentId ?? DEFAULT_AGENT_ID,
      conversation_id: null,
      source_run_id: null,
      salience: 70,
      pinned: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    saveMemory(record);
  }
  return extracted.length;
}

/** 重置实例（API Key 变更后调用） */
export function resetMemoryInstance(): void {
  memoryInstance = null;
  rehydrated = false;
}
```

### 步骤3：重构 agent-learning.ts

**文件**：`apps/desktop/src/main/lib/agent-learning.ts`

改造要点：

- `runLearning()` 调用 `addMemoriesFromConversation()` 替代 `extractMemoryCandidates()`
- 保留 `extractMemoryCandidates`/`buildMemory` 作为降级路径（Mem0 不可用时回退）
- 记忆抽取不再有 `MAX_MEMORIES_PER_RUN` 限制（由 Mem0 LLM 自行决定）

```typescript
// runLearning 核心改造
async function runLearning(conversationId: string): Promise<void> {
  // ... 状态更新 ...
  try {
    const messages = listMessages(conversationId)
      .slice(-12)
      .map((m) => ({
        role: m.role,
        content: extractMessageText(m.content),
      }))
      .filter((m) => m.content);

    // 尝试 Mem0 LLM 抽取
    const count = await addMemoriesFromConversation(messages, DEFAULT_AGENT_ID, conversationId);

    if (count === 0) {
      // 降级：Mem0 不可用，回退到正则抽取
      const candidates = extractMemoryCandidates(listMessages(conversationId))
        .slice(0, MAX_MEMORIES_PER_RUN)
        .map((content) => buildMemory(content));
      for (const memory of candidates) saveMemory(memory);
    }
    // ... 状态更新 ...
  } catch (error) {
    // ... 错误处理 ...
  }
}
```

保留 `extractMemoryCandidates`、`buildMemory`、`isSafeDurableMemory`、`titleFromContent`、`extractMessageText` 作为降级路径。

### 步骤4：buildAgentSystemPrompt 改为 async + 语义搜索

**文件**：`apps/desktop/src/main/lib/db.ts` (L1627-1649)

```typescript
// 改造前
export function buildAgentSystemPrompt(agentId?: string | null, conversationId?: string): string {
  const agent = getAgent(agentId || DEFAULT_AGENT_ID) ?? getAgent(DEFAULT_AGENT_ID);
  if (!agent) return "You are Ayaka, a local AI assistant.";
  const memoriesForPrompt = listMemories()
    .filter(...)
    .slice(0, 8)
    .map((memory) => `- ${memory.title}: ${memory.content}`)
    .join("\n");
  return [...].filter(Boolean).join("\n\n");
}

// 改造后
export async function buildAgentSystemPrompt(
  agentId?: string | null,
  conversationId?: string,
): Promise<string> {
  const agent = getAgent(agentId || DEFAULT_AGENT_ID) ?? getAgent(DEFAULT_AGENT_ID);
  if (!agent) return "You are Ayaka, a local AI assistant.";

  // 从最近用户消息提取查询词
  const recentMessages = conversationId ? listMessages(conversationId) : [];
  const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");
  const query = lastUserMsg ? extractMessageText(lastUserMsg.content).slice(0, 200) : "";

  // 语义搜索（降级到全量过滤）
  const { searchMemoriesSemantic } = await import("./mem0-service");
  const memories = query
    ? await searchMemoriesSemantic(query, agent.id, conversationId, 8)
    : listMemories().filter((m) => m.scope === "global" || m.agent_id === agent.id).slice(0, 8);

  const memoriesForPrompt = memories
    .map((memory) => `- ${memory.title}: ${memory.content}`)
    .join("\n");

  return [
    `You are ${agent.name}.`,
    `Role: ${agent.role}`,
    agent.personality ? `Persona: ${agent.personality}` : "",
    agent.soul_prompt,
    memoriesForPrompt ? `Relevant memory:\n${memoriesForPrompt}` : "",
  ].filter(Boolean).join("\n\n");
}
```

需要从 `agent-learning.ts` 导出 `extractMessageText` 或在 `db.ts` 内联实现（建议内联以避免循环依赖）。

### 步骤5：更新 agent-runtime.ts 类型与调用

**文件**：`apps/desktop/src/main/lib/agent-runtime.ts`

5 处改动：

1. **L76** 类型签名：

```typescript
// 改造前
buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => string;
// 改造后
buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => Promise<string>;
```

2. **L92** 类型签名：同上

3. **L1079** `createRootInstructions` 改为 async：

```typescript
async function createRootInstructions(
  context: RuntimeContext,
  toolInstructions?: string,
): Promise<string> {
  // ...
  const basePrompt = await context.buildAgentSystemPrompt(DEFAULT_AGENT_ID, context.conversationId);
  return [
    basePrompt,
    "You are Ayaka, the root orchestrator...",
    // ...
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

4. **L1112** `createChildInstructions` 改为 async：

```typescript
async function createChildInstructions(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
): Promise<string> {
  const basePrompt = await context.buildAgentSystemPrompt(child.id, context.conversationId);
  return [basePrompt, "You are a child agent under Ayaka...", // ...].join("\n\n");
}
```

5. **L233, L536** 调用点加 `await`：

```typescript
// L233
instructions: await createRootInstructions(context, toolRuntime.instructions),
// L536
instructions: await createChildInstructions(context, child, mode),
```

### 步骤6：更新 server/index.ts 和测试

**文件**：`apps/desktop/src/main/server/index.ts` (L311-312)

```typescript
// 改造前
buildAgentSystemPrompt: (agentId, conversationId) =>
  body.system ?? buildAgentSystemPrompt(agentId, conversationId),
// 改造后
buildAgentSystemPrompt: async (agentId, conversationId) =>
  body.system ?? (await buildAgentSystemPrompt(agentId, conversationId)),
```

**文件**：`apps/desktop/src/main/server/index.test.ts` (L152, L193, L243)

3 处断言改为 `await`：

```typescript
// 改造前
assert.equal(
  captured.value?.buildAgentSystemPrompt("agent-ayaka", "c-stream"),
  "You are a test assistant.",
);
// 改造后
assert.equal(
  await captured.value?.buildAgentSystemPrompt("agent-ayaka", "c-stream"),
  "You are a test assistant.",
);
```

### 步骤7：更新 chat-tools.ts

**文件**：`apps/desktop/src/main/lib/chat-tools.ts`

7.1 `searchMemories()` (L865) 改为 async + 语义搜索：

```typescript
async function searchMemories(
  query: string,
  limit: number,
  agentId?: string | null,
  conversationId?: string,
): Promise<
  Array<{
    id: string;
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    content: string;
    salience: number;
    pinned: boolean;
  }>
> {
  const { searchMemoriesSemantic } = await import("./mem0-service");
  const results = await searchMemoriesSemantic(query, agentId, conversationId, limit);
  return results.map((memory) => ({
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    content: truncate(memory.content, 600),
    salience: memory.salience,
    pinned: memory.pinned === 1,
  }));
}
```

7.2 `memory_search` 工具 execute (L594) 传入 agentId/conversationId：

```typescript
executeWithAudit("memory_search", "Memory search", model, conversationId, async () => {
  const results = await searchMemories(query, limit, agentId, conversationId);
  // ...
});
```

7.3 `saveChatMemory()` (L965) 改为 async + 双写 Mem0：

```typescript
async function saveChatMemory(
  input: MemorySaveInput,
  conversationId: string | undefined,
  agentId: string | null | undefined,
): Promise<unknown> {
  // ... 现有 SQLite 写入逻辑保持不变 ...
  saveMemory(memory);

  // 双写 Mem0（fire-and-forget）
  const { addMemoriesFromConversation } = await import("./mem0-service");
  addMemoriesFromConversation(
    [{ role: "user", content: `${input.title}: ${input.content}` }],
    agentId,
    conversationId,
  ).catch(() => undefined);

  return { id: memory.id, scope: memory.scope /* ... */ };
}
```

## 改造后数据流

```
用户发送消息
  │
  ├─▶ server/index.ts /api/chat
  │     │
  │     ├─▶ buildAgentSystemPrompt(agentId, conversationId) [async]
  │     │     └─▶ mem0-service.searchMemoriesSemantic(query, agentId)
  │     │           ├─ Mem0 可用 → memory.search() 向量搜索 (<50ms)
  │     │           └─ Mem0 不可用 → listMemories() 全量过滤 (降级)
  │     │
  │     └─▶ runAgentChat({ system: 语义化提示词 })
  │           │
  │           ├─▶ createRootInstructions [async]
  │           │     └─ await buildAgentSystemPrompt(...)
  │           │
  │           └─▶ agent 回复过程中可调用 memory_search 工具
  │                 └─▶ searchMemories() [async]
  │                       └─▶ searchMemoriesSemantic() 语义搜索
  │
  └─▶ 回复完成后
        └─▶ queueAgentLearning(conversationId) 防抖 1200ms
              └─▶ runLearning() [async]
                    ├─ Mem0 可用 → addMemoriesFromConversation()
                    │     ├─ Mem0 LLM 抽取记忆
                    │     ├─ 向量嵌入 + 存入内存索引
                    │     └─ 双写 SQLite memories 表
                    └─ Mem0 不可用 → extractMemoryCandidates() 正则降级
                          └─ saveMemory() 写入 SQLite

应用启动
  └─▶ mem0-service.getMemory() 首次调用
        └─▶ rehydrateFromSQLite()
              └─▶ listMemories() → 逐条 memory.add() 重建向量索引
```

## 假设与决策表

| #   | 假设/决策                                                                                                            | 依据                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | Mem0 OSS 使用 `mem0ai/oss` 子路径导入                                                                                | 官方 Node.js 快速入门文档        |
| 2   | OpenAI `gpt-5-mini` + `text-embedding-3-small` 为默认配置                                                            | Mem0 官方文档默认值              |
| 3   | 内存向量存储在进程重启后丢失，需从 SQLite 重水合                                                                     | Mem0 `memory` provider 不持久化  |
| 4   | `getApiKey("openai")` 返回解密后的明文 Key                                                                           | db.ts L407-415 实现              |
| 5   | Mem0 `add()` 返回 `{ results: [{ id, memory, event }] }`                                                             | Mem0 API 设计                    |
| 6   | `createRootInstructions`/`createChildInstructions` 的调用点已在 async 函数内                                         | L222 有 `await`，L542 有 `await` |
| 7   | 降级策略：无 OpenAI Key 时回退到正则/关键词                                                                          | 保证可用性                       |
| 8   | memories 表 schema 不变                                                                                              | 渐进式集成，不破坏现有数据       |
| 9   | Mem0 history 使用独立 db 文件                                                                                        | 避免 schema 冲突                 |
| 10  | `mem0ai@3.0.13` 的 peerDep `better-sqlite3@^12.6.2` 与项目 catalog `^12.11.1` 兼容                                   | npm registry 确认                |
| 11  | `mem0ai` 依赖 `openai@^4.93.0`（OpenAI 官方 SDK），与项目的 `@ai-sdk/openai`（Vercel AI SDK 适配器）是不同包，无冲突 | npm registry 确认                |

## 验证步骤

1. **类型检查**：`vp run typecheck`（原 `npm run typecheck`），确认 async 改造无类型断裂
2. **单元测试**：`vp test`（原 `npm test`），重点验证 `index.test.ts` 3 处 async 断言通过
3. **手动验证-降级**：不配置 OpenAI Key → 记忆功能回退到正则/关键词，无报错
4. **手动验证-语义**：配置 OpenAI Key → 进行多轮对话 → 验证：
   - 系统提示词包含语义相关记忆（非简单按 salience 排序）
   - `memory_search` 工具返回语义相关结果
   - 回复后 `agent-learning` 抽取的记忆质量优于正则
5. **重启持久化**：关闭应用再打开 → 验证重水合后语义搜索仍可检索到历史记忆
