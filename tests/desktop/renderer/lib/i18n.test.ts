import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFormatters, resolveLanguage, translate } from "@renderer/lib/i18n";
import { en, zhCN } from "@renderer/lib/i18n.messages";

void describe("messages", () => {
  void it("keeps zh-CN and en dictionaries in key parity", () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zhCN).sort());
  });

  void it("localizes hosted tool labels and availability reasons", () => {
    assert.equal(translate("en", "chatTools.file_search.label"), "File search");
    assert.equal(translate("en", "chatTools.code_interpreter.label"), "Code interpreter");
    assert.equal(translate("en", "chatTools.tool_search.label"), "Tool search");
    assert.equal(translate("zh-CN", "chatTools.file_search.label"), "文件搜索");
    assert.equal(
      translate("zh-CN", "chatTools.unavailable.fileSearchConfig"),
      "请先配置 OpenAI 向量存储 ID，再启用文件搜索。",
    );
    assert.notEqual(
      translate("zh-CN", "chatTools.unavailable.skillInstructionsOnly"),
      "chatTools.unavailable.skillInstructionsOnly",
    );
  });

  void it("keeps primary Chinese navigation and management surfaces localized", () => {
    assert.equal(translate("zh-CN", "shell.nav.conversations"), "对话");
    assert.equal(translate("zh-CN", "main.title.agents"), "智能体");
    assert.equal(translate("zh-CN", "main.title.tools"), "工具");
    assert.equal(translate("zh-CN", "main.title.memory"), "记忆");
    assert.equal(translate("zh-CN", "settings.title"), "设置");
    assert.equal(translate("zh-CN", "settings.tab.about"), "关于");
    assert.equal(translate("zh-CN", "about.version"), "版本");
    assert.equal(translate("en", "about.action.repository"), "Project repository");
    assert.equal(translate("zh-CN", "agents.action.new"), "新建智能体");
    assert.equal(translate("zh-CN", "tools.tab.registry"), "工具注册表");
    assert.equal(translate("zh-CN", "tools.tab.skills"), "技能");
  });

  void it("does not expose placeholder English on critical zh-CN keys", () => {
    const criticalPrefixes = ["agents.", "tools.", "chatTools.", "input.media.", "settings."];
    const placeholderValues = new Set([
      "Title",
      "Subtitle",
      "Description",
      "Placeholder",
      "NoDescription",
      "NoRuns",
      "NoTools",
      "ModelDeleteFailed",
      "ProviderDeleteFailed",
      "RestoreFailed",
      "ManualOnly",
      "GenerateAudio",
      "ImageOutput",
      "ToolCalling",
    ]);
    const failures = Object.entries(zhCN)
      .filter(([key]) => criticalPrefixes.some((prefix) => key.startsWith(prefix)))
      .filter(([, value]) => placeholderValues.has(value))
      .map(([key, value]) => `${key}=${value}`);

    assert.deepEqual(failures, []);
  });

  void it("keeps non-technical English out of critical zh-CN surfaces", () => {
    const criticalPrefixes = [
      "agents.",
      "tools.",
      "chatTools.",
      "input.media.",
      "main.",
      "shell.nav.",
      "settings.",
      "toast.model.",
    ];
    const allowedEnglish = new Set([
      "AI",
      "API",
      "Base64",
      "CPU",
      "Claude",
      "Diagnostics",
      "Docker",
      "FPS",
      "GB",
      "GPU",
      "Gemini",
      "HTTP",
      "ID",
      "JSON",
      "KB",
      "LM",
      "MB",
      "MCP",
      "Ollama",
      "OpenAI",
      "Runtime",
      "SSE",
      "Schema",
      "Studio",
      "Top-P",
      "URL",
      "UUID",
      "WebGPU",
      "ai",
      "stdio",
      "token",
      "vLLM",
    ]);
    const failures = Object.entries(zhCN)
      .filter(([key]) => criticalPrefixes.some((prefix) => key.startsWith(prefix)))
      .flatMap(([key, value]) => {
        const scrubbed = value.replace(/\{[^}]+\}/g, "").replace(/\$secret:key/g, "");
        return (scrubbed.match(/[A-Za-z][A-Za-z0-9._/-]*/g) ?? [])
          .filter((word) => !allowedEnglish.has(word))
          .map((word) => `${key}=${word}`);
      });

    assert.deepEqual(failures, []);
  });
});

void describe("resolveLanguage", () => {
  void it("resolves system locale to supported languages", () => {
    assert.equal(resolveLanguage("system", "zh-CN"), "zh-CN");
    assert.equal(resolveLanguage("system", "zh-Hans"), "zh-CN");
    assert.equal(resolveLanguage("system", "en-US"), "en");
  });

  void it("falls back unsupported system locales to English", () => {
    assert.equal(resolveLanguage("system", "fr-FR"), "en");
    assert.equal(resolveLanguage("system", null), "en");
  });

  void it("keeps explicit user choices", () => {
    assert.equal(resolveLanguage("zh-CN", "en-US"), "zh-CN");
    assert.equal(resolveLanguage("en", "zh-CN"), "en");
  });
});

void describe("translate", () => {
  void it("translates and interpolates without React context", () => {
    assert.equal(translate("en", "trash.selectedCount", { count: 3 }), "3 selected");
    assert.equal(translate("zh-CN", "trash.selectedCount", { count: 3 }), "已选择 3 项");
  });

  void it("keeps the trash cleanup label free of interpolation placeholders", () => {
    assert.equal(translate("en", "trash.purgeIn"), "Cleanup time");
    assert.equal(translate("zh-CN", "trash.purgeIn"), "清理时间");
  });

  void it("falls back to the key for unknown messages", () => {
    assert.equal(translate("en", "missing.key"), "missing.key");
  });
});

void describe("createFormatters", () => {
  void it("formats numbers and compact numbers for the active locale", () => {
    const zh = createFormatters("zh-CN");
    const enUS = createFormatters("en");

    assert.equal(enUS.number(1234567.89), "1,234,567.89");
    assert.match(zh.compactNumber(1234567), /万/);
    assert.match(enUS.compactNumber(1234567), /M/);
  });

  void it("formats dates and file sizes through Intl", () => {
    const date = new Date(Date.UTC(2026, 0, 2, 3, 4));
    const zh = createFormatters("zh-CN");
    const enUS = createFormatters("en");

    assert.match(
      zh.dateTime(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
      /2026年1月2日/,
    );
    assert.match(
      enUS.dateTime(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
      /January 2, 2026/,
    );
    assert.equal(zh.bytes(1536), "1.5 KB");
    assert.equal(enUS.bytes(1536), "1.5 KB");
  });
});
