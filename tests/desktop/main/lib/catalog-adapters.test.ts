import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  downloadSkillsShPackage,
  parseModelScopeSkillsData,
  parseSkillsShLeaderboardHtml,
  searchSkillsShSkills,
} from "@desktop-main/lib/catalog-adapters";
import {
  inspectSkillArchive,
  inspectSkillFiles,
  validateArchivePath,
} from "@desktop-main/lib/catalog-safety";

void describe("catalog adapters", () => {
  void it("maps the current ModelScope Skills response and download protocol", () => {
    const result = parseModelScopeSkillsData({
      Code: 200,
      Data: {
        TotalCount: 1,
        SkillList: [
          {
            DisplayName: "skill-creator",
            Name: "skill-creator",
            Path: "@anthropics",
            Description: "Create and improve skills",
            GmtModify: 1782237594,
            DownloadCount: 8487,
            Visits: 36029,
            SourceDeveloper: "anthropics",
            SourceURL: "https://github.com/anthropics/skills",
            L1: { ChineseName: "Skills管理" },
          },
        ],
      },
    });
    const item = result.items[0];
    assert.ok(item);
    assert.equal(result.total, 1);
    assert.equal(item.artifactType, "skill");
    assert.equal(item.externalId, "@anthropics/skill-creator");
    assert.equal(item.name, "skill-creator");
    assert.equal(item.version, "1782237594");
    assert.equal(
      item.installUrl,
      "https://www.modelscope.cn/skills/%40anthropics/skill-creator/archive/zip/master",
    );
    assert.equal(item.detail.downloads, 8487);
    assert.equal(item.detail.category, "Skills管理");
    assert.match(item.contentHash!, /^[a-f0-9]{64}$/);
  });

  void it("filters malformed entries and reports API errors", () => {
    const result = parseModelScopeSkillsData({
      Code: 200,
      Data: {
        TotalCount: 3,
        SkillList: [
          { Name: "missing-path" },
          { Path: "owner" },
          { Path: "../escape", Name: "unsafe" },
        ],
      },
    });
    assert.equal(result.items.length, 0);
    assert.throws(() => parseModelScopeSkillsData({ Code: 500, Message: "failed" }), /failed/);
  });

  void it("maps the public skills.sh search response and paginates locally", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          skills: [
            {
              id: "vercel-labs/agent-skills/vercel-react-best-practices",
              name: "vercel-react-best-practices",
              source: "vercel-labs/agent-skills",
              installs: 569164,
            },
            {
              id: "anthropics/skills/frontend-design",
              name: "frontend-design",
              source: "anthropics/skills",
              installs: 689983,
            },
          ],
        }),
      )) as typeof fetch;
    try {
      const result = await searchSkillsShSkills({ query: "design", page: 1, pageSize: 1 });
      assert.equal(result.items.length, 1);
      assert.equal(
        result.items[0]?.externalId,
        "vercel-labs/agent-skills/vercel-react-best-practices",
      );
      assert.equal(result.items[0]?.detail.provider, "skills.sh");
      assert.equal(result.hasMore, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it("parses the current skills.sh RSC leaderboard and legacy page data", () => {
    const rscHtml = String.raw`<script>self.__next_f.push([1,"50:[\"$\",\"$L57\",null,{\"initialSkills\":[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":2809917},{\"source\":\"anthropics/skills\",\"skillId\":\"frontend-design\",\"name\":\"frontend-design\",\"installs\":738903},{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"duplicate\",\"installs\":1}]}]"])</script>`;
    const rscItems = parseSkillsShLeaderboardHtml(rscHtml);
    assert.deepEqual(
      rscItems.map((item) => item.externalId),
      ["vercel-labs/skills/find-skills", "anthropics/skills/frontend-design"],
    );
    assert.equal(rscItems[0]?.detail.installs, 2809917);

    const legacyHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          initialSkills: [
            {
              source: "openai/skills",
              skill_id: "playwright",
              name: "playwright",
              installs: 2,
            },
          ],
        },
      },
    })}</script>`;
    const legacyItems = parseSkillsShLeaderboardHtml(legacyHtml);
    assert.equal(legacyItems[0]?.externalId, "openai/skills/playwright");
  });

  void it("loads the skills.sh homepage for an empty query and supports array search responses", async () => {
    const originalFetch = globalThis.fetch;
    const homepage = String.raw`<script>self.__next_f.push([1,"50:[{\"source\":\"owner/repo\",\"skillId\":\"one\",\"name\":\"one\",\"installs\":3},{\"source\":\"owner/repo\",\"skillId\":\"two\",\"name\":\"two\",\"installs\":2}]"])</script>`;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "https://skills.sh/") return new Response(homepage);
      return new Response(
        JSON.stringify([
          {
            source: "owner/repo",
            skillId: "one",
            name: "one",
            installs: 3,
          },
          {
            source: "owner/repo",
            skillId: "two",
            name: "two",
            installs: 2,
          },
        ]),
      );
    }) as typeof fetch;
    try {
      const homepageResult = await searchSkillsShSkills({ page: 2, pageSize: 1 });
      assert.equal(requestedUrls[0], "https://skills.sh/");
      assert.equal(homepageResult.items[0]?.externalId, "owner/repo/two");
      assert.equal(homepageResult.hasMore, false);

      const searchResult = await searchSkillsShSkills({ query: "two", pageSize: 1 });
      assert.equal(searchResult.items[0]?.externalId, "owner/repo/one");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it("downloads a skills.sh JSON file tree through the existing install endpoint", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      assert.equal(String(input), "https://skills.sh/api/download/owner/repo/my-skill");
      return new Response(
        JSON.stringify({
          hash: "fixture-hash",
          files: [{ path: "skill/SKILL.md", contents: "---\nname: fixture\n---\n" }],
        }),
      );
    }) as typeof fetch;
    try {
      const result = await downloadSkillsShPackage("owner/repo/my-skill");
      assert.equal(result.hash, "fixture-hash");
      assert.equal(result.files[0]?.path, "skill/SKILL.md");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

void describe("skill archive safety", () => {
  void it("validates frontmatter and keeps files inside the skill root", () => {
    const archive = zipSync({
      "repo-main/SKILL.md": strToU8(
        "---\nname: safe-skill\ndescription: Safe fixture\n---\n\n# Skill",
      ),
      "repo-main/references/guide.md": strToU8("guide"),
      "unrelated/ignored.txt": strToU8("ignored"),
    });
    const inspected = inspectSkillArchive(archive);
    assert.equal(inspected.name, "safe-skill");
    assert.deepEqual(Object.keys(inspected.files).sort(), ["SKILL.md", "references/guide.md"]);
  });

  void it("rejects traversal and malformed packages", () => {
    assert.throws(() => validateArchivePath("../outside"), /Unsafe archive path/);
    assert.throws(() => validateArchivePath("C:/outside"), /Unsafe archive path/);
    assert.throws(
      () => inspectSkillArchive(zipSync({ "repo/readme.md": strToU8("missing") })),
      /SKILL\.md/,
    );
  });

  void it("validates skills.sh JSON file trees", () => {
    const inspected = inspectSkillFiles([
      {
        path: "skill/SKILL.md",
        contents: "---\nname: direct\ndescription: Direct\n---\n\n# Direct",
      },
      { path: "skill/references/guide.md", contents: "Guide" },
      { path: "outside.txt", contents: "ignored" },
    ]);
    assert.equal(inspected.name, "direct");
    assert.deepEqual(Object.keys(inspected.files).sort(), ["SKILL.md", "references/guide.md"]);
  });
});
