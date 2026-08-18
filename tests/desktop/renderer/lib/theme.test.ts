import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { SKIN_DEFINITIONS } from "@renderer/skins/registry";
import { applySkin, applyTheme } from "@renderer/lib/theme";

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

function installDom(): FakeDocumentElement {
  const documentElement = new FakeDocumentElement();
  const globals = globalThis as unknown as {
    document: { documentElement: FakeDocumentElement };
  };
  globals.document = { documentElement };
  return documentElement;
}

void describe("applyTheme", () => {
  let root: FakeDocumentElement;

  beforeEach(() => {
    root = installDom();
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
    assert.equal(root.classList.contains("dark"), true);
    assert.equal(root.classList.contains("light"), false);
    assert.equal(root.dataset.density, "compact");
    assert.equal(root.style.getPropertyValue("--skin-primary"), "");
    assert.equal(root.style.fontSize, "16px");
  });

  void it("switches skin attributes without writing token values inline", () => {
    applyTheme(
      themeSettings({
        skin: "zzz",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.dataset.skin, "zzz");
    assert.equal(root.classList.contains("light"), true);
    assert.equal(root.classList.contains("dark"), false);
    assert.equal(root.style.getPropertyValue("--skin-radius"), "");

    applyTheme(
      themeSettings({
        skin: "white",
        fontSize: "base",
        density: "comfortable",
      }),
    );
    assert.equal(root.dataset.skin, "white");
    assert.equal(root.classList.contains("light"), true);
    assert.equal(root.classList.contains("dark"), false);
  });

  void it("falls back to the first registered skin for an unknown runtime id", () => {
    const applied = applySkin("unknown" as AppSettings["skin"]);

    assert.equal(applied, "white");
    assert.equal(root.dataset.skin, "white");
    assert.equal(root.classList.contains("light"), true);
  });

  void it("keeps the skin metadata and previews in the renderer registry", () => {
    const yaka = SKIN_DEFINITIONS.find((skin) => skin.id === "yaka");
    const ark = SKIN_DEFINITIONS.find((skin) => skin.id === "ark");
    const zzz = SKIN_DEFINITIONS.find((skin) => skin.id === "zzz");

    assert.ok(yaka);
    assert.ok(ark);
    assert.ok(zzz);
    assert.equal(yaka.colorScheme, "light");
    assert.equal(yaka.preview.background, "oklch(0.984 0.014 180.72)");
    assert.equal(yaka.preview.accent, "oklch(0.789 0.154 211.53)");
    assert.equal(ark.colorScheme, "light");
    assert.equal(ark.preview.background, "#eef2f3");
    assert.equal(ark.preview.accent, "#4aabea");
    assert.equal(zzz.colorScheme, "light");
    assert.equal(zzz.preview.background, "#edf2f4");
    assert.equal(zzz.preview.accent, "#008bff");
  });

  void it("keeps the public semantic variable bridge in base.css", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../../../apps/desktop/src/renderer/src/assets/base.css"),
      "utf8",
    );
    const rootBlock = css.match(/:root\s*\{[\s\S]*?\n\}/);
    assert.ok(rootBlock, "未找到 base.css 的 :root 块");
    const block = rootBlock[0];

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

    assert.match(css, /--input\s*:\s*var\(--skin-input,\s*var\(--border\)\)/);
    assert.match(css, /--ring\s*:\s*var\(--skin-ring,\s*var\(--focus\)\)/);
    assert.match(css, /@utility font-display/);
    assert.match(css, /@utility font-body/);
    assert.doesNotMatch(css, /data-skin/);
  });
});
