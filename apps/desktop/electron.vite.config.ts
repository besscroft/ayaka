import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // 显式声明 node 原生模块、AI SDK、Hono、Electron 相关包为外部依赖（不应被 vite 打包）
    // 注意：
    //  - better-sqlite3 是 native 模块，必须 external，否则 vite 会试图打包 .node 文件
    //  - drizzle-orm 内部按需 import 驱动，external 后由运行时 require
    //  - @electron-toolkit/utils 内部 require("electron")，若被 inline 会导致
    //    __dirname 指向 out/main/，使 electron 的 path.txt 检查失败
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "db-writer-worker": resolve("src/main/lib/db-writer-worker.ts"),
        },
        external: [
          "ai",
          "@ai-sdk/openai",
          "@ai-sdk/anthropic",
          "@ai-sdk/google",
          "hono",
          "@hono/node-server",
          "electron",
          "@electron-toolkit/utils",
          "@electron-toolkit/preload",
          "electron-updater",
          "fflate",
          "better-sqlite3",
          "drizzle-orm",
          "drizzle-orm/better-sqlite3",
          "drizzle-orm/better-sqlite3/migrator",
        ],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron", "@electron-toolkit/preload"],
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
