# MCP Runtime and Lifecycle

Ayaka stores MCP configuration in SQLite and keeps runtime binaries outside the application bundle:

```text
<userData>/runtimes/<node|uv>/<version>/<platform>-<arch>[-<libc>]/
<userData>/mcp/servers/<serverId>/
```

MCP stdio servers are started on demand. A managed Node or uv runtime is selected first; if no managed runtime is installed, Ayaka falls back to the matching executable on `PATH`. If neither exists, the server enters `needs_runtime` and the Runtime settings page provides the next action. Ayaka never uses Electron's executable as an MCP runtime.

Runtime installation is explicit. The selected manifest must provide a stable version, platform, architecture, archive URL, executable path, and SHA-256. Archives are downloaded into a temporary directory, checked, rejected if they contain unsafe paths or links, and atomically moved into the versioned App Data directory. Multiple versions can coexist. A running MCP keeps its resolved executable path while a newer version is installed.

For uv, the default path uses a bundled manifest for the supported x64/arm64 Windows, macOS, and Linux gnu/musl archives. It contains the official Astral CDN URL, a GitHub Release fallback, archive layout, both `uv` and `uvx` paths, and SHA-256 digests. A user-configured HTTPS manifest/mirror is attempted first; if it is unavailable or invalid, Ayaka falls back to the bundled manifest and then the official online release metadata. The GitHub Releases page can still be pasted into Settings > Runtime:
`https://github.com/astral-sh/uv/releases` (or a `/releases/tag/<version>` page). HTML is never guessed as a custom manifest.

Windows uv ZIP files are flat (`uv.exe` and `uvx.exe` at the archive root). macOS/Linux tarballs contain a top-level directory. Linux selection uses the Node runtime report to distinguish glibc and musl; an unknown libc is not guessed. The install button downloads only the archive, verifies its SHA-256, rejects traversal and links, makes both binaries executable, runs `uv --version` and `uvx --version`, and atomically installs the verified directory. It does not run `install.ps1`/`install.sh`, Python, pip, Homebrew, WinGet, Scoop, Cargo, or a shell, and it does not modify PATH.

`npx` and `uvx` are recognized only when they are the command basename. Safe package extraction is limited to common package flags. Commands that cannot be unambiguously parsed remain unchanged and are reported as requiring manual confirmation. Dependency installation uses a server-specific directory, disables install scripts by default, and removes partial output on failure.

## Configuration exchange

The Config Manager accepts a reviewed subset of Claude JSON (`mcpServers`) and Codex TOML (`[mcp_servers.<name>]`). Import first creates a preview, reports unsupported fields, and then applies a merge without deleting existing servers. Imported servers are disabled. Export never resolves or emits decrypted secrets; `$secret:NAME` references remain references.

## Troubleshooting

- `needs_runtime`: install Node.js or uv/uvx from Settings > Runtime, or make the corresponding command available on `PATH`. Installing uv does not separately install Python; uv manages Python/tool environments when `uvx` later needs them.
- `Linux libc could not be detected`: use a supported distribution or configure a verified HTTPS manifest for the correct target; Ayaka does not guess between glibc and musl.
- `Runtime archive SHA-256 does not match`: the temporary directory is deleted and installation stops. Retry with the official source or a trusted mirror.
- `needs_install`: inspect the server command and run Install dependencies. Commands with ambiguous package arguments require manual review.
- `needs_confirmation`: an install script or unsafe command shape requires an explicit user confirmation path.
- `error`: use Probe or Restart and inspect Runtime diagnostics. Stdio stderr is bounded and secrets are redacted.
- A runtime cannot be removed while a server is using it. Stop that server first.
