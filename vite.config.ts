import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

const generatedIgnorePatterns = ["**/worker-configuration.d.ts", "**/.wrangler/**"];
const skillIgnorePatterns = [".agents/skills/**", ".codex/skills/**", "skills/**"];

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": resolve("apps/desktop/src/renderer/src"),
      "@shared": resolve("apps/desktop/src/shared"),
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [...skillIgnorePatterns, ...generatedIgnorePatterns],
  },
  lint: {
    ignorePatterns: [...skillIgnorePatterns, ...generatedIgnorePatterns, "tests/desktop/**"],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
  test: {
    include: ["tests/vite-plus/**/*.test.ts"],
  },
});
