# Chat 组件设计与 API 文档

> 基于 [AI Elements](https://elements.ai-sdk.dev/) 组件库规范，结合 Vercel AI SDK useChat，
> 在 Ayaka 渲染层实现的「创意型 Chat 体验」完整设计稿与 API 手册。

---

## 目录

1. [设计目标与原则](#1-设计目标与原则)
2. [整体架构](#2-整体架构)
3. [视觉设计规范](#3-视觉设计规范)
4. [核心组件 API](#4-核心组件-api)
   - [4.1 ChatView](#41-chatview)
   - [4.2 MessageInput](#42-messageinput)
   - [4.3 MessageList](#43-messagelist)
   - [4.4 ai-elements 子组件](#44-ai-elements-子组件)
5. [数据流与文件附件](#5-数据流与文件附件)
6. [聊天历史管理](#6-聊天历史管理)
7. [i18n 文案扩展](#7-i18n-文案扩展)
8. [使用示例](#8-使用示例)
9. [可扩展点](#9-可扩展点)
10. [已知限制](#10-已知限制)

---

## 1. 设计目标与原则

### 1.1 设计目标

在保留核心聊天功能的基础上，融入**创新交互**与**视觉设计**，主要围绕六个方面：

| 模块     | 基础能力               | 创意增强                                        |
| -------- | ---------------------- | ----------------------------------------------- |
| 消息展示 | 文本 / 工具调用 / 推理 | 一键复制 · Hover 快捷反应 · 文件附件画廊        |
| 输入框   | 文本输入 / 发送        | 自适应高度 · ⌘+Enter 强制发送 · 智能占位        |
| 发送按钮 | 发送 / 停止            | 发送态切换动画 · 流式脉冲                       |
| 表情选择 | 文本 emoji             | 6 分类网格 + 关键字搜索（中英文）· 光标精准插入 |
| 文件上传 | 选择文件               | 拖拽 · 粘贴 · 缩略图 · 大小限制                 |
| 历史记录 | 列表显示               | 实时搜索 · 日期分组（今天/昨天/本周/更早）      |

### 1.2 设计原则

```
安全性 = 正确性 > 最小变更 > 可读性 > 一致性
```

- **架构清晰** —— 复用 ai-elements，扩展点收敛在 `ai-elements/` 子目录
- **依赖最小化** —— 不引入 emoji 库；att 文件用标准 Web API
- **类型安全** —— 所有新组件导出 `Props` 接口；与 ai-sdk `FileUIPart` 协议兼容
- **可访问性** —— 全部交互元素含 `aria-label`、键盘可达、focus-visible 可见
- **响应式** —— 桌面端从 1024px 起自适应；input 高度 16px → 152px 自动撑高
- **暗色优先** —— 同时兼容 shadcn/base-ui 的 `data-theme` 与 Tailwind v4 的 `dark` 变体

### 1.3 创意交互亮点

1. **拖拽 / 粘贴上传** —— Composer 整个区域是 drop zone，拖入文件时高亮（accent 色 + 4px ring）
2. **Hover 复制 / 表情反应** —— 鼠标移上 assistant 消息时浮现工具条，玻璃拟态 + scale 动画
3. **空态建议** —— 新对话自动展示 4 条 prompt，点击直接发送
4. **日期分组** —— 左侧历史按今天 / 昨天 / 本周 / 更早 分组
5. **拖拽式粘贴剪贴板图片** —— 直接 `Ctrl+V` 把截图转附件

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          App.tsx                                 │
│   ┌──────────┐  ┌──────────────────────────────────────────┐   │
│   │AppShell  │  │           ChatView (route)                │   │
│   │          │  │   ┌──────────────────────────────────┐    │   │
│   │ · nav    │  │   │        MessageList                │   │   │
│   │ · hist   │  │   │  ┌─────────┐  ┌────────────────┐  │   │   │
│   │ · search │  │   │  │ Message │→ │ QuickReactions │  │   │   │
│   │ · group  │  │   │  └─────────┘  └────────────────┘  │   │   │
│   └──────────┘  │   │  ┌─────────┐  ┌────────────────┐  │   │   │
│                 │   │  │ Message │→ │ MsgAttachments │  │   │   │
│                 │   │  └─────────┘  └────────────────┘  │   │   │
│                 │   └──────────────────────────────────┘    │   │
│                 │   ┌──────────────────────────────────┐    │   │
│                 │   │       MessageInput (Composer)     │   │   │
│                 │   │  [😊] [📎] [Agent] [Model]   [↑]  │   │   │
│                 │   └──────────────────────────────────┘    │   │
│                 └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

         ▼  data flow  ▼

┌─────────────────────────────────────────────────────────────────┐
│ ai-elements/                                                      │
│   ├─ prompt-input.tsx         (受控 textarea + submit)            │
│   ├─ conversation.tsx         (滚动容器)                          │
│   ├─ message.tsx              (气泡)                              │
│   ├─ reasoning.tsx            (折叠推理)                          │
│   ├─ tool.tsx                 (工具调用)                          │
│   ├─ emoji-picker.tsx    ★新增 (分类 + 搜索)                      │
│   ├─ attachment-chip.tsx ★新增 (待发送 chip)                     │
│   ├─ quick-reactions.tsx ★新增 (hover 反应)                      │
│   ├─ message-attachments.tsx ★新增 (消息附件画廊)                 │
│   └─ prompt-suggestions.tsx   ★新增 (空态建议)                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 模块分层

| 层          | 关注点                            | 文件                                  |
| ----------- | --------------------------------- | ------------------------------------- |
| 路由 / 容器 | 加载历史、错误处理、发送控制      | `ChatView.tsx`                        |
| 展示        | 消息渲染、composer、附件展示      | `MessageList.tsx`, `MessageInput.tsx` |
| 原子组件    | emoji、chip、reaction、suggestion | `ai-elements/*.tsx`                   |
| 持久化      | IPC / DB                          | `lib/api.ts`（preload 暴露）          |

### 2.2 不变式（重要约束）

- **onSend 签名**：`(payload: { text, files: FilePartLike[] }) => void`
- **files[i] 字段**：`type, mediaType, filename, url`（与 ai-sdk `FileUIPart` 一致；url 字段承载 dataURL）
- **历史回填**：`api.messages.list` 返回的 `content` 字段是 JSON 序列化的 UIMessage（含 parts）
- **会话切换**：通过 `conversationId` prop；`useChat({ id: conversationId })` 触发重新订阅

---

## 3. 视觉设计规范

### 3.1 设计令牌（继承自 shadcn/base-ui + Tailwind v4）

```css
/* 颜色（强调色随主题变化） */
--color-accent        /* 主强调色（按钮、链接、focus ring） */
--color-accent-soft   /* 强调色 10% 透明（背景） */

/* 语义色 */
--color-success       /* 复制成功、发送成功 */
--color-warning       /* 缺少模型、未选模型警告 */
--color-danger        /* 错误、删除 */

/* 文字层级 */
--color-foreground         /* 主文字 */
--color-foreground-70%     /* 次级文字 */
--color-foreground-45%     /* 提示文字 */
--color-foreground-35%     /* 极弱提示 */
--color-foreground-10%     /* 分隔线 */

/* 圆角 */
--radius-input-card: 24px  /* Composer 圆角 */
--radius-bubble: 20px      /* 消息气泡 */
--radius-chip: 12px        /* 附件 chip */
--radius-emoji-grid: 8px   /* emoji 格子 */

/* 阴影 */
--shadow-composer: 0 18px 60px -42px rgba(15, 23, 42, 0.65)
--shadow-emoji-picker: 2xl  /* z-50, mb-2 */
--shadow-bubble: subtle

/* 间距 */
--gap-composer-padding-x: 16px
--gap-composer-padding-y: 12px
--gap-attachment-row: 6px
```

### 3.2 关键界面示意

#### 3.2.1 Composer（消息输入框）

```
┌──────────────────────────────────────────────────────┐
│ [🖼️ 1.png] [📄 readme.pdf]                ← 附件预览 │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Ask Ayaka anything...                              │ │
│ │ (auto-expand up to 152px)                          │ │
│ └──────────────────────────────────────────────────┘ │
│ [😊] [📎] │ [Agent] [Model]               [⏹ / ↑]   │
└──────────────────────────────────────────────────────┘
   border: foreground/15
   focus-within: border-accent/45 + ring-accent/10
   drag-over:   border-accent/60 + ring-accent/15
   no-model:    border-warning/35
```

#### 3.2.2 Emoji Picker

```
┌────────────────────────────┐
│ 🔍 搜索 emoji...        ✕  │  ← 搜索框
├────────────────────────────┤
│ 😀 😂 😃 😄 😁 😆 😅 🤣   │  ← 分类 tab
├────────────────────────────┤
│ 😀 😃 😄 😁 😆 😅 🤣 😂   │  ← 8 列网格
│ 🙂 🙃 😉 😊 😇 🥰 😍 🤩   │
│ 😘 😗 😚 😙 🥲 😋 😛 😜   │
│ ... (max-h-240 滚动)       │
└────────────────────────────┘
   尺寸: 320 × 自适应
   圆角: 16px
   背景: 玻璃拟态
```

#### 3.2.3 Hover 工具条（消息）

```
                            ┌─────────────────┐
                            │ 👍 ❤️ 🎉 😂 🤔 🔥│  ← QuickReactions
                            └─────────────────┘
   ┌──────────────────────────────────────────┐
   │ 这是 AI 的回复...                            │  ← 助手消息
   │                                          │  ← 文本
   │ [📋 复制]   已复制                          │  ← Copy (hover 显示)
   └──────────────────────────────────────────┘
```

#### 3.2.4 消息附件

```
   用户消息:
   ┌──────────────────────────────────────┐
   │ [图1] [图2] [图3]                     │  ← 图片网格（最多 3 列）
   │ [📄 readme.pdf]  2.3 MB              │  ← 文件 chip
   │ 这是问题描述...                         │  ← 文本
   └──────────────────────────────────────┘
```

#### 3.2.5 侧栏历史分组

```
   ─────────────  对话历史          [+] ───
   🔍 搜索会话...                         ← 搜索框

   今天
     💬 解释量子计算                🗑
     💬 React 组件设计                🗑

   昨天
     💬 关于 TypeScript                🗑

   本周
     💬 周会议程                      🗑

   更早
     💬 旅行计划                      🗑
```

### 3.3 动效规范

| 元素                 | 动效                               | 时长  | 缓动     |
| -------------------- | ---------------------------------- | ----- | -------- |
| Emoji Picker 出现    | fade + scale(0.95→1) + slideUp 4px | 150ms | ease-out |
| Quick Reactions 出现 | scale(0.95→1) + fade               | 150ms | ease-out |
| Suggestion hover     | translateY(-2px) + border 变       | 150ms | ease-out |
| 附件 chip 出现       | fade                               | 200ms | ease-out |
| 拖拽高亮             | border + ring 变                   | 200ms | ease-out |
| Drop overlay 出现    | fade                               | 100ms | ease-out |

### 3.4 颜色对比度（无障碍）

- 主文字 / 背景：≥ 7:1
- 次级文字 / 背景：≥ 4.5:1
- 强调色按钮文字：始终白/深色（自动对比）
- 焦点环：accent + 4px ring（不依赖颜色感知）

---

## 4. 核心组件 API

### 4.1 ChatView

```ts
interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo; // 来自 main 进程（port + token）
}
```

**职责**：

- 加载会话历史
- 管理 `useChat`（Vercel AI SDK）
- 错误捕获 + 持久化
- 渲染空态 / 列表 / Composer

**状态**：

| 状态              | 类型             | 用途                          |
| ----------------- | ---------------- | ----------------------------- |
| `selectedModel`   | `string \| null` | 关联 SettingKey.SelectedModel |
| `selectedAgentId` | `string \| null` | 关联 SettingKey.ActiveAgentId |
| `initialMessages` | `UIMessage[]`    | 从 DB 加载                    |
| `historyLoaded`   | `boolean`        | 控制 loading 态               |
| `chatError`       | `string \| null` | UI 错误展示                   |

**关键行为**：

```ts
// 1) 历史加载：每次 conversationId 变化
useEffect(() => {
  void api.messages.list(conversationId).then((rows) => {
    // row.content 是 JSON 序列化的 UIMessage
    const msgs = rows.map((row) => JSON.parse(row.content));
    setInitialMessages(msgs);
  });
}, [conversationId]);

// 2) 发送消息（支持附件）
const handleSend = async ({ text, files }) => {
  // 把 FilePartLike[] 转 ai-sdk FileUIPart[]
  // 预保存到 DB（异步）
  // 触发流式响应
};

// 3) 错误处理：onError 持久化到 DB + toast
```

---

### 4.2 MessageInput

```ts
interface MessageInputProps {
  isLoading: boolean;
  /** 发送回调：包含文本与文件（ai-sdk FileUIPart[]） */
  onSend: (payload: { text: string; files: FilePartLike[] }) => void;
  /** 流式中允许停止 */
  onStop?: () => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
  /** 单个附件最大字节数（默认 10MB） */
  maxFileSize?: number;
  /** 允许的 MIME 类型前缀 */
  accept?: string;
}
```

**特性**：

- 自适应高度（16px → 152px）
- ⌘/Ctrl + Enter 强制发送
- 拖拽 / 粘贴文件
- Emoji 选择器（光标位置插入）
- 实时显示附件预览与大小
- 流式中显示停止按钮，停止时不影响下次发送

**内部子组件**：

```
<PromptInput status={status} onSubmit={handleSubmit}>
  <PromptInputTextarea ref={textareaRef} ... />
  <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={handleEmojiSelect} />
  <AttachmentChip item={a} onRemove={removeAttachment} />  // 每个附件
  <AgentSelector />
  <ModelSelector />
  <PromptInputSubmit status={status} disabled={!canSend} />
</PromptInput>
```

**暴露的 PendingAttachment 类型**：

```ts
export interface PendingAttachment extends AttachmentItem {
  file: File; // 原始 File 引用
}
```

---

### 4.3 MessageList

```ts
interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error;
  errorDetail?: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}
```

**内部结构**：

```
<Conversation>
  <ConversationContent>
    {messages.map(m => (
      <Message from={m.role}>
        <Reasoning>...</Reasoning>
        <MessageAttachments parts={fileParts} />   {/* 图片 + 文件 */}
        <MessageResponse>...</MessageResponse>
        <Tool>...</Tool>
        <QuickReactions onReact={...} />           {/* 创意 */}
        <CopyButton />                             {/* hover 复制 */}
      </Message>
    ))}
    {error && <ErrorBanner />}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

---

### 4.4 ai-elements 子组件

#### 4.4.1 `<EmojiPicker>`

```ts
interface EmojiPickerProps {
  open: boolean; // 受控
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void; // 选中回调
  onCategoryChange?: (id: string) => void;
  categories?: EmojiCategory[]; // 自定义分类
  placeholder?: string;
}
```

**内置数据**：`DEFAULT_EMOJI_CATEGORIES`（6 类 ~180 个 emoji，附关键字）

**使用示例**：

```tsx
const [open, setOpen] = useState(false);

<button onClick={() => setOpen(true)}>😊</button>
<EmojiPicker
  open={open}
  onOpenChange={setOpen}
  onSelect={(e) => insertAtCursor(e)}
  placeholder="搜索..."
/>
```

**键盘交互**：

- Esc 关闭
- 点击外部关闭
- 输入关键字过滤当前分类

---

#### 4.4.2 `<AttachmentChip>`

```ts
interface AttachmentItem {
  id: string;
  file?: File;
  name: string;
  mediaType: string;
  size: number;
  url?: string;
  variant?: "image" | "video" | "audio" | "file";
}

interface AttachmentChipProps {
  item: AttachmentItem;
  onRemove?: (id: string) => void; // 不传则不显示移除按钮
  compact?: boolean; // 紧凑模式（消息中展示）
}
```

**使用示例**：

```tsx
<AttachmentChip
  item={{ id: "1", name: "photo.png", mediaType: "image/png", size: 12345, file }}
  onRemove={(id) => setList((prev) => prev.filter((x) => x.id !== id))}
/>
```

**变体**：

- `image`：显示缩略图（ObjectURL）
- `video` / `audio` / `file`：显示 SVG icon 占位

---

#### 4.4.3 `<QuickReactions>`

```ts
export const DEFAULT_REACTIONS: readonly string[] = ["👍", "❤️", "🎉", "😂", "🤔", "🔥"];

interface QuickReactionsProps {
  onReact: (emoji: string) => void;
  reactions?: readonly string[]; // 自定义
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}
```

**使用**：必须放在 `className="group/msg"` 容器内（默认 hover 行为通过 `group-hover/msg:opacity-100` 触发）

```tsx
<div className="group/msg relative">
  <MessageResponse>{text}</MessageResponse>
  <QuickReactions onReact={(emoji) => console.log(emoji)} />
</div>
```

**视觉**：玻璃拟态，hover/focus 容器时透明度 0→1 + scale 0.95→1

---

#### 4.4.4 `<MessageAttachments>`

```ts
export interface FilePartLike {
  type: string;
  mediaType?: string;
  filename?: string;
  url?: string; // ai-sdk 标准
  data?: string; // 兼容旧字段
}

interface MessageAttachmentsProps {
  parts: FilePartLike[];
  className?: string;
}
```

**渲染规则**：

- 图片：自适应网格（1 / 2 / 3 列）
- 其他：横排 chip

**使用**：

```tsx
const fileParts = message.parts.filter((p) => p.type === "file");
<MessageAttachments parts={fileParts} />;
```

---

#### 4.4.5 `<PromptSuggestions>`

```ts
interface PromptSuggestionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  title?: string;
}
```

**使用**（典型：空态）：

```tsx
<PromptSuggestions
  title="试试这些问题"
  suggestions={["解释量子计算", "写一首诗", "..."]}
  onSelect={(s) => sendMessage(s)}
/>
```

---

## 5. 数据流与文件附件

### 5.1 文件附件完整流程

```
┌──────────────┐    用户拖拽/粘贴/选择
│  File 对象   │ ─────────────────────────────────┐
└──────────────┘                                  ▼
                              ┌──────────────────────────────────┐
                              │  MessageInput.ingestFiles()     │
                              │  - 大小校验 (<10MB)              │
                              │  - MIME 校验                    │
                              │  - 生成 PendingAttachment      │
                              │  - 显示 AttachmentChip          │
                              └──────────────────────────────────┘
                                                  │ 用户点击发送
                                                  ▼
                              ┌──────────────────────────────────┐
                              │  MessageInput.flushSubmit()      │
                              │  - readFileAsDataURL(file)        │
                              │  - 构造 FilePartLike             │
                              │  - 调用 onSend                   │
                              └──────────────────────────────────┘
                                                  │
                                                  ▼
                              ┌──────────────────────────────────┐
                              │  ChatView.handleSend()          │
                              │  - 转 ai-sdk FileUIPart          │
                              │  - 预保存到 DB（API）            │
                              │  - chat.sendMessage({text,files})│
                              └──────────────────────────────────┘
                                                  │
                                                  ▼
                              ┌──────────────────────────────────┐
                              │  Hono Server (main process)      │
                              │  - 解析 multipart                │
                              │  - 调用 AI SDK                   │
                              │  - 流式返回                      │
                              └──────────────────────────────────┘
```

### 5.2 数据格式约定

| 字段                   | 类型                  | 协议                                          |
| ---------------------- | --------------------- | --------------------------------------------- |
| `FileUIPart.url`       | `string`              | base64 dataURL（`data:image/png;base64,...`） |
| `FileUIPart.mediaType` | `string`              | IANA MIME                                     |
| `FileUIPart.filename`  | `string \| undefined` | 文件名                                        |

**关键点**：ai-sdk v2+ 的 `FileUIPart` 用 `url` 字段承载 dataURL（不是 `data`）。本项目统一使用 `url`。

### 5.3 历史消息回填

- DB 中 `messages.content` 是完整 UIMessage JSON 字符串
- 包含所有 parts（text / file / tool-\* / reasoning）
- 加载时直接 `JSON.parse` 后交给 `useChat` 作为 initialMessages

---

## 6. 聊天历史管理

### 6.1 增强特性

`AppShell` 的会话列表新增了三个能力：

1. **搜索框**（仅在有会话时显示）
2. **日期分组**（今天 / 昨天 / 本周 / 更早）
3. **删除按钮的视觉提示**（hover 浮现，红化）

### 6.2 实现要点

```ts
// 过滤 + 分组
const groupedConversations = useMemo(() => {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) => c.title.toLowerCase().includes(q))
    : conversations;
  // 按 updated_at 分组到 4 个固定 label
  // 顺序：今天 → 昨天 → 本周 → 更早
}, [conversations, searchQuery, t]);
```

### 6.3 API 与现有 IPC 兼容

- 仍使用 `api.conversations.list / .delete / .touch`
- 不增加 IPC 调用次数
- 不影响 Trash 行为

---

## 7. i18n 文案扩展

新增键（zh-CN + en）：

```ts
// AppShell
"shell.conversations":       "对话历史" / "Conversations"
"shell.searchPlaceholder":   "搜索会话…" / "Search conversations…"
"shell.noSearchResult":      "没有匹配的会话" / "No matching conversations"
"shell.group.today":         "今天" / "Today"
"shell.group.yesterday":     "昨天" / "Yesterday"
"shell.group.thisWeek":      "本周" / "This week"
"shell.group.earlier":       "更早" / "Earlier"

// ChatView
"chat.empty.title":          "开始一段新对话" / "Start a new conversation"
"chat.empty.subtitle":       "向 Ayaka 提问..." / "Ask Ayaka anything..."
"chat.copy":                 "复制消息" / "Copy message"
"chat.copied":               "已复制" / "Copied"

// MessageInput
"input.placeholder.withAttachments": "添加一些文字..." / "Add some text..."
"input.emoji":               "插入表情" / "Insert emoji"
"input.attach":              "上传附件" / "Attach file"
"input.dropHint":            "松手即可附加文件" / "Drop files to attach"
"input.shortcutHint":        "Enter 发送 · ..." / "Enter to send · ..."

// MessageList
"msg.copy":                  "复制" / "Copy"
"msg.copied":                "已复制" / "Copied"
```

---

## 8. 使用示例

### 8.1 最小化集成

```tsx
import { ChatView } from "@/components/ChatView";

function App() {
  return <ChatView conversationId="conv-123" serverInfo={{ port: 3939, token: "..." }} />;
}
```

### 8.2 自定义 Emoji 分类

```tsx
import { EmojiPicker, type EmojiCategory } from "@/components/ai-elements";

const myCategories: EmojiCategory[] = [
  {
    id: "reactions",
    label: "常用",
    icon: "⚡",
    entries: [
      { char: "👍", keywords: ["thumbs", "up"] },
      { char: "❤️", keywords: ["heart"] },
    ],
  },
];

<EmojiPicker open={open} onOpenChange={setOpen} onSelect={onSelect} categories={myCategories} />;
```

### 8.3 自定义空态建议

```tsx
const mySuggestions = ["总结今天的会议", "为新项目起个名字", "解释 TypeScript 的类型系统"];

<PromptSuggestions title="试试这些" suggestions={mySuggestions} onSelect={(s) => handleSend(s)} />;
```

### 8.4 自定义文件大小限制

```tsx
<MessageInput
  isLoading={isLoading}
  onSend={handleSend}
  selectedModel={model}
  selectedAgentId={agentId}
  onModelChange={setModel}
  onAgentChange={setAgentId}
  maxFileSize={5 * 1024 * 1024} // 5MB
  accept="image/*,application/pdf"
/>
```

### 8.5 完整自定义消息渲染

```tsx
import {
  Message,
  MessageResponse,
  Reasoning,
  QuickReactions,
  MessageAttachments,
} from "@/components/ai-elements";

function CustomMessage({ message, onReact }) {
  return (
    <Message from={message.role} className="group/msg relative">
      <MessageAttachments parts={message.parts.filter((p) => p.type === "file")} />
      {message.parts.map((p, i) => {
        if (p.type === "text") return <MessageResponse key={i}>{p.text}</MessageResponse>;
        if (p.type === "reasoning") return <Reasoning key={i}>...</Reasoning>;
      })}
      <QuickReactions onReact={onReact} />
    </Message>
  );
}
```

---

## 9. 可扩展点

### 9.1 替换 Emoji 字典

`EmojiPicker` 接受 `categories` prop，可注入完整自定义字典（如品牌专属 emoji）。

### 9.2 自定义附件 Chip 行为

`<AttachmentChip onRemove={...}>` 可省略，变为纯展示模式；可以传入更复杂的 `variant` 来扩展。

### 9.3 替换 QuickReactions

通过 `reactions` prop 改变默认 6 个反应；通过 `placement` 改变位置。

### 9.4 主题色扩展

所有强调色 / 焦点环使用 `accent` token。修改 shadcn/base-ui 的主题 bundle 或 Tailwind v4 的 `@theme` 即可全局生效。

### 9.5 i18n 扩展

仅需在 `lib/i18n.tsx` 增加新键；新语言只需在 `LOCALES` 数组中追加并补全字典。

### 9.6 文件上传管线扩展

`flushSubmit` 中可插入：

- 客户端压缩（图片）
- 上传到对象存储后用 URL 替代 dataURL

---

## 10. 已知限制

1. **大文件占用内存**：当前所有文件 base64 后驻留在内存中；超过 10MB 的文件会被拒绝（默认）。如需更大文件，建议客户端压缩后上传。
2. **图片画廊无全屏预览**：`<MessageAttachments>` 当前只展示缩略图，点击打开新标签页（浏览器行为）。如需 Lightbox，需自行实现。
3. **历史分组基于本地时间**：`AppShell` 的日期分组按客户端时区计算。跨时区切换可能导致分组位置变化。
4. **表情反应未持久化**：`<QuickReactions>` 当前回调只触发 `console.log + toast`，未写入 DB。如需保留反馈，可扩展 `handleReaction` 与 messages 表。
5. **拖拽上传不显示实时进度**：当前为「松手即附加」。如需显示上传进度条，可在 `flushSubmit` 中加入进度状态。

---

## 附录 A：文件清单

| 文件                                             | 状态     | 行数（约） | 用途            |
| ------------------------------------------------ | -------- | ---------- | --------------- |
| `components/ChatView.tsx`                        | 重构     | 350        | 路由 + 发送控制 |
| `components/MessageList.tsx`                     | 重构     | 240        | 消息渲染        |
| `components/MessageInput.tsx`                    | 重构     | 415        | Composer        |
| `components/AppShell.tsx`                        | 增强     | 305        | 侧栏 + 历史分组 |
| `components/ai-elements/emoji-picker.tsx`        | **新增** | 360        | 表情选择        |
| `components/ai-elements/attachment-chip.tsx`     | **新增** | 145        | 附件 chip       |
| `components/ai-elements/quick-reactions.tsx`     | **新增** | 70         | hover 反应      |
| `components/ai-elements/message-attachments.tsx` | **新增** | 95         | 消息附件        |
| `components/ai-elements/prompt-suggestions.tsx`  | **新增** | 55         | 空态建议        |
| `components/ai-elements/prompt-input.tsx`        | 增强     | 230        | 暴露 ref        |
| `components/ai-elements/index.ts`                | 更新     | —          | 导出新组件      |
| `components/icons.tsx`                           | 增强     | —          | 新增 6 个 icon  |
| `lib/i18n.tsx`                                   | 增强     | —          | 新增 14 个键    |
| `docs/chat-component.md`                         | **新增** | —          | 本文档          |

## 附录 B：ASCII 界面总览

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Ayaka                                  local                              │
│ ─────────────────────────────────────────────────────────────────────────── │
│  🏠 Ayaka OS       ┌─ 对话历史                       [+] ─┐                  │
│  💬 Chat          │ 🔍 搜索会话…                          │                  │
│  🤖 Agents        │                                        │                  │
│  ⚙️ Agent Loop    │ 今天                                    │                  │
│  💾 Memory        │   💬 解释量子计算                🗑    │                  │
│  🔐 Runtime       │   💬 React 组件设计              🗑    │                  │
│  🌐 Server        │                                        │                  │
│  🖥️ Interactions │ 昨天                                    │                  │
│  ☀️ Sync          │   💬 TypeScript 学习               🗑    │                  │
│                  │                                        │                  │
│                  │ 本周                                    │                  │
│                  │   💬 周会议程                       🗑    │                  │
│                  │                                        │                  │
│                  │ 更早                                    │                  │
│                  │   💬 旅行计划                       🗑    │                  │
│                  │                                        │                  │
│                  │ [⚙️ Settings]                          │                  │
│                  └────────────────────────────────────────┘                  │
│ ─────────────────────────────────────────────────────────────────────────── │
│  对话                                                                       │
│                                                                             │
│                                          ┌───────────────────────────────┐ │
│                                          │ 这是 AI 的回复内容...            │ │
│                                          │ [📋 复制]   已复制              │ │
│                                          └───────────────────────────────┘ │
│  ┌────────────────────────────────────────┐                                  │
│  │ 这是用户的问题...                          │                                  │
│  │ [🖼️ photo.png] [📄 readme.pdf]              │                                  │
│  └────────────────────────────────────────┘                                  │
│                                                                             │
│ ─────────────────────────────────────────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Ask Ayaka anything...                                                  │  │
│  │ (auto-expand to 152px)                                                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  [😊] [📎] │ [Agent] [Model]                                    [⏹ / ↑]   │
│  Enter 发送 · Shift+Enter 换行 · ⌘/Ctrl+Enter 强制发送                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

**版本**：v1.0（2026-07-04）
**作者**：Void AI Team
**依赖**：React 19, shadcn/base-ui, Tailwind v4, Vercel AI SDK, ai-elements
**许可**：MIT
