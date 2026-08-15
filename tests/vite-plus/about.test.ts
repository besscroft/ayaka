import { describe, expect, it } from "vite-plus/test";
import {
  ABOUT_RESOURCES,
  normalizeAppVersion,
} from "../../apps/desktop/src/renderer/src/lib/about.js";

describe("about settings", () => {
  it("normalizes application versions without duplicating the prefix", () => {
    expect(normalizeAppVersion("1.2.3")).toBe("v1.2.3");
    expect(normalizeAppVersion(" v2.0.0 ")).toBe("v2.0.0");
    expect(normalizeAppVersion("")).toBeNull();
    expect(normalizeAppVersion(null)).toBeNull();
  });

  it("links to the official website", () => {
    expect(ABOUT_RESOURCES).toEqual([{ id: "repository", href: "https://ai.zzzvoid.com/" }]);
  });
});
