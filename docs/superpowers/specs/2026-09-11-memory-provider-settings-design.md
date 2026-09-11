# Memory Provider Settings Design

## Summary

Ayaka's local Mem0 integration currently hard-codes the OpenAI provider, the
`gpt-5-mini` LLM, the `text-embedding-3-small` embedding model, and a 1536
dimension vector store. This prevents users who use an OpenAI-compatible
provider from using semantic memory even when that provider exposes both chat
completion and embedding endpoints.

This change adds two optional memory model settings in **Settings → General**:

- Memory LLM
- Memory Embedding

An empty setting means automatic selection. The two settings are independent,
so the LLM and embedding model may come from different providers. Provider API
keys remain in the main process and are never exposed through IPC or renderer
state.

## Goals

- Support the existing OpenAI provider and OpenAI-compatible providers for
  Mem0's LLM and embedding calls.
- Allow users to explicitly select separate LLM and embedding models.
- Select usable models automatically when either setting is empty or stale.
- Preserve SQLite memory records and lexical retrieval when semantic memory is
  not configured.
- Avoid creating repeated failing startup jobs when no usable memory
  configuration exists.
- Rehydrate the in-memory vector index after a memory configuration change.

## Non-goals

- Adding a new remote Mem0 Platform integration.
- Supporting Anthropic Messages or OpenAI Responses endpoints as Mem0 models;
  Mem0's selected adapter calls Chat Completions and Embeddings endpoints.
- Adding a new vector database or changing the SQLite memory schema.
- Adding renderer/page tests; desktop validation remains backend-only as
  required by the repository guide.

## Configuration and persistence

The existing key-value `settings` table is sufficient; no database migration
is needed. Add the following `SettingKey` values:

- `MemoryLlmModel`: `memory_llm_model`
- `MemoryEmbeddingModel`: `memory_embedding_model`

The values are model references in the existing `providerId/modelId` format.
An empty string is the persisted representation of automatic selection and is
exposed to the renderer as `null`, matching `selectedModel` behavior.

Extend `AppSettings`, `DEFAULT_SETTINGS`, `parseSettings`, the settings key
list, and the settings persistence function so these values are loaded,
updated, and retained across restarts. Appearance reset must not modify either
memory model setting.

## Provider resolution

Add a main-process-only resolver in the provider module. It returns an internal
memory model descriptor containing the provider ID, model ID, base URL, API
key, and Mem0-compatible endpoint information. The descriptor must never be
returned from IPC because it contains the decrypted API key.

Eligibility rules:

- The provider kind must be `openai` or `openai-compatible`.
- Custom providers must use the Chat Completions API format (or omit the
  format, which is treated as the default). Anthropic Messages and Responses
  formats are excluded from this Mem0 path.
- The model must be enabled and advertise `textGeneration` for the LLM role or
  `embedding` for the embedding role.
- A provider/model credential must resolve through the existing provider-level
  and model-level API-key fallback logic.

For the LLM setting, a valid manually selected model is preferred. Automatic
selection first tries the current chat model when it is eligible, then the
first eligible configured model in deterministic provider/catalog order.

For the embedding setting, a valid manually selected model is preferred.
Automatic selection first tries eligible embedding models from the effective
LLM provider, then eligible embedding models from all other providers in
deterministic order.

An invalid, disabled, unsupported, or uncredentialed manual reference is
treated as stale and falls back to automatic selection. The renderer should
not clear the stored reference merely because a credential is temporarily
missing; this allows the selection to become active again after the user adds
the key. The effective configuration can report that fallback occurred for
diagnostics without exposing secrets.

## Mem0 integration

Keep using `Memory` from `mem0ai/oss`. For both selected OpenAI-compatible
models, configure Mem0's native `openai` adapter with the resolved provider's
base URL, API key, and model ID:

```ts
llm: {
  provider: "openai",
  config: { apiKey, baseURL, model: llmModelId },
},
embedder: {
  provider: "openai",
  config: { apiKey, baseURL, model: embeddingModelId },
},
```

The Mem0 package uses the OpenAI SDK internally and supports a custom
`baseURL`, so the adapter name remains `openai` while the actual endpoint may
be an OpenAI-compatible service. Omit the fixed vector dimension and allow
Mem0 to probe the embedding endpoint. Keep the existing local vector store,
collection name, history database path, user ID, metadata, and `infer: false`
behavior.

The cached `Memory` instance must be invalidated whenever the effective LLM or
embedding reference, base URL, or credential changes. A private configuration
signature may be used for cache invalidation, but credentials must not appear
in logs, diagnostics, or renderer data.

## Worker and fallback behavior

Expose a main-process memory configuration change hook used after memory
settings, provider API keys, model API keys, model enablement, or relevant
provider catalog changes. The hook invalidates the Mem0 instance and queues a
single idempotent rehydrate job when a usable configuration exists.

At startup, the worker queues the rehydrate job only when the resolver can
produce both an eligible LLM and embedding configuration. If no configuration
exists, the worker continues to process SQLite-only learning, consolidation,
and decay without creating a failing rehydrate job.

If a configured endpoint later fails, the existing bounded retry behavior is
retained and the original provider error is recorded. If configuration is
absent, semantic retrieval returns `null` from the Mem0 service and the
orchestrator continues using SQLite lexical retrieval.

When a usable configuration becomes available, rehydration resets the
in-memory vector store and upserts all active SQLite memories, repairing the
records' `mem0_id` and `sync_status` values. Existing failed sync jobs do not
need to be individually resurrected because rehydration covers all active
records.

## Renderer behavior

Add a “Memory models” section to **Settings → General**, next to the existing
media and vision settings. It contains two localized select controls:

- Memory LLM: Auto plus available eligible LLM models.
- Memory Embedding: Auto plus available eligible embedding models.

Options use the existing provider/model labels and references. Only enabled,
credentialed, Mem0-compatible candidates are shown. If no candidate exists,
the control keeps Auto selected and displays a localized explanation that
semantic memory is unavailable while local memory remains usable.

The general settings component receives the existing `settings` and `update`
props. The model workbench remains responsible for provider/model management;
the memory controls only choose references and do not duplicate key management.
Add both Chinese and English strings to the existing i18n message table.

## Error handling and diagnostics

- Missing configuration is a normal disabled state, not a failed job.
- Stale manual selections fall back to automatic selection.
- Remote authentication, endpoint, model, and embedding-dimension failures
  remain actionable provider errors and are stored in the existing job/runtime
  diagnostics after bounded retries.
- No decrypted API key or full request configuration may be logged.

## Testing

Add focused main-process tests for:

- manual LLM and embedding selection;
- automatic selection of the current chat model and same-provider embedding;
- cross-provider embedding fallback;
- unsupported API formats, disabled models, and missing credentials;
- Mem0 config construction with provider base URLs and model IDs;
- cache invalidation after configuration changes;
- no rehydrate job when no usable configuration exists;
- rehydrate restoring active SQLite memories after configuration becomes
  available.

Use mocks for provider/database state and the Mem0 constructor; never use real
API keys or a real user-data directory. Run the focused tests first, followed
by `vp check`, `vp test`, `vp run ayaka-desktop#test`, and the relevant desktop
type checks.
