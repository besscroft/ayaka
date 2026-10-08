# Ayaka

语言：中文 | [English](README.en.md)

Ayaka 是一个本地优先的 AI 桌面工作台，基于 Electron、React、AI SDK、Hono、SQLite、Drizzle 和 shadcn/base-ui 构建。它不仅提供聊天界面，也把智能体、工具调用、记忆、自动化和本地执行能力放在同一个工作区中。

## 核心能力

- **对话与模型**：支持多家模型服务商、模型参数配置、流式输出、媒体生成和实时语音会话。
- **智能体运行时**：提供 Agent、Agent Loop、子智能体、运行记录、输入队列、预算控制、取消和恢复等能力。
- **本地执行**：支持执行本地命令、读取和写入文件、精确编辑文本以及应用多文件补丁；高风险操作会进入权限审批流程。
- **Skills 与 MCP**：支持可配置的 Skills、MCP 服务、工具选择和生命周期管理。
- **记忆与自动化**：支持记忆、定时任务、会话工作区以及运行结果持久化。
- **沙箱与预览**：支持沙箱工件、HTML/SVG/静态应用预览和隔离的本地预览进程。
- **生成式 UI**：基于 json-render 在聊天消息中流式生成受控的交互式组件，并保存交互状态。
- **本地优先存储**：运行记录、会话和配置保存在本地 SQLite 数据库中；桌面端负责文件系统、密钥和其他特权操作。

完整的产品和运行时设计见[架构说明](docs/architecture.md)。

## 项目结构

| 路径              | 说明                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `apps/desktop`    | Electron 桌面端，包含主进程、预加载层、React 渲染器、数据库和运行时。 |
| `apps/core`       | 与宿主无关的核心后端包，提供 HTTP API、请求校验和运行时契约。         |
| `apps/docs`       | 基于 React Router 和 Cloudflare Workers 的文档站。                    |
| `packages/assets` | 桌面端和文档站共用的资源。                                            |
| `docs`            | 架构说明、组件说明和设计文档。                                        |
| `tests/desktop`   | 桌面端主进程和 Electron 后端测试。                                    |
| `tests/vite-plus` | Vite+ 工具链测试。                                                    |

## 开始开发

### 环境要求

- Node.js `>=22.12.0`
- pnpm `11.6.0`
- 已安装并可用的 Vite+ CLI：`vp`

### 安装依赖

在仓库根目录执行：

```bash
vp install
```

### 启动桌面端

```bash
vp run dev:desktop
```

### 启动文档站

```bash
vp run docs#dev
```

## 检查与测试

```bash
# 格式、Lint 和类型相关检查
vp check

# 根目录测试
vp test

# 桌面端后端测试
vp run ayaka-desktop#test
```

桌面端也可以分别运行主进程测试和 Electron 测试：

```bash
vp run ayaka-desktop#test:main
vp run ayaka-desktop#test:electron
```

## 构建桌面端

```bash
# 未打包构建
vp run build:desktop

# 平台安装包
vp run build:desktop:win
vp run build:desktop:mac
vp run build:desktop:linux
```

## 相关文档

- [架构说明](docs/architecture.md)
- [更新日志](CHANGELOG.md)
- [核心后端说明](apps/core/README.md)
- [文档站说明](apps/docs/README.md)
- [英文版 README](README.en.md)

## 许可证

[MIT License](LICENSE)
