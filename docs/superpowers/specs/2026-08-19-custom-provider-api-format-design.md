# 自定义供应商 API Format 支持设计

## 状态

已获得用户确认，准备进入实现前审阅。

## 目标

让每个自定义供应商在设置中选择一种文本 API 格式，并让保存、模型同步、连接测试和实际对话请求使用同一协议：

- Chat Completions (`/chat/completions`)
- Responses (`/responses`)
- Anthropic Messages (`/v1/messages`)

旧的自定义供应商配置必须继续可用，且内置供应商的当前行为保持不变。

## 方案

在现有 `ModelProviderKind` 之外增加一个只服务于自定义供应商的协议字段。`kind` 继续表示现有的供应商运行时分类；`apiFormat` 只表示文本请求的线协议。这样不会因为用户切换协议而意外改变自定义供应商已有的工具策略、上下文处理或运行时诊断。

当前自定义供应商仍然使用 `kind: "openai-compatible"`，但它的 AI SDK 模型工厂由 `apiFormat` 决定：

| API Format           | AI SDK 工厂                                                    | 请求鉴权                                       | 模型列表解析         |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------- | -------------------- |
| `chat-completions`   | `createOpenAICompatible({ apiKey, baseURL, name })`            | `Authorization: Bearer <key>`                  | OpenAI model list    |
| `responses`          | `createOpenAI({ apiKey, baseURL, name }).responses(modelId)`   | `Authorization: Bearer <key>`                  | OpenAI model list    |
| `anthropic-messages` | `createAnthropic({ apiKey, baseURL, name }).messages(modelId)` | `x-api-key` 和 `anthropic-version: 2023-06-01` | Anthropic model list |

不做协议自动探测，也不增加自定义 Header 配置。用户选择的格式是明确的协议契约。

## 类型与持久化

在 `apps/desktop/src/shared/types.ts` 增加：

```ts
export type CustomProviderApiFormat = "chat-completions" | "responses" | "anthropic-messages";
```

字段变化：

- `CustomProviderInput.apiFormat`：可选输入字段；缺省时按 `chat-completions` 处理，方便兼容现有调用方。
- `ProviderInfo.apiFormat`：自定义供应商返回归一化后的必选协议字段；内置供应商可以不返回该字段，因为它们已有固定适配器。
- `ModelCatalogSettings.providers[].apiFormat`：可选持久化字段，以便读取没有该字段的旧 JSON。

`normalizeCatalog` 对自定义供应商只接受上述三个值；缺失或未知值回退到 `chat-completions`。`upsertCustomProvider` 保存归一化后的值。`listProviders` 将它透传给 renderer。现有 `ModelCatalog` 是设置 JSON，不需要 SQLite 表或迁移文件。

API Format 的显示文案由 i18n 提供，选项文案与截图一致：

- Chat Completions (`/chat/completions`)
- Responses (`/responses`)
- Anthropic Messages (`/v1/messages`)

## 设置界面

所有创建/编辑自定义供应商的现有入口都使用同一字段：

1. 旧模型管理入口的 `ModelEditorDialog`：新增自定义供应商时可选择，编辑自定义模型时显示并可修改已有供应商的格式。
2. 新的 `ProviderModelWorkbench`：`AddProviderDialog` 和供应商详情编辑区域都显示该下拉框。

行为约束：

- 新建自定义供应商默认 Chat Completions。
- 内置供应商不显示可编辑的 API Format 控件。
- 选择格式后需要点击现有保存按钮才生效；测试和同步仍读取已保存配置。
- 修改格式不删除模型、API key、能力、模型选项或模型启用状态。
- 供应商详情可用格式标签替代当前自定义供应商的通用 kind 展示，避免用户看不到实际选择。

所有新增 label、描述、选项和错误提示同时补齐中文与英文 i18n 条目，不在组件内硬编码用户可见文案。

## 运行时数据流

### 保存与读取

renderer 继续通过已有的 `api.providers.upsertCustomProvider` IPC 调用传递 `CustomProviderInput`，不新增 IPC 通道。preload、`index.d.ts` 和 renderer `lib/api.ts` 只需同步更新类型即可。

main process 在 provider 模块中完成字段校验和归一化：

1. 读取 `ModelCatalog`。
2. 根据 `apiFormat` 选择合法值，旧记录缺失时使用 Chat Completions。
3. 保持 `kind: "openai-compatible"`。
4. 写回 JSON 并返回不含密钥的 `ProviderInfo`。

### 文本模型创建

在 `createLanguageModel` 中先判断自定义供应商的 `apiFormat`，再选择 AI SDK provider。内置供应商继续走现有 `kind` 分支。

模型选项的命名空间按实际适配器处理：

- Chat Completions 保留现有 `normalizeOpenAICompatibleProviderOptions`，继续兼容历史 `openai` 命名空间。
- Responses 和 Anthropic Messages 原样透传模型 `providerOptions`，分别由 `openai` 与 `anthropic` 命名空间解释。

自定义供应商的 `providerKind` 保持 `openai-compatible`，以保留当前通用工具和上下文策略。自定义供应商不自动注册内置的 hosted/native tools；模型自身的普通工具调用仍由 AI SDK 处理。

### 媒体模型

API Format 的主目标是文本模型。为避免用户把 Anthropic Messages 模型错误地当作 OpenAI 媒体端点调用：

- 自定义 Chat Completions 继续沿用现有媒体适配行为。
- 自定义 Responses 使用 OpenAI provider 的媒体模型工厂，是否可用仍由模型能力与上游服务决定。
- 自定义 Anthropic Messages 明确拒绝当前构建不支持的媒体生成，并返回可读错误。

## 同步与连接测试

`fetchRemoteModels` 对自定义供应商使用已保存的 `baseUrl`，统一请求 `${baseUrl}/models`：

- Chat Completions / Responses 使用 Bearer 鉴权并调用 `parseOpenAIModelListResponse`。
- Anthropic Messages 使用 `x-api-key`、`anthropic-version` 并调用 `parseAnthropicModelListResponse`。

`testProvider` 和 `syncAvailableModels` 继续共享这条路径，因此不会出现“测试成功但真实请求使用另一种格式”的分叉。内置 Anthropic、Google 以及现有内置 OpenAI provider 的端点逻辑不变。

如果上游没有 `/models` 或返回非预期格式，保留现有失败语义，向 UI 返回截断后的 HTTP 状态/响应错误；不会静默回退到另一种协议。用户可以使用现有“手动添加模型”入口继续配置模型。

## 错误处理与安全

- 不把 API key 写入 `ProviderInfo`、`ModelCatalog`、日志或错误消息。
- API Format 非法值只在归一化层回退为 Chat Completions，不允许把未知字符串传入 provider factory。
- Anthropic 请求只在 main process 构造 `x-api-key`，renderer 只接收 `hasApiKey` 布尔状态。
- base URL 继续沿用现有 HTTP/HTTPS 校验与尾斜杠归一化。
- 协议切换失败时保留旧配置；请求失败不修改模型目录。

## 测试设计

### Main process

在 `tests/desktop/main/lib/providers.test.ts` 增加聚焦覆盖：

- 旧目录缺少 `apiFormat` 时归一化为 Chat Completions。
- 新建和编辑供应商可以保存三种格式，返回值和再次读取值一致。
- 三种格式同步都请求 `${baseUrl}/models`。
- Chat/Responses 使用 Bearer，Anthropic 使用 `x-api-key` 与版本头。
- Chat/Responses 使用 OpenAI model list 解析器，Anthropic 使用 Anthropic model list 解析器。
- 三种格式解析并创建文本模型时，mock fetch 能观察到对应的 `/chat/completions`、`/responses` 或 `/messages` 请求路径。
- 自定义 Anthropic 媒体模型返回明确的不支持错误。

### Renderer

在 `tests/desktop/renderer` 增加设置表单相关聚焦测试或纯 helper 测试，验证：

- API Format 选项完整包含三项，且保留协议路径文案。
- 新建表单默认 Chat Completions。
- 编辑表单从 `ProviderInfo.apiFormat` 恢复当前选项。
- 内置供应商不显示可编辑 API Format 控件。

不引入浏览器自动化依赖；纯状态和选项逻辑使用现有 renderer 测试运行方式覆盖。

## 实现范围

预计修改：

- `apps/desktop/src/shared/types.ts`
- `apps/desktop/src/main/lib/providers.ts`
- `apps/desktop/src/preload/index.d.ts`（如类型导出链需要）
- `apps/desktop/src/renderer/src/components/SettingsDialog.tsx`
- `apps/desktop/src/renderer/src/lib/i18n.messages.ts`
- `tests/desktop/main/lib/providers.test.ts`
- `tests/desktop/renderer` 下对应的设置/格式 helper 测试

不修改：

- 内置供应商的协议选择与端点行为
- 数据库 schema、Drizzle migration 和密钥存储格式
- IPC 通道名称
- 自定义 Header、协议自动探测和 `/models` 之外的同步回退

## 验证命令

实现完成后按仓库指南执行：

```text
vp run ayaka-desktop#test:main
vp run ayaka-desktop#test:renderer
vp check
vp test
vp run ayaka-desktop#typecheck
vp run ayaka-desktop#build
```

聚焦失败与已有仓库基线失败分开记录，不使用全仓库自动修复掩盖无关 diff。
