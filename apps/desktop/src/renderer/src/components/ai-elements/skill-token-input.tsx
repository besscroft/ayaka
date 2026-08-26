import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type HTMLAttributes,
} from "react";
import { SKILL_INVOCATION_TOKEN_SOURCE } from "@shared/skill-invocation";
import { cn } from "../../lib/utils";

export interface SkillTokenOption {
  id: string;
  name: string;
}

export interface SkillTokenInputHandle {
  focus(): void;
  getCaretOffset(): number;
  setCaretOffset(offset: number): void;
}

export interface SkillTokenInputProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onInput" | "onKeyDown" | "onPaste" | "value"
> {
  value: string;
  skills: readonly SkillTokenOption[];
  placeholder?: string;
  onValueChange: (value: string, caretOffset: number) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
}

const SKILL_TOKEN_RE = new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, "g");

export const SkillTokenInput = forwardRef<SkillTokenInputHandle, SkillTokenInputProps>(
  function SkillTokenInput(
    { value, skills, placeholder, onValueChange, onKeyDown, onPaste, className, ...rest },
    forwardedRef,
  ): React.JSX.Element {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const skillNameById = new Map(skills.map((skill) => [skill.id, skill.name]));
    const skillSignature = skills.map((skill) => `${skill.id}\u0000${skill.name}`).join("\u0001");

    const syncEditor = (): void => {
      const editor = editorRef.current;
      if (!editor) return;
      if (editor.dataset.wireValue === value && editor.dataset.skillSignature === skillSignature) {
        return;
      }
      renderWireValue(editor, value, skillNameById);
      editor.dataset.wireValue = value;
      editor.dataset.skillSignature = skillSignature;
    };

    useLayoutEffect(() => {
      syncEditor();
    }, [value, skillSignature]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => editorRef.current?.focus(),
        getCaretOffset: () => {
          const editor = editorRef.current;
          if (!editor) return value.length;
          return getCaretOffset(editor);
        },
        setCaretOffset: (offset) => {
          const editor = editorRef.current;
          if (!editor) return;
          setCaretOffset(editor, offset);
        },
      }),
      [value],
    );

    const handleInput = (): void => {
      const editor = editorRef.current;
      if (!editor) return;
      const nextValue = serializeEditor(editor);
      const caretOffset = getCaretOffset(editor);
      editor.dataset.wireValue = nextValue;
      onValueChange(nextValue, caretOffset);
    };

    return (
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-slot="skill-token-input"
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        spellCheck
        className={cn(
          "skill-token-input block min-h-16 max-h-[152px] w-full overflow-y-auto",
          "whitespace-pre-wrap break-words bg-transparent px-0 text-[15px] leading-6",
          "text-foreground outline-none empty:before:pointer-events-none",
          "empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
          className,
        )}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        {...rest}
      />
    );
  },
);

function renderWireValue(
  editor: HTMLDivElement,
  value: string,
  skillNameById: ReadonlyMap<string, string>,
): void {
  editor.replaceChildren();
  SKILL_TOKEN_RE.lastIndex = 0;
  let cursor = 0;
  for (const match of value.matchAll(SKILL_TOKEN_RE)) {
    const token = match[0];
    const start = match.index ?? cursor;
    const skillId = match[1];
    if (!skillId) continue;
    if (start > cursor) editor.append(document.createTextNode(value.slice(cursor, start)));
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.slot = "skill-token";
    chip.dataset.skillToken = skillId;
    chip.dataset.skillTokenValue = token;
    chip.setAttribute("aria-label", skillNameById.get(skillId) ?? skillId);
    chip.setAttribute("title", skillNameById.get(skillId) ?? skillId);
    chip.className =
      "mx-0.5 inline-flex select-none items-center gap-1 rounded-full bg-muted px-2 py-0.5 align-baseline text-sm text-foreground";

    const icon = createSparklesIcon();
    chip.append(icon);

    const label = document.createElement("span");
    label.dataset.slot = "skill-token-label";
    label.textContent = skillNameById.get(skillId) ?? skillId;
    chip.append(label);
    editor.append(chip);
    cursor = start + token.length;
  }
  if (cursor < value.length) editor.append(document.createTextNode(value.slice(cursor)));
}

function createSparklesIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.dataset.slot = "skill-token-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("class", "size-3.5 shrink-0");

  const main = document.createElementNS(namespace, "path");
  main.setAttribute(
    "d",
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
  );
  icon.append(main);

  const small = document.createElementNS(namespace, "path");
  small.setAttribute("d", "M20 2v4M22 4h-4");
  icon.append(small);

  const dot = document.createElementNS(namespace, "circle");
  dot.setAttribute("cx", "4");
  dot.setAttribute("cy", "20");
  dot.setAttribute("r", "2");
  icon.append(dot);
  return icon;
}

function serializeEditor(editor: HTMLDivElement): string {
  return Array.from(editor.childNodes)
    .map((child, index) => {
      const lineBreak =
        index > 0 &&
        child.nodeType === Node.ELEMENT_NODE &&
        (child as HTMLElement).tagName === "DIV"
          ? "\n"
          : "";
      return lineBreak + serializeNode(child);
    })
    .join("")
    .replace(/\u00a0/g, " ");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  if (element.dataset.skillTokenValue) return element.dataset.skillTokenValue;
  if (element.tagName === "BR") return "\n";
  return Array.from(element.childNodes).map(serializeNode).join("");
}

function getCaretOffset(editor: HTMLDivElement): number {
  const selection = editor.ownerDocument?.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return serializeEditor(editor).length;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) && range.startContainer !== editor) {
    return serializeEditor(editor).length;
  }
  return measureBefore(editor, range.startContainer, range.startOffset);
}

function measureBefore(root: Node, target: Node, targetOffset: number): number {
  let total = 0;
  const visit = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) total += targetOffset;
      else {
        total += Array.from(node.childNodes)
          .slice(0, targetOffset)
          .reduce((sum, child) => sum + serializeNode(child).length, 0);
      }
      return true;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.dataset.skillTokenValue) {
        total += element.dataset.skillTokenValue.length;
        return false;
      }
    }

    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === "DIV") {
        total += 1;
      }
    }
    return false;
  };
  visit(root);
  return total;
}

function setCaretOffset(editor: HTMLDivElement, offset: number): void {
  const selection = editor.ownerDocument?.defaultView?.getSelection();
  if (!selection) return;
  const range = editor.ownerDocument.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;

  const visit = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
      } else {
        remaining -= length;
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.dataset.skillTokenValue) {
        const length = element.dataset.skillTokenValue.length;
        if (remaining <= length) {
          const parent = element.parentNode ?? editor;
          const index = Array.prototype.indexOf.call(parent.childNodes, element);
          range.setStart(parent, remaining === 0 ? index : index + 1);
          range.collapse(true);
          placed = true;
        } else {
          remaining -= length;
        }
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(editor);
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
