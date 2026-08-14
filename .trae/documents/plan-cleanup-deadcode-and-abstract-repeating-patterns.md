# 计划：清理死代码 + 抽象重复模式

## 概述

对 `apps/desktop` 做一次保守的代码健康检查：删除**确认没人用**的死代码，把**形态高度一致**的重复模式抽成通用工具；不动行为、不拆大文件、不重命名既有模块。

工作目录：`c:\github\void-ai\apps\desktop`。
涉及三大类共 ~10 个改动点，分布在 renderer 和 main 两层。

---

## 现状分析

通过 Phase 1 探索确认了以下问题（带文件:行号）：

### A. 死代码 / 冗余导出

1. **`App.tsx:117-134`** — `onPetOpenAbout` 监听回调只 `console.info` 一行，无任何 UI 行为；属于"未完成 stub"。`onPetOpenSettings` 是真功能（打开 settings dialog），保留。
2. **`ChatView.tsx:870-924`** `tryAutoTitle(_lastSentCount, …)` — 第四个形参 `_lastSentCount` 在函数体里从未被读取。调用方（`ChatView.tsx:299, 464`）在传值前也确实只是为了凑齐签名。
3. **`useDesktopPetState.ts:30, 95-97, 165`** — controller 暴露的 `applyServerConfig` 在外部 `DesktopPetApp.tsx` 没有任何消费方（grep 全仓库仅 5 处出现，4 处在 hook 内部自用）。属于 dead field。
4. **`main/lib/runtime-recorder.ts`** — 整文件只是把 `db.ts` 的 4 个函数 re-export 成 `recordXxx` 别名；但 `recordRuntimeRun / recordRuntimeStep / updateRecordedRuntimeRun / updateRecordedRuntimeStep` 4 个 re-export **无人使用**（grep 0 个调用方）。`insertRuntimeEvent` re-export 被 `agent-runtime.ts:412` / `workflow-dispatcher.ts:251` 用，保留。
5. **`main/lib/desktop-pet-window.ts:40-46`** — controller options 上的 `openMainSettings / openAbout / quitApp / syncTrayMenu` 四个可选回调；`main/index.ts:152-173` 的 `new DesktopPetWindowController({…})` **一个都没传**。其中 `syncTrayMenu` 在 `desktop-pet-window.ts:98, 105, 337` 被 `this.options.syncTrayMenu?.()` 调用——永远不会触发，但功能上确实属于"托盘联动"的预期点。
6. **`main/lib/desktop-pet-window.ts:22-23`** — `DESKTOP_PET_OPEN_SETTINGS_CHANNEL` / `DESKTOP_PET_OPEN_ABOUT_CHANNEL` 常量被声明但仅在 `main/index.ts:91, 94, 105, 108` 用作字面量字符串，这两处可以直接用字面量。常量本身可有可无（保留也无害，但建议清理避免误导"这是被消费方共享的 channel 名"）。

### B. 冗余类型断言 / 抽象机会

7. **`renderer/src/lib/api.ts:149-177, 266-279`** — 5 处相同的"optional API 包装"模式：

   ```ts
   setWindowSize: (size) => {
     const raw = (assertApi().desktopPet as unknown as { setWindowSize?: ... }).setWindowSize;
     if (!raw) return Promise.resolve(false);
     return raw(size);
   }
   ```

   而 `preload/index.d.ts:125-139, 205-209` 已经完整声明了这些方法。属于历史残留（曾因 preload 漏注册而加）。可以全部退化为直接 `assertApi().xxx`。

8. **`renderer/src/lib/api.ts:266-279`（`system.onPetOpenSettings/About`）** — 同样 `as unknown as { yyy?: ... }` 模式，`preload/index.d.ts:207-208` 已声明。属于第 7 条同一类。

9. **`MessageList.tsx:635-672`** — `isTextPart / isReasoningPart / isSourcePart / isAttachmentPart / isToolPart` 5 个类型守卫和 `normalizeToolState / isActiveToolState` 两个工具。形式高度统一（都是 `(part) => part.type === "X"`）。可以集中到一个 `MessagePartPredicates` 对象，但**单一守卫文件才 38 行**，独立成模块收益不抵成本。**保留原样**。

10. **`chat-media.ts:39-93` `detectMediaIntent`** — 4 段高度重复的"A.*B|B.*A 中英双语"正则块。可以抽 `matchAnyOrder(english, chinese, kind)` 工具消除 4 段 copy-paste。

11. **`ChatView.tsx:154-159, 240-241` + 多处** — `useState` + 镜像 `useRef` 的双轨模式（`mediaSettingsRef`, `selectedModelRef`, `reasoningLevelRef`, `toolSelectionRef`），目前用 `useEffect` 同步。可以抽一个 `useLatestRef` hook。但这些 ref 的存在是为了在 `useMemo(() => new DefaultChatTransport({...}), [conv, port, token])` 这种不能放依赖的回调里读最新值。**保留原样**——已经定型，重构风险大于收益。

### C. 重复调用模式

12. **`ChatView.tsx:308-309, 525-529, 651-655, 682-684` 等多处** — `notify.error(t("toast.chat.failed"), detail, locale)` + 写 `setChatError(detail)` + `console.error("[chat] …", err)` 是一组惯用语。可以抽 `reportChatError(err, locale, source: "send"|"edit"|"resend"|"stream")` 一个内部 helper。

13. **`ChatView.tsx: 多处`** — `void persistMessagesSnapshot(conv, msgs, createdAtRef.current); void api.conversations.touch(conversationId);` 经常成对出现。可以抽 `persistAndTouch(messages)`。但**目前散在 6+ 处**，抽出来后还要小心 createdAt 时机——`touch` 不依赖 `createdAt`，抽函数风险不高。

---

## 改动清单（按优先级）

### P0：直接删的死代码（行为不变）

| #   | 文件                             | 行                               | 动作                                                                                                                                      | 风险               |
| --- | -------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | `App.tsx`                        | 117-134                          | 删 `useEffect` 中的 `onPetOpenAbout` 分支；保留 `onPetOpenSettings` 并把 `as unknown as` 断言换成直接 `api.system.onPetOpenSettings(...)` | 低（仅 stub）      |
| 2   | `ChatView.tsx`                   | 870, 873, 调用方 299/464         | 删 `tryAutoTitle` 的 `_lastSentCount` 形参与所有调用点的第三个参数                                                                        | 极低（纯签名瘦身） |
| 3   | `useDesktopPetState.ts`          | 30, 95-97, 165                   | 删 `applyServerConfig` 字段；`useEffect:104-114` 内部直接 `setAutoSleepMs(config.interaction.autoSleepMs)` 即可                           | 低（外部无消费）   |
| 4   | `main/lib/runtime-recorder.ts`   | 9-14                             | 删 4 个无人用的 re-export，只保留 `insertRuntimeEvent` re-export + export 即可                                                            | 极低               |
| 5   | `main/lib/desktop-pet-window.ts` | 21-23, 89-107, 325-339, 269, 373 | 删 `openMainSettings / openAbout / quitApp` 三个 options 字段；`syncTrayMenu` **保留**（有内部调用，等同"外部未接线"标记）                | 低（未接线）       |
| 6   | `main/index.ts:152-173`          | —                                | 同步：不再传这 3 个 options                                                                                                               | 极低               |

### P1：删除冗余类型断言

| #   | 文件                      | 行                                          | 动作                                                                                                                                                                                                                                                                                                |
| --- | ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7   | `renderer/src/lib/api.ts` | 149-157, 158-166, 169-177, 266-272, 273-279 | 把 5 处 `(assertApi().xxx as unknown as { yyy?: ... }).yyy` 模式全部退化为直接 `assertApi().xxx`，并按文件顶部其他方法风格返回对应签名                                                                                                                                                              |
| 8   | `App.tsx`                 | 119-121, 123-129                            | 同步去掉 `as unknown as { onPetOpenSettings? / onPetOpenAbout? }`，改成 `api.system.onPetOpenSettings(...)`（onPetOpenAbout 已删，参见 #1）                                                                                                                                                         |
| 9   | `useDesktopPetState.ts`   | 110, 144                                    | 同步：把 `window.api?.desktopPet?.onConfigApplied?.(handler)` / `setFrameRate?.(targetFps)` 改用 `assertApi()` 包装（如 `assertApi().desktopPet.setFrameRate(targetFps)`）。**注意**：这两处用 `?.` 是为了在 `window.api` 尚未注入时兜底；改为 `assertApi()` 后要确认在测试环境下也能兜底（看 #10） |
| 10  | `renderer/src/lib/api.ts` | 44-49 `assertApi`                           | `assertApi` 本身是抛错实现；如果要保留 `useDesktopPetState` 的"window.api 可能未注入"容错，**改为** `const safe = (): AyakaApi                                                                                                                                                                      | null => window.api ?? null;`，hook 里改 `safe()?.desktopPet.setFrameRate(...)`，保留容错。**最终决定**：保留 `useDesktopPetState`的容错，改用统一 helper`safeApi()`替代`assertApi()` 的硬抛错，但仅在 hook 中使用。`api.ts`其他地方继续`assertApi()`。 |

### P2：抽象重复模式

| #   | 文件                                        | 动作                                                                                                                                                                        |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | `renderer/src/lib/chat-media.ts:39-93`      | 抽 `matchIntent(text, normalized, enPair: { pattern: RegExp; kind: MediaKind }, zhPair: { pattern: RegExp; kind: MediaKind })`；把 4 段 copy-paste 改为 4 次调用            |
| 12  | `renderer/src/components/ChatView.tsx` 多处 | 抽内部 `reportChatError(source, err)`：统一 `getChatErrorMessage + setChatError + console.error + notify.error + persistMessagesSnapshot + api.conversations.touch`；不导出 |
| 13  | `renderer/src/components/ChatView.tsx`      | 抽 `persistAndTouch(messages)`：`persistMessagesSnapshot(...)` + `api.conversations.touch(...)` 串起来；同上不导出                                                          |

### P3：保留不动的项（明确记录）

- `desktop-pet-bounds.ts:52-60` 的 `_config` 形参：已带注释说明"为签名一致性保留"——保持。
- `MessageList.tsx` 的 5 个 part 类型守卫：集中收益不抵成本——保持。
- `ChatView.tsx` 的 `useState + useRef` 双轨：模式已定型，重构面大、收益小——保持。
- `SettingsDialog.tsx` 135KB / `ChatView.tsx` 38KB / `i18n.messages.ts` 88KB 等大文件：**本次不拆**。属于结构性重构，超出"清理 + 局部抽象"范围。
- `main/lib/agent-graph.ts` / `agent-routing.ts` / `runtime-defaults.ts` 等结构合理的小文件——保持。

---

## 验证步骤

按 Vite+ 工具链：

```bash
cd c:\github\void-ai\apps\desktop
pnpm run typecheck          # 确认类型仍 OK
pnpm run lint               # 确认无新增 lint 错误
pnpm run test               # 跑全部单元测试（共 14 个测试文件）
```

手动验证：

- 启动 dev (`pnpm run dev`)：确认主窗口 + 桌宠 + 托盘均正常打开，右键桌宠 → 设置项能正常唤起 settings dialog（验证 P0-#1 / P1-#7 / P1-#8 仍工作）。
- 跑一轮对话：发送 / 接收 / 停止 / 编辑 / 重发 / 删除，确认 reportChatError / persistAndTouch 抽象后行为不变（验证 P2-#12 / P2-#13）。
- 触发一次"打开主窗口设置"：通过桌宠右键菜单 → 设置项，确认 P0-#1 留下的 `onPetOpenSettings` 分支能打开 settings dialog。
- 切换到中文 / 英文，确认 detectMediaIntent 抽象后意图识别结果一致（人工构造几个 trigger 句测试：英文"generate an image of cats"、中文"生成一段视频"）。

---

## 假设与决策

- **假设**：preload 的方法签名是稳定的（d.ts 声明 = 实际实现）。已经 grep 确认 5 处 `as unknown as` 包装的方法都已在 preload/index.ts 中注册。
- **决策**：保留 `useDesktopPetState` 中的 `window.api?` 容错，但只在 hook 内部用 `safeApi()` helper 兜底；其他地方继续 `assertApi()` 硬抛错。这样 hook 的"测试友好"特性不丢，其余调用点保持"早失败"。
- **决策**：P2 抽象范围限定在 renderer 层（chat-media + ChatView）；main 层的抽象机会本次不主动碰，避免改动面失控。
- **决策**：本次**不**触碰 SettingsDialog / ChatView 拆分、**不**触碰 i18n.messages 拆分——属于结构性重构，应作为独立 PR。
- **决策**：删 stub 优先于"实现完整功能"——用户后续若要加 AboutDialog 再说。

---

## 当前执行状态（最新）

所有 13 项改动已在上一轮实现并落地，工作区当前空（`git status` 干净），**所有改动暂存在 `stash@{0}`**。已通过验证项：

| 验证               | 命令                              | 结果                                                                                                             |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 类型检查 (node)    | `npm run typecheck:node`          | ✅ exit 0                                                                                                        |
| 类型检查 (web)     | `npm run typecheck:web`           | ✅ exit 0（修复 2 处错误：persistAndTouch 返回 `Promise<boolean>` 类型 + preload 漏声明 `setIgnoreMouseEvents`） |
| Lint baseline 对比 | `npm run lint` (改动前 vs 改动后) | ✅ 改动前后 errors 数都是 56，无新增；warnings 由 21179 降至 18603（prettier 把多余格式标得"未变更"）            |

**待执行步骤**（按顺序）：

1. `git stash pop` — 恢复 10 个文件的改动到工作区
2. `cd apps/desktop; npm run test` — 跑全部 14 个测试文件，验证抽象后行为不变
3. `cd apps/desktop; npm run typecheck`（一次性跑 node + web）— 冒烟
4. 手动验证（在 dev 启动后）：
   - 桌宠右键 → 设置项能正常唤起 settings dialog（验证 P0-#1 / P1-#8）
   - 跑一轮对话：发送 / 接收 / 停止 / 编辑 / 重发 / 删除（验证 P2-#12 / P2-#13）
   - 中英文 `detectMediaIntent` 行为一致（验证 P2-#11：英文 "generate an image of cats" / 中文 "生成一段视频"）

Stash 中改动文件清单（10 个）：

```
M  apps/desktop/src/main/lib/agent-runtime.ts
M  apps/desktop/src/main/lib/desktop-pet-window.ts
D  apps/desktop/src/main/lib/runtime-recorder.ts        (整文件删除)
M  apps/desktop/src/main/lib/workflow-dispatcher.ts
M  apps/desktop/src/preload/index.d.ts                  (补 setIgnoreMouseEvents 类型)
M  apps/desktop/src/renderer/src/App.tsx
M  apps/desktop/src/renderer/src/components/ChatView.tsx
M  apps/desktop/src/renderer/src/lib/api.ts             (新增 safeApi)
M  apps/desktop/src/renderer/src/lib/chat-media.ts     (新增 matchIntent)
M  apps/desktop/src/renderer/src/lib/useDesktopPetState.ts
```
