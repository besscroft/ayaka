# Runtime 一致性、热快照与 IPC 契约设计

## 目标

本轮把五项问题收敛到同一个边界：持久化写入必须有明确不变量，热路径只能读取它实际需要的数据，主进程/ preload/ renderer 的 IPC 参数必须来自同一份契约，数据库聚合代码和项目文档要反映实际职责。

## 1. 消息批量写入

`saveMessagesBatch` 是单会话写入 API。空数组直接返回；非空数组先检查每一行的 id、conversation_id、role、content/content_json 和 created_at，并确认所有行的 conversation_id 相同。事务开始前读取目标 conversation；不存在立即失败。通过全部校验后，在一个事务中执行 upsert，并将该会话 `message_revision` 增加一次。这样一次 batch 要么完全提交，要么不产生任何消息或 revision 变化。跨会话输入通过稳定的 validation error 拒绝，调用方如需多会话写入必须拆成多个 batch。

数据库实现移到 `message-store.ts`，`db.ts` 只处理 writer worker 路由和公开兼容导出。IPC 入口先用 shared schema 解析，避免非法数据进入数据库层。

## 2. Runtime 热/冷快照

保留现有全量 `runtimeSnapshot` 作为显式诊断接口。新增 `getConversationRuntimeStatus`/`agents:runtimeStatus`：输入是 conversationId，可选 runId 和每类记录上限；返回当前会话最近 runs、对应 run 的 inputs/steps/instances/events 和 conversation state。所有数据库查询按 conversation 或 run 过滤，默认上限远小于全量列表；不读取全局 agent runtime state、memories、collaboration、sandbox snapshots 等冷集合。显式 run 必须属于请求的 conversation，即使它不在最近 run 限制内也会被单独带回。

ChatView 的首次恢复、250ms/1200ms polling、入队/消费/停止后的刷新改为 `runtimeStatus`。AgentsPanel 继续在打开/动作后读取全量 snapshot，以保证诊断视图兼容。`RuntimeStatusSnapshot` 由 shared types 定义，作为 AgentStatusWidget/WorkspaceSidePanel 的共同输入类型。

聚合构建逻辑移到 `runtime-snapshot.ts`。该模块只负责把 reader 结果组合成 full snapshot 或 conversation status；数据库表查询仍由 `db.ts` 暴露的窄 reader 函数提供，避免模块相互访问内部 DB 状态。

## 3. 统一 IPC schema

`shared/ipc-schema.ts` 提供 channel 到 Zod schema 的 registry、`IpcInput` 推导类型和 `parseIpcInput`。主进程是最终信任边界；解析失败抛出带 channel/code 的稳定错误。首批迁移：消息 list/save/saveBatch/applyPatch、runtime status、runtime enqueue/discard/cancel。preload 方法接收已推导的结构，renderer `api.ts` 只暴露领域方法，不重复定义任意对象结构。

旧通道名称和返回形状保留；schema 迁移是兼容增强。其余通道按领域逐步纳入 registry，不在本轮机械重写全部 handler。

## 4. 文件边界和文档

本轮抽取消息存储和 runtime snapshot 聚合这两个直接相关边界，不重写 SettingsDialog、agent-runtime 或 chat-tools 的全部结构。`AGENTS.md` 改成实际的 React Router/Cloudflare docs、`apps/core` 和 `packages/assets` 描述；`docs/architecture.md` 补充消息 revision、热/冷 runtime 读取和 IPC 三段式契约。

## 错误与测试

- 跨会话 batch、空 batch、不存在会话、非法消息字段均有主进程回归覆盖；失败后验证消息数量和 revision 未变化。
- runtime status 测试验证 conversation/run 过滤、上限和全量 snapshot 兼容。
- schema 测试验证合法输入通过、未知/缺失/超限字段拒绝；主进程 handler 使用同一 parser。
- 运行生产 Node/Web typecheck、Electron backend tests、root `vp test`；不新增 renderer/page 测试。全仓格式基线或 native ABI/Windows 权限限制单独记录。
