import { AVATAR_ASSET_URLS } from "@ayaka/assets/emotions";
import {
  AGENT_AVATAR_IDS,
  DEFAULT_AGENT_AVATAR_ID,
  isAgentAvatarId,
  type AgentAvatarId,
} from "@shared/agent-avatar";

export interface AgentAvatarAsset {
  id: AgentAvatarId;
  label: string;
  url: string;
  value: AgentAvatarId;
}

const URL_BY_ID = AVATAR_ASSET_URLS satisfies Record<AgentAvatarId, string>;

export const AGENT_AVATAR_ASSETS: AgentAvatarAsset[] = AGENT_AVATAR_IDS.map((id) => ({
  id,
  label: id,
  url: URL_BY_ID[id],
  value: id,
}));

const AGENT_AVATAR_ASSET_BY_ID = new Map(
  AGENT_AVATAR_ASSETS.map((asset) => [asset.id, asset] as const),
);

export function getAgentAvatarAsset(value: unknown): AgentAvatarAsset {
  return (
    AGENT_AVATAR_ASSET_BY_ID.get(isAgentAvatarId(value) ? value : DEFAULT_AGENT_AVATAR_ID) ??
    AGENT_AVATAR_ASSET_BY_ID.get(DEFAULT_AGENT_AVATAR_ID)!
  );
}
