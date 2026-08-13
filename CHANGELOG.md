# Changelog

## [0.1.19] - 2026-08-13

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

## [0.1.18] - 2026-08-13

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

## [0.1.17] - 2026-08-13

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

## [0.1.16] - 2026-08-12

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

## [0.1.15] - 2026-08-04

### 中文

#### 变更

- 改进本地路径管理和数据库写入处理。

### English

#### Changed

- Improved local path management and database write handling.
