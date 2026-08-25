import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui";
import {
  AGENT_AVATAR_ASSETS,
  getAgentAvatarAsset,
  type AgentAvatarAsset,
} from "../lib/agent-avatar-assets";

interface AgentAvatarPickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function AgentAvatarPicker({
  value,
  onChange,
  ariaLabel,
}: AgentAvatarPickerProps): React.JSX.Element {
  const selected = getAgentAvatarAsset(value);

  return (
    <Select
      items={AGENT_AVATAR_ASSETS}
      value={selected}
      isItemEqualToValue={(option, next) => option.id === next.id}
      itemToStringLabel={(option) => option.id}
      itemToStringValue={(option) => option.id}
      onValueChange={(option) => option && onChange(option.id)}
    >
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue>
          {(option: AgentAvatarAsset | null) => (option ? <AvatarOption asset={option} /> : null)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-64" alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {AGENT_AVATAR_ASSETS.map((asset) => (
            <SelectItem key={asset.id} value={asset}>
              <AvatarOption asset={asset} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function AvatarOption({ asset }: { asset: AgentAvatarAsset }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <img
        src={asset.url}
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0 rounded-md object-cover"
      />
      <span className="truncate">{asset.id}</span>
    </span>
  );
}
