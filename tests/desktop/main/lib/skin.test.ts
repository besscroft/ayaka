import assert from "node:assert/strict";
import test from "node:test";
import { parseSkinId, SKIN_IDS } from "@shared/skin";

test("supports only the remaining built-in skins", () => {
  assert.deepEqual(SKIN_IDS, ["white", "black"]);
  assert.equal(parseSkinId("white"), "white");
  assert.equal(parseSkinId("black"), "black");
  assert.equal(parseSkinId("nova-light"), "white");
  assert.equal(parseSkinId("nova-dark"), "black");
});

test("falls back to white for the removed ZZZ skin", () => {
  assert.equal(parseSkinId("zzz"), "white");
});
