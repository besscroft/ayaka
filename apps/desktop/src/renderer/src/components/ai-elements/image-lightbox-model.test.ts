import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampImageIndex, wrapImageIndex } from "./image-lightbox-model";

void describe("image lightbox navigation", () => {
  void it("wraps previous and next image indices", () => {
    assert.equal(wrapImageIndex(0, -1, 3), 2);
    assert.equal(wrapImageIndex(2, 1, 3), 0);
    assert.equal(wrapImageIndex(1, 1, 1), 0);
  });

  void it("clamps the initial image index to the available images", () => {
    assert.equal(clampImageIndex(-2, 3), 0);
    assert.equal(clampImageIndex(8, 3), 2);
    assert.equal(clampImageIndex(2, 0), 0);
  });
});
