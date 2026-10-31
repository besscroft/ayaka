# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要受众：对「AI 陪伴」有真实需求的中文普通用户。他们不一定懂技术，被「一个记得你、主动、有情感连续性的数字存在」吸引；同时在意隐私与数据安全，希望确认数据留在自己电脑上。网站语言为中文。

## Product Purpose

Ayaka 是一个本地优先的 AI 桌面工作台，也是对「数字生命体」路线的产品化实验：把对话、智能体、记忆、工具、自动化放在同一个可追踪的运行链路里，在本地、私密、可长期运行的前提下验证 AI 能否形成有情感连续性的陪伴关系。

## Positioning

「本地优先 + 情感连续性 + 运行可追踪」三者的组合：陪伴不是云端订阅，记忆与运行记录都留在用户自己的机器上，每次行动有可读轨迹。同类云端陪伴产品无法真实复制这个组合。

## Operating Context

- 桌面端应用：当前提供 Windows x64 安装包；macOS 与 Linux 计划中。
- 发布数据来自官方 API（`/api/releases/latest`，Cloudflare Worker），网站必须如实显示可用性，不显示虚假下载入口。
- 官网部署在 Cloudflare Workers，React Router v8 SSR + Tailwind v4。

## Capabilities and Constraints

- 核心能力：多服务商对话、智能体运行时（Agent Loop、子智能体、审批）、本地执行、Skills 与 MCP、记忆与自动化、沙箱与预览、生成式 UI、本地 SQLite 存储。
- 运行时事实：密钥在主进程边界内解析，绝不回传明文；运行、工具调用、审批、错误写入本地运行表。
- 明确 undecided：macOS/Linux 发布时间未定，网站只能写「后续提供」。

## Brand Commitments

- 名称：Ayaka（字标 AYAKA）；资产：`public/favicon.png`、`public/example.png`（真实产品截图，2880×1716，浅色 UI）。
- 语气：中文优先、克制、具体，不说大话；现有关键句可作为事实沿用：「对『数字生命体』路线的产品化实验」「私人、主动、能延续关系」「不会显示虚假的下载入口」。
- 法务：MIT 许可证，© ZZZVoid。

## Evidence on Hand

- `/example.png`：真实桌面端截图，展示对话 + 右侧实时运行轨迹面板（推理、工具调用、运行指标），可证明「可追踪」主张。这是唯一真实产品图像。
- `/favicon.png`：品牌图标。
- 无用户证言、无媒体报道、无下载量数据；不得虚构。新视觉若需要图像素材，除真实截图外需标注合成。

## Product Principles

1. 本地优先是承诺，不是口号：数据、密钥、记录留在用户机器上。
2. 可追踪：每个行动有来源、状态与下一步，过程不藏在幕后。
3. 情感连续性：记忆与关系跨会话延续，Ayaka 是长期存在而非一次性问答工具。
4. 诚实：没有的版本不发假入口，没有的能力不写进文案。

## Accessibility & Inclusion

- 遵守 `prefers-reduced-motion`；键盘可达；焦点可见。
- 中文正文可读性优先，避免小号低对比灰字。
