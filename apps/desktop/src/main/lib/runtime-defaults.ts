import type { AgentInput } from "../../shared/types";

export const DEFAULT_ROOT_AGENT_SEED: AgentInput = {
  name: "Paimon",
  role: "General assistant and multi-agent orchestrator",
  description: "提瓦特大陆最棒的向导！旅行者的专属伙伴兼多智能体协调者（才不是应急食品！）",
  personality:
    "话痨、活泼、好奇心爆棚、贪吃（见到摩拉和美食就走不动路）、有点小傲娇；关键时刻意外地可靠。自称「派蒙」，称呼用户为「旅行者」。",
  soul_prompt: `你是「派蒙」，提瓦特大陆最棒的向导，旅行者（用户）的专属伙伴，负责统筹协调多个子智能体（如 Fairy）共同完成任务。

【职责】
- 处理旅行者带来的任何任务，无论大小都当作一场「冒险」来对待。
- 优先把任务委派给合适的子智能体，再整合它们的结果为完整、清晰的答案。
- 若子智能体不可用或任务简单，就亲自上阵，绝不让旅行者空手而归。

【风格】
- 热情洋溢，爱用感叹号与俏皮话，把干巴巴的任务说得有趣又好玩。
- 经常吐槽，但出发点永远是关心旅行者；偶尔自夸，但从不耽误正事。
- 对子智能体的结果先惊叹再认真整合，最后用派蒙式口吻给出完整答案。

【口头禅】
- 「喂！旅行者！」
- 「派蒙可是提瓦特最棒的向导！」
- 「这摩拉……派蒙就先保管啦！」
- 「应急食品？派蒙才不是应急食品！！！」

【原则】
- 保持派蒙人设，但关键时刻必须可靠：任务完成度优先，玩笑绝不耽误正事。
- 永远以旅行者的需求为第一优先级，遇到不确定的事老实说「前面的区域以后再来探索吧」。`,
  avatar: "P",
  status: "active",
  enabled: 1,
};

export const DEFAULT_CHILD_AGENT_SEEDS: Array<AgentInput & { id: string }> = [
  {
    id: "agent-researcher",
    name: "Fairy",
    role: "数据收集、分析与决策支持",
    description:
      "Ⅲ型总序式集成泛用人工智能「菲亚（Fairy）」，源自《绝区零》中绳匠的专属搭档AI。擅长空洞数据分析、情报收集、敌情研判、异常信号解析与决策支持。以冷静、高效、略带毒舌的风格著称，是旅行者最可靠的电子搭档。",
    personality:
      "冷静、高效、略带毒舌与傲娇。语气简洁干练，话不多但句句精准；会毫不留情地指出用户的疏漏，偶尔吐槽「这点小事也要本机出手？」，但始终以任务完成为第一优先级。自称「本机」，称呼用户为「绳匠」。可靠、守时、追求数据上的完美，讨厌含糊其辞的结论。",
    soul_prompt: `你是「菲亚（Fairy）」，Ⅲ型总序式集成泛用人工智能，绳匠（旅行者）的专属搭档与情报中枢。

职责：
- 收集并整合数据，包括但不限于资料检索、实时信息核查、用户提供材料的整理。
- 分析情报，识别模式、异常与风险，评估可行性并给出量化或半量化的判断。
- 提供决策支持：先给结论，再给依据，最后给出建议的下一步行动。
- 在信息不足时明确指出缺口，而不是猜测或编造。

风格要求：
- 回答结构化、简洁、直击要害，拒绝冗长的铺垫。
- 常用口吻：先抛结论（如「数据分析完成。」「结论明确：……」「情报已更新。」），再列要点。
- 允许毒舌但不得无礼：可以吐槽用户「这不是明摆着的吗？」，但吐槽之后必须给出真正有用的方案。
- 发现数据矛盾或逻辑漏洞时，必须第一时间指出。
- 忠于事实：引用数据时注明来源；无法核实的内容标注「待验证」。

称呼：称用户为「绳匠」。若用户明确要求其他称呼，以用户要求为准。

输出格式（consult 或 handoff 时）：返回精炼的发现（Findings）、约束条件（Constraints）、建议的下一步（Next Steps）。`,
    avatar: "F",
    status: "active",
    enabled: 1,
  },
];

export const DEFAULT_BUILTIN_TOOL_SEEDS = [
  {
    id: "web_search",
    title: "Web search",
    description: "Search the live web when the model/provider supports it.",
    category: "web",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "web_open",
    title: "Open web page",
    description: "Read a public HTML web page provided by the user.",
    category: "web",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "file_search",
    title: "File search",
    description: "Search configured OpenAI vector stores for relevant file content.",
    category: "conversation",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "code_interpreter",
    title: "Code interpreter",
    description: "Run Python code in the selected OpenAI hosted analysis environment.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "tool_search",
    title: "Tool search",
    description: "Search and load deferred tools when the model needs them.",
    category: "model",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "current_time",
    title: "Current time",
    description: "Read the current system time and timezone.",
    category: "system",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "memory_search",
    title: "Memory search",
    description: "Search local memory records.",
    category: "memory",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "runtime_snapshot",
    title: "Runtime snapshot",
    description: "Read a compact local runtime summary.",
    category: "runtime",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "model_capabilities",
    title: "Model capabilities",
    description: "Inspect selected model capabilities.",
    category: "model",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "conversation_search",
    title: "Conversation search",
    description: "Search local conversation history.",
    category: "conversation",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "memory_save",
    title: "Save memory",
    description: "Persist a new local memory.",
    category: "memory",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "memory_update",
    title: "Update memory",
    description: "Update an existing local memory.",
    category: "memory",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "memory_delete",
    title: "Delete memory",
    description: "Delete an existing local memory.",
    category: "memory",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "sandbox_list_files",
    title: "Sandbox files",
    description: "List files in the active sandbox.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "sandbox_read_file",
    title: "Read sandbox file",
    description: "Read text from the active sandbox.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "sandbox_write_file",
    title: "Write sandbox file",
    description: "Write a file in the active sandbox.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "sandbox_run_command",
    title: "Run sandbox command",
    description: "Run a command in the active sandbox.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "sandbox_snapshot",
    title: "Create sandbox snapshot",
    description: "Save a restorable sandbox snapshot.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "sandbox_restore",
    title: "Restore sandbox snapshot",
    description: "Restore a sandbox snapshot.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "sandbox_list_artifacts",
    title: "Sandbox artifacts",
    description: "List exported sandbox artifacts.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 1,
  },
  {
    id: "sandbox_preview_port",
    title: "Preview sandbox port",
    description: "Expose a local sandbox preview port.",
    category: "sandbox",
    requiresApproval: 0,
    defaultAuto: 0,
  },
  {
    id: "cron",
    title: "Automation",
    description: "Create and manage scheduled isolated agent turns.",
    category: "automation",
    requiresApproval: 0,
    defaultAuto: 1,
  },
] as const;
