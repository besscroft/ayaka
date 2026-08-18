import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "@renderer/components/ui/button";

const buttonVariants = [
  "default",
  "primary",
  "secondary",
  "outline",
  "ghost",
  "tertiary",
  "destructive",
  "link",
  "success",
  "info",
  "warning",
  "danger",
  "ether",
  "fire",
  "electric",
  "ice",
  "physical",
] as const;

void describe("Button API", () => {
  void it("keeps the existing size contract for every button variant", () => {
    for (const variant of buttonVariants) {
      const html = renderToStaticMarkup(<Button variant={variant}>Action</Button>);

      assert.match(html, new RegExp(`data-variant="${variant}"`));
      assert.match(html, /data-size="default"/);
      assert.match(html, /data-round="true"/);
      assert.match(html, /data-slot="button-content"/);
    }
  });

  void it("marks a bare Button for the ZZZ implicit black default", () => {
    const html = renderToStaticMarkup(<Button>Action</Button>);

    assert.match(html, /data-variant="secondary"/);
    assert.match(html, /data-implicit-default="true"/);
    assert.doesNotMatch(html, /data-implicit-default="false"/);
  });

  void it("keeps explicit secondary separate from the implicit default", () => {
    const html = renderToStaticMarkup(<Button variant="secondary">Action</Button>);

    assert.match(html, /data-variant="secondary"/);
    assert.doesNotMatch(html, /data-implicit-default/);
  });

  void it("gives hollow precedence over plain and circle precedence over round", () => {
    const hollowHtml = renderToStaticMarkup(
      <Button plain hollow>
        Action
      </Button>,
    );
    const circleHtml = renderToStaticMarkup(
      <Button circle round>
        Action
      </Button>,
    );

    assert.match(hollowHtml, /data-hollow="true"/);
    assert.doesNotMatch(hollowHtml, /data-plain/);
    assert.match(circleHtml, /data-circle="true"/);
    assert.match(circleHtml, /data-round="false"/);
  });

  void it("supports highlight, non-round, and the current icon sizes", () => {
    const html = renderToStaticMarkup(
      <Button highlight round={false}>
        Highlight
      </Button>,
    );

    assert.match(html, /data-highlight="true"/);
    assert.match(html, /data-round="false"/);

    for (const size of ["default", "md", "sm", "lg"] as const) {
      const sized = renderToStaticMarkup(<Button size={size}>Action</Button>);
      assert.match(sized, new RegExp(`data-size="${size}"`));
    }
  });

  void it("keeps leading and trailing icons in normal content flow", () => {
    const html = renderToStaticMarkup(
      <Button>
        <svg data-icon="inline-start" aria-hidden="true" />
        Start
        <svg data-icon="inline-end" aria-hidden="true" />
      </Button>,
    );

    assert.match(html, /data-slot="button-content"/);
    assert.match(html, /data-icon="inline-start"/);
    assert.match(html, /data-icon="inline-end"/);
    assert.doesNotMatch(html, /position-absolute/);
  });

  void it("renders loading as an independent leading icon slot", () => {
    const html = renderToStaticMarkup(
      <Button variant="warning" isPending>
        Saving
      </Button>,
    );
    const loaderIndex = html.indexOf('data-slot="button-loader"');
    const contentIndex = html.indexOf('data-slot="button-content"');

    assert.ok(loaderIndex >= 0);
    assert.ok(contentIndex > loaderIndex);
    assert.match(html, /data-icon="inline-start"/);
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /data-loading="true"/);
    assert.match(html, /Saving/);
  });

  void it("uses a circular icon-only shape without changing its size", () => {
    const html = renderToStaticMarkup(
      <Button variant="success" size="lg" isIconOnly aria-label="Confirm">
        <svg aria-hidden="true" />
      </Button>,
    );

    assert.match(html, /data-size="icon"/);
    assert.match(html, /data-icon-only="true"/);
    assert.match(html, /size-9/);
    assert.match(html, /<svg aria-hidden="true"><\/svg>/);

    const explicitIconSize = renderToStaticMarkup(
      <Button size="icon" aria-label="Open">
        <svg aria-hidden="true" />
      </Button>,
    );
    assert.match(explicitIconSize, /data-icon-only="true"/);
  });

  void it("marks every icon-only semantic variant for the skin layer", () => {
    for (const variant of ["ghost", "tertiary", "link"] as const) {
      const html = renderToStaticMarkup(
        <Button variant={variant} isIconOnly aria-label={variant}>
          <svg aria-hidden="true" />
        </Button>,
      );

      assert.match(html, /data-icon-only="true"/);
      assert.match(html, /data-size="icon"/);
      assert.match(html, new RegExp(`data-variant="${variant}"`));
    }
  });

  void it("preserves disabled behavior independently from pending state", () => {
    const disabledHtml = renderToStaticMarkup(
      <Button variant="danger" isDisabled>
        Delete
      </Button>,
    );
    const pendingHtml = renderToStaticMarkup(
      <Button variant="danger" isPending>
        Delete
      </Button>,
    );

    assert.match(disabledHtml, /disabled=""/);
    assert.doesNotMatch(disabledHtml, /aria-busy/);
    assert.match(pendingHtml, /disabled=""/);
    assert.match(pendingHtml, /aria-busy="true"/);
  });
});
