# @ayaka/core

宿主无关的 Ayaka HTTP Core。它提供 Hono API、请求校验、稳定错误协议和运行时能力合同；Electron、Node 服务或其他 Web host 通过 `CoreRuntime` 注入模型、Agent、媒体、存储和鉴权能力。

## Electron

桌面端在 `apps/desktop/src/main/server/index.ts` 创建 `DesktopRuntimeAdapter`，继续使用本地 provider、SQLite、Agent runtime、MCP 和媒体资产实现。renderer 的 URL、请求头和 IPC 不需要改变。

## 服务器或 Docker

服务器宿主可以创建自己的 `CoreRuntime`，然后复用同一个 `createCoreApp`：

```ts
import { createCoreApp, startCoreServer } from "@ayaka/core";

const app = createCoreApp({ runtime: serverRuntime });
await startCoreServer(app, { hostname: "0.0.0.0", port: 8787 });
```

服务器适配层需要自行决定身份认证、租户隔离、数据库、对象存储、限流、SSRF 防护和长任务生命周期；这些能力不会从桌面端默认实现中隐式继承。

## 开发命令

```bash
vp run "@ayaka/core#typecheck"
vp run "@ayaka/core#build"
```
