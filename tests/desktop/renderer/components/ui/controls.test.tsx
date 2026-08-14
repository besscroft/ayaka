import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Checkbox,
  DateTimePicker,
  LoadingIndicator,
  SelectField,
  Slider,
  Switch,
} from "@renderer/components/ui/index";

void describe("shared form controls", () => {
  void it("renders a Switch control before ordinary text children", () => {
    const html = renderToStaticMarkup(<Switch>Enabled</Switch>);

    assert.match(html, /h-6 w-11/);
    assert.match(html, />Enabled<\/span>/);
    assert.doesNotMatch(html, /Enabled.*h-6 w-11/);
  });

  void it("keeps explicit Switch compound content and inherits its size", () => {
    const html = renderToStaticMarkup(
      <Switch size="sm" isSelected isDisabled>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          Compact
        </Switch.Content>
      </Switch>,
    );

    assert.match(html, /h-5 w-9/);
    assert.match(html, /size-4 data-checked:translate-x-4/);
    assert.match(html, /data-checked/);
    assert.match(html, /data-disabled/);
    assert.match(html, />Compact<\/span>/);
  });

  void it("renders Checkbox labels for both plain and compound content", () => {
    const plain = renderToStaticMarkup(<Checkbox isSelected>Remember</Checkbox>);
    const compound = renderToStaticMarkup(
      <Checkbox>
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          Custom label
        </Checkbox.Content>
      </Checkbox>,
    );

    assert.match(plain, /bg-primary/);
    assert.match(plain, /focus-visible:ring-2/);
    assert.match(plain, />Remember<\/span>/);
    assert.match(compound, /Custom label/);
    assert.match(compound, /data-slot="checkbox-indicator"|data-checked/);
  });

  void it("renders one Slider thumb for a scalar and one per range value", () => {
    const scalar = renderToStaticMarkup(<Slider value={40} />);
    const range = renderToStaticMarkup(<Slider value={[20, 80]} />);

    assert.equal(count(scalar, 'data-slot="slider-thumb"'), 1);
    assert.equal(count(range, 'data-slot="slider-thumb"'), 2);
    assert.match(scalar, /bg-primary/);
    assert.match(scalar, /bg-muted/);
    assert.match(scalar, /bg-background/);
    assert.match(scalar, /border-foreground\/30/);
  });

  void it("maps SelectField values to labels and preserves an empty value", () => {
    const selected = renderToStaticMarkup(
      <SelectField
        value="ocean"
        options={[
          { value: "white", label: "White" },
          { value: "ocean", label: "Ocean" },
        ]}
        onChange={() => undefined}
        ariaLabel="Theme"
      />,
    );
    const empty = renderToStaticMarkup(
      <SelectField
        value=""
        options={[
          { value: "", label: "Inherit" },
          { value: "model", label: "Model" },
        ]}
        onChange={() => undefined}
        placeholder="Choose"
        ariaLabel="Model"
      />,
    );

    assert.match(selected, /Ocean/);
    assert.match(selected, /aria-label="Theme"/);
    assert.match(selected, /value="ocean"/);
    assert.match(empty, /Inherit/);
    assert.match(empty, /value=""/);
  });

  void it("keeps loading indicators visible with semantic status markup", () => {
    const html = renderToStaticMarkup(<LoadingIndicator label="Loading" />);

    assert.match(html, /role="status"/);
    assert.match(html, /text-primary/);
    assert.match(html, />Loading<\/span>/);
  });

  void it("renders the DateTimePicker with a calendar trigger and shared time input", () => {
    const html = renderToStaticMarkup(
      <DateTimePicker value="2026-08-11T13:45" onChange={() => undefined} ariaLabel="Run at" />,
    );

    assert.match(html, /aria-label="Run at"/);
    assert.match(html, /type="time"/);
    assert.match(html, /value="13:45"/);
    assert.match(html, /lucide-calendar-days/);
  });
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
