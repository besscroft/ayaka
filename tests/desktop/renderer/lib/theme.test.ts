import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS, SKIN_DEFINITIONS, type AppSettings } from "@shared/types";
import { applyTheme } from "@renderer/lib/theme";

class FakeStyle {
  private readonly values = new Map<string, string>();
  fontSize = "";

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? "";
    this.values.delete(name);
    return previous;
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }
}

class FakeClassList {
  private readonly values = new Set<string>();

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeDocumentElement {
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList();

  setAttribute(name: string, value: string): void {
    if (name === "data-skin") this.dataset.skin = value;
    if (name === "data-density") this.dataset.density = value;
  }

  removeAttribute(name: string): void {
    if (name === "data-skin") delete this.dataset.skin;
    if (name === "data-density") delete this.dataset.density;
  }
}

function themeSettings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function installDom(matches: boolean): FakeDocumentElement {
  const documentElement = new FakeDocumentElement();
  const globals = globalThis as unknown as {
    document: { documentElement: FakeDocumentElement };
    window: { matchMedia: () => { matches: boolean } };
  };
  globals.document = { documentElement };
  globals.window = { matchMedia: () => ({ matches }) };
  return documentElement;
}

void describe("applyTheme", () => {
  let root: FakeDocumentElement;

  beforeEach(() => {
    root = installDom(false);
  });

  void it("syncs app theme attributes and appearance settings", () => {
    const applied = applyTheme(
      themeSettings({
        skin: "black",
        fontSize: "lg",
        density: "compact",
      }),
    );

    assert.equal(applied, "black");
    assert.equal(root.dataset.skin, "black");
    assert.equal(root.style.getPropertyValue("color-scheme"), "dark");
    assert.equal(root.classList.contains("dark"), true);
    assert.equal(root.classList.contains("light"), false);
    assert.equal(root.dataset.density, "compact");
    assert.equal(root.style.getPropertyValue("--skin-radius"), "10px");
    assert.equal(root.style.getPropertyValue("--skin-primary"), "oklch(0.922 0 0)");
    assert.equal(root.style.fontSize, "16px");
  });

  void it("updates skin radius and color mode when switching skins", () => {
    applyTheme(
      themeSettings({
        skin: "yaka",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.style.getPropertyValue("--skin-radius"), "10px");
    assert.equal(root.dataset.skin, "yaka");
    assert.equal(root.style.getPropertyValue("--skin-primary"), "oklch(0.42 0.12 232)");
    assert.equal(root.classList.contains("light"), true);
    assert.equal(root.classList.contains("dark"), false);

    applyTheme(
      themeSettings({
        skin: "white",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.style.getPropertyValue("--skin-radius"), "10px");
    assert.equal(root.dataset.skin, "white");
  });

  void it("keeps yaka geometry aligned with White while using the yaka palette", () => {
    const white = SKIN_DEFINITIONS.find((skin) => skin.id === "white");
    const yaka = SKIN_DEFINITIONS.find((skin) => skin.id === "yaka");
    assert.ok(white);
    assert.ok(yaka);
    assert.equal(yaka.radius, white.radius);
    assert.equal(yaka.fontStack, white.fontStack);
    assert.equal(yaka.monoFontStack, white.monoFontStack);
    assert.equal(yaka.colorScheme, white.colorScheme);
    assert.equal(yaka.tokens.primary, "oklch(0.42 0.12 232)");
    assert.equal(yaka.tokens.background, "oklch(0.96 0.02 232)");
    assert.equal(yaka.tokens.surface, "oklch(0.975 0.018 232)");
    assert.equal(yaka.tokens.overlay, "oklch(0.985 0.012 232)");
    assert.equal(yaka.tokens.fieldBackground, "oklch(0.875 0.055 232)");
    assert.notEqual(yaka.tokens.surface, "oklch(1 0 0)");
    assert.notEqual(yaka.tokens.primary, white.tokens.primary);
    assert.notEqual(yaka.tokens.background, white.tokens.background);
  });

  void it("defines every required semantic token for every built-in skin", () => {
    const required = [
      "background",
      "foreground",
      "surface",
      "surfaceForeground",
      "overlay",
      "overlayForeground",
      "fieldBackground",
      "fieldForeground",
      "primary",
      "primaryForeground",
      "secondary",
      "secondaryForeground",
      "muted",
      "mutedForeground",
      "border",
      "separator",
      "accent",
      "accentForeground",
      "focus",
      "link",
      "success",
      "successForeground",
      "warning",
      "warningForeground",
      "danger",
      "dangerForeground",
    ] as const;

    for (const skin of SKIN_DEFINITIONS) {
      for (const token of required) assert.ok(skin.tokens[token], `${skin.id}.${token}`);
    }
  });

  // 回归测试：Tailwind v4 编译的 rounded-md/lg/xl/2xl 引用的是具名变量 --radius-md/lg/xl/2xl，
  // 而 shadcn 的 tailwind.css 只在 @layer theme 内把它们硬编码为固定值。
  // main.css 必须在 unlayered :root 里把这些变量桥接到 var(--radius)，
  // 否则切换皮肤时 --skin-radius 改了但所有 rounded-* 元素不变。
  void it("main.css 在 :root 中把 --radius-{sm,md,lg,xl,2xl} 桥接到 var(--radius)", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../../../apps/desktop/src/renderer/src/assets/main.css"),
      "utf8",
    );
    const rootBlock = css.match(/:root\s*\{[\s\S]*?\n\}/);
    assert.ok(rootBlock, "未找到 :root 块");
    const block = rootBlock[0];
    // sm/md/xl/2xl 形如 calc(var(--radius) ± Npx)，lg 形如 var(--radius)。
    for (const name of [
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--radius-xl",
      "--radius-2xl",
    ]) {
      const re = new RegExp(`${name}\\s*:\\s*[^;]*var\\(--radius\\)`);
      assert.match(block, re, `${name} 必须基于 var(--radius) 派生`);
    }
  });
});
