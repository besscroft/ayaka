import { describe, expect, it } from "vite-plus/test";

describe("Vite+ test integration", () => {
  it("loads the bundled test runner", () => {
    expect("ayaka").toBe("ayaka");
  });
});
