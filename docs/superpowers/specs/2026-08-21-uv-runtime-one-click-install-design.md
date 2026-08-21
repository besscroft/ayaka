# Ayaka uv / uvx 跨平台一键安装设计

## 状态

方向已获用户确认，本文档进入实现前审阅。本文档只定义 uv / uvx 的托管运行时安装，不改变现有 MCP ToolSet、审批、OAuth、生命周期和 Node Runtime 的接口语义。

## 背景与目标

Ayaka 的 MCP Server 不使用 Electron 的 `process.execPath`。当 MCP 配置使用 `uv` 或 `uvx` 时，Ayaka 需要在没有 Python、pip、系统包管理器或可用 PATH 的普通用户设备上完成运行环境安装。

目标是让用户只需点击一次“安装”即可获得可验证的 `uv` 和 `uvx`：

- 不要求用户预先安装 Python、pip、Homebrew、WinGet、Scoop、Cargo 或 shell。
- 不执行 Astral 的 `install.ps1` / `install.sh`，不修改用户 PATH，不写入 shell profile，不请求管理员权限。
- 使用 Astral 官方发布的独立二进制压缩包，下载后校验 SHA-256，安全解压并原子安装。
- 支持 Windows、macOS、Linux 的 x64 / arm64；Linux 正确区分 glibc 与 musl。
- 安装后同时验证 `uv --version` 与 `uvx --version`，并让 MCP Lifecycle Manager 使用固定的绝对路径。
- 升级安装新版本时保留旧版本，使已运行 MCP 继续使用原绝对路径。
- 网络、镜像、校验、平台不支持等失败都返回明确且可操作的错误。

非目标：本次不打包 Python，不管理系统 PATH，不调用系统包管理器，不把 uv 的 Python 环境或缓存迁移到 Ayaka 的 Runtime 目录，不自动执行远程安装脚本。

## 官方安装方式核对

Astral 官方文档列出 standalone installer、PyPI、Homebrew、MacPorts、WinGet、Scoop、Docker、GitHub Releases 和 Cargo 等方法。对 Ayaka 来说，只有 GitHub Releases / Astral 发布归档适合作为应用内托管 Runtime：其余方法都依赖外部工具、系统权限、shell 或用户环境。

官方 standalone installer 本质上也是：识别目标平台，下载发布归档，解压 `uv` / `uvx` / `uvw`，再复制到用户目录。Ayaka 复用这个“直接使用发布归档”的结果，但不复用安装脚本的副作用。

官方归档命名与内容约定如下：

| 目标              | 归档                                   | 必需可执行文件      | 备注                  |
| ----------------- | -------------------------------------- | ------------------- | --------------------- |
| Windows x64       | `uv-x86_64-pc-windows-msvc.zip`        | `uv.exe`, `uvx.exe` | 二进制位于 ZIP 根目录 |
| Windows arm64     | `uv-aarch64-pc-windows-msvc.zip`       | `uv.exe`, `uvx.exe` | 二进制位于 ZIP 根目录 |
| macOS x64         | `uv-x86_64-apple-darwin.tar.gz`        | `uv`, `uvx`         | 归档带有顶层目录      |
| macOS arm64       | `uv-aarch64-apple-darwin.tar.gz`       | `uv`, `uvx`         | 归档带有顶层目录      |
| Linux glibc x64   | `uv-x86_64-unknown-linux-gnu.tar.gz`   | `uv`, `uvx`         | glibc 至少 2.17       |
| Linux glibc arm64 | `uv-aarch64-unknown-linux-gnu.tar.gz`  | `uv`, `uvx`         | glibc 至少 2.28       |
| Linux musl x64    | `uv-x86_64-unknown-linux-musl.tar.gz`  | `uv`, `uvx`         | 静态 musl 归档        |
| Linux musl arm64  | `uv-aarch64-unknown-linux-musl.tar.gz` | `uv`, `uvx`         | 静态 musl 归档        |

平台与架构不应只根据文件名推导安装路径。Manifest 必须声明归档布局和每个必需可执行文件的相对路径：Windows 的路径是 `uv.exe` / `uvx.exe`，Unix 归档的路径是 `<top-level>/uv` / `<top-level>/uvx`。这样可以避免把 Windows ZIP 错误地当成带顶层目录的归档。

## 方案决策

### 1. 直接托管二进制，不运行官方脚本

安装按钮只调用 main process 的 Runtime Manager。Runtime Manager 通过无 shell 的 HTTPS 请求下载归档，执行以下检查：

1. URL 使用 HTTPS；允许 GitHub / Astral 官方地址和用户明确配置的 HTTPS 镜像。
2. 响应状态成功，内容大小不超过上限。
3. 内容 SHA-256 与 Manifest 完全匹配。
4. ZIP / tar.gz 不包含绝对路径、`..` 路径或符号链接。
5. 归档中的必需可执行文件全部存在，且路径位于临时安装目录内。
6. 在临时目录直接执行绝对路径 `uv --version` 和 `uvx --version`，确认可执行文件有效。
7. 全部检查通过后，将临时目录原子重命名为版本目录。

不使用 `shell: true`，不执行任何从远程来源取得的脚本，不继承 Electron 专用环境变量，不把 token 或完整 `env` 写入日志。

### 2. Manifest 来源分层

GitHub Releases 页面可以继续作为用户可粘贴的便捷 URL，但安装流程不依赖 GitHub API 的实时限流结果。

来源优先级为：

```text
已安装 Managed uv
    ↓ 没有可用版本
用户显式配置的 HTTPS Manifest / 镜像
    ↓ 未配置、不可用或用户选择官方源
应用内置 uv Manifest（离线可读取）
    ↓ 用户选择刷新或内置版本不可用
Ayaka 官方 HTTPS Manifest
```

用户显式配置的镜像只在其值通过 HTTPS、Manifest schema 和目标资产校验后生效；配置存在但不可用时，安装流程回退到内置/官方源并保留可操作的镜像错误提示。这样高级设置既能满足受限网络环境，也不会让一个失效的自定义地址阻断正常安装。

Manifest 本身是静态数据，不包含脚本、命令或安装钩子。每个平台目标至少包含一个主下载 URL 和可选备用 URL。官方源使用 Astral 的发布 CDN URL，GitHub Release URL 作为备用；这样既减少 GitHub API 限流，又保留用户提供的 Releases 来源兼容性。

用户粘贴以下 URL 时，Config/Runtime Source Normalizer 只做地址识别，不执行页面内容：

```text
https://github.com/astral-sh/uv/releases
https://github.com/astral-sh/uv/releases/latest
https://github.com/astral-sh/uv/releases/tag/<version>
```

它们分别映射到最新版本或固定版本的官方静态 Manifest / Release 元数据。任意其他自定义地址必须返回受支持的 Manifest JSON；HTML 页面不能被猜测为自定义 Manifest。

### 3. Manifest 模型

建议新增版本化的内部模型，保留现有 `RuntimeManifestAsset` 的兼容读取：

```ts
type RuntimeLibc = "gnu" | "musl" | null;
type RuntimeArchiveLayout = "flat" | "top-level-directory";

interface ManagedRuntimeManifest {
  schema: "ayaka-runtime-manifest-v2";
  runtime: "uv";
  channel: "stable";
  generatedAt: string;
  releases: Array<{
    version: string;
    assets: Array<{
      platform: "win32" | "darwin" | "linux";
      architecture: "x64" | "arm64";
      libc: RuntimeLibc;
      archiveUrl: string;
      fallbackArchiveUrls?: string[];
      archiveType: "zip" | "tar.gz";
      archiveLayout: RuntimeArchiveLayout;
      sha256: string;
      executables: Array<{
        command: "uv" | "uvx";
        relativePath: string;
      }>;
    }>;
  }>;
}
```

示例 Windows 资产：

```json
{
  "platform": "win32",
  "architecture": "x64",
  "libc": null,
  "archiveUrl": "https://releases.astral.sh/github/uv/releases/download/0.12.5/uv-x86_64-pc-windows-msvc.zip",
  "fallbackArchiveUrls": [
    "https://github.com/astral-sh/uv/releases/download/0.12.5/uv-x86_64-pc-windows-msvc.zip"
  ],
  "archiveType": "zip",
  "archiveLayout": "flat",
  "sha256": "<64 lowercase hex characters>",
  "executables": [
    { "command": "uv", "relativePath": "uv.exe" },
    { "command": "uvx", "relativePath": "uvx.exe" }
  ]
}
```

Manifest 校验必须拒绝未知 schema、未知平台、无匹配 libc、版本路径穿越、非 HTTPS URL、非 64 位 SHA-256、重复 command 或不安全 executable path。

### 4. Linux libc 选择

Runtime Manager 在 main process 中解析当前运行环境：

- 首选 `process.report.getReport().header.glibcVersionRuntime` 判断 glibc 及版本。
- 没有 glibc 信息时，以无 shell 的方式探测 libc；不能确认时标记为 `unknown`，不猜测下载 gnu 或 musl。
- glibc 版本低于该 uv 资产的最低要求时，优先选择对应 musl 静态资产；如果当前系统不是 musl 且无法运行该资产，则返回“系统 glibc 版本过低”的明确错误。
- 当前只承诺 x64 / arm64；其他架构返回不支持，不自动选择相近架构。

Runtime 类型需要将 `libc` 和可选的 `minimumGlibc` 作为解析结果的一部分。已有数据库记录没有该字段时按 `null` 兼容，新的 uv 安装记录必须写入实际目标信息，避免同版本不同 libc 发生误复用。

### 5. 安装目录与运行时解析

继续使用用户数据目录，应用升级不触碰这些文件：

```text
<userData>/runtimes/uv/<version>/<platform>-<arch>-<libc>/
```

每个版本目录只放已验证的 `uv`、`uvx`、`uvw`（如果 Manifest 声明并校验它）和运行时元数据。安装阶段使用同级唯一临时目录，完成后原子替换；已存在且校验一致的版本直接复用，校验不一致则按新安装处理，不覆盖正在使用的目录。

MCP 解析规则保持：

```text
MCP command basename = uv / uvx
    ↓
选择当前平台、架构、libc 的最高可用 Managed uv
    ↓
替换为已验证的绝对路径
    ↓
启动 MCP 子进程（shell=false）
```

`uvx` 不需要 Python 可执行文件。uv 会在首次执行 Python 工具时根据自身机制准备 Python 和工具环境；Ayaka 只负责提供 `uvx` 二进制和独立的 MCP 依赖目录，不把 Python 安装过程误认为 Ayaka Runtime 安装过程。

### 6. 安装、升级、卸载状态

Runtime UI 默认只展示“uv / uvx”和一个安装按钮。Manifest URL、镜像和版本选择放入高级设置；默认不要求普通用户理解发布页、平台三元组或 SHA-256。

状态流程：

```text
未安装 → 读取 Manifest → 下载中 → 校验中 → 解压中 → 验证中 → 已安装
                                      ↘ 失败并清理临时目录
```

安装进度通过现有 `runtime:state-changed` 事件发送阶段、百分比、当前版本和错误摘要。失败不把半成品标记为 available；重试会生成新的临时目录。升级安装新版本时，运行中的 MCP 继续使用旧 `runtimeInstallationId` 和旧绝对路径，升级完成后新启动的 MCP 才使用新版本。

卸载前检查 MCP Runtime State：只要有 Server 正在使用该版本，就拒绝卸载并提示先停止 Server。卸载失败保留安装记录和错误状态，不删除其他版本。

## 配置与 IPC 变化

### Main process

Runtime Manager 增加以下内部职责：

- `detectUvTarget()`：返回 platform、architecture、libc、glibc version。
- `resolveUvManifest()`：按来源优先级和目标选择资产。
- `downloadAndVerifyRuntimeAsset()`：下载、重定向校验、大小限制和 SHA-256。
- `extractAndValidateRuntimeArchive()`：区分 flat ZIP 与 top-level tar.gz，拒绝链接和路径穿越。
- `verifyUvBinaries()`：验证 `uv` 与 `uvx` 版本和可执行文件路径。
- `installManagedRuntimeAtomically()`：临时目录、备份、原子移动和失败回滚。

现有 `runtime:managedSnapshot`、`runtime:managedInstall`、`runtime:managedUpgrade`、`runtime:managedUninstall` 和 `runtime:state-changed` 保留。安装结果增加 target、verified commands 和 source kind，但不返回秘密或完整下载响应。

### Renderer

普通设置页显示：

- 系统 uv / uvx 是否可用及版本。
- Managed uv / uvx 是否已安装及版本。
- 当前使用优先级：Managed > PATH。
- 安装、升级、卸载、重试。

高级设置显示：

- 官方源 / Ayaka Manifest / 自定义 HTTPS 镜像。
- 当前目标平台、架构和 Linux libc。
- 当前选中的版本、下载源和校验状态。

用户文案必须加入中文和英文 i18n。自定义 URL 输入框不能在 `onChange` 的延迟 state updater 中读取 `event.currentTarget`；先同步复制字符串，再提交 state。

## 安全边界

- 仅 main process 访问网络、文件系统、SQLite 和子进程。
- 不启用 shell，不调用 `process.execPath` 作为 uv，不继承 Electron 专用环境变量。
- 不执行 `install.ps1` / `install.sh`，不执行 npm/pip/cargo/winget/brew/scoop。
- 只允许 HTTPS；重定向每一跳重新校验协议，限制最大跳转次数。
- Manifest 与归档都校验 URL、版本、平台、架构、libc、归档类型、SHA-256 和相对路径。
- ZIP 目录条目必须按目录处理；空文件仍按文件处理。tar 中拒绝 symlink、hardlink、绝对路径和 `..`。
- 安装目录在 App Data 下，删除和回滚只允许作用于经过 `isPathWithin` 验证的明确目录。
- 日志只记录 runtime kind、版本、目标和阶段，不记录 MCP env、headers、secret 或下载响应内容。

## 错误模型与用户引导

| 错误                      | 用户看到的下一步                                        |
| ------------------------- | ------------------------------------------------------- |
| 当前平台 / 架构不支持     | 提示 Ayaka 当前版本支持的目标，保留系统 Runtime 入口    |
| Linux libc 无法识别       | 提示查看系统发行版或配置兼容的 HTTPS 镜像，不猜测资产   |
| glibc 版本过低            | 提示升级系统或使用支持的 musl / gnu 资产                |
| Manifest 不可用           | 自动回退内置 Manifest；仍失败时引导配置镜像             |
| 下载 HTTP 错误 / 网络失败 | 尝试备用官方 URL，失败后显示重试和镜像设置              |
| SHA-256 不匹配            | 立即删除临时目录，提示源内容不可信，不允许继续安装      |
| 缺少 uv 或 uvx            | 安装失败并提示完整归档 / Manifest 不匹配                |
| 文件占用 / 原子替换失败   | 保留旧版本，提示停止使用该版本的 MCP 后重试             |
| uv 可执行文件验证失败     | 标记 failed，清理半成品，不把它暴露给 Lifecycle Manager |

错误文案不应把底层完整路径、下载 token 或远程响应原文直接显示给用户；诊断详情可以保留状态码、目标和脱敏后的错误类型。

## 测试设计

### Main process

- 目标解析：Windows/macOS/Linux x64/arm64；Linux gnu、musl、低 glibc、unknown libc。
- Manifest：schema、版本、平台、架构、libc、URL、SHA-256、归档布局和 executable path 校验。
- 官方资产：Windows flat ZIP、Unix top-level tar.gz，正确得到 `uv` / `uvx` 路径。
- ZIP 目录条目、空文件、tar 目录、symlink/hardlink、绝对路径和 `..` 路径。
- 下载重定向：允许 HTTPS → HTTPS，拒绝 HTTPS → HTTP 和过多跳转。
- SHA-256 正确、错误和归档过大。
- 原子安装、失败回滚、重复安装复用、升级不影响运行中 Server、卸载占用保护。
- Runtime 优先级：Managed uv > PATH；无二进制时返回 `needs_runtime`。

### Renderer

- 普通用户只看到安装/升级/卸载和状态。
- 高级设置可配置 HTTPS 镜像，输入值更新不会触发 `currentTarget` 空引用。
- 安装进度、失败重试、Linux libc 提示和中英文 i18n。

### 验收顺序

```text
focused main/renderer tests
→ vp run ayaka-desktop#typecheck:node
→ vp run ayaka-desktop#typecheck:web
→ vp check（记录既有基线失败，不做全局自动修复）
→ vp test
→ desktop main/renderer/electron tests
→ desktop build
```

必须额外验证：没有 Node/uv 时不会后台自动下载；用户点击安装后可完成 uv/uvx 安装；应用升级不删除 userData 下的 Runtime；自定义 MCP 和正在运行的 MCP 不受 Runtime 升级影响。

## 实现分期

1. 增加 uv target / libc / manifest 类型和内置 Manifest，保持旧 Manifest 兼容读取。
2. 修正官方 uv 资产布局：Windows ZIP 根目录、Unix tar 顶层目录；安装后验证两个命令。
3. 增加 Linux libc 检测和目标选择。
4. 重构下载与原子安装状态，增加备用 URL、进度和可操作错误。
5. 调整 Runtime 设置页为普通 / 高级两层，并补齐 i18n。
6. 完成 focused tests、迁移兼容性验证、完整类型检查和桌面构建。

## 设计自检结论

- 不依赖 Python：uv 自带工具链管理能力，MCP 只需要 uv / uvx。
- 不依赖系统包管理器：所有外部安装器均不进入 Ayaka 执行路径。
- 不把 GitHub API 当作唯一来源：内置 Manifest 和 Astral CDN 解决限流与网络问题。
- 不假设所有归档布局相同：Manifest 显式声明 flat / top-level-directory。
- 不误用旧版本：Runtime Installation ID、绝对路径和运行中 MCP 绑定保持稳定。
- 不牺牲安全性：无 shell、无远程脚本、HTTPS、SHA-256、路径和链接校验、原子回滚均保留。
