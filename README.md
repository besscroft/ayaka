# Ayaka

A local-first AI desktop workspace built with Electron, React, AI SDK, Hono, SQLite, Drizzle and shadcn/base-ui.

Ayaka is being shaped as more than a chat client. The desktop app now has first-class surfaces for Agents, Agent Loop runtime, Harness, Memory, Server, interaction profiles and sync state. It can run locally without a self-hosted cloud server, while leaving a clear path for optional encrypted sync and a future Web client.

See [docs/architecture.md](docs/architecture.md) for the full product and technical design.

## Development

```bash
vp install
vp run dev:desktop
```

## Validation

```bash
vp check
vp test
```

## Desktop builds

```bash
vp run build:desktop
vp run build:desktop:win
vp run build:desktop:mac
vp run build:desktop:linux
```
