# 会话与设置本地加载性能优化设计

## 背景

用户反馈点击历史会话时会长时间显示“正在加载历史”，并且部分设置的读取和更新也有明显等待。应用虽然运行在本地，但当前调用路径经过 renderer、preload、Electron IPC、主进程数据库封装和 SQLite writer worker；本地 SQLite 查询本身不是唯一的延迟来源。

当前已确认的主要问题：

1. `ChatView` 对持久化会话先读取会话详情，详情返回后才读取消息历史；workspace 又是额外的 IPC。
2. `ChatSessionRegistry` 已缓存会话对象和消息，但切回缓存会话时 `ChatView` 仍进入 loading，并再次等待数据库 hydration。
3. `AppShell` 挂载时读取一次会话列表，active conversation 变化时再次读取；点击会话会触发整个列表刷新。
4. `settings:getAll` 在一次 IPC 中循环执行单 key SQL；SettingsProvider 更新多个字段时又拆成多个 settings IPC，写入在 SQLite worker 中逐个排队。

## 目标

- 冷启动和切换持久化会话时，尽快完成聊天首屏展示。
- 切换到已在 renderer 内缓存的会话时，直接使用缓存内容展示，不被重复数据库读取阻塞。
- 在不改变现有数据模型和特权边界的前提下，减少会话 hydration 和设置读写的 IPC/SQL/worker 往返。
- 保证后台校准不会以旧数据覆盖用户刚产生的新消息。
- 保留设置更新的错误传播和原有业务副作用。

## 非目标

- 不引入新的全局数据库缓存层或跨窗口同步协议。
- 不修改消息 JSON 格式、会话 revision 语义或 SQLite schema；现有会话主键、消息会话索引和设置主键已覆盖目标查询。
- 不改变 renderer 的 Electron/Node 隔离边界。
- 不添加 desktop page/renderer 测试或浏览器自动化。
- 不把 workspace 目录扫描、artifact 读取等非 hydration 必需的文件 IO 加入首屏关键路径。

## 方案概览

采用四项相互配合的改动：

1. 新增会话 hydration 聚合读取接口，在一次 IPC 中返回会话、消息快照和 workspace 信息。
2. 对已 hydration 的 `ChatSessionRegistry` 会话先渲染内存快照，再后台重新读取并有条件地应用数据库结果。
3. 让 `AppShell` 的会话列表只在真正影响列表的事件中刷新，不因 active conversation 改变而全量查询。
4. 将 settings 批量读取改成一次 SQL，将 SettingsProvider 的多字段写入改成一次 IPC、一次 writer 命令和一个 SQLite 事务。

## 详细设计

### 1. 会话 hydration 聚合读取

新增共享类型 `ConversationHydration`：

```ts
interface ConversationHydration {
  conversation: Conversation;
  messages: MessageSnapshot;
  workspace: WorkspaceInfo | null;
}
```

新增 `conversations.hydrate(id)` API，并同步更新：

- `apps/desktop/src/shared/types.ts`
- `apps/desktop/src/main/lib/db.ts` 或其 owning main-process module
- `apps/desktop/src/main/ipc/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`
- `apps/desktop/src/renderer/src/lib/api.ts`

主进程接口先读取会话。会话不存在时返回 `null`，不继续读取消息和 workspace；会话存在时读取消息 revision、消息行和 workspace 行，并映射为已有 UI 类型。所有读取仍使用 renderer 不可访问的主进程数据库连接。

聚合接口的价值是消除 renderer 与主进程之间的串行等待。它不把 workspace 文件系统操作加入数据库查询，也不改变现有 `messages.list` 等 API，以免影响其它调用方。

`ChatView` 的冷启动 hydration 改为等待一次 `api.conversations.hydrate(conversationId)`。收到结果后一次性设置 conversation 是否持久化、workspace、消息、revision 和 hydration 状态。请求失败时继续使用现有错误 UI 和重试流程。

### 2. 缓存会话的即时展示与后台校准

当 `session.hydrated` 为 true 时：

1. 使用 `session.chat.messages` 初始化当前 ChatView 的 refs/state。
2. 立即将 hydration 状态设置为 `ready`，不再显示“正在加载历史”。
3. 后台发起一次 hydration 聚合读取，主要用于校准会话元数据、workspace、消息和 revision。
4. 后台结果返回前若组件已卸载、会话已切换或本地已发生消息写入，则丢弃不再适用的结果。
5. 应用后台消息结果前检查当前会话仍然是同一 hydration 请求，且没有未完成的本地持久化冲突；发生冲突时保留内存中的较新状态，由现有 persistence/reconciliation 机制继续处理。

这使缓存切换的感知延迟接近 React state 切换和已有 Chat 实例渲染时间，同时保留外部运行或其它窗口写入后的最终校准能力。冷启动仍以数据库快照为权威，避免空会话或首次加载时使用不完整缓存。

### 3. 会话列表刷新策略

`AppShell` 保留初始会话列表读取，但移除对 `activeConversationId` 的 effect 依赖。切换会话只更新 active id，不重新查询整个列表。

列表刷新来源调整为：

- 会话创建：刷新或增量加入新会话。
- 会话删除/恢复：刷新或增量更新列表。
- 重命名：优先使用事件 payload 更新本地项目，保留无 payload 时的全量刷新降级。
- 会话 touch/排序变化：消息持久化或标题更新完成后，由调用方派发 renderer 内部的 `ayaka:conversation-touched` 事件，携带 id、title（如有）和 updatedAt；`AppShell` 增量更新对应列表项并按 updatedAt 排序，不得通过 active id 变化间接触发列表查询。

创建、删除、恢复继续使用现有事件/回调；重命名继续使用现有 `ayaka:conversation-renamed` 事件；新增的 `ayaka:conversation-touched` 只传递 id、title 和 updatedAt 等非敏感元数据，不返回数据库或密钥内容。列表刷新函数应保持可重复调用且不产生并发请求风暴；必要时用一个 pending refresh promise 合并同一时段的刷新。

### 4. 设置批量读取

保留 `settings.getAll(keys)` 的公开契约，但主进程实现改为一次查询：

```ts
select key, value from settings where key in (...keys)
```

结果先构造 key → value 的 map，再按调用方传入的 key 补齐缺失项为 `null`。空 key 数组直接返回空对象，不执行 SQL。由于 settings.key 是主键，不需要新增索引或迁移。

### 5. 设置批量写入

新增 `settings.setAll(entries)`，entries 为受 preload 类型约束的 `{ key: string; value: string }[]`。主进程 DB domain 新增 `setSettings(entries)`：

- 空数组直接成功返回。
- 在一个 SQLite transaction 内执行所有 upsert。
- 通过现有 SQLite writer 动态命令分发，因此 renderer 只发生一次 IPC，主进程到 writer 只发生一次命令往返。
- 任何一项失败都回滚整个 patch，向 renderer 传播错误。

`SettingsProvider.persist` 将当前 patch 序列化为 entries 后调用一次 `api.settings.setAll`。`update` 仍先乐观更新 React state，批量写入失败时保留现有行为（错误由调用方处理/传播；不额外引入未经请求的回滚策略）。单字段调用点继续使用 `settings.set`，避免无意义地扩大修改范围。

IPC handler 对批量 entries 做基本输入校验：key/value 必须是字符串，过滤重复 key 时以后出现的 entry 覆盖以前的 entry，避免一次请求产生不确定的重复 upsert。涉及 selected model 或 memory model 的设置变更只触发一次 `notifyMemoryConfigurationChanged()`。

### 6. 类型和安全边界

所有新 API 必须同时存在于 preload 实现、`index.d.ts` 声明和 renderer `lib/api.ts` wrapper。renderer 不导入 Electron、better-sqlite3、Drizzle 或 Node 内置模块。设置值仍以字符串形式保存，不通过 IPC 暴露 API key 明文。

## 数据流

### 冷启动

```text
点击/恢复 active id
  -> ChatView
  -> conversations.hydrate IPC
  -> main: conversation + messages + workspace queries
  -> one response
  -> ChatView sets refs/state -> ready
```

### 缓存切换

```text
点击会话
  -> AppRoot 切换 active id
  -> ChatView 读取 ChatSessionRegistry 内存快照 -> 立即 ready
  -> 后台 conversations.hydrate
  -> request/cancel/conflict check
  -> 仅应用仍然有效的校准结果
```

### 设置 patch

```text
SettingsProvider.update(patch)
  -> one settings.setAll IPC
  -> main setSettings(entries)
  -> one SQLite writer command
  -> one SQLite transaction
```

## 错误处理与一致性

- 聚合 hydration 失败继续显示现有“历史加载失败”和重试按钮；后台校准失败不能清空已展示的缓存，会记录现有 chat error logging 路径或 console warning。
- 所有异步 hydration 结果必须检查取消标志/请求 token，禁止旧会话结果更新当前会话。
- 本地消息持久化 dirty 或 revision 冲突时，后台数据库结果不得覆盖内存中的新消息；已有 `applyMessagesPatch` revision 校验继续作为最终一致性保护。
- 批量设置写入使用事务保证全成全败；memory 配置通知只在事务成功后触发。
- 既有单 key settings API 保持兼容，未参与 SettingsProvider patch 的调用方不需要迁移。

## 测试策略

新增或更新 backend tests，覆盖：

1. `settings:getAll` 对多 key、缺失 key、重复 key 和空数组的返回值。
2. `setSettings` 批量 upsert 会写入所有值；事务中途失败时不会留下部分写入。
3. `conversations.hydrate` 返回会话、消息 revision、消息行和 workspace；不存在会话返回 `null`。
4. 现有消息 revision、workspace 查询及设置单 key API 不回归。

按仓库约束执行：

- `vp run ayaka-desktop#test:main`
- `vp run ayaka-desktop#test:electron`（如果新增 IPC registration 需要 Electron-backed coverage）
- `vp run ayaka-desktop#test`
- `vp check`
- `vp test`
- 必要时执行 `vp run ayaka-desktop#typecheck` 或 desktop build-sensitive typecheck。

不添加 `tests/desktop/renderer/**`、renderer page tests 或 browser automation。

## 验收标准

- 点击已缓存会话不再显示“正在加载历史”作为切换阻塞状态。
- 冷启动会话历史不再被 `conversations.get` 完成时间串行阻塞；renderer 只需等待一次 hydration IPC。
- 点击会话不再额外触发整个 conversation list 查询。
- 设置页一次多字段更新最多发起一次批量设置 IPC，并以一个事务落盘。
- 所有既有会话、消息、workspace、设置和 memory 配置通知测试通过。
- 不新增数据库 migration，不改变 preload 安全边界。
