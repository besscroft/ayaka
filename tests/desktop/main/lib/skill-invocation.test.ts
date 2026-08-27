import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SKILL_INVOCATIONS,
  isSkillOnlyInvocation,
  parseSkillInvocations,
  stripSkillInvocations,
} from "@shared/skill-invocation";

void describe("Skill invocation tokens", () => {
  void it("parses only whitespace-delimited tokens and de-duplicates them", () => {
    assert.deepEqual(parseSkillInvocations("/skill:writing /skill:writing  /skill:research"), [
      { skillId: "writing", token: "/skill:writing" },
      { skillId: "research", token: "/skill:research" },
    ]);
    assert.deepEqual(parseSkillInvocations("path/skill:writing a/skill:research"), []);
    assert.deepEqual(parseSkillInvocations("/skill:writing/bad /skill:ok,"), []);
  });

  void it("strips only the supported number of invocations", () => {
    const tokens = Array.from(
      { length: MAX_SKILL_INVOCATIONS + 1 },
      (_, index) => `/skill:s${index}`,
    ).join(" ");
    const stripped = stripSkillInvocations(tokens);
    assert.match(stripped, /\/skill:s8/);
    assert.doesNotMatch(stripped, /\/skill:s0/);
  });

  void it("does not treat historical message text as part of the token protocol", () => {
    const current = "Earlier text mentioned /skill:old\n\n/skill:current";
    assert.deepEqual(parseSkillInvocations(current), [
      { skillId: "old", token: "/skill:old" },
      { skillId: "current", token: "/skill:current" },
    ]);
  });

  void it("recognizes a message that contains only supported Skill invocations", () => {
    assert.equal(isSkillOnlyInvocation(" /skill:writing /skill:research "), true);
    assert.equal(
      isSkillOnlyInvocation(
        "/skill:s0 /skill:s1 /skill:s2 /skill:s3 /skill:s4 /skill:s5 /skill:s6 /skill:s7 /skill:s8",
      ),
      true,
    );
    assert.equal(isSkillOnlyInvocation("/skill:writing\n\nPlease summarize this"), false);
    assert.equal(isSkillOnlyInvocation("Please use /skill:writing"), false);
    assert.equal(isSkillOnlyInvocation("/skill:invalid/path"), false);
  });
});
