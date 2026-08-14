# Ayaka Docs

The documentation site is a React Router v8 SSR application deployed to Cloudflare Workers.

## Development

From the repository root:

```bash
vp run docs#dev
```

The application is available at `http://localhost:5173`.

## Type Generation and Checks

Generate Cloudflare Worker bindings and React Router route types:

```bash
vp run docs#cf-typegen
```

Run the full docs validation, including the Worker deployment dry run:

```bash
vp run docs#check
```

## Deployment

Authenticate Wrangler with a Cloudflare account, then deploy the Worker:

```bash
vp run docs#deploy
```

The Worker name and runtime settings are defined in `wrangler.jsonc`. Cloudflare bindings can be added there and accessed through `context.get(cloudflareContext)` in route loaders and actions.

## Production Preview

Build and preview the production assets locally:

```bash
vp run docs#preview
```
