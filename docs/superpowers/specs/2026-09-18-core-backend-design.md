# Ayaka Core 后端抽离设计

## 状态

已获得用户对总体方向的确认，等待实现前的文档审阅。

## 背景

当前桌面端的 Hono 后端位于 `apps/desktop/src/main/server/index.ts`。它同时承担 HTTP 路由、请求校验、AI SDK 调用编排和 Electron 主进程能力接入，因此只能在桌面进程中运行。未来需要支持服务器、Docker 和 Web 端，但服务器与桌面在数据库、文件系统、密钥、MCP、沙箱、模型凭证和进程生命周期上不可能完全相同。

本设计采用独立 Hono app、独立 Node 启动器、宿主框架只保留路由壳，以及把数据库、模型运行时、Agent runtime 等拆成可组合能力的组织方式；在此基础上增加一层宿主无关的 `apps/core`，让 Electron 和服务器都通过 adapter 提供运行时能力。

## 目标

1. 在 `apps/core` 建立可独立构建、测试和导入的 Core workspace project。
2. 将现有 `/api/*` Hono API 的协议和行为迁移到 Core，保持桌面端现有调用路径、请求头和错误代码兼容。
3. 让 Core 不导入 Electron、Node 文件系统、SQLite 客户端、桌面 provider 密钥或桌面专属模块。
4. 让桌面端通过一个明确的 `DesktopRuntimeAdapter` 复用现有实现，保持当前本地优先行为。
5. 为未来 `apps/server` 或 Docker 宿主提供稳定的 `ServerRuntimeAdapter` 接口和 Node HTTP 启动边界，但本次不虚构服务器数据库、鉴权和存储实现。
6. 保留 AI SDK 的统一模型调用能力，并让 Memory/Mem0 成为宿主可替换的可选能力。

## 非目标

- 本次不实现完整的多用户服务器数据库、账号体系、Redis、对象存储或 Docker 编排。
- 本次不把所有 `apps/desktop/src/main/lib` 一次性搬入 Core；只有真正跨宿主的协议、编排和纯逻辑进入 Core。
- 本次不改变 renderer 的 IPC API、聊天 URL、请求头或持久化数据结构。
- 本次不添加 desktop page/renderer 测试或浏览器自动化。

## 架构

```text
                 ┌──────────────────────────────┐
                 │           apps/core           │
                 │  Hono app + API contracts     │
                 │  validation + error protocol  │
                 │  AI orchestration             │
                 │  runtime capability contract  │
                 └──────────────┬───────────────┘
                                │ inject
             ┌──────────────────┴──────────────────┐
             │                                     │
┌────────────▼────────────┐        ┌──────────────▼─────────────┐
│ apps/desktop             │        │ future apps/server          │
│ DesktopRuntimeAdapter    │        │ ServerRuntimeAdapter        │
│ Electron/SQLite/MCP      │        │ env/auth/Postgres/storage   │
│ local provider/sandbox   │        │ server provider/memory     │
└────────────┬────────────┘        └──────────────┬─────────────┘
             │                                     │
      loopback Node server                 Node/Docker/Next host
```

### Core 层

`apps/core/src` 按职责拆分：

- `contracts/`：API 请求、响应、错误码、鉴权上下文、运行时能力类型和共享常量。
- `routes/`：`health`、`models`、`chat`、`media`、`title`、`followups`、`suggestions` 等 Hono 子路由。
- `app.ts`：组合 middleware 和子路由，导出 `createCoreApp(options)`；只接收 Web 标准 `Request`/`Response`。
- `runtime.ts`：定义 `CoreRuntime` 及按领域拆分的能力接口。
- `server.ts`：可选的 Node HTTP 启动适配器；它只负责监听、优雅关闭和把 Node 请求交给 `app.fetch`，不包含业务逻辑。
- `index.ts`：稳定的 workspace exports，供桌面宿主、未来服务器宿主和契约测试使用。

Core 的 Hono app 不保存跨请求的桌面状态，不自行读取环境变量中的桌面密钥，也不直接初始化数据库或 Electron。

### Runtime 能力接口

`CoreRuntime` 按能力分组，避免一个“大而全”的宿主接口：

- `models`：列出可用模型、解析 `provider/model`、返回能力（如 vision）和 AI SDK `LanguageModel`。
- `chat`：规范化媒体输入、构建 Agent system prompt、执行 Agent chat、处理 start/resume/recovery、返回流式响应和执行元数据。
- `media`：校验后执行图片、语音、转录等生成，并通过宿主提供的 asset writer 保存结果。
- `memory`：可选的 retrieve/store/search 能力；Core 只消费抽象结果，不认识 `mem0ai` 的密钥或桌面数据库。
- `storage`：对话媒体、生成资产、运行时事件和诊断记录等宿主持久化能力；Core 不假设 SQLite 或 PostgreSQL。
- `auth`：解析当前请求的身份/会话；桌面 adapter 使用现有 session token，服务器 adapter 可接 cookie、Bearer 或 Web session。
- `observability`：结构化日志、错误记录和请求诊断，默认实现可以是 no-op。

能力接口的返回值使用 Core contracts 或 Web 标准类型，不能暴露桌面 `db` row、Electron 对象、解密后的 provider key 或 Node 原生句柄。

### AI SDK 与 Mem0

Core 可以依赖当前 workspace 已安装的 `ai` 类型和通用调用 API，但模型实例、providerOptions、API key 和模型目录由 runtime 注入。这样 `/api/title`、`/api/followups`、`/api/suggestions` 可以共享 Core 的 prompt/解析逻辑，同时不把凭证解析带进 Core。

Memory 只作为可选 capability：桌面端可以把现有 `mem0-service` 或本地 memory orchestrator 包装成 adapter；服务器端可以使用 `@mem0/vercel-ai-provider`、Mem0 Platform SDK 或自有存储。Core 对 Mem0 只依赖“检索上下文 / 保存交互”的接口，不把某一种 Mem0 配置写死。

## API 与数据流

现有路径保持不变：

- `GET /api/health`
- `GET /api/models`
- `POST /api/chat`
- `POST /api/media/generate`
- `POST /api/title`
- `POST /api/followups`
- `POST /api/suggestions`

请求流程：

1. Host 创建 runtime adapter。
2. Host 调用 `createCoreApp({ runtime, auth, cors, serverInfo })`。
3. Core middleware 处理 CORS、请求身份和统一错误边界。
4. Route 做 JSON 解析、输入校验、稳定错误码映射和响应头设置。
5. Route 调用 runtime capability；流式聊天通过 `AbortSignal` 传递取消。
6. Host 负责监听、关闭、日志输出和宿主生命周期。

桌面端继续由 `apps/desktop/src/main/index.ts` 启动 loopback server，IPC 继续返回 `LocalServerInfo`。只有 `createApp` 的实现改为调用 Core，renderer 无需感知迁移。

未来服务器端可以复用同一个 `coreApp.fetch`：

- 独立 Node/Docker 进程使用 Core 的 Node adapter；
- Next.js、Bun 或其他 Hono-compatible host 直接挂载 `fetch`；
- 服务器鉴权、CORS、数据库和资产存储全部由 ServerRuntimeAdapter 提供。

## 兼容与安全边界

- 保留现有 `x-ayaka-session`、`x-ayaka-run-id` 以及 `/api/*` 路径，避免 renderer 和旧客户端同时升级。
- Core 负责输入验证、UUID/run mode 校验、模型缺失和稳定错误码；runtime 负责把平台错误映射为可诊断但不泄露密钥的错误。
- CORS origin、鉴权方式、监听 host/port 和是否允许匿名 health 检查由宿主配置，不在 Core 内硬编码 Electron 的 loopback 假设。
- Core 禁止导入 `electron`、`better-sqlite3`、`drizzle-orm/better-sqlite3`、桌面 `runtime-paths` 或任何 provider secret resolver。
- 服务器 adapter 必须显式处理 SSRF、租户隔离、请求限流、持久化并发和长任务生命周期；这些不应通过复用桌面默认值“顺便得到”。

## 测试策略

### Core 契约测试

将现有 `tests/desktop/main/server/index.test.ts` 的 HTTP 行为测试迁移到 Core 测试目录，使用 fake runtime 覆盖：

- 未授权、非法 JSON、非法 model/runId/mode/reasoning/permission 输入；
- chat start/resume/recovery 和 run id 响应头；
- media 校验、错误分类和 abort signal；
- title/followups/suggestions 的解析、清洗和空结果；
- CORS、health、models 响应协议。

这些测试不能 import Electron 或桌面数据库。

### Desktop adapter 测试

保留/新增 `tests/desktop/main` 下的 focused tests，验证：

- adapter 能正确接入现有 provider、agent runtime、media asset writer 和 DB system prompt；
- 桌面 server 启停、端口/令牌信息和诊断事件仍然正确；
- 桌面异常被转换成 Core 期望的错误协议。

不添加 renderer page tests 或浏览器自动化。

### 验证命令

按仓库要求依次运行最小相关测试、`vp check`、`vp test`、`vp run ayaka-desktop#test:main`，必要时运行 `vp run ayaka-desktop#test:electron`、`vp run ayaka-desktop#typecheck` 和 `vp run ayaka-desktop#build`。

## 实施阶段

1. **Core contract 与 workspace skeleton**：建立 `apps/core` 包、导出边界、TypeScript/Vite+ 配置和最小 fake-runtime app。
2. **迁移 HTTP 路由**：将当前 Hono 路由和纯校验/错误逻辑迁移到 Core，先让 Core 契约测试通过。
3. **桌面适配**：从 desktop server wrapper 创建 `DesktopRuntimeAdapter`，接通原有 provider、agent、media、DB 和诊断能力；桌面启动器只保留 loopback 生命周期。
4. **兼容与清理**：将 Core contracts 作为共享类型来源，desktop shared 层保留必要 re-export；移除 Core 对 desktop 路径的反向依赖。
5. **宿主扩展准备**：提供 Node server adapter 的接口/示例和部署说明，但不在本次伪造完整服务器业务实现。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `runAgentChat` 参数类型与桌面实现高度耦合 | 先定义 Core chat input/output contract，在 desktop adapter 内做一次类型转换 |
| shared types 与 Core 互相导入形成循环 | 迁移 server transport types 到 Core，desktop 只 re-export，不让 Core 导入 desktop |
| Core 误带入 Electron/SQLite 依赖 | 在 Core tsconfig、lint 和测试中加入禁止 import 检查 |
| 服务器能力被误认为已完成 | 明确本次只交付可注入的 Core 和桌面 adapter，ServerRuntimeAdapter 作为下一宿主实现 |
| 流式响应/取消语义变化 | 保留现有 Response/AbortSignal 约定，并用 Core 契约测试锁定行为 |

## 验收标准

- `apps/core` 可独立通过 typecheck/test/build。
- Desktop renderer 现有聊天、标题、追问、建议、媒体生成请求无需改 URL 或 header 即可工作。
- Core 源码没有 Electron、SQLite 客户端或 desktop main 路径导入。
- Core 契约测试覆盖现有 Hono server 测试中的协议行为。
- Desktop main tests 和仓库 `vp check` / `vp test` 通过。
- 文档明确如何为未来服务器实现新的 runtime adapter，而不要求修改 Core 路由。
