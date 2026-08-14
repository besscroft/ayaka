# Mem0 记忆层集成 - 续作计划

## 摘要

本计划承接上一会话的工作，完成 Mem0 集成的剩余步骤。原计划（`plan-integrate-mem0-memory-layer.md`）已批准并执行到步骤 5，本续作聚焦于步骤 6（测试适配）、步骤 7（chat-tools.ts 语义化）和验证。

## 当前状态分析

### 已完成（步骤 1-5）

| 步骤 | 文件                                                                       | 状态                                                                                            |
| ---- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | `pnpm-workspace.yaml` + `apps/desktop/package.json`                        | ✅ mem0ai@3.0.13 已安装                                                                         |
| 2    | `apps/desktop/src/main/lib/mem0-service.ts`                                | ✅ 完整实现（getMemory/searchMemoriesSemantic/addMemoriesFromConversation/rehydrateFromSQLite） |
| 3    | `apps/desktop/src/main/lib/agent-learning.ts`                              | ✅ runLearning 调用 addMemoriesFromConversation + 正则降级                                      |
| 4    | `apps/desktop/src/main/lib/db.ts` L1627-1678                               | ✅ buildAgentSystemPrompt 已 async + 调用 searchMemoriesSemantic                                |
| 5    | `apps/desktop/src/main/lib/agent-runtime.ts` L76/L92/L1079/L1119/L233/L536 | ✅ 类型签名与 createRootInstructions/createChildInstructions 已 async                           |

### 待完成（本计划范围）

| 步骤 | 文件                                                         | 待办                                                                       |
| ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 6a   | `apps/desktop/src/main/server/index.ts` L41                  | `CreateAppOptions.buildAgentSystemPrompt` 类型签名需改为 `Promise<string>` |
| 6b   | `apps/desktop/src/main/server/index.test.ts`                 | 4 处 mock 改 async + 3 处断言加 await                                      |
| 7a   | `apps/desktop/src/main/lib/chat-tools.ts` L865-895           | `searchMemories` 改 async + 调用 searchMemoriesSemantic                    |
| 7b   | `apps/desktop/src/main/lib/chat-tools.ts` L965-996           | `saveChatMemory` 改 async + Mem0 双写                                      |
| 7c   | `apps/desktop/src/main/lib/chat-tools.ts` L593-599           | `memory_search` 工具 execute 传入 agentId/conversationId + await           |
| 7d   | `apps/desktop/src/main/lib/chat-tools.ts` L469-474, L500-501 | `executeChatHostTool` dispatcher 适配 async                                |
| 验证 | -                                                            | `vp run typecheck` + `vp test`                                             |

## 提议的改动

### 步骤 6a：server/index.ts 类型签名

**文件**：`apps/desktop/src/main/server/index.ts` (L41)

```typescript
// 改造前
buildAgentSystemPrompt?: (agentId?: string | null, conversationId?: string) => string;

// 改造后
buildAgentSystemPrompt?: (agentId?: string | null, conversationId?: string) => Promise<string>;
```

**原因**：`CreateAppOptions` 的类型签名需与 `db.ts` 的 async 实现保持一致，否则 mock 函数传入时类型不匹配。

### 步骤 6b：server/index.test.ts mock + 断言

**文件**：`apps/desktop/src/main/server/index.test.ts`

需改动 7 处（4 处 mock + 3 处断言）：

| 行号 | 当前                                                                | 改为                                                                      |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| L122 | `buildAgentSystemPrompt: () => "You are a test assistant."`         | `buildAgentSystemPrompt: async () => "You are a test assistant."`         |
| L152 | `captured.value?.buildAgentSystemPrompt("agent-ayaka", "c-stream")` | `await captured.value?.buildAgentSystemPrompt("agent-ayaka", "c-stream")` |
| L183 | `buildAgentSystemPrompt: () => "Ayaka root prompt"`                 | `buildAgentSystemPrompt: async () => "Ayaka root prompt"`                 |
| L193 | `options.buildAgentSystemPrompt("agent-ayaka", "c-neutral")`        | `await options.buildAgentSystemPrompt("agent-ayaka", "c-neutral")`        |
| L240 | `buildAgentSystemPrompt: () => "Base instructions."`                | `buildAgentSystemPrompt: async () => "Base instructions."`                |
| L243 | `options.buildAgentSystemPrompt("agent-ayaka", undefined)`          | `await options.buildAgentSystemPrompt("agent-ayaka", undefined)`          |
| L284 | `buildAgentSystemPrompt: () => "You are a test assistant."`         | `buildAgentSystemPrompt: async () => "You are a test assistant."`         |

**注意**：L152 和 L193 处的 `buildAgentSystemPrompt` 调用本身已在 async 函数体内（`async (options) => {...}` 和外层 `async () => {...}`），可直接加 `await`。

### 步骤 7a：searchMemories 改 async + 语义搜索

**文件**：`apps/desktop/src/main/lib/chat-tools.ts` (L865-895)

```typescript
// 改造前
function searchMemories(
  query: string,
  limit: number,
): Array<{ id: string; scope: MemoryScope; ... }> {
  const terms = splitTerms(query);
  return listMemories()
    .map((memory) => ({ memory, score: scoreText(...) }))
    .filter((item) => item.score > 0)
    .sort(...)
    .slice(0, limit)
    .map(({ memory }) => ({ ... }));
}

// 改造后
async function searchMemories(
  query: string,
  limit: number,
  agentId?: string | null,
  conversationId?: string,
): Promise<Array<{ id: string; scope: MemoryScope; ... }>> {
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

**说明**：

- 新增 `agentId` 和 `conversationId` 参数，用于 Mem0 过滤
- 保留 `truncate` 截断逻辑（600 字符上限）
- 不再需要 `splitTerms` 和 `scoreText`（Mem0 内部用向量相似度排序）
- 降级逻辑由 `searchMemoriesSemantic` 内部处理（无 API Key 时回退到全量过滤）

### 步骤 7b：saveChatMemory 改 async + Mem0 双写

**文件**：`apps/desktop/src/main/lib/chat-tools.ts` (L965-996)

```typescript
// 改造前
function saveChatMemory(
  input: MemorySaveInput,
  conversationId: string | undefined,
  agentId: string | null | undefined,
): unknown {
  // ... 构造 memory + saveMemory(memory) ...
  return { id: memory.id, scope: memory.scope, ... };
}

// 改造后
async function saveChatMemory(
  input: MemorySaveInput,
  conversationId: string | undefined,
  agentId: string | null | undefined,
): Promise<unknown> {
  // ... 构造 memory + saveMemory(memory)（现有逻辑保持不变）...

  // 双写 Mem0（fire-and-forget，不阻塞返回）
  const { addMemoriesFromConversation } = await import("./mem0-service");
  addMemoriesFromConversation(
    [{ role: "user", content: `${input.title}: ${input.content}` }],
    agentId,
    conversationId,
  ).catch((error) => {
    console.warn("[chat-tools] saveChatMemory mem0 dual-write failed:", error);
  });

  return { id: memory.id, scope: memory.scope, ... };
}
```

**说明**：

- 现有 SQLite 写入逻辑完全保留
- Mem0 双写采用 fire-and-forget（`.catch()` 不阻塞返回）
- 用 `input.title: input.content` 作为消息内容，让 Mem0 LLM 决定是否抽取
- 降级：Mem0 不可用时 `addMemoriesFromConversation` 返回 0，不影响 SQLite 已写入的数据

### 步骤 7c：memory_search 工具 execute 适配

**文件**：`apps/desktop/src/main/lib/chat-tools.ts` (L593-599)

```typescript
// 改造前
execute: (input) =>
  executeWithAudit("memory_search", "Memory search", model, conversationId, async () => {
    const query = normalizeQuery(input.query);
    const limit = normalizeLimit(input.limit, 6, 12);
    const results = searchMemories(query, limit);
    return { query, count: results.length, results };
  }),

// 改造后
execute: (input) =>
  executeWithAudit("memory_search", "Memory search", model, conversationId, async () => {
    const query = normalizeQuery(input.query);
    const limit = normalizeLimit(input.limit, 6, 12);
    const results = await searchMemories(query, limit, agentId, conversationId);
    return { query, count: results.length, results };
  }),
```

**说明**：内层 `async () =>` 已存在，只需加 `await` 和传参。`agentId`/`conversationId` 在 `createHostTools` 闭包中已可用。

### 步骤 7d：executeChatHostTool dispatcher 适配

**文件**：`apps/desktop/src/main/lib/chat-tools.ts` (L469-474, L500-501)

```typescript
// L469-474 改造前
case "memory_search": {
  const value = input as MemorySearchInput;
  const query = normalizeQuery(value.query);
  const limit = normalizeLimit(value.limit, 6, 12);
  const results = searchMemories(query, limit);
  return { query, count: results.length, results };
}

// L469-474 改造后
case "memory_search": {
  const value = input as MemorySearchInput;
  const query = normalizeQuery(value.query);
  const limit = normalizeLimit(value.limit, 6, 12);
  const results = await searchMemories(query, limit, agentId, conversationId);
  return { query, count: results.length, results };
}

// L500-501 改造前
case "memory_save":
  return saveChatMemory(input as MemorySaveInput, conversationId, agentId);

// L500-501 改造后
case "memory_save":
  return await saveChatMemory(input as MemorySaveInput, conversationId, agentId);
```

**说明**：`executeChatHostTool` 已是 `async` 函数（L442），内层 `async () => {}` 也是 async（L463），可直接 `await`。

### 步骤 7e：memory_save 工具 execute 适配

**文件**：`apps/desktop/src/main/lib/chat-tools.ts` (L685-688)

```typescript
// 改造前
execute: (input) =>
  executeWithAudit("memory_save", "Save memory", model, conversationId, async () =>
    saveChatMemory(input, conversationId, agentId),
  ),

// 改造后
execute: (input) =>
  executeWithAudit("memory_save", "Save memory", model, conversationId, async () =>
    await saveChatMemory(input, conversationId, agentId),
  ),
```

**说明**：`async () => saveChatMemory(...)` 当 saveChatMemory 返回 Promise 时，async 箭头函数会自动 unwrap，但显式加 `await` 更清晰。

## 假设与决策

| #   | 假设/决策                                                           | 依据                                                                 |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | `splitTerms` 和 `scoreText` 在 searchMemories 改造后不再被调用      | Grep 确认仅 searchMemories 使用                                      |
| 2   | Mem0 双写采用 fire-and-forget，不阻塞 saveChatMemory 返回           | 与 Vercel AI SDK Provider 设计一致（`.then()` 无 await）             |
| 3   | `executeWithAudit` 的回调支持 async 返回值                          | L442 `executeChatHostTool` 已是 `async`，L463 内层也是 `async () =>` |
| 4   | mock 函数用 `async () => "..."` 而非 `() => Promise.resolve("...")` | 更简洁，TypeScript 类型兼容                                          |
| 5   | 不删除 `splitTerms`/`scoreText` 函数定义                            | 保持最小变更，未来可能复用；若 typecheck 报 unused 再移除            |

## 验证步骤

1. **类型检查**：`vp run typecheck`
   - 确认 async 改造无类型断裂
   - 确认 mock 函数类型与 `CreateAppOptions` 兼容

2. **单元测试**：`vp test`
   - 重点验证 `index.test.ts` 3 处 async 断言通过
   - 确认现有测试无回归

3. **手动验证-降级**（可选，需运行时）：
   - 不配置 OpenAI Key → `memory_search` 工具返回全量过滤结果
   - `memory_save` 工具写入 SQLite 成功，Mem0 双写静默失败

4. **手动验证-语义**（可选，需运行时）：
   - 配置 OpenAI Key → `memory_search` 返回语义相关结果
   - `memory_save` 写入后 Mem0 向量索引同步更新
