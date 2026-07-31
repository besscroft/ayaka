# 修复数据库每次启动被重置的问题

## 摘要

每次启动应用后,用户本地的会话历史、API keys、Agent 配置、设置等**全部丢失**(像全新安装)。dev 模式与打包后都会复现。

根因是一套历史遗留的"自动备份重建"机制:`resetDatabaseFiles` + `assertCognitiveMemorySchema` + `isRecoverableSchemaInitError`。项目早期用 `node:sqlite`,后切到 `better-sqlite3`,并把多个历史迁移"合并"成单个 `0000_initial.sql`(直接改文件加列,而非生成新迁移)。由于 drizzle-orm 0.45.2 的 migrate **不校验 hash、只比较 `created_at`**,旧库不会重新执行迁移,导致旧 schema 缺列 → 兜底校验失败 → 触发"备份并清空"。

项目未上线,直接移除这套危险的历史遗留机制,改为 fail-fast;用户清理一次本地旧数据库即可,新库会正常 migrate。

---

## 根因分析

### 问题触发链

```
启动 → initDb() → openAndMigrateDb()
                    │
                    ├─ migrate(db, { migrationsFolder })
                    │   └─ drizzle 0.45.2 判断:
                    │      !lastDbMigration || Number(lastDbMigration.created_at) < folderMillis
                    │      ⚠ 只比较 created_at,完全不校验 hash
                    │      → 旧库已记录 created_at=1784712952299 → 跳过 0000_initial
                    │
                    ├─ assertCognitiveMemorySchema(rawDb)   ← 兜底校验
                    │   └─ SELECT mem0_id, sync_status, strength, last_reinforced_at FROM memories
                    │      → 旧库 memories 表缺这些列 → 抛 "no such column: mem0_id"
                    │
                    └─ catch → isRecoverableSchemaInitError(error) = true
                               ("no such column" 匹配 RECOVERABLE_SCHEMA_PATTERN)
                               → resetDatabaseFiles(dbPath, error)
                                  └─ 把 void-ai.db / -wal / -shm 移到
                                     backup-before-runtime-schema-{timestamp}/
                                  → 数据库变空库 → seedDefaults 重新种默认数据
                                  → 用户数据全部丢失 ❌
```

### 关键证据

1. **`resetDatabaseFiles` 是唯一会清空整个数据库的代码路径**(`db.ts:259-275`)。它把 `.db/.db-wal/.db-shm` 三个文件整体移走到 backup 目录,等价于"重置"。`seedDefaults` / `cancelStaleRuntimeRuns` / `purgeExpiredDeletedConversations` 都是幂等的局部操作,不会导致"全部丢失"。

2. **drizzle-orm 0.45.2 migrate 不校验 hash**(`node_modules/.pnpm/drizzle-orm@0.45.2.../sqlite-core/dialect.cjs:662-695`):

   ```js
   const lastDbMigration = session.values(
     sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
   )[0];
   for (const migration of migrations) {
     if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) {
       // 执行迁移 + INSERT hash,created_at
     }
   }
   ```

   `hash` 只被写入、从不被读回比对。一旦旧库 `__drizzle_migrations` 里 `created_at >= 0000_initial.folderMillis(1784712952299)`,即使 `0000_initial.sql` 内容已变更(加了 `mem0_id` 等列),migrate 也会跳过。

3. **`0000_initial.sql` 是"合并后"的迁移**:`drizzle-metadata.test.ts:48-56` 有测试 `"tracks only the consolidated initial migration"`,断言 journal 只有 1 个 entry。这证实项目曾把多个历史迁移压缩进单个 `0000_initial.sql`,直接改文件加列 —— 这正是旧库 schema 不一致的来源。

4. **`assertCognitiveMemorySchema` 检查的列在当前 `0000_initial.sql` 中存在**(`0000_initial.sql:252-255` 有 `mem0_id`/`sync_status`/`strength`/`last_reinforced_at`;`memory_jobs` 有 `idempotency_key`;`memory_observations` 表存在)。所以**新库** migrate 后校验能通过;只有**旧库**(合并前创建的)才会失败。

5. **`agent-lifecycle.test.ts:52-103` 的测试 `"backs up and rebuilds an incompatible cognitive memory schema"`** 明确构造了一个 `memories(id)` 只有 `id` 列的 legacy 库,验证 initDb 会自动备份重建 —— 证实这套机制就是为"旧 schema 升级"设计的容错,但它以**静默清空用户数据**为代价。

6. **历史遗留痕迹**:`index.ts:154` 注释仍写"node:sqlite,实验性 API",但 `db.ts:1` 实际 `import Database from "better-sqlite3"`;`drizzle-metadata.test.ts:3` 用 `DatabaseSync` from `node:sqlite`。证实项目经历过 `node:sqlite → better-sqlite3` 迁移。

### 为什么"每次"启动都重置(而非只一次)

理论上 reset 后的新库 migrate 会执行最新 `0000_initial.sql`,记录 `created_at`,下次启动跳过 migrate 且校验通过,不应再 reset。但实际"每次"复现,可能的原因有:

- **reset 后第二次 `openAndMigrateDb` 失败**:第二次不在 `initDb` 的 try-catch 内,失败会抛到 `index.ts:156` 被吞掉,`dbInstance=null`,数据库停留在空库/部分建表状态。下次启动空库会重新 migrate 成功 —— 但若失败发生在 migrate 事务内(事务回滚),库仍是空的,且 `__drizzle_migrations` 未记录,下次会重新 migrate。这条路径下 reset 只会发生有限次。
- **Windows 文件锁导致 `resetDatabaseFiles` 没真正移走文件**:`moveDatabaseFile`(`db.ts:277-284`)的 `renameSync` 失败后回退 `copyFileSync + unlinkSync`,`unlinkSync` 若失败**不会抛错**(catch 吞掉),旧 `.db` 文件仍在 → 第二次 `openAndMigrateDb` 打开的还是旧库 → 又失败 → 下次启动又触发 reset。Windows 上 WAL 模式下文件句柄释放有延迟,这会**每次复现**。
- **旧库 `__drizzle_migrations` 的 `created_at` 与 `0000_initial.folderMillis` 比较异常**:若历史遗留导致 `created_at` 为非数字/异常大,migrate 每次都尝试重新执行 → "table already exists" → 匹配 `RECOVERABLE_SCHEMA_PATTERN`("already exists") → reset。

**无论确切是哪条路径,根因都是 `resetDatabaseFiles` 这套"静默清空"机制本身**。移除它 + 清理旧库,所有路径都被切断。

---

## 修复方案

项目未上线,采用根治性方案:**移除整套历史遗留的"自动备份重建"机制,改为 fail-fast**。

```
修复后流程:
启动 → initDb() → openAndMigrateDb()
                    │
                    ├─ migrate(db, { migrationsFolder })   ← 唯一权威的 schema 来源
                    │   └─ 旧库:__drizzle_migrations 已记录 → 跳过(用户会先清理旧库)
                    │   └─ 新库:执行 0000_initial.sql 建全部表
                    │
                    ├─ cancelStaleRuntimeRuns()            ← 保留(启动清理,合理)
                    ├─ purgeExpiredDeletedConversations()  ← 保留(回收站过期清理,合理)
                    └─ seedDefaults()                      ← 保留(幂等种默认数据)

         (移除 assertCognitiveMemorySchema / isRecoverableSchemaInitError / resetDatabaseFiles)
```

### 用户侧一次性操作

清理本地 userData 下的旧数据库(项目未上线,旧数据可弃):

- Windows: `%APPDATA%\Paimon\data\` 目录下的 `void-ai.db`、`void-ai.db-wal`、`void-ai.db-shm` 以及所有 `backup-before-runtime-schema-*` 文件夹全部删除。
- 重新启动应用,新库会正常 migrate,不再被重置。

---

## 具体改动

### 1. `apps/desktop/src/main/lib/db.ts`(核心)

**移除 import**(`db.ts:131`):

```ts
// 删除整行
import { assertCognitiveMemorySchema, isRecoverableSchemaInitError } from "./schema-init";
```

**简化 `initDb()`**(`db.ts:194-205`):改为直接调用 `openAndMigrateDb`,失败 fail-fast 抛错,不再备份重建:

```ts
export function initDb(): DbInstance {
  if (dbInstance) return dbInstance;
  const dbPath = join(resolveDataDir(), DB_FILENAME);
  return openAndMigrateDb(dbPath);
}
```

**`openAndMigrateDb` 移除 `assertCognitiveMemorySchema` 调用**(`db.ts:207-227`):migrate 是唯一权威 schema 来源,不需要兜底校验:

```ts
function openAndMigrateDb(dbPath: string): DbInstance {
  rawDb = new Database(dbPath);
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.pragma("busy_timeout = 5000");

  dbInstance = drizzle(rawDb, { schema });
  try {
    migrate(dbInstance, { migrationsFolder: resolveMigrationsFolder() });
    cancelStaleRuntimeRuns();
    purgeExpiredDeletedConversations();
    seedDefaults();
  } catch (error) {
    rawDb.close();
    rawDb = null;
    dbInstance = null;
    throw error;
  }
  return dbInstance;
}
```

**移除 `resetDatabaseFiles` 和 `moveDatabaseFile` 函数**(`db.ts:259-284` 整段删除):连同它们用到的 `copyFileSync`、`renameSync`、`unlinkSync`、`basename`、`dirname`、`mkdirSync` 等 import 若无其它使用方也一并清理(需检查)。

> 注意:`closeDb()`(`db.ts:286-292`)保留,`before-quit` 仍需调用。`resolveDataDir`/`resolveMigrationsFolder` 保留。

### 2. `apps/desktop/src/main/lib/schema-init.ts`(整文件删除)

整个文件只导出 `assertCognitiveMemorySchema` 和 `isRecoverableSchemaInitError`,全部被移除。Grep 确认仅 `db.ts` 与 `drizzle-metadata.test.ts` 引用,无其它消费者。

### 3. `apps/desktop/src/main/lib/agent-lifecycle.test.ts`(移除 reset 测试)

删除 `db.ts:52-103` 的 `it("backs up and rebuilds an incompatible cognitive memory schema", ...)` 整个测试块。该测试依赖 `resetDatabaseFiles` 行为,移除机制后不再适用。

其余测试(`isAgentRuntimeBusy`、`archiveAgent`、`restoreAgent`、`deleteAgent` 等,105-231 行)与 reset 无关,保留。测试顶部的 `existsSync`、`readdirSync`、`mkdir`、`Database` 等 import 若仅被该测试使用,需一并清理(执行时检查)。

### 4. `apps/desktop/src/main/lib/drizzle-metadata.test.ts`(精简)

- 移除 `import { assertCognitiveMemorySchema, isRecoverableSchemaInitError } from "./schema-init";`(`:6`)
- 移除 `createMemorySchema` 辅助函数(`:8-30`,仅服务于被删测试)
- 移除以下测试块:
  - `"recognizes recoverable schema errors wrapped by Drizzle"`(`:58-72`)
  - `"detects legacy memory schemas before runtime startup"`(`:74-81`)
  - `"detects a missing memory observations table"`(`:83-93`)
  - `"detects a missing memory job idempotency column"`(`:95-105`)
  - `"accepts the current cognitive memory schema"`(`:107-114`)
  - `"does not classify runtime and provider failures as schema failures"`(`:116-123`)
- 保留:
  - `"keeps migration metadata as parseable BOM-free JSON"`(`:33-46`)
  - `"tracks only the consolidated initial migration"`(`:48-56`)
- 移除仅被删除测试使用的 import:`DatabaseSync` from `node:sqlite`(`:3`)、`assert`(`:1`)若仍被保留测试使用则保留(`assert` 仍需要,保留;`DatabaseSync` 移除)。

### 5. `apps/desktop/src/main/index.ts`(更新过时注释)

`index.ts:154-155` 注释更新为准确描述:

```ts
// 1. 初始化数据库（better-sqlite3 + drizzle-orm）
//    迁移文件位于 apps/desktop/drizzle,生产环境从 process.resourcesPath/drizzle 读取
```

---

## 假设与决策

1. **决策:移除而非保留 reset 机制**。理由:
   - 项目未上线,不需要"旧版本升级容错"(没有真实用户数据需要保护)。
   - 该机制以**静默清空全部用户数据**为代价,掩盖了真正的 schema 一致性问题,危险远大于收益。
   - `0000_initial.sql` 与 `schema.ts` 已一致,新库 migrate 后 schema 完整,不需要兜底校验。

2. **决策:用户手动清理旧库,而非代码自动清理**。理由:
   - 项目未上线,一次性手动删除即可。
   - 代码自动删除旧库会重蹈"静默清空"的覆辙。

3. **决策:保留 `cancelStaleRuntimeRuns` / `purgeExpiredDeletedConversations` / `seedDefaults`**。理由:它们都是幂等的启动清理/种数据操作,不会导致"全部丢失",与本次问题无关。

4. **未来约束(写入项目记忆,提醒后续开发)**:schema 变更必须通过 `vp run desktop#db:generate` 生成**新的迁移文件**(如 `0001_xxx.sql`),**禁止直接修改 `0000_initial.sql`**。直接改 0000 不会对旧库生效(drizzle 不校验 hash),会重新引入本次问题。

5. **不引入新依赖**:纯删除代码 + 注释更新,符合"优先使用项目已有依赖"。

---

## 验证步骤

1. **静态检查**:

   ```bash
   vp check
   ```

   确认无残留对 `schema-init`、`resetDatabaseFiles`、`assertCognitiveMemorySchema`、`isRecoverableSchemaInitError` 的引用。

2. **类型检查**:

   ```bash
   vp run desktop#typecheck
   ```

3. **单元测试**:

   ```bash
   vp run desktop#test
   ```

   重点关注:
   - `agent-lifecycle.test.ts`:reset 测试已移除,其余测试应通过。
   - `drizzle-metadata.test.ts`:journal 一致性测试应通过。
   - 其它涉及 db 初始化的测试(`memory-orchestrator`、`runtime-architecture` 等)应不受影响。

4. **运行时验证(dev)**:
   - 先清理 `%APPDATA%\Paimon\data\` 下的 `void-ai.db*` 和 `backup-before-runtime-schema-*`。
   - `vp run dev:desktop` 启动,创建会话、配置 API key、改设置,正常使用后退出。
   - **再次启动**,确认会话/API key/设置**仍然存在**(未被重置)。
   - 检查 `%APPDATA%\Paimon\data\` 下**不应**出现新的 `backup-before-runtime-schema-*` 目录。

5. **运行时验证(打包)**:
   - `vp run build:desktop:win` 打包后安装运行,重复第 4 步的启动-使用-退出-再启动流程,确认数据持久。

6. **回归确认**:连续启动 3 次以上,每次数据都应保留,不再触发任何重置。
