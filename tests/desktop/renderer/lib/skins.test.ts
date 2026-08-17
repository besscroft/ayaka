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
  yaka: "yaka/tokens.css",
  ark: "ark/tokens.css",
};

const COMPONENT_HOOKS = {
  yaka: ["button", "tooltip-trigger", "sidebar-menu-button", "calendar"],
  ark: [
    "window-titlebar",
    "window-sidebar-toggle",
    "window-brand",
    "window-controls",
    "button",
    "message-content",
    "card",
    "dialog-content",
    "popover-content",
    "select-content",
    "dialog-header",
    "dialog-footer",
    "badge",
    "tabs-list",
    "tabs-trigger",
  ],
} as const;

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
      "@import './base.css';",
      "@import '../skins/index.css';",
      "@import './runtime.css';",
    ];
    let previousIndex = -1;
    for (const entry of imports) {
      const index = mainCss.indexOf(entry);
      assert.ok(index > previousIndex, `missing or out-of-order import: ${entry}`);
      previousIndex = index;
    }
  });

  void it("keeps component overrides isolated to their owning skin", () => {
    const indexCss = readFileSync(resolve(SKINS_ROOT, "index.css"), "utf8");

    for (const skinId of ["yaka", "ark"] as const) {
      const css = readFileSync(resolve(SKINS_ROOT, skinId, "components.css"), "utf8");
      assert.match(css, new RegExp(`:root\\[data-skin=["']${skinId}["']\\]`));
      assert.match(indexCss, new RegExp(`@import ["']\\./${skinId}/components\\.css["']`));
      for (const hook of COMPONENT_HOOKS[skinId]) {
        assert.match(css, new RegExp(`data-slot=["']${hook}["']`), `${skinId}.${hook}`);
      }
    }
  });
});
