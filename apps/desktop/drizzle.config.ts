/**
 * Drizzle Kit 配置
 *
 * 用于：
 *  - `pnpm db:generate`：根据 schema.ts 生成 SQL 迁移文件
 *  - `pnpm db:studio`：可视化数据库浏览器
 *
 * 注意：
 *  - 运行时数据库路径是动态的（app.getPath('userData')/data/ayaka.db），
 *    这里给 drizzle-kit 用的固定路径仅用于本地开发/迁移生成时的 schema 推断。
 *  - 迁移文件落地后会被 vite 打包进 main 进程，运行时通过 migrate() 应用。
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/main/lib/schema.ts",
  // 迁移文件目录：运行时由 main 进程读取并应用
  out: "./drizzle",
  // 仅用于 drizzle-kit 命令行工具本地推演，运行时使用 app.getPath('userData') 下路径
  dbCredentials: {
    url: "./.drizzle-dev/dev.db",
  },
  dialect: "sqlite",
  // 严格模式：schema 变更必须显式生成迁移文件
  strict: true,
  verbose: true,
});
