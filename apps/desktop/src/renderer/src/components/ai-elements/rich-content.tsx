import { Fragment, createElement, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { IconSparkles } from "../icons";
import {
  getMediaKindFromUrl,
  parseRichContentBlocks,
  sanitizeRichContentUrl,
  type MediaKind,
  type RichContentBlock,
} from "./rich-content-utils";

interface RichContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  skillMentions?: readonly RichContentSkillMention[];
}

export interface RichContentSkillMention {
  id: string;
  name: string;
}

const BLOCKED_HTML_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "meta",
  "link",
  "svg",
  "math",
  "canvas",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
]);

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "abbr",
  "audio",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);
const VOID_HTML_TAGS = new Set(["br", "hr", "img", "source"]);

export function RichContent({
  value,
  skillMentions = [],
  className,
  ...rest
}: RichContentProps): React.JSX.Element {
  const blocks = parseRichContentBlocks(value);
  const skillMentionById = new Map(skillMentions.map((skill) => [skill.id, skill]));

  return (
    <div
      data-slot="rich-content"
      className={cn("rich-content flex min-w-0 flex-col gap-3 break-words", className)}
      {...rest}
    >
      {blocks.map((block, index) => renderBlock(block, `block-${index}`, skillMentionById))}
    </div>
  );
}

function renderBlock(
  block: RichContentBlock,
  key: string,
  skillMentionById: ReadonlyMap<string, RichContentSkillMention>,
): ReactNode {
  switch (block.type) {
    case "paragraph": {
      const mediaUrl = getStandaloneMediaUrl(block.text);
      if (mediaUrl) return <MediaEmbed key={key} url={mediaUrl} alt="" />;
      return (
        <p key={key} className="m-0 leading-7">
          {renderInlineMarkdown(block.text, key, skillMentionById)}
        </p>
      );
    }
    case "heading": {
      const Tag = `h${block.depth}` as "h1" | "h2" | "h3" | "h4";
      return (
        <Tag key={key} className={headingClass(block.depth)}>
          {renderInlineMarkdown(block.text, key, skillMentionById)}
        </Tag>
      );
    }
    case "code":
      return (
        <div
          data-slot="rich-content-code"
          key={key}
          className="overflow-hidden rounded-lg border border-border"
        >
          {block.lang ? (
            <div className="border-b border-border bg-muted px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {block.lang}
            </div>
          ) : null}
          <pre className="m-0 max-w-full overflow-x-auto bg-muted/50 p-3 text-[12px] leading-6">
            <code className="bg-transparent p-0 font-mono font-normal">{block.code}</code>
          </pre>
        </div>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="m-0 border-l-2 border-primary/60 pl-3 text-muted-foreground"
        >
          {block.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={`${key}-q-${index}`} className={cn("m-0", index > 0 && "mt-2")}>
              {renderInlineMarkdown(paragraph, `${key}-q-${index}`, skillMentionById)}
            </p>
          ))}
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={cn(
            "m-0 flex flex-col gap-1 pl-5 leading-7",
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item, index) => (
            <li key={`${key}-item-${index}`} className="pl-1">
              {item.checked !== undefined ? (
                <span className="-ml-5 mr-2 inline-flex size-4 translate-y-0.5 items-center justify-center rounded border border-border bg-muted text-[10px]">
                  {item.checked ? "✓" : ""}
                </span>
              ) : null}
              {renderInlineMarkdown(item.text, `${key}-item-${index}`, skillMentionById)}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div
          data-slot="rich-content-table"
          key={key}
          className="max-w-full overflow-x-auto rounded-lg border border-border"
        >
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {block.headers.map((header, index) => (
                  <th
                    key={`${key}-th-${index}`}
                    className="border-b border-border px-3 py-2 font-semibold"
                  >
                    {renderInlineMarkdown(header, `${key}-th-${index}`, skillMentionById)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-tr-${rowIndex}`} className="border-t border-border">
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-td-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
                      {renderInlineMarkdown(
                        cell,
                        `${key}-td-${rowIndex}-${cellIndex}`,
                        skillMentionById,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "html":
      return <SafeHtml key={key} html={block.html} />;
    case "hr":
      return <hr key={key} className="my-1 border-border" />;
  }
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  skillMentionById: ReadonlyMap<string, RichContentSkillMention>,
): ReactNode[] {
  if (containsHtmlTag(text)) return [<SafeHtml key={`${keyPrefix}-html`} html={text} inline />];

  const nodes: ReactNode[] = [];
  const pattern =
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<>)]+|mailto:[^\s<>)]+)|(?<!\S)\/skill:([A-Za-z0-9_.-]+)(?!\S)/g;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(
        ...renderTextWithBreaks(text.slice(lastIndex, index), `${keyPrefix}-t-${matchIndex}`),
      );
    }

    if (match[1] !== undefined) {
      nodes.push(
        <MediaEmbed
          key={`${keyPrefix}-img-${matchIndex}`}
          url={match[2]}
          alt={match[1]}
          title={match[3]}
          fallbackKind="image"
        />,
      );
    } else if (match[4] !== undefined) {
      const href = sanitizeRichContentUrl(match[5], "link");
      nodes.push(
        href ? (
          <a
            data-slot="rich-content-link"
            key={`${keyPrefix}-a-${matchIndex}`}
            href={href}
            title={match[6]}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-link underline decoration-link/35 underline-offset-3 hover:decoration-link"
          >
            {renderInlineMarkdown(match[4], `${keyPrefix}-a-${matchIndex}`, skillMentionById)}
          </a>
        ) : (
          <span key={`${keyPrefix}-bad-a-${matchIndex}`}>{match[4]}</span>
        ),
      );
    } else if (match[7] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-code-${matchIndex}`} className="font-mono">
          {match[7]}
        </code>,
      );
    } else if (match[8] !== undefined || match[9] !== undefined) {
      const value = match[8] ?? match[9] ?? "";
      nodes.push(
        <strong key={`${keyPrefix}-strong-${matchIndex}`} className="font-semibold">
          {renderInlineMarkdown(value, `${keyPrefix}-strong-${matchIndex}`, skillMentionById)}
        </strong>,
      );
    } else if (match[10] !== undefined) {
      nodes.push(
        <del key={`${keyPrefix}-del-${matchIndex}`} className="text-foreground/60">
          {renderInlineMarkdown(match[10], `${keyPrefix}-del-${matchIndex}`, skillMentionById)}
        </del>,
      );
    } else if (match[11] !== undefined || match[12] !== undefined) {
      const value = match[11] ?? match[12] ?? "";
      nodes.push(
        <em key={`${keyPrefix}-em-${matchIndex}`}>
          {renderInlineMarkdown(value, `${keyPrefix}-em-${matchIndex}`, skillMentionById)}
        </em>,
      );
    } else if (match[13] !== undefined) {
      const href = sanitizeRichContentUrl(match[13], "link");
      const mediaKind = getMediaKindFromUrl(match[13]);
      nodes.push(
        mediaKind ? (
          <MediaEmbed key={`${keyPrefix}-media-url-${matchIndex}`} url={match[13]} alt="" />
        ) : href ? (
          <a
            key={`${keyPrefix}-url-${matchIndex}`}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-link underline decoration-link/35 underline-offset-3 hover:decoration-link"
          >
            {match[13]}
          </a>
        ) : (
          match[13]
        ),
      );
    } else if (match[14] !== undefined) {
      const skillId = match[14];
      const skill = skillMentionById.get(skillId);
      nodes.push(
        <span
          key={`${keyPrefix}-skill-${matchIndex}`}
          data-slot="skill-mention"
          data-skill-id={skillId}
          title={`/skill:${skillId}`}
          aria-label={skill?.name ?? skillId}
          className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-current/20 bg-current/10 px-2 py-0.5 align-baseline text-[0.9em] font-medium text-current"
        >
          <IconSparkles className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{skill?.name ?? skillId}</span>
        </span>,
      );
    }

    lastIndex = index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderTextWithBreaks(text.slice(lastIndex), `${keyPrefix}-t-end`));
  }

  return nodes;
}

function renderTextWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split("\n");
  return parts.flatMap((part, index) => {
    const nodes: ReactNode[] = [];
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    if (part) nodes.push(<Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>);
    return nodes;
  });
}

function SafeHtml({ html, inline = false }: { html: string; inline?: boolean }): React.JSX.Element {
  if (typeof DOMParser === "undefined") {
    return inline ? <>{html}</> : <p className="m-0 leading-7">{html}</p>;
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const children = renderDomChildren(doc.body.childNodes, "html");
  return inline ? <>{children}</> : <div className="flex min-w-0 flex-col gap-3">{children}</div>;
}

function renderDomChildren(nodes: NodeListOf<ChildNode>, keyPrefix: string): ReactNode[] {
  return Array.from(nodes)
    .map((node, index) => renderDomNode(node, `${keyPrefix}-${index}`))
    .filter((node): node is ReactNode => node !== null && node !== undefined);
}

function renderDomNode(node: ChildNode, key: string): ReactNode | null {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_HTML_TAGS.has(tag)) return null;

  const children = renderDomChildren(element.childNodes, key);
  if (!ALLOWED_HTML_TAGS.has(tag)) return <Fragment key={key}>{children}</Fragment>;

  const props = getSafeHtmlProps(tag, element);
  if (props === null) return null;
  if (VOID_HTML_TAGS.has(tag)) return createElement(tag, { key, ...props });
  return createElement(tag, { key, ...props }, children);
}

function getSafeHtmlProps(tag: string, element: HTMLElement): Record<string, unknown> | null {
  const title = element.getAttribute("title") ?? undefined;

  switch (tag) {
    case "a": {
      const href = sanitizeRichContentUrl(element.getAttribute("href") ?? "", "link");
      return {
        href: href ?? undefined,
        title,
        target: href ? "_blank" : undefined,
        rel: href ? "noreferrer noopener" : undefined,
        className:
          "font-medium text-link underline decoration-link/35 underline-offset-3 hover:decoration-link",
      };
    }
    case "img": {
      const src = sanitizeRichContentUrl(element.getAttribute("src") ?? "", "image");
      if (!src) return null;
      return {
        src,
        alt: element.getAttribute("alt") ?? "",
        title,
        loading: "lazy",
        decoding: "async",
        draggable: false,
        className: "my-2 max-h-[520px] max-w-full rounded-lg border border-border object-contain",
      };
    }
    case "audio": {
      const src = sanitizeRichContentUrl(element.getAttribute("src") ?? "", "media");
      return {
        src: src ?? undefined,
        title,
        controls: true,
        preload: "metadata",
        className: "my-2 w-full min-w-[220px]",
      };
    }
    case "video": {
      const src = sanitizeRichContentUrl(element.getAttribute("src") ?? "", "media");
      const poster = sanitizeRichContentUrl(element.getAttribute("poster") ?? "", "image");
      return {
        src: src ?? undefined,
        poster: poster ?? undefined,
        title,
        controls: true,
        preload: "metadata",
        className:
          "my-2 aspect-video max-h-[560px] w-full rounded-lg border border-border bg-black object-contain",
      };
    }
    case "source": {
      const src = sanitizeRichContentUrl(element.getAttribute("src") ?? "", "media");
      if (!src) return null;
      return { src, type: element.getAttribute("type") ?? undefined };
    }
    default:
      return { title, className: htmlClassName(tag) };
  }
}

function MediaEmbed({
  url,
  alt,
  title,
  fallbackKind,
}: {
  url: string;
  alt: string;
  title?: string;
  fallbackKind?: MediaKind;
}): React.JSX.Element {
  const kind = getMediaKindFromUrl(url) ?? fallbackKind;
  if (!kind) return <span>{url}</span>;

  const src = sanitizeRichContentUrl(url, kind === "image" ? "image" : "media");
  if (!src) return <span>{alt || url}</span>;

  if (kind === "audio") {
    return (
      <span className="my-2 block rounded-lg border border-border bg-muted p-2">
        {title || alt ? (
          <span className="mb-1 block truncate text-xs font-medium text-foreground/65">
            {title || alt}
          </span>
        ) : null}
        <audio controls src={src} className="w-full" preload="metadata" />
      </span>
    );
  }

  if (kind === "video") {
    return (
      <span className="my-2 block overflow-hidden rounded-lg border border-border bg-muted">
        <video
          controls
          src={src}
          className="aspect-video w-full bg-black object-contain"
          preload="metadata"
        />
        {title || alt ? (
          <span className="block truncate px-2 py-1.5 text-xs font-medium text-foreground/65">
            {title || alt}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      className="my-2 block w-fit max-w-full overflow-hidden rounded-lg border border-border bg-muted"
      title={title || alt}
    >
      <img src={src} alt={alt} loading="lazy" className="max-h-[520px] max-w-full object-contain" />
      {title ? (
        <span className="block truncate px-2 py-1.5 text-xs font-medium text-foreground/65">
          {title}
        </span>
      ) : null}
    </a>
  );
}

function containsHtmlTag(value: string): boolean {
  return /<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(value);
}

function getStandaloneMediaUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\S+$/.test(trimmed)) return null;
  return getMediaKindFromUrl(trimmed) ? trimmed : null;
}

function headingClass(depth: 1 | 2 | 3 | 4): string {
  switch (depth) {
    case 1:
      return "m-0 text-lg font-semibold leading-8 text-foreground";
    case 2:
      return "m-0 text-base font-semibold leading-7 text-foreground";
    case 3:
      return "m-0 text-sm font-semibold leading-7 text-foreground/90";
    case 4:
      return "m-0 text-sm font-medium leading-7 text-foreground/80";
  }
}

function htmlClassName(tag: string): string | undefined {
  switch (tag) {
    case "p":
      return "m-0 leading-7";
    case "h1":
      return headingClass(1);
    case "h2":
      return headingClass(2);
    case "h3":
      return headingClass(3);
    case "h4":
    case "h5":
    case "h6":
      return headingClass(4);
    case "ul":
      return "m-0 list-disc pl-5 leading-7 [&>li+li]:mt-1";
    case "ol":
      return "m-0 list-decimal pl-5 leading-7 [&>li+li]:mt-1";
    case "li":
      return "pl-1";
    case "blockquote":
      return "m-0 border-l-2 border-accent/60 pl-3 text-foreground/70";
    case "pre":
      return "m-0 max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-3 text-[12px] leading-6";
    case "code":
      return "font-mono";
    case "table":
      return "w-full border-collapse text-left text-xs";
    case "thead":
      return "bg-muted text-foreground/65";
    case "th":
      return "border-b border-border px-3 py-2 font-semibold";
    case "td":
      return "border-t border-border px-3 py-2 align-top";
    case "hr":
      return "my-1 border-border";
    case "mark":
      return "rounded bg-warning/20 px-1 text-foreground";
    default:
      return undefined;
  }
}
