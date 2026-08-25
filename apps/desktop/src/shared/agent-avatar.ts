export const DEFAULT_AGENT_AVATAR_ID = "bloub-cercle-attentif-bleu-anime" as const;

export const AGENT_AVATAR_IDS = [
  "bloub-cercle-attentif-bleu-anime",
  "bloub-cercle-blase-bleu-anime",
  "bloub-cercle-colere-bleu-anime",
  "bloub-cercle-confus-bleu-anime",
  "bloub-cercle-curieux-bleu-anime",
  "bloub-cercle-effraye-bleu-anime",
  "bloub-cercle-excite-bleu-anime",
  "bloub-cercle-fier-bleu-anime",
  "bloub-cercle-heureux-bleu-anime",
  "bloub-cercle-hilare-bleu-anime",
  "bloub-cercle-mefiant-bleu-anime",
  "bloub-cercle-neutre-bleu-anime",
  "bloub-cercle-somnolent-bleu-anime",
  "bloub-cercle-surpris-bleu-anime",
  "bloub-cercle-timide-bleu-anime",
  "bloub-cercle-triste-bleu-anime",
] as const;

export type AgentAvatarId = (typeof AGENT_AVATAR_IDS)[number];

const AGENT_AVATAR_ID_SET = new Set<string>(AGENT_AVATAR_IDS);

export function isAgentAvatarId(value: unknown): value is AgentAvatarId {
  return typeof value === "string" && AGENT_AVATAR_ID_SET.has(value);
}

export function normalizeAgentAvatarId(value: unknown): AgentAvatarId {
  return isAgentAvatarId(value) ? value : DEFAULT_AGENT_AVATAR_ID;
}
