import { type ReactNode } from "react";
import {
  asRecord,
  getToolPartName,
  normalizeMemoryResults,
  normalizeSandboxArtifacts,
  normalizeSandboxCommand,
  normalizeWebOpenResult,
  normalizeWebSearchResult,
  readArray,
  readBoolean,
  readNumber,
  readString,
  safeJsonStringify,
  sanitizeToolUrl,
  truncateText,
  type RenderableToolPart,
} from "../lib/generated-tool-ui";
import { useT } from "../lib/i18n";
import {
  IconBookOpen,
  IconCheck,
  IconClock,
  IconDatabase,
  IconGlobe,
  IconLink,
  IconSearch,
  IconWrench,
} from "./icons";
import { RichContent } from "./ai-elements";

interface GeneratedToolResultProps {
  part: RenderableToolPart;
}

export function GeneratedToolResult({ part }: GeneratedToolResultProps): React.JSX.Element | null {
  const toolName = getToolPartName(part);
  if (!toolName || part.output === undefined) return null;

  switch (toolName) {
    case "web_search":
      return <WebSearchResult output={part.output} />;
    case "web_open":
      return <WebOpenResult output={part.output} />;
    case "memory_search":
      return <MemorySearchResult output={part.output} />;
    case "memory_save":
    case "memory_update":
    case "memory_delete":
      return <MemoryMutationResult toolName={toolName} output={part.output} />;
    case "cron":
      return <AutomationResult output={part.output} />;
    case "sandbox_list_files":
      return <SandboxFilesResult output={part.output} />;
    case "sandbox_read_file":
      return <SandboxFileResult output={part.output} />;
    case "sandbox_write_file":
      return <SandboxWriteResult output={part.output} />;
    case "sandbox_run_command":
      return <SandboxCommandResult output={part.output} />;
    case "sandbox_snapshot":
    case "sandbox_restore":
      return <SandboxSnapshotResult toolName={toolName} output={part.output} />;
    case "sandbox_list_artifacts":
      return <SandboxArtifactsResult output={part.output} />;
    case "sandbox_preview_port":
      return <SandboxPreviewResult output={part.output} />;
    case "current_time":
      return <CurrentTimeResult output={part.output} />;
    case "runtime_snapshot":
      return <RuntimeSnapshotResult output={part.output} />;
    case "model_capabilities":
      return <ModelCapabilitiesResult output={part.output} />;
    case "conversation_search":
      return <ConversationSearchResult output={part.output} />;
    case "file_search":
    case "code_interpreter":
    case "tool_search":
      return <ProviderResult toolName={toolName} output={part.output} />;
    default:
      return null;
  }
}

function WebSearchResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const normalized = normalizeWebSearchResult(output);
  return (
    <ResultStack>
      {normalized.query ? <ResultLabel icon={<IconSearch />} text={normalized.query} /> : null}
      {normalized.results.length === 0 ? (
        <EmptyResult />
      ) : (
        <div className="flex flex-col gap-2">
          {normalized.results.map((result) => (
            <div key={result.url} className="min-w-0">
              <SafeLink href={result.url}>
                <span className="truncate">{result.title}</span>
                <IconLink className="size-3 shrink-0" />
              </SafeLink>
              {result.snippet ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground/55">
                  {result.snippet}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {normalized.results.length > 0 ? (
        <p className="text-[10px] text-foreground/40">
          {t("tool.generated.sources", { count: normalized.results.length })}
        </p>
      ) : null}
    </ResultStack>
  );
}

function WebOpenResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const normalized = normalizeWebOpenResult(output);
  if (!normalized) return <FallbackResult output={output} />;
  return (
    <ResultStack>
      <SafeLink href={normalized.finalUrl}>
        <span className="truncate font-medium">{normalized.title}</span>
        <IconLink className="size-3 shrink-0" />
      </SafeLink>
      {normalized.description ? (
        <p className="text-[11px] leading-relaxed text-foreground/60">{normalized.description}</p>
      ) : null}
      <div className="max-h-64 overflow-y-auto rounded-md bg-muted px-2.5 py-2">
        <RichContent value={truncateText(normalized.text, 16_000)} className="gap-2 text-[11px]" />
      </div>
      {normalized.truncated ? (
        <p className="text-[10px] text-foreground/45">{t("tool.generated.truncated")}</p>
      ) : null}
    </ResultStack>
  );
}

function MemorySearchResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const normalized = normalizeMemoryResults(output);
  return (
    <ResultStack>
      {normalized.query ? <ResultLabel icon={<IconDatabase />} text={normalized.query} /> : null}
      {normalized.results.length === 0 ? (
        <EmptyResult />
      ) : (
        <div className="flex flex-col gap-2">
          {normalized.results.map((memory) => (
            <div key={memory.id} className="min-w-0 border-l-2 border-accent/40 pl-2">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
                  {memory.title}
                </p>
                {memory.pinned ? (
                  <span className="text-[10px] text-primary">{t("tool.generated.pinned")}</span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/60">
                {memory.content}
              </p>
              {memory.scope || memory.kind || memory.salience !== undefined ? (
                <p className="mt-1 text-[10px] text-foreground/40">
                  {[
                    memory.scope,
                    memory.kind,
                    memory.salience !== undefined ? `${memory.salience}` : null,
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-foreground/40">
        {t("tool.generated.memories", { count: normalized.results.length })}
      </p>
    </ResultStack>
  );
}

function MemoryMutationResult({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const title = readString(record?.title);
  const id = readString(record?.id);
  const key =
    toolName === "memory_save"
      ? "tool.generated.memorySaved"
      : toolName === "memory_update"
        ? "tool.generated.memoryUpdated"
        : "tool.generated.memoryDeleted";
  return (
    <ResultStack>
      <ResultLabel icon={<IconCheck />} text={t(key)} />
      {title ? <p className="truncate text-xs text-foreground/70">{title}</p> : null}
      {id ? <p className="truncate font-mono text-[10px] text-foreground/40">{id}</p> : null}
    </ResultStack>
  );
}

function AutomationResult({ output }: { output: unknown }): React.JSX.Element {
  const { t, f } = useT();
  const jobs = readArray(output);
  const records = jobs.length > 0 ? jobs : [output];
  return (
    <ResultStack>
      {records.map((value, index) => {
        const record = asRecord(value);
        if (!record) return <FallbackResult key={index} output={value} />;
        const name = readString(record.name) ?? t("tool.generated.automationItem");
        const status = readString(record.status);
        const nextRunAt = readNumber(record.nextRunAt) ?? readNumber(record.next_run_at);
        const description = readString(record.description);
        return (
          <div key={readString(record.id) ?? index} className="flex flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <IconClock className="size-3 shrink-0 text-foreground/50" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
                {name}
              </span>
              {status ? <StatusText value={status} /> : null}
            </div>
            {description ? <p className="text-[11px] text-foreground/55">{description}</p> : null}
            {nextRunAt ? (
              <p className="text-[10px] text-foreground/45">
                {t("tool.generated.nextRun", { value: f.dateTime(nextRunAt) })}
              </p>
            ) : null}
          </div>
        );
      })}
    </ResultStack>
  );
}

function SandboxFilesResult({ output }: { output: unknown }): React.JSX.Element {
  const { t, f } = useT();
  const record = asRecord(output);
  const entries = readArray(record?.entries);
  const rootPath = readString(record?.path);
  if (entries.length === 0) return <EmptyResult />;
  return (
    <ResultStack>
      {rootPath ? <ResultLabel icon={<IconBookOpen />} text={rootPath} /> : null}
      <div className="flex flex-col gap-1">
        {entries.slice(0, 50).map((value, index) => {
          const entry = asRecord(value);
          const path =
            readString(entry?.path) ??
            readString(entry?.name) ??
            t("tool.generated.entry", { index: index + 1 });
          const kind = readString(entry?.kind);
          const size = readNumber(entry?.size);
          return (
            <div key={path} className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/70">{path}</span>
              <span className="shrink-0 text-foreground/40">
                {kind ?? t("tool.generated.fileKind")}
              </span>
              {size !== undefined ? (
                <span className="shrink-0 text-foreground/40">{f.bytes(size)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      {entries.length > 50 ? (
        <p className="text-[10px] text-foreground/40">{t("tool.generated.truncated")}</p>
      ) : null}
    </ResultStack>
  );
}

function SandboxFileResult({ output }: { output: unknown }): React.JSX.Element {
  const { t, f } = useT();
  const record = asRecord(output);
  const path = readString(record?.path);
  const text = readString(record?.text);
  const truncated = readBoolean(record?.truncated);
  const bytes = readNumber(record?.bytes);
  if (!path || text === undefined) return <FallbackResult output={output} />;
  return (
    <ResultStack>
      <ResultLabel icon={<IconBookOpen />} text={path} />
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground/75">
        {truncateText(text, 16_000)}
      </pre>
      {truncated ? (
        <p className="text-[10px] text-foreground/45">{t("tool.generated.truncated")}</p>
      ) : null}
      {bytes !== undefined ? (
        <p className="text-[10px] text-foreground/40">{f.bytes(bytes)}</p>
      ) : null}
    </ResultStack>
  );
}

function SandboxWriteResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const path = readString(record?.path);
  const mode = readString(record?.mode);
  return (
    <ResultStack>
      <ResultLabel icon={<IconCheck />} text={t("tool.generated.fileWritten")} />
      {path ? <p className="font-mono text-[11px] text-foreground/65">{path}</p> : null}
      {mode ? <StatusText value={mode} /> : null}
    </ResultStack>
  );
}

function SandboxCommandResult({ output }: { output: unknown }): React.JSX.Element {
  const { t, f } = useT();
  const result = normalizeSandboxCommand(output);
  if (!result) return <FallbackResult output={output} />;
  const command = [result.command, ...result.args].join(" ");
  const log = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return (
    <ResultStack>
      <div className="flex min-w-0 items-center gap-2">
        <IconWrench className="size-3 shrink-0 text-foreground/50" />
        <code className="min-w-0 flex-1 truncate text-[11px] text-foreground/75">$ {command}</code>
        {result.exitCode !== undefined && result.exitCode !== null ? (
          <StatusText
            value={
              result.exitCode === 0
                ? t("tool.generated.passed")
                : t("tool.generated.exitCode", { code: result.exitCode })
            }
          />
        ) : null}
      </div>
      {result.cwd ? <p className="font-mono text-[10px] text-foreground/40">{result.cwd}</p> : null}
      {log ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground/75">
          {log}
        </pre>
      ) : null}
      {result.durationMs !== undefined ? (
        <p className="text-[10px] text-foreground/40">
          {t("tool.generated.duration", { value: f.fixed(result.durationMs / 1000, 1) })}
        </p>
      ) : null}
      {result.timedOut ? (
        <p className="text-[10px] text-danger">{t("tool.generated.timedOut")}</p>
      ) : null}
    </ResultStack>
  );
}

function SandboxSnapshotResult({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const restored = readNumber(record?.restored);
  const label = readString(record?.label);
  return (
    <ResultStack>
      <ResultLabel
        icon={<IconCheck />}
        text={
          toolName === "sandbox_restore"
            ? t("tool.generated.restored")
            : t("tool.generated.snapshotCreated")
        }
      />
      {label ? <p className="text-xs text-foreground/70">{label}</p> : null}
      {restored !== undefined ? (
        <p className="text-[10px] text-foreground/45">
          {t("tool.generated.restoredCount", { count: restored })}
        </p>
      ) : null}
    </ResultStack>
  );
}

function SandboxArtifactsResult({ output }: { output: unknown }): React.JSX.Element {
  const { t, f } = useT();
  const artifacts = normalizeSandboxArtifacts(output);
  if (artifacts.length === 0) return <EmptyResult />;
  return (
    <ResultStack>
      {artifacts.map((artifact) => (
        <div key={artifact.id ?? artifact.path} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/70">
            {artifact.path}
          </span>
          {artifact.sizeBytes !== undefined ? (
            <span className="shrink-0 text-[10px] text-foreground/40">
              {f.bytes(artifact.sizeBytes)}
            </span>
          ) : null}
          {artifact.url ? (
            <SafeLink href={artifact.url} compact>
              <IconLink className="size-3" />
              <span>{t("tool.generated.open")}</span>
            </SafeLink>
          ) : null}
        </div>
      ))}
    </ResultStack>
  );
}

function SandboxPreviewResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const url = sanitizeToolUrl(readString(record?.url));
  return (
    <ResultStack>
      {url ? (
        <SafeLink href={url}>
          <IconLink className="size-3" />
          <span className="truncate">{readString(record?.path) ?? url}</span>
        </SafeLink>
      ) : (
        <ResultLabel icon={<IconGlobe />} text={t("tool.generated.previewRegistered")} />
      )}
    </ResultStack>
  );
}

function CurrentTimeResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const localDateTime = readString(record?.localDateTime);
  const timeZone = readString(record?.timeZone);
  return (
    <ResultStack>
      <ResultLabel icon={<IconClock />} text={localDateTime ?? t("tool.generated.timeValue")} />
      {timeZone ? <p className="text-[10px] text-foreground/45">{timeZone}</p> : null}
    </ResultStack>
  );
}

function RuntimeSnapshotResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const agents = asRecord(record?.agents);
  const memories = asRecord(record?.memories);
  const runs = readArray(record?.agentRuns).length;
  return (
    <ResultStack>
      <ResultLabel icon={<IconDatabase />} text={t("tool.generated.runtimeSnapshot")} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-foreground/60">
        <span>
          {t("tool.generated.agents")}: {readNumber(agents?.total) ?? 0}
        </span>
        <span>
          {t("tool.generated.memoriesLabel")}: {readNumber(memories?.total) ?? 0}
        </span>
        <span>
          {t("tool.generated.running")}: {readNumber(agents?.active) ?? 0}
        </span>
        <span>
          {t("tool.generated.runs")}: {runs}
        </span>
      </div>
    </ResultStack>
  );
}

function ModelCapabilitiesResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const capabilities = asRecord(record?.capabilities);
  const enabled = Object.entries(capabilities ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .slice(0, 8);
  return (
    <ResultStack>
      <ResultLabel
        icon={<IconWrench />}
        text={readString(record?.modelId) ?? t("tool.generated.modelValue")}
      />
      {enabled.length > 0 ? (
        <p className="text-[11px] text-foreground/55">{enabled.join(" / ")}</p>
      ) : null}
    </ResultStack>
  );
}

function ConversationSearchResult({ output }: { output: unknown }): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const results = readArray(record?.results);
  if (results.length === 0) return <EmptyResult />;
  return (
    <ResultStack>
      {results.slice(0, 12).map((value, index) => {
        const item = asRecord(value);
        const text = readString(item?.text) ?? safeJsonStringify(value);
        const role = readString(item?.role);
        return (
          <div key={readString(item?.id) ?? index} className="border-l-2 border-border pl-2">
            <p className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/65">
              {text}
            </p>
            {role ? <span className="text-[10px] text-foreground/40">{role}</span> : null}
          </div>
        );
      })}
      <p className="text-[10px] text-foreground/40">
        {t("tool.generated.matches", { count: results.length })}
      </p>
    </ResultStack>
  );
}

function ProviderResult({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}): React.JSX.Element {
  const { t } = useT();
  const record = asRecord(output);
  const items = readArray(record?.results ?? record?.items ?? output);
  const text = readString(record?.text) ?? readString(record?.output) ?? readString(record?.stdout);
  return (
    <ResultStack>
      <ResultLabel
        icon={<IconWrench />}
        text={t("tool.generated.providerOutput", { tool: toolName })}
      />
      {text ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground/75">
          {truncateText(text, 12_000)}
        </pre>
      ) : items.length > 0 ? (
        <div className="flex flex-col gap-1 text-[11px] text-foreground/65">
          {items.slice(0, 12).map((item, index) => (
            <p key={index} className="line-clamp-3 whitespace-pre-wrap">
              {readString(asRecord(item)?.title) ??
                readString(asRecord(item)?.text) ??
                safeJsonStringify(item)}
            </p>
          ))}
        </div>
      ) : (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/70">
          {safeJsonStringify(output)}
        </pre>
      )}
    </ResultStack>
  );
}

function ResultStack({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function ResultLabel({ icon, text }: { icon: ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/60">
      <span className="shrink-0 text-foreground/50">{icon}</span>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

function StatusText({ value }: { value: string }): React.JSX.Element {
  return <span className="shrink-0 text-[10px] text-foreground/45">{value}</span>;
}

function SafeLink({
  href,
  children,
  compact = false,
}: {
  href: string;
  children: ReactNode;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={
        compact
          ? "inline-flex min-w-0 items-center gap-1 text-[10px] text-primary hover:underline"
          : "inline-flex min-w-0 items-center gap-1 text-[11px] text-primary hover:underline"
      }
    >
      {children}
    </a>
  );
}

function EmptyResult(): React.JSX.Element {
  const { t } = useT();
  return <p className="text-[11px] text-foreground/45">{t("tool.generated.noResults")}</p>;
}

function FallbackResult({ output }: { output: unknown }): React.JSX.Element {
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/75">
      {safeJsonStringify(output)}
    </pre>
  );
}
