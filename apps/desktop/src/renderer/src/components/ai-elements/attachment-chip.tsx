/**
 * AI Elements - AttachmentChip 组件
 *
 * 设计目标：
 *  - 渲染"待发送附件"的小型 chip（缩略图 + 文件名 + 大小 + 移除）
 *  - 支持图片（inline 预览）和其他文件类型（icon 占位）
 *  - 与 ai-sdk 的 FileUIPart 兼容（不直接依赖 ai-sdk，便于独立使用）
 *
 * 数据流：
 *  - 父组件持有 attachment 列表（含 id, file, mediaType, name, size）
 *  - 父组件传入 onRemove 回调
 *  - 点击 X 时调用 onRemove
 *
 * 设计要点：
 *  - 体积超过 1MB 时显示为 MB，否则显示 KB
 *  - 图片通过 URL.createObjectURL 生成预览（useEffect 中 revoke 避免内存泄漏）
 *  - 文件大小按 1024 进制（符合开发直觉）
 */
import { useEffect, useMemo, useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconClose } from "../icons";

/** 通用附件描述符（与 ai-sdk 的 FileUIPart 兼容字段） */
export interface AttachmentItem {
  /** 唯一 ID（用于 React key 与移除回调） */
  id: string;
  /** 原始 File 对象（可选；展示模式下可省略） */
  file?: File;
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  mediaType: string;
  /** 字节大小 */
  size: number;
  /** 远程 URL（dataURL 也存这里，与 ai-sdk FileUIPart.url 协议一致） */
  url?: string;
  /** 显式覆盖类型（默认根据 mediaType 推断） */
  variant?: "image" | "file" | "audio" | "video";
}

interface AttachmentChipProps extends Omit<HTMLAttributes<HTMLDivElement>, "onRemove"> {
  item: AttachmentItem;
  /** 移除按钮回调；不传则不显示移除按钮 */
  onRemove?: (id: string) => void;
  /** 紧凑模式：用于侧边栏 / 已发送消息 */
  compact?: boolean;
}

/**
 * 单个附件 chip
 *
 * 示例：
 *   <AttachmentChip item={a} onRemove={(id) => setList(list.filter(x => x.id !== id))} />
 */
export function AttachmentChip({
  item,
  onRemove,
  compact = false,
  className,
  ...rest
}: AttachmentChipProps): React.JSX.Element {
  const { t, f } = useT();
  /** 媒体分类（image / video / audio / file），与 ai-elements attachments 思路一致 */
  const category = useMemo<"image" | "video" | "audio" | "file">(() => {
    if (item.variant) return item.variant;
    if (item.mediaType.startsWith("image/")) return "image";
    if (item.mediaType.startsWith("video/")) return "video";
    if (item.mediaType.startsWith("audio/")) return "audio";
    return "file";
  }, [item.mediaType, item.variant]);

  // 图片本地预览：通过 ObjectURL，组件卸载时 revoke
  const [previewUrl, setPreviewUrl] = useState<string | null>(item.url ?? null);
  useEffect(() => {
    if (item.url) {
      setPreviewUrl(item.url);
      return;
    }
    if (category === "image" && item.file) {
      const url = URL.createObjectURL(item.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
    return;
  }, [category, item.file, item.url]);

  return (
    <div
      data-slot="attachment-chip"
      data-category={category}
      className={cn(
        "group relative flex items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/40 text-xs",
        compact ? "h-8 pl-1.5 pr-2" : "h-12 pl-1.5 pr-2",
        className,
      )}
      {...rest}
    >
      {/* 缩略图 / 类型 icon */}
      <div
        className={cn(
          "shrink-0 overflow-hidden rounded-lg bg-muted",
          compact ? "size-6" : "size-9",
        )}
      >
        {category === "image" && previewUrl ? (
          <img
            src={previewUrl}
            alt={item.name}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <CategoryGlyph category={category} compact={compact} />
        )}
      </div>

      {/* 文件名 + 大小 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground" title={item.name}>
          {item.name}
        </span>
        {!compact && (
          <span className="truncate text-[10px] text-muted-foreground">{f.bytes(item.size)}</span>
        )}
      </div>

      {/* 移除按钮 */}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={t("attachment.remove", { name: item.name })}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition",
            "hover:bg-muted hover:text-foreground",
            compact ? "size-5" : "size-6",
          )}
        >
          <IconClose className="size-3" />
        </button>
      )}
    </div>
  );
}

/** 类型 icon 占位（非图片类型） */
function CategoryGlyph({
  category,
  compact,
}: {
  category: "image" | "video" | "audio" | "file";
  compact: boolean;
}): React.JSX.Element {
  const size = compact ? 12 : 18;
  // 简化 SVG：基于 emoji/字符绘制
  if (category === "video") {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zm14 2.5l4-2.5v12l-4-2.5v-7z" />
        </svg>
      </div>
    );
  }
  if (category === "audio") {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    );
  }
  // file (default)
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    </div>
  );
}
