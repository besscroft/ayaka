/**
 * AI Elements - PromptInput 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/prompt-input
 *
 * 简化实现：
 *  - 原版封装了 attachments / command menu / 多 select 等复杂功能
 *  - 本项目只用到：受控 textarea + 提交按钮
 *  - 因此只暴露最小子集：PromptInput / PromptInputTextarea / PromptInputSubmit
 *  - onSubmit 回调签名与 AI Elements 一致：({ text, files }) => void
 *
 * 数据流（与 AI Elements 兼容）：
 *  <PromptInput onSubmit={({ text }) => send({ text })}>
 *    <PromptInputTextarea value={input} onChange={...} />
 *    <PromptInputSubmit status={isStreaming ? "streaming" : "ready"} />
 *  </PromptInput>
 */
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type FormHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconArrowUp, IconDots } from "../icons";

export interface PromptInputMessage {
  text: string;
  files: File[]; // 本项目暂未启用文件附件
}

type SubmitStatus = "submitted" | "streaming" | "ready" | "error";

interface PromptInputContextValue {
  /** 当前文本 */
  value: string;
  setValue: (next: string) => void;
  /** 提交回调：组件负责把 form 提交聚合成 { text, files } */
  onSubmit: (message: PromptInputMessage) => void;
  /** 当前是否在生成中（用于 disable submit / 改图标） */
  status: SubmitStatus;
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInputContext(): PromptInputContextValue {
  const ctx = useContext(PromptInputContext);
  if (!ctx) throw new Error("PromptInput components must be used inside <PromptInput>");
  return ctx;
}

interface PromptInputProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  /**
   * 提交回调。组件本身不维护 status，调用方根据 useChat 的 status 传入。
   */
  onSubmit: (message: PromptInputMessage) => void;
  value?: string;
  status?: SubmitStatus;
  children?: ReactNode;
}

/**
 * 受控 / 非受控都可：若子组件 <PromptInputTextarea value onChange> 则为受控；
 * 若省略，则组件内部维护 value 状态。
 */
export function PromptInput({
  onSubmit,
  value: controlledValue,
  status = "ready",
  className,
  children,
  ...rest
}: PromptInputProps): React.JSX.Element {
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const valueRef = useRef(value);
  // 保留最新值给 onSubmit 引用（避免 stale closure）
  valueRef.current = value;

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const text = valueRef.current.trim();
    if (status === "streaming" || status === "submitted") return;
    onSubmit({ text, files: [] });
    setInternalValue("");
  };

  return (
    <PromptInputContext.Provider value={{ value, setValue: setInternalValue, onSubmit, status }}>
      <form
        data-slot="prompt-input"
        className={cn("relative w-full", className)}
        onSubmit={handleSubmit}
        {...rest}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

interface PromptInputTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

/**
 * 文本输入：自动随内容撑高（最大 152px），Enter 发送 / Shift+Enter 换行
 *
 * 通过 forwardRef 暴露底层 textarea，父组件可以：
 *  - 读取光标位置（在 emoji 选区中精确插入）
 *  - 主动聚焦 / 失焦
 */
export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea(
    {
      value: controlledValue,
      onChange: controlledOnChange,
      className,
      onKeyDown,
      disabled,
      ...rest
    },
    forwardedRef,
  ): React.JSX.Element {
    const ctx = usePromptInputContext();
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const value = controlledValue ?? ctx.value;
    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
      // 始终同步到 context，否则 PromptInput 的 submit 拿不到值（受控时 internalValue 不会被更新）
      ctx.setValue(e.currentTarget.value);
      controlledOnChange?.(e);
    };

    // 自动撑高
    useEffect(() => {
      const textarea = ref.current;
      if (!textarea) return;
      textarea.style.height = "0px";
      const maxHeight = 152;
      const next = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${Math.max(next, 64)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [value]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        // 触发 form 提交：模拟 form.requestSubmit
        (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
      }
    };

    // 合并 forwardedRef 与本地 ref
    const setRefs = (node: HTMLTextAreaElement | null): void => {
      ref.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };

    return (
      <textarea
        ref={setRefs}
        data-slot="prompt-input-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        className={cn(
          "block w-full max-h-[152px] min-h-16 resize-none overflow-hidden bg-transparent",
          "text-[15px] leading-6 text-foreground outline-none",
          "placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-70",
          className,
        )}
        {...rest}
      />
    );
  },
);

interface PromptInputSubmitProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  status?: SubmitStatus;
  children?: ReactNode;
}

/**
 * 提交按钮
 * - status="streaming" 或 "submitted" 时显示加载图标、disabled
 * - status="ready" 时显示箭头
 */
export function PromptInputSubmit({
  status: statusProp,
  className,
  children,
  disabled,
  ...rest
}: PromptInputSubmitProps): React.JSX.Element {
  const { t } = useT();
  const ctx = usePromptInputContext();
  const status = statusProp ?? ctx.status;
  const isLoading = status === "streaming" || status === "submitted";
  // 当父组件未传 disabled 时，按文本是否为空自动判断
  const computedDisabled = disabled ?? (isLoading || ctx.value.trim().length === 0);

  return (
    <button
      type="submit"
      data-slot="prompt-input-submit"
      data-icon-only="true"
      data-icon-tone={computedDisabled ? "disabled" : isLoading ? "danger" : "primary"}
      data-status={status}
      disabled={computedDisabled}
      aria-label={rest["aria-label"] ?? (isLoading ? t("input.stop") : t("input.send"))}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md",
        "border border-transparent transition",
        computedDisabled
          ? "bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        className,
      )}
      {...rest}
    >
      {isLoading ? (
        <IconDots className="size-3.5 animate-pulse" />
      ) : (
        <IconArrowUp className="size-4" />
      )}
      {children}
    </button>
  );
}
