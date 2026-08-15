import type { AgentProfile } from "@shared/types";
import { cn } from "../lib/utils";

const ROOT_AGENT_AVATAR_URL = new URL("../../../../resources/icon.png", import.meta.url).href;

interface AgentAvatarProps {
  profile: AgentProfile | null;
  fallback?: string;
  className?: string;
}

export function AgentAvatar({
  profile,
  fallback = "A",
  className,
}: AgentAvatarProps): React.JSX.Element {
  const label = profile?.avatar || profile?.name?.slice(0, 1) || fallback.slice(0, 1);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden select-none",
        className,
      )}
    >
      {profile?.kind === "main" ? (
        <img
          src={ROOT_AGENT_AVATAR_URL}
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
        />
      ) : (
        label
      )}
    </span>
  );
}
