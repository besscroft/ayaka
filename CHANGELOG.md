# Changelog

## [0.2.5]

### 中文

#### 变更

- 将“新建任务 / New task”识别为会话标题占位符，使新建任务会话能够正常生成并保存实际标题。

### English

#### Changed

- Recognized “新建任务 / New task” as a placeholder conversation title so new task conversations can generate and save their actual titles.

## [0.2.4]

### 中文

#### 新增

- 新增本地执行引擎和五种工具，支持执行本地命令、读取和写入文件、精确编辑文本及应用多文件补丁。
- 新增本地执行风险评估与权限审批，根据操作类型和目标路径判断是否需要确认，并在聊天中展示操作摘要和结果。

#### 变更

- 统一本地命令与文件操作的运行记录、取消处理和错误结果；文件变更支持路径校验、冲突检测及补丁失败回滚。
- 保留沙箱工具和会话工作区命令的现有边界，本地执行工具在主进程中运行，并通过结构化参数调用命令。

### English

#### Added

- Added a local execution engine and five tools for running local commands, reading and writing files, making exact text edits, and applying multi-file patches.
- Added risk assessment and permission review for local execution, determining when confirmation is needed from the operation and target path and showing operation summaries and results in chat.

#### Changed

- Unified runtime records, cancellation, and error results for local commands and file operations. File changes include path validation, conflict detection, and rollback after patch failures.
- Preserved the existing boundaries for sandbox tools and conversation-workspace commands. Local execution runs in the main process and invokes commands with structured arguments.

## [0.2.3]

### 中文

#### 新增

- 新增响应生成期间提交消息的能力，用户可继续输入并将消息加入处理队列，也可移除尚未处理的队列消息。
- 新增实时会话删除功能，删除前会显示确认提示。
- 为聊天消息和实时会话消息新增时间显示。

#### 变更

- 优化消息队列、运行时输入和消息持久化流程，确保排队消息按顺序处理并正确同步到会话记录。
- 优化消息操作栏布局，将消息时间与操作项、助手执行耗时统一展示。
- 更新 ZZZ 皮肤的颜色变量，改善文字和输入占位符在深色背景下的可读性。

### English

#### Added

- Added message submission while a response is streaming. New messages can be queued for processing, and pending queued messages can be removed.
- Added realtime-session deletion with a confirmation prompt.
- Added timestamps to chat messages and realtime-session messages.

#### Changed

- Improved message-queue, runtime-input, and persistence flows so queued messages are processed in order and synchronized correctly with conversation history.
- Updated the message-action row to show timestamps alongside actions and assistant execution time.
- Updated ZZZ skin color variables to improve text and input-placeholder readability on dark backgrounds.

## [0.2.2]

### 中文

#### 新增

- 新增实时语音对话功能，支持麦克风采集、实时语音模型选择、文本消息收发以及实时会话历史持久化。
- 新增 OpenAI 原生 Realtime 和 OpenAI 兼容 Realtime 协议支持，可配置传输协议与服务端点。
- 新增阿里云百炼原生 Realtime 支持，适配工作空间、地域、音频格式和事件转发。
- 新增实时会话自动标题生成、可折叠历史侧栏和会话搜索功能。
- 新增实时会话断线重连能力，可在保留当前转录内容的情况下重新建立连接。

#### 变更

- 优化实时会话历史界面、消息时间显示、默认标题和窗口顶部导航，改善聊天与实时视图之间的切换体验。
- 扩展服务商和模型配置，支持实时能力开关、协议选项及 Realtime 端点参数，并完善对应的配置校验。

### English

#### Added

- Added realtime voice conversations with microphone capture, realtime model selection, text messaging, and persisted session history.
- Added support for OpenAI Realtime and OpenAI-compatible Realtime protocols with configurable transports and service endpoints.
- Added native Alibaba Cloud Bailian Realtime support, including workspace, region, audio-format, and event-forwarding adaptations.
- Added automatic titles for realtime sessions, a collapsible history sidebar, and session search.
- Added realtime-session reconnection, allowing the transport to be re-established while keeping the current transcript.

#### Changed

- Improved the realtime history view, message timestamps, default titles, and window navigation for smoother switching between chat and realtime views.
- Extended provider and model settings with realtime capability toggles, protocol choices, endpoint parameters, and related validation.

## [0.2.1]

### 中文

#### 新增

- 新增服务商 API 密钥显示/隐藏功能，用户可在模型设置中主动查看已保存的密钥。

#### 变更

- 提供商 ID 改为可选；留空时根据提供商名称或服务地址自动生成稳定 ID。
- 优化模型设置中的同步操作与按钮加载状态展示，并调整按钮空内容的渲染逻辑。
- 为聊天视图按会话标识组件实例，避免切换会话时复用旧状态。

### English

#### Added

- Added a show/hide control for provider API keys, allowing users to explicitly reveal a saved key in model settings.

#### Changed

- Made provider IDs optional and automatically derive a stable ID from the provider name or endpoint when the field is left blank.
- Improved model-settings sync actions and loading-state feedback, and refined how buttons render empty content.
- Keyed chat views by conversation ID to prevent stale component state from carrying over when switching conversations.

## [0.2.0]

### 中文

#### 新增

- 新增宿主无关的 `@ayaka/core` 核心后端包，提供统一的 HTTP API、请求校验、错误协议、聊天与媒体生成接口，以及可注入的运行时能力契约。
- 新增核心后端的 Node 服务启动器，桌面端通过运行时适配器复用本地模型、Agent、媒体、存储和鉴权能力，为后续服务器或 Docker 宿主适配提供基础。
- 新增基于 json-render 的生成式 UI，支持智能体在聊天消息中流式生成受控的交互式组件，并支持组件状态在会话中持久化。
- 新增共享生成式 UI catalog、类型定义和安全组件封装，支持卡片、按钮、图片、头像、链接等组件，并限制为本地状态与内置交互。

#### 变更

- 重构桌面端本地服务，将聊天、标题、追问建议、开场建议、模型和媒体接口迁移至 `@ayaka/core`，保持现有桌面端请求协议兼容。
- 优化聊天消息流处理，将生成式 UI 数据与普通文本分离，避免展示数据进入模型上下文，并在流式结束后同步交互状态。
- 优化生成式 UI 的安全性与容错能力，限制 URL、组件和动作范围，并为不支持或渲染失败的组件提供降级展示。

### English

#### Added

- Added the host-agnostic `@ayaka/core` backend package with a unified HTTP API, request validation, stable error protocol, chat and media-generation endpoints, and an injectable runtime contract.
- Added a Node server starter for the core backend. The desktop app now supplies a runtime adapter for its local models, agents, media, storage, and authorization, establishing a foundation for server or Docker hosts.
- Added json-render-powered generative UI, allowing agents to stream controlled interactive components inside chat messages and persist component state in conversations.
- Added shared generative-UI catalogs, types, and safe component wrappers for cards, buttons, images, avatars, links, and related components, limited to local state and built-in interactions.

#### Changed

- Refactored the desktop local service to use `@ayaka/core` for chat, title, follow-up suggestions, starter suggestions, model, and media endpoints while preserving the existing desktop request contract.
- Improved chat stream handling by keeping generative-UI data separate from ordinary text, preventing presentation data from entering model context and synchronizing interactive state after streaming completes.
- Improved generative-UI safety and resilience by restricting URLs, components, and actions and providing fallbacks for unsupported or failed renders.

## [0.1.42]

### 中文

#### 新增

- 新增 SVG 沙箱工件支持，可发布、读取并在工作区预览 SVG 图像。
- 新增自动化任务工作区管理，创建定时任务时自动初始化关联会话工作区。
- 新增新建对话高亮与快速初始化，首次进入新会话时减少不必要的历史加载。
- 新增沙箱命令未找到错误识别与本地化提示，帮助用户使用已安装命令或沙箱写文件工具。

#### 变更

- 优化聊天视图会话加载与 hydration，通过批量读取会话、消息和工作区信息及批量保存设置，减少初始化请求并改善性能。
- 优化自动化运行消息同步，支持运行期间周期性保存助手消息快照，并在会话中及时刷新外部运行结果。
- 优化工作区侧边面板的会话切换和自动打开逻辑，按会话恢复布局并尊重用户关闭状态。
- 将 `sandbox_write_file` 设为默认自动工具，更新沙箱命令和文件写入工具描述，并优化沙箱文件创建流程。
- 优化提供商与模型设置同步和 API 密钥读取缓存，减少重复解密并改善配置更新体验。
- 优化用户消息富文本样式，确保标题、代码、表格和链接在气泡背景上保持清晰。

#### 修复

- 修复外部运行会话的消息同步逻辑，避免运行完成后消息延迟或缺失。
- 修复会话加载时空消息列表的处理问题。

### English

#### Added

- Added SVG sandbox artifacts with publishing, resource access, and workspace image previews.
- Added automatic workspace setup for automations, initializing the associated conversation workspace when a scheduled task is created.
- Added new-conversation highlighting and fast initialization to avoid unnecessary history loading when entering a fresh conversation.
- Added localized command-not-found error classification and guidance to use an installed executable or the sandbox file tool.

#### Changed

- Improved conversation loading and hydration with batched conversation, message, and workspace reads plus batched settings writes, reducing initialization requests and improving performance.
- Improved automation-run synchronization by periodically saving assistant-message snapshots during execution and refreshing externally produced results in the conversation.
- Improved workspace-panel session switching and automatic opening, restoring layouts per conversation while respecting an explicit close action.
- Made `sandbox_write_file` an automatic tool by default, refreshed sandbox command/file-writing descriptions, and improved sandbox file-creation handling.
- Improved provider and model settings synchronization with API-key read caching, reducing repeated secret decryption and making configuration updates more responsive.
- Improved rich-content styling inside user message bubbles so headings, code, tables, and links remain readable against the bubble background.

#### Fixed

- Fixed message synchronization for externally running conversations, preventing delayed or missing messages after a run completes.
- Fixed handling of empty message lists during conversation hydration.

## [0.1.41]

### 中文

#### 新增

- 新增对话能力开关，支持按会话启用或禁用记忆与联网搜索，并在工具调用和代理学习流程中同步生效。

#### 变更

- 重构聊天输入区和工具栏布局，将工具与权限选择移至底部工具栏，简化工具选择器显示并优化间距。
- 移除新建对话空状态中的自动建议生成与展示，精简空状态交互。
- 优化上下文详情弹窗，使用独立浮层和自动视口定位，改善悬停交互并避免容器或窄窗口裁剪。
- 优化聊天头部工作区按钮为纯图标按钮，改善空间利用与可访问性。

#### 修复

- 修复模型和推理选择器在顶部展开时的菜单对齐问题。
- 修复聊天设计文档的中文乱码问题。

### English

#### Added

- Added per-conversation capability switches for Memory and Web search, with disabled capabilities respected by tool execution and agent-learning flows.

#### Changed

- Reworked the chat composer and toolbar layout by moving tool and permission selectors into the bottom toolbar, simplifying the tool-selector presentation, and refining spacing.
- Removed automatically generated starter suggestions from the empty new-conversation state to simplify the interaction.
- Improved the context-details popover with a separate layer and automatic viewport-aware positioning, preventing clipping and making hover interactions more reliable.
- Updated the workspace button in the chat header to an icon-only control for better space usage and accessibility.

#### Fixed

- Fixed menu alignment for model and reasoning selectors when their menus open above the trigger.
- Fixed garbled Chinese text in the chat design documentation.

## [0.1.40]

### 中文

#### 新增

- 新增长期记忆模型配置，支持在通用设置中分别选择记忆 LLM 和 Embedding 模型，或使用自动选择，并兼容 OpenAI 及 OpenAI 兼容服务商。
- 新增会话工作区侧栏布局持久化，按会话保存侧栏的显示状态和宽度，并在切换会话时自动恢复。

#### 变更

- 优化长期记忆配置变更处理，模型、服务商或 API 密钥更新后自动重置并重新初始化记忆实例。
- 优化浏览器面板初始化，仅在面板实际展示时拉取或创建浏览器会话，避免新会话尚未发送消息时提前写入工作区和会话记录。

### English

#### Added

- Added configurable long-term memory models in General settings, allowing separate Memory LLM and embedding selections with automatic selection support for OpenAI and OpenAI-compatible providers.
- Added persistent per-conversation workspace-panel layouts, restoring the panel’s visibility and width when switching conversations.

#### Changed

- Improved long-term memory configuration handling so memory instances are automatically reset and reinitialized when models, providers, or API keys change.
- Improved browser-pane initialization by fetching or creating browser sessions only when the pane is visible, preventing premature workspace and conversation records for new conversations before the first message is sent.

## [0.1.39]

### 中文

#### 新增

- 新增内置浏览器工具链，提供标签页管理、页面导航、页面快照、点击、输入、按键、滚动、等待和截图共 9 个工具，支持智能体执行交互式网页任务。
- 新增工作台浏览器面板，支持浏览器标签页管理、地址导航、前进后退、刷新、页面操作及截图预览。
- 新增浏览器会话与标签页持久化，支持按会话恢复浏览器工作状态。

#### 变更

- 优化浏览器消息处理，对输入内容和截图数据进行脱敏与安全路径转换，避免敏感信息和临时数据被直接持久化或重新发送。

### English

#### Added

- Added a built-in browser toolchain with nine tools for tab management, navigation, snapshots, clicking, typing, key presses, scrolling, waiting, and screenshots, enabling agents to perform interactive web tasks.
- Added a browser pane to the workspace with tab management, address navigation, back/forward controls, reload, page actions, and screenshot previews.
- Added persistent browser sessions and tabs so browser state can be restored per conversation.

#### Changed

- Improved browser-message handling by redacting input values and converting screenshot data to safe workspace paths, preventing sensitive information and temporary data from being persisted or resent directly.

## [0.1.38]

### 中文

#### 新增

- 新增代码块复制、折叠与展开功能，支持显示代码语言并提供复制状态提示，长代码块默认折叠。
- 新增临时会话转为永久会话后的创建事件通知，并自动刷新会话列表。

#### 变更

- 将 `sandbox_run_command` 设为默认自动启用工具，并完善工具描述，明确区分工作区命令与沙箱命令的用途。
- 优化追问建议生成与展示，仅基于最新助手消息生成建议，并增加加载状态、请求取消和历史建议去重，减少重复建议。

### English

#### Added

- Added code-block copying, collapsing, and expanding, with language labels, copy-status feedback, and automatic collapsing for long code blocks.
- Added a conversation-created event after a temporary conversation becomes persistent, with automatic conversation-list refresh.

#### Changed

- Made `sandbox_run_command` enabled by default as an automatic tool and improved its description to clarify the distinction between workspace and sandbox commands.
- Improved follow-up suggestion generation and display by using only the latest assistant message, adding loading states and request cancellation, and filtering suggestions shown previously to reduce duplicates.

## [0.1.37]

### 中文

#### 新增

- 新增技能脚本执行系统，支持技能包安装与导入、脚本入口管理、依赖检查、运行记录和输出截断，并通过执行策略与路径校验提升安全性。
- 新增技能显式调用与自动按需加载能力，支持在输入框使用 `/skill:<id>` 语法、技能提及菜单和键盘导航。
- 新增技能辅助资源读取能力，支持技能安全读取包内资源，并完善空技能调用与输入校验提示。
- 新增文档站下载页面，支持展示最新 Windows x64 版本、安装包大小、校验和与平台信息。

#### 变更

- 优化技能管理与聊天工具集成，支持技能自动触发、指令加载、技能列表实时更新及不可用状态提示。
- 优化技能提及输入体验，将 `/skill:<id>` 文本渲染为可编辑技能芯片，并改进菜单筛选、键盘交互和回车提交逻辑。
- 优化会话消息滚动，首次打开会话自动定位到最新消息；用户主动滚动后立即停止自动跟随。
- 简化沙箱产物预览流程，移除授权交互，HTML 和静态产物可直接预览。
- 优化消息编辑流程，保存有效编辑后立即关闭编辑器，再执行异步重新生成。
- 更新官网产品定位与文案，统一调整为“数字生命体”相关叙事，并完善首页与下载页体验。

### English

#### Added

- Added a Skill script-execution system with Skill package installation and import, script-entry management, dependency checks, run records, output truncation, and execution/path safety validation.
- Added explicit Skill invocation and on-demand loading with `/skill:<id>` syntax, a Skill mention menu, and keyboard navigation.
- Added secure access to auxiliary resources inside Skill packages, along with clearer validation for empty Skill invocations and invalid input.
- Added a documentation-site download page showing the latest Windows x64 release, package size, checksum, and platform details.

#### Changed

- Improved Skill management and chat-tool integration with automatic triggering, instruction loading, live Skill-list updates, and unavailable-state guidance.
- Improved Skill mentions by rendering `/skill:<id>` text as editable Skill chips and refining menu filtering, keyboard interactions, and Enter-to-submit behavior.
- Improved conversation scrolling so a newly opened conversation starts at the latest message while user scrolling immediately suspends automatic following.
- Simplified sandbox-artifact previews by removing authorization interactions and allowing HTML and static artifacts to open directly.
- Improved message editing so the editor closes immediately after a valid save before asynchronous regeneration begins.
- Updated the website’s product positioning and copy around the “digital lifeform” direction, with a refined home page and download experience.

## [0.1.36]

### 中文

#### 新增

- 新增会话权限管理，支持“每次询问”“仅审批风险操作”和“完全访问”三种模式，并提供全局默认权限与单会话覆盖设置。
- 新增附件 MIME 类型自动推断，在原始类型缺失或为通用二进制类型时，根据文件扩展名补全图片、音频、视频和文本附件类型。
- 新增富文本内容渲染与推理内容智能滚动，改善 Markdown 展示及流式输出体验。
- 新增运行时诊断详情查看能力，并添加 MemOS 记忆操作系统 MCP 预设。
- 新增代理头像选择器、内置动态头像资源及运行状态展示。

#### 变更

- 优化工具审批与会话恢复逻辑，完善审批响应状态、风险匹配及大参数处理，并支持完全访问模式跳过软审批。
- 优化工作区侧边面板动画、过渡效果和可访问性行为。
- 优化黑色与 ZZZ 深色皮肤的头像样式及图片预览交互。
- 统一运行时日志时间处理为北京时间，并改善诊断信息展示。

#### 修复

- 修复 ZZZ 主题图片预览框关闭按钮定位不正确的问题。

### English

#### Added

- Added session permission management with Ask, Approve risky actions, and Full access modes, plus global defaults and per-session overrides.
- Added automatic attachment MIME-type inference, filling in image, audio, video, and text types from file extensions when the declared type is missing or generic.
- Added rich-content rendering and smart scrolling for reasoning output, improving Markdown display and streaming behavior.
- Added runtime diagnostic detail views and a MemOS Memory Operating System MCP preset.
- Added an agent avatar picker, built-in animated avatar assets, and agent runtime-status indicators.

#### Changed

- Improved tool approval and session-recovery flows with approval-response states, refined risk matching, large-argument support, and soft-approval bypass in Full access mode.
- Improved workspace side-panel animations, transitions, and accessibility behavior.
- Improved avatar styling and image-preview interactions for the Black and ZZZ dark skins.
- Standardized runtime log timestamps on Beijing time and improved diagnostic presentation.

#### Fixed

- Fixed the image-preview close button being positioned incorrectly in the ZZZ skin.

## [0.1.35]

### 中文

#### 新增

- 新增 OpenCode Free 内置免费模型目录，支持公开模型服务、模型目录自动更新及模型启用状态管理。
- 新增沙箱产物发布与预览能力，支持静态应用和 HTML 产物的发布、授权、预览及工作区侧边面板管理。
- 新增工作区命令工具的审批配置，支持在工具设置中持久化审批策略并处理等待审批任务的取消与恢复。

#### 变更

- 优化消息操作栏布局，助手消息默认显示操作条并整合执行耗时，用户消息继续保持悬停时显示。
- 优化工作区侧边面板的布局和拖拽调整大小交互，完善指针取消与捕获释放处理。
- 优化提供商状态、模型列表同步及聊天错误提示，补充模型不可用、免费额度或 IP 限制等场景的可操作提示。

#### 修复

- 修复工作区侧边面板生成应用内容区域布局不正确的问题。
- 修复拖拽调整工作区侧边面板大小时指针取消与捕获释放处理不完整的问题。

### English

#### Added

- Added a built-in OpenCode Free model catalog with public free models, automatic catalog refresh, and model enablement controls.
- Added sandbox artifact publishing and preview support for static apps and HTML artifacts, including authorization and workspace side-panel management.
- Added approval configuration for the workspace command tool, with persisted policies and cancellation/recovery handling for runs waiting for approval.

#### Changed

- Improved message-action layout by keeping assistant actions visible and placing execution time on the same row, while user actions remain hover-only.
- Improved workspace side-panel layout and resize interactions, including pointer-cancellation and pointer-capture cleanup.
- Improved provider status, model-list synchronization, and chat error messages with actionable guidance for unavailable models and free-quota or IP limits.

#### Fixed

- Fixed the generated-app content area using an incorrect layout inside the workspace side panel.
- Fixed incomplete pointer-cancellation and pointer-capture cleanup while resizing the workspace side panel.

## [0.1.34]

### 中文

#### 新增

- 新增 Desktop Commander、AntV 图表、Draw.io、Notion 和 MySQL 共 5 个内置 MCP 预设。
- 新增结构化工作区命令执行工具，支持按可执行文件与参数运行命令，并根据风险等级自动执行或请求审批。
- 新增共享静态资源包，支持桌面端与文档站复用 Ayaka 资源。

#### 变更

- 优化 MCP 依赖安装与运行参数处理，支持 SQLite MCP 的版本兼容约束，并支持桌面端重启后恢复未完成的依赖安装。
- 优化流式消息渲染，统一使用富文本内容组件展示增量输出。

#### 修复

- 修复切换对话时聊天视图未正确重新渲染的问题。

### English

#### Added

- Added five built-in MCP presets: Desktop Commander, AntV Chart, Draw.io, Notion, and MySQL.
- Added a structured workspace command tool that runs executables with argument arrays and automatically allows or requests approval based on command risk.
- Added a shared static-assets package for reusing Ayaka assets across the desktop and documentation apps.

#### Changed

- Improved MCP dependency installation and runtime-argument handling with SQLite MCP version compatibility constraints and recovery for interrupted installations after restart.
- Improved streaming message rendering by consistently using the rich-content renderer for incremental output.

#### Fixed

- Fixed the chat view not re-rendering correctly when switching conversations.

## [0.1.33]

### 中文

#### 新增

- 新增 MCP 运行环境管理，支持托管 Node.js 与 uv 运行时的安装、升级和卸载，并提供独立的运行环境设置页面。
- 新增 MCP 服务器生命周期管理，支持启动、停止、重启、探测及依赖安装，并展示依赖安装进度和状态。
- 新增 Claude JSON 与 Codex TOML 格式的 MCP 配置导入导出。
- 新增已启用且依赖就绪的 stdio MCP 服务器自动启动，以及服务器工具列表变化的自动发现与刷新。

#### 变更

- 优化 MCP 工作区与工具选择器布局，改善服务器启动后的工具发现和列表更新体验。
- 统一 MCP 工具策略解析逻辑，简化工具可用性、自动启用和审批状态的判断。
- 支持为托管运行时传递前置参数，完善运行时命令与依赖安装流程。

#### 修复

- 修复 Windows 下 npm/npx 调用方式不兼容导致的 MCP 依赖安装问题。
- 修复技能面板默认打开标签页不符合预期的问题，默认显示“已安装”。

### English

#### Added

- Added MCP runtime management with installation, upgrade, and removal support for managed Node.js and uv runtimes, plus a dedicated runtime settings page.
- Added MCP server lifecycle management for starting, stopping, restarting, probing, and installing dependencies, with dependency progress and status display.
- Added MCP configuration import and export in Claude JSON and Codex TOML formats.
- Added automatic startup for enabled stdio MCP servers with ready dependencies, along with automatic discovery and refresh when server tool lists change.

#### Changed

- Improved MCP workspace and tool-selector layouts, including better tool discovery and list updates after servers start.
- Unified MCP tool-policy resolution to simplify availability, auto-enable, and approval-state handling.
- Added support for passing prefix arguments to managed runtimes and improved runtime command and dependency-installation flows.

#### Fixed

- Fixed MCP dependency installation on Windows by using a compatible npm/npx invocation flow.
- Fixed the Skills panel opening on the wrong default tab; it now opens on Installed.

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
