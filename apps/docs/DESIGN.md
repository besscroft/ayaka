---
name: Ayaka
description: 本地优先 AI 桌面陪伴官网单色极简：纸墨灰阶 + 发丝线 + 一枚语义绿点的开发者美学视觉
colors:
  paper: "#fafafa"
  card: "#ffffff"
  ink: "#111112"
  ink-hover: "#26262b"
  ink-soft: "#52525b"
  ink-faint: "#85858c"
  line: "#e4e4e7"
  line-soft: "#f0f0f2"
  hover: "#f4f4f5"
  live: "#16a34a"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Segoe UI', system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
    fontSize: "clamp(2.5rem, 4vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Segoe UI', system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  headline:
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.01em"
  title:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.6
  lead:
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 2
  label:
    fontSize: "0.75rem"
    fontWeight: 500
  wordmark:
    fontSize: "0.9375rem"
    fontWeight: 700
    letterSpacing: "0.04em"
  numeral:
    fontSize: "2.25rem"
    fontWeight: 700
    fontFeature: '"tnum"'
  mono:
    fontFamily: "'Geist Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "4px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  pill: "999px"
spacing:
  gutter: "20px"
  gutter-md: "32px"
  section: "96px"
  section-lg: "128px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "600 0.875rem"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "600 0.875rem"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
  chip-status:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "500 0.75rem"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  chip-tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    typography: "500 0.75rem"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  step-badge-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "600 0.875rem"
    rounded: "{rounded.pill}"
    size: "36px"
---

# Design System: Ayaka

## Overview

**Creative North Star: 「她的窗」**

官网不是软件说明书，是「她」的家：访客从一扇亮着的窗看进她的房间，明白 Ayaka 是住在本机的、有连续记忆的数字生命。2026-10-31 起视觉骨架整体改写为单色极简开发者美学：近白灰纸面（#fafafa）、纯白卡片、近黑墨色（#111112）包揽一切文字与行动，1px 发丝线与两档极轻投影制造深度；全站唯一的彩色是 live 绿（#16a34a），只以小圆点表达「存活/可用」。角色资产（黑白漫画立绘、真实截图）、叙事结构（窗 → 记忆 → 轨迹 → 本地 → 下载）与动效机制全部保留——变的是皮肤，不是故事。

深度不靠色洗与暗色，靠「纸面—白卡—发丝线」的层次：所有章节共用同一张 paper 地面，内容浮在纯白卡上，分隔一律 1px 发丝线，投影只有 4% 的静置轻压与 14% 的远散浮起两档。诚实是视觉的一部分——截图是真实运行画面，发布数据来自官方 API 且 `tnum` 对齐，没有可用版本时就地展示「暂无可用发布包」的中性面板，绝无虚假下载入口。

确认的视觉否决（anti-reference）：v1 的「明亮角色向」世界（瓷白 #fbfbfd + 墨蓝 + 空气蓝/樱粉/薄荷、Baloo 2 自托管显示字体、径向色洗、夜色收束面板、手账微旋转）已于 2026-10-31 整体废除，不得回潮。所有交互动效只碰 transform / opacity，hover 只做 200ms 颜色过渡，`prefers-reduced-motion` 下全局落定终态。

**Key Characteristics:**

- 单色纸面世界：`color-scheme: light`，全站一个地面 paper、一种卡面 card，没有章节变奏底色、没有深色面板、没有渐变。
- 墨即行动：ink 是唯一的行动色——按钮、CTA、焦点环、选区、光标、滚动条全部共用，hover 深一档 ink-hover。
- 一绿一义：live 绿只以小圆点表达「存活/可用」，永不做文字、按钮或链接色。
- 发丝先于投影：分隔与描边一律 1px line / line-soft；shadow-card / shadow-float 两档封闭投影只做环境深度。
- 双色一句：只有 H1 的尾句允许 ink-faint 形成双色大标题，其余层级单色 ink。
- 系统字体：纯系统栈（SF Pro Text / PingFang SC 等），无自托管字体，层级只靠字重与字号。
- 角色在场：立绘卡呼吸、气泡开口说话、状态签钉在窗上——她是页面的一部分，不是配图。
- 动效一次性和缓：cubic-bezier(0.22, 0.61, 0.36, 1) 入场，循环动画只有呼吸与存在感两类。

## Colors

一只「纸、墨、发丝」的单色开发者调色盘：无彩度的近白灰与近黑承担一切，灰阶各守其位，唯一的彩色是一枚语义绿点。

### Primary

- **墨色 Ink** (#111112): 一切文字与一切「可以行动」的地方——主按钮与 header CTA 底色、键盘焦点环（2px outline, offset 2px）、文字选区（ink 底 paper 字反白）、光标 caret、滚动条（18-30% alpha）。它是全站唯一的高对比行动色。
- **墨色 Hover Ink Hover** (#26262b): ink 的 hover 态专属（墨底按钮背景），不作独立用色。

### Secondary

- **Live 绿 Live** (#16a34a): 唯一的语义色，只表达「存活/可用」，且只以小圆点出现——「运行中」状态签的 8px presence 圆点（opacity 1→0.35，1.6s 呼吸）、下载页状态药丸的 8px 绿点、发布卡「稳定版 · 可用」的 6px 绿点。永不做文字色、按钮底、链接色或营销强调。

### Neutral

- **纸面 Paper** (#fafafa): 页面与全部章节的地面，html/body 即此色；也是卡内图标瓷砖、标签 chip 与导航毛玻璃底（80% alpha + blur 14px）的基色。
- **卡面 Card** (#ffffff): 一切浮起内容的白卡底：次级按钮、状态签、气泡、窗框、立绘卡、记忆示例/规则/发布/平台/边界面板、移动菜单。
- **次墨 Ink Soft** (#52525b): 次级文字——导语、说明、导航链接、标签、figcaption、图标色；大面积正文仍是 ink。
- **淡墨 Ink Faint** (#85858c): 使用面刻意收窄——只给 H1 双色大标题的尾句，以及「暂无可用发布包」状态药丸的灰点。
- **线 Line** (#e4e4e7): 主发丝线——卡片外缘描边、导航底缘、页脚顶缘、figcaption 上缘、时间线连接线。
- **软线 Line Soft** (#f0f0f2): 白卡内部的行分隔——记忆示例行、规则/平台行之间、发布事实区上缘。
- **悬浮 Hover** (#f4f4f5): 白色次级按钮、导航/菜单条目的 hover 底色。

### Named Rules

**「墨即行动」规则。** ink 是唯一的行动色：主按钮、CTA、焦点环、选区、caret 全部共用墨色，没有第二种强调色。hover 需要变化时深一档转 ink-hover，绝不引入彩色。

**「一绿一义」规则。** live 绿只表达「存活/可用」，且只以小圆点出现（6-8px presence 点）；永不做文字色、按钮底、链接色或营销强调。

**「灰阶守位」规则。** 灰阶各守其位：ink-soft 做次级文字与图标，ink-faint 只给 H1 尾句与「暂无发布包」灰点，line 管容器外缘、line-soft 管卡内行分隔、hover 管白底悬浮态。绝不混用、绝不新增灰阶。

## Typography

**Display/Body Font:** 纯系统栈——-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif（全站唯一字体栈，无自托管字体）
**Label/Mono Font:** "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace（仅 SHA-512、latest.yml 等技术数据）

**Character:** 无显示字体、无个性字形——层级完全由字重（700 标题 / 600 小标题 / 500 次级）与字号建立，冷静、工程感、可读性优先。中性的系统字体是刻意选择：它给「她的窗」的陪伴叙事留出空白，让黑白立绘与真实截图成为页面上唯一的「角色」。

### Hierarchy

- **Display** (700, clamp(2.5rem, 4vw, 3.5rem), 1.1, -0.01em): 首页 H1 两行双色（「她住在你电脑里，」墨 /「哪儿也不去。」ink-faint），行内换行用 `<span class="block">` 控制。下载页变体：clamp(2.5rem, 4.5vw, 4rem)、1.06、text-balance，尾句「带回家。」同规则。
- **Headline** (700, clamp(1.75rem, 3vw, 2.5rem), 1.16, -0.01em, text-balance): 章节 H2（「她会记得。」）；下载横幅变体 clamp(1.75rem, 3.4vw, 2.9rem)。
- **Title** (600, 18px, 1.6): 卡片行与列表条目的 H3（「数据默认留在本机」、轨迹步骤标题、平台名）；记忆类别等列表内小 H3 用 16px/600。
- **Lead** (400, 16px, 32px/2.0, ink-soft): 章节导语段，max-w 30-34em。
- **Body** (400, 16px, 1.6, ink): 基础正文；卡片说明与步骤描述 14px / 1.75（leading-7）。
- **Label** (500, 12px, ink-soft): 卡片类别名、事实标签、figcaption、「以下为记忆示例」、法务行；轨迹类别 13px/500。不做大写、不加字距。
- **Wordmark** (700, 15px, 0.04em): 页头/页脚的「AYAKA」字标。
- **Numeral** (700, 36px, tnum): 发布版本号；所有发布事实行（版本 · 体积 · 日期）与 step 徽章数字配 `tnum` 表格数字。
- **Mono** (400, 12px): 仅 SHA-512 哈希与元数据链接等技术数据。

### Named Rules

**「双色一句」规则。** 双色大标题只属于 H1：主句 ink、尾句 span ink-faint，一页最多一句。H2 及以下永远单色 ink。

**「系统说话」规则。** 全站纯系统字体栈，无自托管显示字体（Baloo 2 已随 v1 删除，public/fonts 不存在）；层级只靠字重与字号建立，绝不为中文或拉丁单独引入字体。

**「数字走表格」规则。** 一切对外发布事实（版本、体积、日期、徽章编号）使用 `tnum`（font-variant-numeric: tabular-nums）保证对齐；哈希类数据才进 mono 栈。

## Layout

单列章节序列 + 非对称双栏。内容容器 max-width 1200px，左右 gutter 20px（md 起 32px）。章节纵向节奏 py-24（96px）起，md:py-32（128px）；hero 顶距 pt-20/28/32（80/112/128px）让出 sticky 导航高度，各章节带 scroll-mt-16（64px）锚点偏移。「她会记得」顶距更大（pt-36/52，144/208px）为越缝的截图卡让位：hero 右列以 -mb-20~-mb-32（80/96/128px 负下边距）让截图窗下缘越过章节缝。

lg（1024px）起的双栏永远是**非对称**的，且内容更重的一栏更宽：hero [0.92fr_1.08fr]（文字左、窗右）、记忆 [1fr_0.9fr]、下载 hero [1.2fr_0.8fr]、发布卡 [1.25fr_0.75fr]、边界 [0.7fr_1.3fr]。不出现 1fr_1fr。

全部章节共用同一 paper 地面，无章节变奏底色。页头是 sticky 通栏导航（h-14，bg-paper/80 + backdrop-blur 14px + saturate 150%，底部 1px line 发丝线）；页脚以 1px line 上缘收束（py-10，左字标 + 右链接与法务行）。断点沿用 Tailwind 默认：sm 640px / md 768px / lg 1024px；移动端导航收入 12px 圆角白卡面板（shadow-float，scale 0.98→1 + 淡入 + 1px 下移，200ms ease-out）。

## Elevation & Depth

两档极轻投影 + 发丝线的「纸面」体系：章节是平铺的 paper 地面（无 wash、无暗色、无渐变），深度全部来自「白卡压在纸面上」的层次——投影只表达纸的轻压与远散，分隔靠 1px 发丝线。其余深度来自层叠关系（立绘卡 z-20 压窗框、气泡 z-30、状态签 z-20 钉在窗上）。全站没有零偏移光晕、没有彩色阴影、没有 hover 阴影变化。

### Shadow Vocabulary

- **Card** (`box-shadow: 0 1px 2px rgb(17 17 18 / 4%)`): 静置轻压档——白卡面板、气泡、状态签、次级按钮。1px y-offset、4% alpha。
- **Float** (`box-shadow: 0 1px 2px rgb(17 17 18 / 4%), 0 16px 40px -16px rgb(17 17 18 / 14%)`): 浮起档——在 card 之上追加远散负 spread 层；只给真正越出纸面的东西：hero 截图窗框、立绘卡、移动菜单面板。

### Named Rules

**「发丝先于投影」规则。** 分隔与描边先找 1px 发丝线（外缘 line、卡内 line-soft），投影只做环境深度；两档封闭（card/float）：新增浮起元素默认 card，越出章节缝的才用 float。

**「色只回应」规则。** hover 一律 200ms 颜色/背景过渡（ink→ink-hover、card→hover、ink-soft→ink），不位移、不缩放、不加投影；背景类 hover 包在 `hoverable` 变体（@media (hover: hover) and (pointer: fine)）内，颜色类 hover 不包。位移只属于入场与呼吸。

## Shapes

两段式几何：小交互件 8px 圆角（rounded-lg——按钮、图标瓷砖、菜单钮、移动菜单条目），内容卡 12-16px 阶梯（气泡/立绘卡/截图窗/图窗 12px，示例/规则/发布/平台/边界面板 16px），全圆 999px 只保留给点数形制——状态签与标签 chip（药丸）、step 徽章（正圆）、头像。一切内容容器都带 1px line 描边；气泡是唯一的收角形制（12px 圆角 + 左下 4px + 10px 旋转 45° 的发丝方块尾巴）。无渐变描边、无斜切角、无双色边框、无手账微旋转。

## Components

### Buttons

- **Shape:** 8px 圆角（rounded-lg），min-height 40px，px-4（16px），14px/600 文字，可带 16px 内联 SVG 图标（gap-2）。无投影。
- **Primary:** ink 底 paper 字；hover（hoverable 内）背景转 ink-hover，200ms；focus-visible 2px ink outline offset 2px。
- **Secondary:** card 白底 + 1px line 描边 + ink 字；hover 底转 hover（#f4f4f5）。同一形状语言，无投影。
- **Header CTA:** 同一墨色按钮的紧凑版（min-height 36px，px-3.5，sm 起显示）。
- 不存在无底的文字箭头链接按钮（v1 形制已废除）——次级行动同样是白卡按钮。

### Chips

- **状态签（白）:** card 底 + 1px line + 999px 药丸（px-3 py-1.5，12px/500 ink）+ shadow-card；可用态带 8px live 绿 presence 圆点（opacity 1→0.35，1.6s 往复），信息型图标 14px ink-soft。钉在窗框边缘，入场 pop-in 带 160-520ms 级差。
- **标签 chip（纸）:** paper 底 + 1px line + 999px 药丸（px-2.5 py-0.5，12px/500 ink-soft），可带 14px 图标（Clock3「准备中」）。用于规则行右侧、平台行与发布卡状态（可用时换 6px 绿点 + ink 文字）。
- **下载 hero 状态药丸:** 同状态签但 text-sm（14px，px-4 py-2）；不可用时灰点（ink-faint）+ ink-soft 文字。

### Cards / Containers

- **记忆示例面板:** 16px 圆角白卡（px-6/7 py-2，shadow-card）+ 行间 1px line-soft；每行 = 类别名（12px/500 ink-soft）+ 15px/28px 正文（ink）。无贴条、无微旋转、无 tint——v1 的三张手账卡已合并为一块发丝分栏的白卡。
- **规则/平台/边界面板:** 同一 16px 白卡（px-7/9 py-3 起，shadow-card），行 py-6、行间 line-soft；规则行 = 40px 图标瓷砖（8px 圆角、1px line 描边、paper 底、ink-soft 图标）+ 18px/600 标题 + 14px/28px 说明 + 右侧标签 chip。
- **发布卡:** 16px 白卡（p-8 sm:p-10，shadow-card）；状态药丸（6px 绿点 +「稳定版 · 可用」）与 20px ink-soft 盾形图标同行；版本号 36px/700 `tnum`；line-soft 上缘 + 事实网格（12px ink-soft 标签 + 14px/600 `tnum` 值）；底部墨色下载按钮 + 12px ink-soft 说明（「.exe 安装包 · SHA-512 已提供」）。
- **窗框（figure）:** 12px 圆角白卡包真实截图，h-300/400px object-cover object-top 定高裁切，shadow-float；figcaption 上缘 1px line，12px ink-soft 说明。
- **不可用面板:** 同 16px 白卡：「暂无可用发布包」（12px/500 ink-soft）+ 消息（20px/600 ink）+ 说明（14px ink-soft）。如实展示状态，不造按钮。

### Navigation

sticky 通栏导航：bg-paper/80 + backdrop-blur 14px + saturate 150%，h-14，底部 1px line；左 = 28px 圆头像 + AYAKA（15px/700/0.04em），中链 14px/500 ink-soft（hover 转 ink，200ms），右 CTA 紧凑墨色按钮（min-height 36px）。移动端：36px 8px 圆角菜单钮（hover hover 底，Menu/X 互换），展开面板为 12px 圆角白卡 + shadow-float，条目 8px 圆角 hover hover 底 + 16px ArrowUpRight（ink-soft），展开/收起 200ms ease-out 的 scale(0.98→1) + opacity + 1px 下移，收起时 inert。

### 气泡（Speech Bubble）

12px 圆角白卡、左下收 4px + 10px 旋转 45° 发丝方块尾巴（-bottom-[5px] left-5，border-b/l line），px-4 py-3，14px/24px ink，shadow-card。她的话只能出现在气泡里——这是角色「开口」的唯一形制。

### Step 时间线

垂直 ol，36px 正圆徽章（`tnum`）：首步 ink 底 paper 字，其余 card 白底 ink-soft 字 + 1px line 描边；步间 1px line 竖线相连。行内容 = 13px/500 ink-soft 类别 + 18px/600 标题 + 14px/28px ink-soft 说明（max-w-xl）。滚动显现按 60ms/步级差。下载页「安装三步」同款（标题 20px/600，徽章 36px）。

### 手风琴（Accordion）

Base UI 手风琴，置于 16px 白面板内：触发行 py-5（边界面板 16px/600 ink）或 py-3（发布卡 14px/600 ink），右置 16px chevron（展开时上下互换），hover 不加下划线；内容 14px ink-soft（发布卡 SHA-512 行进 mono 栈，latest.yml 链接 ink + line 色 underline、hover 转 ink）。焦点沿用全局 2px ink outline。

### 签名组件：「她的窗」

首屏右列的整体构图：真实截图窗（12px 白卡 + 1px line + shadow-float，下缘以负边距越出首屏）为窗，立绘卡（12px 白卡 + shadow-float + breathe ±4px/5.5s 呼吸，w-32/40/48）压在窗框上缘，气泡 z-30 在窗边开口，三枚白色状态签（首枚带 live 绿 presence 点）钉在窗上，入场按 0/80/160/360/440/520ms pop/rise 级差。这是世界的原点组件，新页面应优先复用「窗 + 越框立绘 + 状态签」的层叠关系，而非重新发明 hero。

### 动效语法（作用于所有组件）

入场一次性且可降级：rise-in（24px 上移 + 淡入，520ms）/ pop-in（scale 0.94 + 淡入，320ms）共用 cubic-bezier(0.22, 0.61, 0.36, 1)；滚动显现由 JS 挂 `reveal-ready` 后才隐藏（无 JS / reduced-motion 时内容始终可见），480ms 同曲线，`--reveal-delay` 级差 60-120ms（IntersectionObserver，rootMargin -12%，threshold 0.08）。循环动画只有两类：breathe（translateY ±4px，5.5s ease-in-out alternate）与 presence（opacity 1→0.35，1.6s），均只碰 transform/opacity。hover 无位移——颜色/背景过渡 200ms，背景类包 `hoverable`。`prefers-reduced-motion: reduce` 下：动画时长归 0.01ms、循环停止、reveal 直接终态、smooth scroll 关闭。

## Do's and Don'ts

### Do:

- **Do** 一切内容用纯白卡承载，分隔与描边用 1px 发丝线（外缘 line、卡内 line-soft），浮起元素配 shadow-card（越出章节缝的用 shadow-float）。
- **Do** 行动与强调只用墨色：主按钮 bg-ink、hover 转 ink-hover、焦点环 2px ink outline offset 2px、选区 ink 底反白。
- **Do** 「存活/可用」只用 live 绿的 6-8px 圆点表达，配 presence 呼吸（1.6s）；其他一切信息回到灰阶。
- **Do** 双色只出现在 H1：尾句 span 用 ink-faint；H2 及以下单色 ink。
- **Do** 发布事实行用 `tnum`，如实展示 release 数据；不可用时展示中性白卡面板，不造下载入口。
- **Do** 新动效只碰 transform/opacity，入场用 cubic-bezier(0.22, 0.61, 0.36, 1) 一次性完成，hover 只做 200ms 颜色过渡并包进 `hoverable`，并为 reduced-motion 提供终态。

### Don't:

- **Don't** 回到 v1 旧世界：无瓷白/墨蓝/空气蓝/樱粉/薄荷/夜色，无径向 wash、无手账微旋转、无和纸贴条、无药丸按钮、无 Baloo 2 等自托管显示字体——这些形制已整体废除，不得回潮。
- **Don't** 引入第二种语义色、渐变、霓虹、发光、暗色面板或玻璃拟态卡片——深度只来自发丝线 + 两档投影。
- **Don't** 把 live 绿用于文字、按钮、链接或营销强调——它只以小圆点表达「存活/可用」。
- **Don't** 在 hover 上做位移/缩放/投影变化；位移只属于入场（rise/pop）与呼吸（breathe）。
- **Don't** 制造零偏移光晕或彩色阴影；shadow-card / shadow-float 两档封闭，都是带 y 偏移、基于 ink 的低 alpha「纸压」型。
- **Don't** 呈现不存在的下载入口或编造的证言/数据；页面上的图像除真实截图与官方立绘外必须标注合成。
