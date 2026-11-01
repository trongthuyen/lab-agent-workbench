import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultFeatureStates, resolveConfig, type FeatureStates } from "@lab-agent-workbench/core";
import { createFeatureMenu } from "../src/feature-menu.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;

test("feature menu keeps a draft until Ctrl+S and Esc/Ctrl+C cancel", () => {
  for (const close of ["\x13", "\x1b", "\x03"]) {
    const initial = defaultFeatureStates(resolveConfig());
    const results: (FeatureStates | undefined)[] = [];
    let renders = 0;
    const menu = createFeatureMenu(initial, theme, () => { renders += 1; }, (state) => results.push(state));
    assert.match(menu.render(100).join("\n"), /LAWb \/ Feature controls/);
    menu.handleInput?.("\r");
    assert.equal(results.length, 0);
    assert.equal(initial.writeProtection, true);
    assert.match(menu.render(100).join("\n"), /Guardrails OFF: Write protection/);
    assert.match(menu.render(100).join("\n"), /Unsaved changes/);
    menu.handleInput?.(close);
    assert.equal(results.length, 1);
    if (close === "\x13") assert.equal(results[0]?.writeProtection, false);
    else assert.equal(results[0], undefined);
    assert.ok(renders > 0);
  }
});

test("feature menu supports keyboard navigation and stays within terminal width after invalidate", () => {
  const initial = defaultFeatureStates(resolveConfig());
  let result: FeatureStates | undefined;
  const menu = createFeatureMenu(initial, theme, () => {}, (state) => { result = state; });
  menu.handleInput?.("\x1b[B");
  menu.handleInput?.(" ");
  for (const width of [12, 24, 40, 80, 120]) {
    menu.invalidate();
    for (const line of menu.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
  }
  menu.handleInput?.("\x13");
  assert.equal(result?.readProtection, false);
  assert.equal(result?.writeProtection, true);
});
