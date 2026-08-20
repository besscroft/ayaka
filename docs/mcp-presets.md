# MCP 预设维护

Ayaka 的 MCP 预设由客户端内置 JSON 配置维护，不再从线上 MCP 商店读取目录或安装配置。

## 添加预设

编辑 `apps/desktop/src/main/config/mcp-presets.json`，在顶层 JSON 数组中添加一个经过审核的预设对象。当前已内置 filesystem、Feishu、DingTalk、Vercel、Supabase、Sequential Thinking、Fetch、Time、Knowledge Graph Memory、SQLite、Playwright、Git、Cloudflare Workers、智谱搜索、Puppeteer、高德地图、天眼查、Slack、GitHub 和麦当劳预设；示例结构如下。JSON 不支持注释；字段名、字符串和数组元素都必须使用双引号。

```json
{
  "id": "my-server",
  "name": "My MCP Server",
  "description": "What this server provides.",
  "version": "1.0.0",
  "author": "Maintainer",
  "category": "tools",
  "tags": ["example"],
  "docsUrl": "https://example.com/docs",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@example/mcp-server"],
  "env": { "API_TOKEN": "$secret:API_TOKEN" },
  "secretKeys": ["API_TOKEN"],
  "warnings": ["Review the command and permissions before enabling."]
}
```

远程 MCP 使用 `transport: "http"` 或 `transport: "sse"` 和 HTTPS URL；仅允许 localhost、127.0.0.1 或 ::1 使用 HTTP。stdio 预设必须提供 command，远程预设不能提供 command。

旧配置中的 `streamable-http` 对应当前格式的 `transport: "http"`；搜索别名使用 `tags` 表达。预设不声明 `enabled`，安装始终先保持禁用，用户完成审查后才能启用。

HTTP 预设示例：

```json
{
  "id": "my-http-server",
  "name": "My HTTP Server",
  "description": "Remote MCP over Streamable HTTP.",
  "version": "1.0.0",
  "transport": "http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "$secret:API_TOKEN" },
  "secretKeys": ["API_TOKEN"]
}
```

SSE 预设示例：

```json
{
  "id": "my-sse-server",
  "name": "My SSE Server",
  "description": "Remote MCP over server-sent events.",
  "version": "1.0.0",
  "transport": "sse",
  "url": "https://example.com/sse"
}
```

`secretKeys` 只声明用户需要输入的名称。真实 secret 必须由用户在客户端审查窗口中输入，并通过加密 IPC 保存；不要把真实值写进源码、普通配置、日志或预设元数据。预设可以用 `$secret:NAME` 引用已声明的 secret。

## 配置与更新行为

安装会复制预设配置为独立的 MCP 实例，并保持禁用，直到用户完成审查。之后修改预设元数据不会覆盖用户已经安装的 command、参数、URL、密钥或启用状态。删除预设定义只会从客户端目录中移除它，不会删除已安装的 MCP。

卸载只删除 MCP 配置、运行注册和安装记录，不删除用户目录或外部包。客户端不负责安装 npm 包、二进制文件或其他外部依赖；这些依赖必须由用户环境提供。

## 删除与升级预设

- 删除：从 `apps/desktop/src/main/config/mcp-presets.json` 中移除对应对象并提交配置。下次客户端同步内置来源时会删除该预设的 Catalog 缓存；已经安装的 MCP 仍保留，用户可以继续管理或卸载它。
- 升级：保持 `id` 不变，只更新 `version` 和经过审核的元数据。相同 `id` 会映射到稳定的 Catalog 项；用户重新安装时会刷新安装记录元数据，但不会覆盖已有 MCP 的运行配置、secrets 或启用状态。
- 更换实现或传输配置：如果必须改变 command、参数、URL、headers、env 或 secret 声明，先评估对已有安装的影响，并通过新的 `id` 发布为独立预设，避免把新配置静默写入用户现有 MCP。

## 验证

从仓库根目录运行：

```powershell
vp run ayaka-desktop#typecheck:node
vp run ayaka-desktop#typecheck:web
vp run ayaka-desktop#test:main
vp run ayaka-desktop#test:renderer
```

添加预设后，至少确认 JSON 可解析、它能在 MCP 预设页显示、详情配置正确、安装后保持禁用，并在输入所需 secret 后成功审查和启用。stdio 预设还应确认 command、args 和外部依赖由用户环境提供。
