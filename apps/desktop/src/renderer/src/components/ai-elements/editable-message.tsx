/**
 * AI Elements - EditableMessage 组件
 *
 * 设计目标：
 *  - 消息编辑态：把消息气泡替换为 textarea + 保存/取消
 *  - 支持键盘：Enter 保存，Shift+Enter 换行，Esc 取消
 *  - 不破坏原消息的"高度过渡"——通过 fade 切换
 *
 * 用法：
 *   <EditableMessage
 *     value={text}
 *     onChange={setText}
 *     onSave={() => commit()}
 *     onCancel={() => cancel()}
 *     isSaving={isSaving}
 *   />
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconCheck, IconClose } from "../icons";

interface EditableMessageProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** 保存按钮 loading 态 */
  isSaving?: boolean;
  /** 占位符 */
  placeholder?: string;
  className?: string;
}

export function EditableMessage({
  value,
  onChange,
  onSave,
  onCancel,
  isSaving = false,
  placeholder,
  className,
}: EditableMessageProps): React.JSX.Element {
  const { t } = useT();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const placeholderText = placeholder ?? t("msg.edit.placeholder");

  /** 进入编辑态：自动聚焦并把光标移到末尾 */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    const length = node.value.length;
    node.setSelectionRange(length, length);
    // 自适应高度
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Enter 不带 Shift 触发保存
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSaving && value.trim().length > 0) onSave();
    }
  };

  const canSave = value.trim().length > 0 && !isSaving;

  return (
    <div data-slot="editable-message" className={cn("flex w-full flex-col gap-1.5", className)}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          // 自适应高度
          const node = e.currentTarget;
          node.style.height = "auto";
          node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholderText}
        rows={1}
        className={cn(
          "w-full resize-none rounded-md border border-input bg-background px-4 py-2.5",
          "text-sm leading-relaxed text-foreground placeholder:text-muted-foreground",
          "focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/10",
        )}
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <IconClose className="size-3" />
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
            canSave
              ? "bg-primary/10 text-primary hover:bg-primary/15"
              : "bg-muted text-muted-foreground",
          )}
        >
          <IconCheck className="size-3" />
          {isSaving ? t("msg.edit.sending") : t("msg.edit.save")}
        </button>
      </div>
    </div>
  );
}
