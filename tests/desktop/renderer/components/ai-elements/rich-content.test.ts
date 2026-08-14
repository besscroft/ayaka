import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMediaKindFromUrl,
  parseRichContentBlocks,
  sanitizeRichContentUrl,
} from "@renderer/components/ai-elements/rich-content-utils";

void describe("rich chat content renderer helpers", () => {
  void it("parses common markdown blocks", () => {
    const blocks = parseRichContentBlocks(`# Title

- [x] Done
- [ ] Next

| Name | Value |
| ---- | ----- |
| One | **Two** |

\`\`\`ts
const ok = true;
\`\`\``);

    assert.equal(blocks[0]?.type, "heading");
    assert.deepEqual(blocks[1], {
      type: "list",
      ordered: false,
      items: [
        { text: "Done", checked: true },
        { text: "Next", checked: false },
      ],
    });
    assert.deepEqual(blocks[2], {
      type: "table",
      headers: ["Name", "Value"],
      rows: [["One", "**Two**"]],
    });
    assert.deepEqual(blocks[3], {
      type: "code",
      lang: "ts",
      code: "const ok = true;",
    });
  });

  void it("detects rich media URLs", () => {
    assert.equal(getMediaKindFromUrl("https://example.com/photo.webp"), "image");
    assert.equal(getMediaKindFromUrl("https://example.com/speech.mp3?download=1"), "audio");
    assert.equal(getMediaKindFromUrl("ayaka-media://asset/generated.mp4"), "video");
    assert.equal(getMediaKindFromUrl("https://example.com/page"), null);
  });

  void it("allows only safe URL protocols for rich content", () => {
    assert.equal(sanitizeRichContentUrl("https://example.com", "link"), "https://example.com");
    assert.equal(
      sanitizeRichContentUrl("mailto:hello@example.com", "link"),
      "mailto:hello@example.com",
    );
    assert.equal(
      sanitizeRichContentUrl("data:image/png;base64,AA==", "image"),
      "data:image/png;base64,AA==",
    );
    assert.equal(
      sanitizeRichContentUrl("ayaka-media://asset/image.png", "image"),
      "ayaka-media://asset/image.png",
    );
    assert.equal(sanitizeRichContentUrl("javascript:alert(1)", "link"), null);
    assert.equal(sanitizeRichContentUrl("data:text/html;base64,PGgxPg==", "image"), null);
  });
});
