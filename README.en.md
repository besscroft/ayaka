# Ayaka

Language: [中文](README.md) | English

Ayaka is a local-first AI desktop workspace built with Electron, React, the AI SDK, Hono, SQLite, Drizzle, and shadcn/base-ui. It goes beyond a chat window by bringing agents, tool calls, memory, automations, and local execution into one workspace.

## Core capabilities

- **Chat and models**: Supports multiple model providers, model settings, streaming responses, media generation, and realtime voice sessions.
- **Agent runtime**: Provides Agents, the Agent Loop, child agents, runtime records, input queues, budget controls, cancellation, and recovery.
- **Local execution**: Runs local commands, reads and writes files, makes exact text edits, and applies multi-file patches; higher-risk operations go through approval.
- **Skills and MCP**: Supports configurable Skills, MCP servers, tool selection, and lifecycle management.
- **Memory and automations**: Provides memory, scheduled tasks, conversation workspaces, and persisted run results.
- **Sandbox and previews**: Supports sandbox artifacts, HTML/SVG/static-app previews, and isolated local preview processes.
- **Generative UI**: Uses json-render to stream controlled interactive components inside chat messages and persist their interaction state.
- **Local-first storage**: Stores runtime records, conversations, and settings in a local SQLite database; the desktop process owns filesystem, secret, and other privileged operations.

See the [architecture guide](docs/architecture.md) for the complete product and runtime design.

## Project structure

| Path              | Description                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `apps/desktop`    | Electron desktop app with the main process, preload bridge, React renderer, database, and runtime. |
| `apps/core`       | Host-agnostic core backend package with HTTP APIs, request validation, and runtime contracts.      |
| `apps/docs`       | Documentation site built with React Router and deployed to Cloudflare Workers.                     |
| `packages/assets` | Assets shared by the desktop app and documentation site.                                           |
| `docs`            | Architecture, component, and design documents.                                                     |
| `tests/desktop`   | Main-process and Electron backend tests for the desktop app.                                       |
| `tests/vite-plus` | Vite+ toolchain tests.                                                                             |

## Development

### Requirements

- Node.js `>=22.12.0`
- pnpm `11.6.0`
- The Vite+ CLI, available as `vp`

### Install dependencies

From the repository root:

```bash
vp install
```

### Run the desktop app

```bash
vp run dev:desktop
```

### Run the documentation site

```bash
vp run docs#dev
```

## Checks and tests

```bash
# Formatting, lint, and type-aware checks
vp check

# Root tests
vp test

# Desktop backend tests
vp run ayaka-desktop#test
```

You can also run the desktop test groups separately:

```bash
vp run ayaka-desktop#test:main
vp run ayaka-desktop#test:electron
```

## Build the desktop app

```bash
# Unpackaged build
vp run build:desktop

# Platform packages
vp run build:desktop:win
vp run build:desktop:mac
vp run build:desktop:linux
```

## Related documentation

- [Architecture guide](docs/architecture.md)
- [Changelog](CHANGELOG.md)
- [Core backend guide](apps/core/README.md)
- [Documentation site guide](apps/docs/README.md)
- [中文版 README](README.md)

## License

[MIT License](LICENSE)
