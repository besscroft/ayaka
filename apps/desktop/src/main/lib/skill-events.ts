export interface SkillChangedEvent {
  skillId?: string;
  reason:
    | "created"
    | "imported"
    | "updated"
    | "enabled"
    | "disabled"
    | "deleted"
    | "restored"
    | "dependencies"
    | "package";
}

const listeners = new Set<(event: SkillChangedEvent) => void>();

export function onSkillChanged(listener: (event: SkillChangedEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySkillChanged(event: SkillChangedEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Observers must not affect Skill persistence or execution.
    }
  }
}
