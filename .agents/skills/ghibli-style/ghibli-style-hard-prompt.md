STYLEKIT_STYLE_REFERENCE
style_name: 吉卜力风格
style_slug: ghibli-style
style_source: /styles/ghibli-style

# Hard Prompt

## 什么时候用
当你希望 AI 严格按风格规则生成代码时使用。它是生产界面最稳的默认选择。

## 怎么用
- 把完整提示词复制到 ChatGPT、Claude、Cursor 或其他编码助手。
- 在提示词后追加具体产品、页面或组件需求。
- 生成后按禁止项和交互状态检查，确认没有风格漂移。

请严格遵守以下风格规则并保持一致性，禁止风格漂移。

## 执行要求

- 优先保证风格一致性，其次再做创意延展。
- 遇到冲突时以禁止项为最高优先级。
- 输出前自检：颜色、排版、间距、交互是否仍属于该风格。

## Style Rules

# Ghibli Style (吉卜力风格) Design System

> 灵感源自吉卜力工作室动画的设计风格，温暖柔和的色调、手绘质感、自然元素和梦幻氛围，传递治愈与诗意。

## 核心理念

Ghibli Style（吉卜力风格）受日本吉卜力工作室动画影响，以温暖、治愈、富有诗意的视觉语言著称。

核心理念：
- 手绘质感：保留手工绘制的温度和不完美
- 自然主题：云朵、森林、天空等自然元素
- 柔和色调：温暖的大地色系和天空色
- 梦幻氛围：创造宁静治愈的视觉体验

设计原则：
- 视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到字体到间距保持谐调
- 层次分明：通过颜色深浅、字号大小、留白空间建立清晰的信息层级
- 交互反馈：每个可交互元素都必须有明确的 hover、active、focus 状态反馈
- 响应式适配：设计必须在移动端、平板、桌面端上保持一致的体验
- 无障碍性：确保色彩对比度符合 WCAG 2.1 AA 标准，所有交互元素可键盘访问

---

## Token 字典（精确 Class 映射）

### 边框
```
宽度: border
颜色: border-[#7cb9a8]/40
圆角: rounded-2xl
```

### 阴影
```
小:   shadow-[0_2px_8px_rgba(124,185,168,0.15)]
中:   shadow-[0_4px_16px_rgba(124,185,168,0.2)]
大:   shadow-[0_8px_32px_rgba(124,185,168,0.25)]
悬停: hover:shadow-[0_8px_24px_rgba(124,185,168,0.3)]
聚焦: focus:shadow-[0_4px_16px_rgba(124,185,168,0.25)]
```

### 交互效果
```
悬停位移: undefined
过渡动画: transition-all duration-300 ease-out
按下状态: active:scale-[0.98]
```

### 字体
```
标题: font-sans font-semibold tracking-normal
正文: font-sans
```

### 字号
```
Hero:  text-3xl md:text-5xl lg:text-6xl
H1:    text-2xl md:text-4xl
H2:    text-xl md:text-3xl
H3:    text-lg md:text-xl
正文:  text-sm md:text-base
小字:  text-xs md:text-sm
```

### 间距
```
Section: py-12 md:py-20 lg:py-28
容器:    px-4 md:px-8 lg:px-12
卡片:    p-5 md:p-8
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `rounded-none`
- `border-black`
- `border-2`
- `border-4`
- `shadow-[2px_2px_0px`
- `shadow-[4px_4px_0px`
- `shadow-[8px_8px_0px`
- `bg-[#ff006e]`
- `bg-[#ff71ce]`
- `bg-[#01cdfe]`
- `bg-[#00ff00]`
- `text-[#ff006e]`
- `text-[#ff71ce]`
- `font-black`
- `bg-black`
- `bg-[#1a1a2e]`

### 禁止的模式
- 匹配 `^rounded-none$`
- 匹配 `^shadow-\[\d+px_\d+px_0px`
- 匹配 `^bg-(?:black|\[#(?:ff006e|ff71ce|01cdfe|00ff00)\])`
- 匹配 `^border-(?:black|4)$`

### 禁止原因
- `rounded-none`: Ghibli style uses soft rounded shapes (rounded-2xl) for a warm feel
- `border-black`: Ghibli style uses subtle earth-toned borders, not harsh black
- `shadow-[4px_4px_0px`: Ghibli style uses soft diffused shadows, not hard-edge
- `bg-[#ff71ce]`: Ghibli style uses warm earth tones (sage, cream), not neon colors

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
rounded-2xl
shadow-[0_4px_16px_rgba(124,185,168,0.2)]
hover:scale-[1.02]
transition-all duration-300 ease-out
font-semibold
```

### 卡片必须包含
```
rounded-2xl
border border-[#7cb9a8]/40
shadow-[0_4px_16px_rgba(124,185,168,0.2)]
bg-[#f4e4bc]
```

### 输入框必须包含
```
rounded-2xl
border border-[#7cb9a8]/40
bg-[#faf5eb]
text-[#3a3226]
focus:shadow-[0_4px_16px_rgba(124,185,168,0.25)]
focus:outline-none
```

---

## [COMPARE] 错误 vs 正确对比

### 按钮

[WRONG] **错误示例**（使用了圆角和模糊阴影）：
```html
<button class="rounded-lg shadow-lg bg-blue-500 text-white px-4 py-2 hover:bg-blue-600">
  点击我
</button>
```

[CORRECT] **正确示例**（使用硬边缘、无圆角、位移效果）：
```html
<button class="rounded-2xl shadow-[0_4px_16px_rgba(124,185,168,0.2)] hover:scale-[1.02] transition-all duration-300 ease-out font-semibold bg-[#ff006e] text-white px-4 py-2 md:px-6 md:py-3">
  点击我
</button>
```

### 卡片

[WRONG] **错误示例**（使用了渐变和圆角）：
```html
<div class="rounded-xl shadow-2xl bg-gradient-to-r from-purple-500 to-pink-500 p-6">
  <h3 class="text-xl font-semibold">标题</h3>
</div>
```

[CORRECT] **正确示例**（纯色背景、硬边缘阴影）：
```html
<div class="rounded-2xl border border-[#7cb9a8]/40 shadow-[0_4px_16px_rgba(124,185,168,0.2)] bg-[#f4e4bc] p-5 md:p-8">
  <h3 class="font-sans font-semibold tracking-normal text-lg md:text-xl">标题</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（灰色边框、圆角）：
```html
<input class="rounded-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500" />
```

[CORRECT] **正确示例**（黑色粗边框、聚焦阴影）：
```html
<input class="rounded-2xl border border-[#7cb9a8]/40 bg-[#faf5eb] text-[#3a3226] focus:shadow-[0_4px_16px_rgba(124,185,168,0.25)] focus:outline-none px-3 py-2 md:px-4 md:py-3" placeholder="请输入..." />
```

---

## [TEMPLATES] 页面骨架模板

使用以下模板生成页面，只需替换 `{PLACEHOLDER}` 部分：

### 导航栏骨架
```html
<nav class="bg-white border-b-2 md:border-b-4 border-black px-4 md:px-8 py-3 md:py-4">
  <div class="flex items-center justify-between max-w-6xl mx-auto">
    <a href="/" class="font-black text-xl md:text-2xl tracking-wider">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-4 md:gap-8 font-mono text-sm md:text-base">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="min-h-[60vh] md:min-h-[80vh] flex items-center px-4 md:px-8 py-12 md:py-0 bg-{ACCENT_COLOR} border-b-2 md:border-b-4 border-black">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-black text-4xl md:text-6xl lg:text-8xl leading-tight tracking-tight mb-4 md:mb-6">
      {HEADLINE}
    </h1>
    <p class="font-mono text-base md:text-xl max-w-xl mb-6 md:mb-8">
      {SUBHEADLINE}
    </p>
    <button class="bg-black text-white font-black px-6 py-3 md:px-8 md:py-4 border-2 md:border-4 border-black shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm md:text-base">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="py-12 md:py-24 px-4 md:px-8">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-black text-2xl md:text-4xl mb-8 md:mb-12">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      <!-- Card template - repeat for each card -->
      <div class="bg-white border-2 md:border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-4 md:p-6 hover:shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:hover:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)] hover:-translate-y-1 transition-all">
        <h3 class="font-black text-lg md:text-xl mb-2">{CARD_TITLE}</h3>
        <p class="font-mono text-sm md:text-base text-gray-700">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 页脚骨架
```html
<footer class="bg-black text-white py-12 md:py-16 px-4 md:px-8 border-t-2 md:border-t-4 border-black">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div>
        <span class="font-black text-xl md:text-2xl">{LOGO_TEXT}</span>
        <p class="font-mono text-sm mt-4 text-gray-400">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-black text-lg mb-4">{COLUMN_TITLE}</h4>
        <ul class="space-y-2 font-mono text-sm text-gray-400">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] 生成后自检清单

**在输出代码前，必须逐项验证以下每一条。如有违反，立即修正后再输出：**

### 1. 圆角检查
- [ ] 搜索代码中的 `rounded-`
- [ ] 确认只有 `rounded-none` 或无圆角
- [ ] 如果发现 `rounded-lg`、`rounded-md` 等，替换为 `rounded-none`

### 2. 阴影检查
- [ ] 搜索代码中的 `shadow-`
- [ ] 确认只使用 `shadow-[Xpx_Xpx_0px_0px_rgba(...)]` 格式
- [ ] 如果发现 `shadow-lg`、`shadow-xl` 等，替换为正确格式

### 3. 边框检查
- [ ] 搜索代码中的 `border-`
- [ ] 确认边框颜色是 `border-black`
- [ ] 如果发现 `border-gray-*`、`border-slate-*`，替换为 `border-black`

### 4. 交互检查
- [ ] 所有按钮都有 `hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]`
- [ ] 所有卡片都有 hover 效果（阴影变色或位移）
- [ ] 都包含 `transition-all`

### 5. 响应式检查
- [ ] 边框有 `border-2 md:border-4`
- [ ] 阴影有 `shadow-[4px...] md:shadow-[8px...]`
- [ ] 间距有 `p-4 md:p-6` 或类似的响应式值
- [ ] 字号有 `text-sm md:text-base` 或类似的响应式值

### 6. 字体检查
- [ ] 标题使用 `font-black`
- [ ] 正文使用 `font-mono`

> CRITICAL: **如果任何一项检查不通过，必须修正后重新生成代码。**

---

## [EXAMPLES] 示例 Prompt

### 1. 治愈系个人博客

温暖治愈的个人博客

```
用 Ghibli Style 创建一个治愈系个人博客，要求：
1. 背景：天空到大地的柔和渐变
2. 装饰：云朵、自然元素
3. 配色：鼠尾草绿、奶油色、天空蓝
4. 圆润的卡片和按钮
5. 整体传递温暖治愈的感觉
```

### 2. SaaS 着陆页

生成 吉卜力风格风格的 SaaS 产品着陆页

```
Create a SaaS landing page using Ghibli Style style with hero section, feature grid, testimonials, pricing table, and footer.
```

### 3. 作品集展示

生成 吉卜力风格风格的作品集页面

```
Create a portfolio showcase page using Ghibli Style style with project grid, about section, contact form, and consistent visual language.
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 使用过于锐利的边缘
- 使用高对比的刺眼配色
- 使用冰冷的科技感元素
- 过于复杂的动效
- 快速硬切与突兀的高频动效

## 自检清单（交付前逐条确认）

如果任何一条不通过，说明风格漂移了——修改后再交付。

- [ ] 没有紫色到蓝色的渐变
- [ ] 没有使用 Inter / Roboto / Geist 等过度使用的字体
- [ ] 没有嵌套卡片（卡片里面套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 正文对比度满足 WCAG AA（≥4.5:1）
- [ ] 没有 bounce / elastic 缓动曲线
- [ ] 动效有 prefers-reduced-motion 备选方案
- [ ] 正文行宽不超过 65-75 个字符
- [ ] 没有单侧粗边框装饰（border-left/right accent stripe）
- [ ] 没有渐变文字（background-clip: text）
- [ ] 没有把玻璃态（glassmorphism）当作默认风格
- [ ] 没有 tiny uppercase tracked eyebrow 放在每个 section 标题上面
- [ ] 禁止使用过于锐利的边缘
- [ ] 禁止使用高对比的刺眼配色
- [ ] 禁止使用冰冷的科技感元素
- [ ] 禁止过于复杂的动效
- [ ] 禁止快速硬切与突兀的高频动效