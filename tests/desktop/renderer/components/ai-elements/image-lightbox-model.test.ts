import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampImageIndex,
  readImageData,
  wrapImageIndex,
} from "@renderer/components/ai-elements/image-lightbox-model";

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

  void it("reads workspace images through the workspace API instead of fetching blob URLs", async () => {
    const data = await readImageData(
      { src: "blob:http://localhost/preview", workspacePath: "outputs/image.png" },
      "conversation-1",
      async (input) => {
        assert.deepEqual(input, {
          conversationId: "conversation-1",
          path: "outputs/image.png",
        });
        return { data: new Uint8Array([1, 2, 3]).buffer };
      },
    );

    assert.deepEqual(Array.from(new Uint8Array(data)), [1, 2, 3]);
  });
});
