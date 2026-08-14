import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createWorkspaceMediaBlob,
  getMediaResourceSignature,
  normalizeWorkspaceFileData,
} from "@renderer/lib/media-resource";

void describe("media resource helpers", () => {
  void it("normalizes common IPC byte representations", () => {
    assert.deepEqual(Array.from(normalizeWorkspaceFileData(new Uint8Array([1, 2])) ?? []), [1, 2]);
    assert.deepEqual(Array.from(normalizeWorkspaceFileData(new Uint16Array([513])) ?? []), [1, 2]);
    assert.deepEqual(
      Array.from(normalizeWorkspaceFileData(new Uint8Array([3, 4]).buffer) ?? []),
      [3, 4],
    );
    const crossRealmArrayBuffer = new ArrayBuffer(2);
    new Uint8Array(crossRealmArrayBuffer).set([11, 12]);
    assert.deepEqual(Array.from(normalizeWorkspaceFileData(crossRealmArrayBuffer) ?? []), [11, 12]);
    assert.deepEqual(Array.from(normalizeWorkspaceFileData([5, 6]) ?? []), [5, 6]);
    assert.deepEqual(Array.from(normalizeWorkspaceFileData({ 0: 7, 1: 8 }) ?? []), [7, 8]);
    assert.deepEqual(Array.from(normalizeWorkspaceFileData({ data: [9, 10] }) ?? []), [9, 10]);
    assert.equal(normalizeWorkspaceFileData({ invalid: true }), null);
  });

  void it("changes the resource signature when a workspace media reference changes", () => {
    const first = getMediaResourceSignature("conversation-1", [
      { type: "file", mediaType: "image/png", url: "workspace://outputs/image.png" },
    ]);
    const second = getMediaResourceSignature("conversation-1", [
      { type: "file", mediaType: "image/png", url: "workspace://outputs/image-2.png" },
    ]);
    assert.notEqual(first, second);
  });

  void it("creates an owned blob with the expected media type and bytes", async () => {
    const blob = createWorkspaceMediaBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    assert.equal(blob.type, "image/png");
    assert.deepEqual(
      Array.from(new Uint8Array(await blob.arrayBuffer())),
      [0x89, 0x50, 0x4e, 0x47],
    );
  });
});
