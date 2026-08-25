import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKIN_DEFINITIONS } from "@renderer/skins/registry";
import type { SkinId } from "@shared/types";

const SKINS_ROOT = resolve(import.meta.dirname, "../../../../apps/desktop/src/renderer/src/skins");

const TOKEN_FILE_BY_ID: Record<SkinId, string> = {
  white: "white/tokens.css",
  black: "black/tokens.css",
  zzz: "zzz/tokens.css",
};

const COMPONENT_HOOKS = {
  black: ["agent-avatar"],
  zzz: [
    "window-titlebar",
    "window-sidebar-toggle",
    "window-brand",
    "window-controls",
    "button",
    "agent-avatar",
    "tooltip-trigger",
    "tooltip-content",
    "message-content",
    "card",
    "dialog-content",
    "popover-content",
    "select-content",
    "select-item",
    "dialog-header",
    "dialog-footer",
    "badge",
    "tabs-list",
    "tabs-trigger",
    "switch-control",
    "checkbox-control",
    "slider-track",
    "slider-range",
    "slider-thumb",
    "toggle-group",
    "toggle-group-item",
    "prompt-input",
    "prompt-input-textarea",
    "prompt-input-submit",
    "prompt-input-stop",
    "model-selector-trigger",
    "model-selector-content",
    "model-selector-item",
    "reasoning-selector-trigger",
    "reasoning-selector-content",
    "reasoning-selector-item",
    "prompt-input-attach",
    "prompt-input-separator",
    "alert-dialog-content",
    "field-label",
    "command",
    "table-wrapper",
    "card-header",
    "code-surface",
    "empty",
    "loading",
    "alert",
    "memory-nav-item",
    "memory-row",
  ],
} as const;

const ZZZ_PAGE_HOOKS = [
  [
    "components/AppShell.tsx",
    ["app-shell", "app-main", "sidebar-primary-nav", "conversation-list"],
  ],
  [
    "components/MainPanelView.tsx",
    [
      "tools-page",
      "mcp-page",
      "skills-page",
      "memory-page",
      "agents-page",
      "memory-layout",
      "memory-detail",
    ],
  ],
  ["components/ChatView.tsx", ["chat-page", "chat-main"]],
  ["components/SettingsDialog.tsx", ["settings-dialog", "settings-nav", "settings-detail"]],
  ["components/AgentsPanel.tsx", ["agent-detail-dialog"]],
  ["components/McpWorkspace.tsx", ["mcp-workspace", "mcp-server-item", "mcp-server-detail"]],
] as const;

const REQUIRED_TOKENS = [
  "background",
  "foreground",
  "surface",
  "surface-foreground",
  "overlay",
  "overlay-foreground",
  "field-background",
  "field-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "border",
  "separator",
  "accent",
  "accent-foreground",
  "focus",
  "link",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "danger",
  "danger-foreground",
] as const;

void describe("skin CSS contract", () => {
  void it("defines every required semantic token for every registered skin", () => {
    for (const skin of SKIN_DEFINITIONS) {
      const file = TOKEN_FILE_BY_ID[skin.id];
      const css = readFileSync(resolve(SKINS_ROOT, file), "utf8");

      assert.match(css, new RegExp(`:root\\[data-skin=["']${skin.id}["']\\]`));
      assert.match(css, new RegExp(`color-scheme\\s*:\\s*${skin.colorScheme}`));
      assert.match(css, /--skin-radius\s*:/);
      assert.match(css, /--skin-font-stack\s*:/);
      assert.match(css, /--skin-mono-font-stack\s*:/);

      for (const token of REQUIRED_TOKENS) {
        assert.match(css, new RegExp(`--skin-${token}\\s*:`), `${skin.id}.${token}`);
      }
    }
  });

  void it("statically imports every registered skin token file", () => {
    const indexCss = readFileSync(resolve(SKINS_ROOT, "index.css"), "utf8");

    for (const skin of SKIN_DEFINITIONS) {
      assert.match(indexCss, new RegExp(`@import ["']\\./${skin.id}/tokens\\.css["']`));
    }
  });

  void it("keeps the public, skin, and runtime CSS entry order", () => {
    const mainCss = readFileSync(resolve(SKINS_ROOT, "../assets/main.css"), "utf8");
    const imports = [
      /@import ["']\.\/base\.css["'];/,
      /@import ["']\.\.\/skins\/index\.css["'];/,
      /@import ["']\.\/runtime\.css["'];/,
    ];
    let previousIndex = -1;
    for (const entry of imports) {
      const match = mainCss.match(entry);
      const index = match?.index ?? -1;
      assert.ok(index > previousIndex, `missing or out-of-order import: ${entry}`);
      previousIndex = index;
    }
  });

  void it("keeps component overrides isolated to their owning skin", () => {
    const indexCss = readFileSync(resolve(SKINS_ROOT, "index.css"), "utf8");

    for (const skinId of ["black", "zzz"] as const) {
      const css = readFileSync(resolve(SKINS_ROOT, skinId, "components.css"), "utf8");
      assert.match(css, new RegExp(`:root\\[data-skin=["']${skinId}["']\\]`));
      assert.match(indexCss, new RegExp(`@import ["']\\./${skinId}/components\\.css["']`));
      for (const hook of COMPONENT_HOOKS[skinId]) {
        assert.match(css, new RegExp(`data-slot=["']${hook}["']`), `${skinId}.${hook}`);
      }
    }
  });

  void it("keeps ZZZ page boundaries and business hooks in the renderer", () => {
    for (const [relativePath, hooks] of ZZZ_PAGE_HOOKS) {
      const source = readFileSync(resolve(SKINS_ROOT, "..", relativePath), "utf8");
      for (const hook of hooks) {
        assert.match(source, new RegExp(`(?:data-page|data-slot)(?:=|=\\{)[^>]*${hook}`), hook);
      }
    }
  });

  void it("keeps ZZZ model and reasoning selectors vertically scrollable", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const selectorStart = css.indexOf(
      ':root[data-skin="zzz"]\n  :is([data-slot="model-selector-content"], [data-slot="reasoning-selector-content"]) {',
    );
    const selectorEnd = css.indexOf("\n}", selectorStart);
    const selectorCss = css.slice(selectorStart, selectorEnd);

    assert.ok(selectorStart >= 0);
    assert.ok(selectorEnd > selectorStart);
    assert.match(selectorCss, /overflow-x:\s*hidden/);
    assert.match(selectorCss, /overflow-y:\s*auto/);
    assert.doesNotMatch(selectorCss, /overflow:\s*hidden/);
  });

  void it("uses a compact radius for every ZZZ multiline field", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    assert.match(
      css,
      /:root\[data-skin=["']zzz["']\][\s\S]*:is\(textarea,\s*\[data-slot=["']textarea["']\],\s*\[data-slot=["']prompt-input-textarea["']\]\)[\s\S]*border-radius:\s*10px/,
    );
    assert.match(
      css,
      /:root\[data-skin=["']zzz["']\]\s+\[data-page=["']chat-page["']\]\s+\[data-slot=["']prompt-input-textarea["']\][\s\S]*border-radius:\s*10px[\s\S]*padding:\s*8px\s+10px/,
    );
  });

  void it("defines the complete ZZZ reference button contract", () => {
    const tokens = readFileSync(resolve(SKINS_ROOT, "zzz/tokens.css"), "utf8");
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const buttonStart = css.indexOf(':root[data-skin="zzz"] [data-slot="button"] {');
    const buttonEnd = css.indexOf(
      ':root[data-skin="zzz"] [data-slot="tooltip-trigger"]',
      buttonStart,
    );
    const buttonCss = css.slice(buttonStart, buttonEnd);

    assert.ok(buttonStart >= 0);
    assert.ok(buttonEnd > buttonStart);

    for (const token of [
      "default",
      "primary",
      "success",
      "info",
      "warning",
      "danger",
      "ether",
      "fire",
      "electric",
      "ice",
      "physical",
      "highlight-start",
      "highlight-end",
      "border",
      "plain-background",
      "disabled-color",
      "disabled-background",
      "hollow-disabled-color",
    ]) {
      assert.match(tokens, new RegExp(`--skin-button-${token}\\s*:`), token);
    }

    for (const variant of [
      "default",
      "primary",
      "secondary",
      "outline",
      "ghost",
      "tertiary",
      "link",
      "success",
      "info",
      "warning",
      "danger",
      "destructive",
      "ether",
      "fire",
      "electric",
      "ice",
      "physical",
    ]) {
      assert.match(css, new RegExp(`data-variant=["']${variant}["']`), variant);
    }

    for (const modifier of ["plain", "hollow", "highlight", "circle", "round"]) {
      assert.match(css, new RegExp(`data-${modifier}`), modifier);
    }

    assert.match(css, /data-implicit-default/);
    assert.match(buttonCss, /border:\s*1px\s+solid\s+#000000/);
    assert.match(buttonCss, /border-radius:\s*6px/);
    assert.match(buttonCss, /font-style:\s*italic/);
    assert.match(buttonCss, /letter-spacing:\s*1px/);
    assert.match(buttonCss, /background-size:\s*6px\s+6px/);
    assert.match(buttonCss, /inset\s+0\s+1px\s+2px/);
    assert.match(buttonCss, /inset\s+0\s+0\s+0\s+3px/);
    assert.match(buttonCss, /inset\s+0\s+0\s+0\s+4px/);
    assert.match(buttonCss, /data-slot="button-loader"/);
    assert.match(buttonCss, /data-slot="button-content"/);
    assert.doesNotMatch(buttonCss, /overflow:\s*hidden/);
    assert.doesNotMatch(buttonCss, /clip-path:/);
    assert.doesNotMatch(buttonCss, /filter:\s*brightness/);
    assert.doesNotMatch(buttonCss, /skin-checker-light/);
    assert.match(css, /@keyframes zzz-button-highlight/);
    assert.match(css, /@keyframes zzz-button-loading/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /rotate\(1turn\)/);
    assert.match(css, /data-slot="message-action-button"/);
    assert.match(css, /data-slot="conversation-scroll-button"/);
    assert.match(css, /data-slot=["']tool-approve["']/);
    assert.match(css, /data-slot=["']tool-deny["']/);
    assert.match(css, /data-slot=["']prompt-input-submit["']/);
    assert.match(css, /data-slot=["']prompt-input-stop["']/);
    assert.match(css, /data-icon-only/);
    assert.match(css, /border-radius:\s*50%/);
    assert.match(css, /data-icon-tone/);
    assert.match(css, /data-slot=["']window-control["']/);
    assert.match(css, /data-slot=["']window-sidebar-toggle["']/);
    assert.match(css, /flex:\s*0\s+0\s+2\.75rem/);
    assert.match(css, /window-control[\s\S]*min-width:\s*2\.75rem/);
    assert.match(css, /window-controls[\s\S]*window-control[\s\S]*flex-basis:\s*2\.5rem/);
    assert.match(css, /window-controls[\s\S]*window-control[\s\S]*min-width:\s*2\.5rem/);
    assert.match(
      css,
      /window-controls[\s\S]*window-control-button:hover[\s\S]*background:\s*transparent/,
    );
    assert.match(
      css,
      /window-controls[\s\S]*window-close-button:hover[\s\S]*background:\s*transparent/,
    );
    assert.match(css, /window-control[\s\S]*width:\s*2rem[\s\S]*height:\s*2rem/);
    assert.match(css, /window-control[\s\S]*transform:\s*translate\(-50%,\s*-50%\)/);
  });

  void it("keeps the ZZZ image lightbox close control anchored to the top right", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const lightbox = readFileSync(
      resolve(SKINS_ROOT, "..", "components/ai-elements/image-lightbox.tsx"),
      "utf8",
    );

    assert.match(lightbox, /data-image-lightbox-close=["']true["']/);
    assert.match(
      css,
      /:root\[data-skin=["']zzz["']\]\s+\[data-image-lightbox-close=["']true["']\]\s*\{[\s\S]*?position:\s*absolute/,
    );
    assert.match(lightbox, /className=["'][^"']*absolute\s+right-3\s+top-3/);
  });

  void it("keeps the ZZZ tabs active pill fully rounded", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const tabsListRule = css.match(
      /:root\[data-skin=["']zzz["']\]\s+\[data-slot=["']tabs-list["']\]\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const activeTabRule = css.match(
      /:root\[data-skin=["']zzz["']\]\s+\[data-slot=["']tabs-trigger["']\]\[data-active\]\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    assert.ok(tabsListRule);
    assert.match(tabsListRule, /gap:\s*2px/);
    assert.ok(activeTabRule);
    assert.match(activeTabRule, /border-radius:\s*9999px/);
    assert.doesNotMatch(activeTabRule, /clip-path:/);
  });

  void it("defines the complete ZZZ reference switch contract", () => {
    const tokens = readFileSync(resolve(SKINS_ROOT, "zzz/tokens.css"), "utf8");
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const switchStart = css.indexOf(':root[data-skin="zzz"] [data-slot="switch"] {');
    const switchEnd = css.indexOf(
      ':root[data-skin="zzz"] [data-slot="checkbox-control"]',
      switchStart,
    );
    const switchCss = css.slice(switchStart, switchEnd);

    assert.ok(switchStart >= 0);
    assert.ok(switchEnd > switchStart);

    for (const token of [
      "background",
      "checked-background",
      "disabled-background",
      "checked-disabled-background",
      "disabled-color",
      "knob",
      "border",
      "highlight",
    ]) {
      assert.match(tokens, new RegExp(`--skin-switch-${token}\\s*:`), token);
    }

    for (const value of ["#323232", "#00cc0d", "#1c1c1c", "#2e2e2e", "#585858"]) {
      assert.match(tokens, new RegExp(escapeRegExp(value), "i"), value);
    }

    assert.match(switchCss, /--zzz-switch-thumb-offset:\s*4px/);
    assert.match(switchCss, /--zzz-switch-thumb-size:\s*24px/);
    assert.match(switchCss, /--zzz-switch-label-inset:\s*18px/);
    assert.match(switchCss, /--zzz-switch-label-size:\s*14px/);
    assert.match(
      switchCss,
      /:root\[data-skin="zzz"\] \[data-slot="switch"\] \{[\s\S]*?color:\s*#ffffff;/,
    );
    assert.match(switchCss, /width:\s*85px/);
    assert.match(switchCss, /height:\s*34px/);
    assert.match(switchCss, /padding-inline:\s*var\(--zzz-switch-label-inset\)/);
    assert.match(switchCss, /inset-inline-end:\s*var\(--zzz-switch-label-inset\)/);
    assert.match(switchCss, /inset-inline:\s*var\(--zzz-switch-label-inset\) auto/);
    assert.match(switchCss, /border-radius:\s*9999px/);
    assert.match(switchCss, /background-size:\s*6px\s+6px/);
    assert.match(switchCss, /inset\s+-1px\s+-1px\s+2px/);
    assert.match(switchCss, /inset\s+0\s+0\s+0\s+4px\s+var\(--skin-switch-background\)/);
    assert.match(switchCss, /conic-gradient/);
    assert.match(switchCss, /radial-gradient/);
    assert.match(switchCss, /translate:\s*none\s*!important/);
    assert.match(switchCss, /content:\s*["']OFF["']/);
    assert.match(switchCss, /content:\s*["']ON["']/);
    assert.match(switchCss, /data-checked/);
    assert.match(switchCss, /data-disabled/);
    assert.match(switchCss, /focus-visible/);
    assert.match(switchCss, /:active/);
    assert.match(switchCss, /prefers-reduced-motion/);
    assert.doesNotMatch(switchCss, /var\(--primary\)/);
  });

  void it("scopes the gray striped light surface to the requested ZZZ pages", () => {
    const tokens = readFileSync(resolve(SKINS_ROOT, "zzz/tokens.css"), "utf8");
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const pageBackgroundStart = css.lastIndexOf(
      ':root[data-skin="zzz"]\n  :is(\n    [data-page="chat-page"]',
    );
    const pageBackgroundCss = css.slice(pageBackgroundStart);

    assert.ok(pageBackgroundStart >= 0);
    assert.match(pageBackgroundCss, /background-color:\s*#b8b8b8/);
    assert.match(pageBackgroundCss, /background-image:\s*var\(--skin-pattern-stripes\)/);
    assert.match(pageBackgroundCss, /background-repeat:\s*repeat/);

    for (const page of [
      "chat-page",
      "agents-page",
      "tools-page",
      "mcp-page",
      "skills-page",
      "automation-page",
      "memory-page",
    ]) {
      assert.match(pageBackgroundCss, new RegExp(`data-page=["']${page}["']`), page);
    }

    assert.match(
      pageBackgroundCss,
      /data-page=["']chat-page["']\]\s*>\s*header[\s\S]*background-image:\s*var\(--skin-pattern-stripes\)/,
    );
    assert.match(tokens, /--skin-background:\s*#edf2f4/);
    assert.match(tokens, /--skin-surface:\s*#ffffff/);
  });

  void it("removes the rectangular avatar surface from dark skins", () => {
    for (const skinId of ["black", "zzz"] as const) {
      const css = readFileSync(resolve(SKINS_ROOT, `${skinId}/components.css`), "utf8");
      const avatarStart = css.indexOf(`:root[data-skin="${skinId}"] [data-slot="agent-avatar"]`);
      const avatarEnd = css.indexOf("\n}", avatarStart);
      const avatarCss = css.slice(avatarStart, avatarEnd);

      assert.ok(avatarStart >= 0, skinId);
      assert.ok(avatarEnd > avatarStart, skinId);
      assert.match(avatarCss, /background:\s*transparent/, skinId);
      assert.match(avatarCss, /box-shadow:\s*none/, skinId);
    }
  });

  void it("keeps ZZZ chat text readable on dark surfaces", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const assistantMessageStart = css.indexOf(
      ':root[data-skin="zzz"]\n  [data-page="chat-page"]\n  [data-slot="message"][data-from="assistant"]',
    );
    const assistantMessageCss = css.slice(assistantMessageStart);
    const placeholderStart = css.indexOf(
      ':root[data-skin="zzz"]\n  [data-page="chat-page"]\n  [data-slot="prompt-input-textarea"]::placeholder',
    );
    const placeholderCss = css.slice(placeholderStart);

    assert.ok(assistantMessageStart >= 0);
    assert.match(assistantMessageCss, /--foreground:\s*var\(--skin-dark-foreground\)/);
    assert.match(assistantMessageCss, /--muted-foreground:\s*var\(--skin-dark-muted\)/);
    assert.ok(placeholderStart >= 0);
    assert.match(placeholderCss, /color:\s*var\(--skin-dark-muted\)/);
    assert.match(placeholderCss, /opacity:\s*1/);
  });

  void it("keeps ZZZ management page text readable", () => {
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/components.css"), "utf8");
    const pageTextStart = css.indexOf(
      ':root[data-skin="zzz"]\n  :is(\n    [data-page="tools-page"]',
    );
    const pageTextCss = css.slice(pageTextStart);

    assert.ok(pageTextStart >= 0);
    for (const page of ["tools-page", "mcp-page", "skills-page", "automation-page"]) {
      assert.match(pageTextCss, new RegExp(`data-page=["']${page}["']`), page);
    }
    assert.match(pageTextCss, /--foreground:\s*var\(--skin-dark-foreground\)/);
    assert.match(pageTextCss, /--muted-foreground:\s*var\(--skin-dark-muted\)/);
    assert.match(pageTextCss, /color:\s*var\(--skin-dark-foreground\)/);
  });

  void it("defines the ZZZ Sonner message contract", () => {
    const imports = readFileSync(resolve(SKINS_ROOT, "index.css"), "utf8");
    const css = readFileSync(resolve(SKINS_ROOT, "zzz/sonner.css"), "utf8");
    const app = readFileSync(resolve(SKINS_ROOT, "..", "App.tsx"), "utf8");

    assert.match(imports, /@import ["']\.\/zzz\/sonner\.css["'];/);
    assert.match(app, /const isZzzSkin = settings\.skin === ["']zzz["']/);
    assert.match(app, /position=\{isZzzSkin \? ["']top-center["'] : ["']top-right["']\}/);
    assert.match(app, /duration=\{isZzzSkin \? 1500 : 1000\}/);
    assert.match(app, /visibleToasts=\{isZzzSkin \? 1 : 3\}/);
    assert.match(app, /toasterId:\s*ORIGINAL_TOASTER_ID/);
    assert.match(app, /className:\s*ORIGINAL_TOAST_CLASS/);
    assert.match(app, /id=\{ORIGINAL_TOASTER_ID\}/);
    assert.match(app, /className=\{ORIGINAL_TOASTER_CLASS\}/);
    assert.match(
      css,
      /:root\[data-skin=["']zzz["']\] \[data-sonner-toaster\]:not\(\.ayaka-original-toaster\)/,
    );
    assert.match(css, /\[data-sonner-toast\]:not\(\.ayaka-original-toast\)/);
    assert.match(css, /top:\s*23px/);
    assert.match(css, /width:\s*max-content/);
    assert.match(css, /height:\s*34px/);
    assert.match(css, /padding:\s*0 17px/);
    assert.match(css, /border-radius:\s*9999px/);
    assert.match(css, /--zzz-sonner-background:\s*#000000/);
    assert.match(css, /--zzz-sonner-foreground:\s*#ffffff/);
    assert.match(css, /--y:\s*translateY\(0\)/);
    assert.match(css, /transform:\s*var\(--y\);/);

    for (const value of ["#006607", "#80e686", "#600e00", "#e08e80", "#806200", "#ffe180"]) {
      assert.match(css, new RegExp(escapeRegExp(value), "i"), value);
    }

    assert.match(css, /zzz-sonner-message-flash\s+0\.07s\s+linear\s+3\s+alternate/);
    assert.match(css, /zzz-sonner-message-size\s+0\.63s\s+linear/);
    assert.match(css, /zzz-sonner-message-opacity\s+0\.42s\s+linear/);
    assert.match(css, /zzz-sonner-message-size-reverse\s+0\.42s\s+linear/);
    assert.match(css, /zzz-sonner-message-flash-reverse\s+0\.07s\s+linear\s+3\s+alternate/);
    assert.match(css, /data-type=["']loading["']/);
    assert.match(
      css,
      /:not\(\.ayaka-original-toast\):not\(\[data-type=["']loading["']\]\)\s+\[data-icon\][\s\S]*display:\s*none/,
    );
    assert.match(css, /\[data-close-button\][\s\S]*display:\s*none/);
    assert.match(css, /\[data-button\][\s\S]*display:\s*flex/);
    assert.match(css, /--swipe-amount-y/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(
      css,
      /prefers-reduced-motion:[\s\S]*data-mounted=["']true["'][\s\S]*data-visible=["']true["'][\s\S]*data-content[\s\S]*opacity:\s*1/,
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
