# Changelog

## [0.1.32]

### 中文

#### 新增

- 新增基于独立 JSON 配置的内置 MCP 预设目录，提供 20 个经过审核的本地与远程 MCP 预设，并支持搜索、分类与安装管理。
- 新增 MCP 服务能力加载状态与 stderr 诊断，提供本地化且可操作的连接错误提示。

#### 变更

- 移除 mcp.so 商店目录，改用本地内置 MCP 预设系统；预设安装后默认保持禁用，更新预设元数据时保留用户配置、密钥与启用状态。
- 优化 MCP 工作区布局、环境变量配置及服务切换状态处理，提升服务列表与详情面板的可用性。

#### 修复

- 修复 Windows 中文环境下 stdio MCP 服务 stderr 解码异常及缺少命令时错误信息不清晰的问题。
- 修复绝区零主题模型与推理选择器无法正常纵向滚动的问题。

### English

#### Added

- Added a standalone JSON-backed built-in MCP preset catalog with 20 reviewed local and remote presets, plus search, categorization, and installation management.
- Added MCP capability-loading states and stderr diagnostics with localized, actionable connection errors.

#### Changed

- Replaced the mcp.so marketplace catalog with a local built-in MCP preset system; newly installed presets remain disabled until reviewed, and metadata updates preserve user configuration, secrets, and enabled state.
- Improved MCP workspace layout, environment-variable configuration, and server-switch state handling for clearer server lists and detail panels.

#### Fixed

- Fixed unclear stdio MCP errors caused by stderr decoding in Chinese Windows environments and missing commands.
- Fixed ZZZ skin model and reasoning selectors not scrolling vertically as expected.

## [0.1.31]

### 中文

#### 新增

- 新增自定义服务商 API 协议格式选择，支持 Chat Completions、Responses 和 Anthropic Messages，并完善类型校验、本地化文案与请求路由。

#### 变更

- 优化对话工作区处理，切换会话时仅在聊天头部显示当前会话的工作区信息。
- 重构聊天页面布局，将智能体状态面板整合到聊天头部，支持更自然的折叠、展开动画与布局适配。
- 优化虚拟消息列表渲染，提取可复用的渲染逻辑，减少切换会话时的渲染异常。
- 移除自定义服务商的帮助链接配置与相关界面，保留内置服务商的帮助链接。
- 优化绝区零主题窗口控件的尺寸及交互样式。

#### 修复

- 修复生产环境 CSS 压缩导致绝区零主题开关位置偏移的问题。

### English

#### Added

- Added custom-provider API format selection for Chat Completions, Responses, and Anthropic Messages, with matching type validation, localized copy, and request routing.

#### Changed

- Improved conversation workspace handling so the chat header only shows the workspace for the current conversation.
- Restructured the chat layout by integrating the agent-status panel into the chat header with smoother collapse, expansion, and responsive layout behavior.
- Improved virtualized message-list rendering with reusable render-item logic to reduce rendering issues when switching conversations.
- Removed custom-provider help-link configuration and related UI while preserving help links for built-in providers.
- Improved ZZZ skin window-control sizing and interaction styles.

#### Fixed

- Fixed ZZZ skin switch positioning being offset after production CSS minification.

## [0.1.30]

### 中文

#### 新增

#### 变更

- 移除 yaka 和明日方舟主题皮肤及相关样式、注册信息与本地化文案。
- 修复绝区零主题样式覆盖原生 Toast 通知的问题，保留原生通知的默认布局与展示效果。
- 优化绝区零主题管理页面的文字可读性，并移除管理弹窗中不必要的背景色。

### English

#### Added

#### Changed

- Removed the yaka and Arknights skins with their related styles, registry entries, and localized copy.
- Fixed the ZZZ skin overriding native toast notifications by keeping the original notification layout and presentation.
- Improved management-page text readability under the ZZZ skin and removed unnecessary backgrounds from management dialogs.

## [0.1.29]

### 中文

#### 新增

- 新增消息列表虚拟化渲染，按需渲染可见消息，提升长对话的渲染性能。
- 新增聊天会话注册表与增量 Token 缓存，支持跨会话保留 AI Chat 实例并降低 Token 估算开销。

#### 变更

- 优化聊天消息协调与持久化，仅更新发生变化的消息并复用稳定的消息引用，减少不必要的重渲染和写入。
- 完善消息及推理内容的流式状态处理，改善流式响应期间的展示。
- 移除半透明侧边栏功能及相关设置、样式、主题应用逻辑和国际化文案。

### English

#### Added

- Added virtualized message-list rendering that only mounts visible messages for better long-conversation performance.
- Added a chat-session registry and incremental token cache to preserve AI chat instances across conversations and reduce token-estimation work.

#### Changed

- Optimized chat reconciliation and persistence by reusing stable message references and writing only changed messages, reducing unnecessary rerenders and writes.
- Improved streaming-state handling for message and reasoning content during streamed responses.
- Removed the translucent-sidebar feature and its related setting, styles, theme application logic, and localized copy.

## [0.1.28]

### 中文

#### 新增

- 新增“绝区零”主题皮肤，提供完整的颜色令牌、组件样式、交互状态和界面装饰。
- 新增绝区零主题的 Toast 通知样式，支持与主题配套的提示卡片、状态色和动效。

#### 变更

- 完善绝区零主题的按钮、图标按钮、窗口控件及基础 UI 组件样式，提升主题覆盖的一致性。
- 统一图标按钮及相关交互元素的 `data-*` 属性标记，便于主题样式按语义进行定制。
- 根据当前皮肤动态调整 Toast 通知的位置、显示数量和持续时间。

### English

#### Added

- Added a Zenless Zone Zero skin with complete color tokens, component styles, interaction states, and UI decoration.
- Added ZZZ-specific toast notification styles with themed status cards, colors, and motion.

#### Changed

- Expanded ZZZ styling for buttons, icon buttons, window controls, and base UI components for more consistent theme coverage.
- Standardized `data-*` attributes on icon buttons and related interactive elements for semantic skin customization.
- Adjusted toast position, visible count, and duration based on the active skin.

## [0.1.27]

### 中文

#### 新增

- 为基础 UI 组件补充 `data-slot` 属性，便于皮肤和自定义样式进行精准定位。

#### 变更

- 重构皮肤系统，将皮肤定义与样式拆分至渲染器侧的独立模块，简化皮肤注册与扩展。
- 优化设置页面皮肤选择网格布局，在不同窗口尺寸下自适应 2 列或 4 列展示。
- 优化窗口标题栏及基础 UI 组件的样式标记，提升主题样式覆盖能力。

### English

#### Added

- Added `data-slot` attributes to base UI components for precise skin and custom-style targeting.

#### Changed

- Refactored the skin system into renderer-side modules for simpler skin registration and extension.
- Improved the Settings skin selector with a responsive two- or four-column grid across window sizes.
- Improved styling hooks for the window title bar and base UI components to support theme overrides.

## [0.1.26]

### 中文

#### 新增

- 新增桌面端错误日志系统，自动捕获主进程与渲染进程的控制台错误、未捕获异常和未处理 Promise 拒绝，支持日志持久化、敏感信息脱敏及自动清理。
- 在设置的诊断页面新增错误日志导出功能，支持一键导出当天错误日志。

#### 变更

#### 修复

- 修复永久删除智能体时未清理其 Soul 文件的问题。

### English

#### Added

- Added a desktop error-logging system that captures console errors, uncaught exceptions, and unhandled promise rejections from the main and renderer processes, with persistence, sensitive-data redaction, and automatic cleanup.
- Added one-click export for the current day's error log in Settings diagnostics.

#### Changed

#### Fixed

- Fixed permanent agent deletion leaving its Soul files behind.

## [0.1.25]

### 中文

#### 新增

- 新增 Windows 系统托盘支持，可从托盘打开 Ayaka、新建聊天、打开设置或退出应用。
- 新增托盘菜单多语言支持与托盘图标资源。

#### 变更

- 重构代理循环与工具回合控制逻辑，简化任务完成判断和停止条件。
- 优化窗口生命周期管理，支持关闭窗口后保留应用在系统托盘运行，并在重复启动时唤醒已有窗口。

### English

#### Added

- Added Windows system-tray support for opening Ayaka, starting a new chat, opening Settings, or quitting the app.
- Added localized tray-menu labels and tray icon resources.

#### Changed

- Refactored agent-loop and tool-turn control to simplify task-completion decisions and stopping conditions.
- Improved window lifecycle handling so closing the window keeps the app running in the system tray and launching the app again focuses the existing window.

## [0.1.24]

### 中文

#### 新增

- 新增完整的 MCP 客户端集成能力，支持工作区服务器配置、连接管理、工具调用及 OAuth 认证。
- 新增 MCP 服务器连接状态显示与后台发现能力。
- 新增 MCP 工作区服务器编辑功能。

#### 变更

- 优化 MCP 传输认证校验与交互流程。
- 移除视频生成功能及相关配置、资源和界面。

### English

#### Added

- Added full MCP client integration with workspace server configuration, connection management, tool invocation, and OAuth authentication.
- Added MCP server connection-status display and background discovery.
- Added editing support for MCP workspace servers.

#### Changed

- Improved MCP transport authentication validation and interaction flows.
- Removed video-generation features and their related configuration, assets, and UI.

## [0.1.23]

### 中文

#### 新增

- 新增基于官方 OpenAI-Compatible SDK 的兼容提供商支持，并保留旧模型配置选项的兼容迁移。

#### 变更

- 重构兼容提供商的模型创建与提供商参数处理，支持返回用量信息。
- 优化流式聊天消息同步与渲染，减少加载期间的消息闪烁和状态错乱。
- 默认折叠工具调用卡片，降低长对话中的信息密度。

### English

#### Added

- Added official OpenAI-compatible SDK support for compatible providers while preserving legacy model-option settings.

#### Changed

- Refactored compatible-provider model creation and provider-option handling, including usage reporting.
- Improved streaming chat message synchronization and rendering to reduce flicker and inconsistent states while conversations load.
- Collapsed tool-call cards by default to reduce visual noise in long conversations.

## [0.1.22]

### 中文

#### 新增

- 新增全局与代理记忆管理工具，支持查看、读取和写入 SOUL 与记忆文件，并通过访问控制与审计日志保护敏感内容。
- 新增对话运行 ID 跟踪与追问建议，支持重试时自动恢复过期运行。
- 新增兼容 OpenAI 接口模型的推理内容识别与展示，并支持展示消息来源。
- 新增 Agent 头像组件，区分主代理与子代理的身份展示。

#### 变更

- 重构聊天消息合并与持久化流程，通过会话快照提升流式更新、重连和退出时的数据一致性。
- 将产品品牌统一更新为 Ayaka，并同步应用、文档、协议及资源命名。
- 更新设置页模型选择布局与 Ayaka 主题，优化不同窗口尺寸下的显示效果。
- 优化关于页资源入口与品牌图标，移除过时的桌面助手网站内容。
- 优化实时思考面板与消息流式展示，简化执行状态信息并减少滚动和渲染跳动。
- 移除输入框中已不再使用的快捷键提示，减少无效界面信息。

### English

#### Added

- Added global and agent memory-management tools for listing, reading, and writing SOUL and memory files, with access control and audit logging for sensitive content.
- Added conversation run ID tracking and follow-up suggestions, with automatic recovery for stale runs during retries.
- Added reasoning-content detection and rendering for OpenAI-compatible models, along with source display in conversations.
- Added Agent avatar components to distinguish the primary agent from sub-agents.

#### Changed

- Refactored chat-message merging and persistence around conversation snapshots to improve consistency during streaming updates, reconnects, and shutdown.
- Unified the product branding under Ayaka across the application, documentation, protocols, and resources.
- Updated the model-selector layout and Ayaka theme in Settings for better behavior across window sizes.
- Improved About-page resource links and brand icons, and removed the outdated desktop-companion website section.
- Simplified the live-thinking panel and streaming message rendering to reduce unnecessary status detail, scrolling, and layout jumps.
- Removed the unused input shortcut hint to reduce interface noise.

## [0.1.21]

### 中文

#### 新增

- 新增 OpenAI 兼容模型的图片输入适配，支持将图片数据转换为兼容的图片 URL 格式。

#### 变更

- 优化对话执行摘要展示，将工具调用、搜索和图片等执行信息移到助手消息气泡外，提升长回复的阅读体验。
- 优化对话自动滚动，展开或折叠执行详情时保持当前滚动位置，减少内容跳动。
- 优化对话重试流程，在运行状态过期或无法继续时自动切换到新的运行。

#### 修复

- 修复工作区图片、Data URL 和网络图片输入的校验与处理问题，并在附件图片无法读取时显示明确的错误提示。
- 修复推理模型请求中传入不受支持的采样参数导致请求失败的问题。

### English

#### Added

- Added image-input support for OpenAI-compatible models by converting image data to compatible image URLs.

#### Changed

- Moved execution summaries for tool calls, searches, and images outside assistant message bubbles to improve readability for long responses.
- Improved conversation auto-scrolling so expanding or collapsing execution details preserves the current scroll position and reduces layout jumps.
- Improved conversation retry handling by automatically starting a new run when the previous run is stale or cannot be resumed.

#### Fixed

- Fixed validation and handling for workspace images, data URLs, and remote image URLs, with a clear error when an attached image cannot be read.
- Fixed request failures caused by sending unsupported sampling parameters to reasoning models.

## [0.1.20]

### 中文

#### 新增

- 新增视觉模型配置与通用设置标签页，支持自动选择或指定图片输入模型。
- 新增对话图片灯箱预览，支持自适应图片预览、键盘切换、缩放查看，以及保存图片和定位文件。

#### 变更

- 重构媒体资源加载与上下文桥接，统一处理图片及其他媒体附件，并增加加载占位和失败提示。
- 当对话包含图片输入时自动使用已配置的视觉模型；当前模型不支持图片输入时显示明确的错误提示。

#### 修复

- 修复工作区文件通过 Electron contextBridge 传输时的二进制数据类型兼容性问题。

### English

#### Added

- Added vision model configuration and a General settings tab, with support for automatic selection or a dedicated model for image input.
- Added an image lightbox for conversations with adaptive previews, keyboard navigation, zooming, image saving, and file location.

#### Changed

- Refactored media-resource loading and context bridging to unify image and other media attachment handling, with loading placeholders and failure messages.
- Conversations with image input now automatically use the configured vision model and show a clear error when the current model does not support images.

#### Fixed

- Fixed binary data type compatibility when workspace files are transferred through Electron's contextBridge.

## [0.1.19]

### 中文

#### 变更

- 优化工作区设置页面，直接显示当前工作区父目录，并在选择新目录后自动刷新状态。
- 优化确认对话框的样式扩展能力，改善设置页面中的交互体验。

#### 移除

- 移除桌面桌宠功能及其相关的数据库配置、资源、界面、文档和测试代码。
- 启动时清理旧版桌宠数据，避免已移除功能遗留无效配置。

### English

#### Changed

- Improved the workspace settings page by displaying the current parent directory and refreshing the state after a new directory is selected.
- Improved confirmation dialog styling support for a smoother settings experience.

#### Removed

- Removed the desktop pet feature and its related database configuration, assets, UI, documentation, and tests.
- Added startup cleanup for legacy desktop pet data to prevent stale configuration from remaining after the feature removal.

## [0.1.18]

### 中文

#### 变更

- 优化智能体状态面板交互体验，避免非编辑内容被意外选中。
- 调整智能体状态面板中指令区域的默认折叠状态，减少初始信息占用。
- 移除技能卡片上无实际用途的运行按钮及相关代码逻辑。

### English

#### Changed

- Improved the agent status panel interaction by preventing accidental selection of non-editable content.
- Updated the instructions section in the agent status panel to be collapsed by default, reducing the initial information density.
- Removed the unused run button and related logic from skill cards.

## [0.1.17]

### 中文

#### 新增

- 新增应用更新日志页面，可在关于设置中查看版本记录。
- 新增任务阻塞状态和任务完成限制，完善任务完成工具流。

#### 变更

- 改进智能体工具结果补全和历史清理逻辑，提升运行状态的一致性。

#### 修复

- 修复回收站清理时间提示中的插值占位符问题。

### English

#### Added

- Added an in-app update log page for viewing release notes from About settings.
- Added blocked-task status and completion limits, improving the task completion tool flow.

#### Changed

- Improved agent tool-result reconciliation and history cleanup for more consistent runtime state.

#### Fixed

- Fixed interpolation placeholders in the recycle-bin cleanup time message.

## [0.1.16]

### 中文

#### 新增

- 新增用于附件和生成文件的独立对话工作区。
- 新增默认父目录选择和孤立工作区管理。

#### 变更

- 改进桌面工作区中的智能体状态和运行诊断。

### English

#### Added

- Added isolated conversation workspaces for attachments and generated files.
- Added workspace management for selecting a default parent folder and handling orphaned workspaces.

#### Changed

- Improved agent status and runtime diagnostics in the desktop workspace.

## [0.1.15]

### 中文

#### 变更

- 改进本地路径管理和数据库写入处理。

### English

#### Changed

- Improved local path management and database write handling.
