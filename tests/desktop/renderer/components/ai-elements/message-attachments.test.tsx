import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageAttachments } from "@renderer/components/ai-elements/message-attachments";

void describe("message image attachments", () => {
  void it("renders compact, non-cropping image controls instead of external links", () => {
    const html = renderToStaticMarkup(
      <MessageAttachments
        parts={[
          {
            type: "file",
            mediaType: "image/png",
            filename: "one.png",
            url: "data:image/png;base64,AA==",
          },
          {
            type: "file",
            mediaType: "image/png",
            filename: "two.png",
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    );

    assert.match(html, /max-w-\[420px\]/);
    assert.match(html, /aspect-\[4\/3\]/);
    assert.match(html, /object-contain/);
    assert.match(html, /aria-label="查看图片：one\.png"/);
    assert.doesNotMatch(html, /target="_blank"/);
    assert.doesNotMatch(html, /object-cover/);
  });
});

void describe("message video attachments", () => {
  void it("keeps rendering uploaded video files after video generation removal", () => {
    const html = renderToStaticMarkup(
      <MessageAttachments
        parts={[
          {
            type: "file",
            mediaType: "video/mp4",
            filename: "clip.mp4",
            url: "data:video/mp4;base64,AA==",
          },
        ]}
      />,
    );

    assert.match(html, /<video/);
    assert.match(html, /clip\.mp4/);
  });
});
