export const MAX_SKILL_INVOCATIONS = 8;

/**
 * Keep the invocation grammar shared by the renderer composer and the main
 * process runtime. The look-behind prevents paths such as `a/skill:x` from
 * being interpreted as a Skill invocation.
 */
export const SKILL_INVOCATION_TOKEN_SOURCE = String.raw`(?:^|(?<=\s))\/skill:([A-Za-z0-9_.-]+)(?!\S)`;

export interface SkillInvocation {
  skillId: string;
  token: string;
}

export function parseSkillInvocations(text: string): SkillInvocation[] {
  if (!text || !text.includes("/skill:")) return [];
  const seen = new Set<string>();
  const invocations: SkillInvocation[] = [];
  for (const match of text.matchAll(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, "g"))) {
    const skillId = match[1];
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    invocations.push({ skillId, token: match[0] });
    if (invocations.length >= MAX_SKILL_INVOCATIONS) break;
  }
  return invocations;
}

export function stripSkillInvocations(text: string): string {
  if (!text || !text.includes("/skill:")) return text;
  let removed = 0;
  return text
    .replace(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, "g"), (token) => {
      if (removed >= MAX_SKILL_INVOCATIONS) return token;
      removed += 1;
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

export function isSkillOnlyInvocation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || parseSkillInvocations(trimmed).length === 0) return false;
  return trimmed.replace(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, "g"), "").trim() === "";
}
