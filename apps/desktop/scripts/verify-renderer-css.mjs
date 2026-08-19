import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const assetsDir = resolve(import.meta.dirname, "../out/renderer/assets");
const cssFiles = readdirSync(assetsDir).filter((name) => /^index-.*\.css$/.test(name));

if (cssFiles.length !== 1) {
  throw new Error(
    `Expected exactly one renderer CSS bundle in ${assetsDir}, found ${cssFiles.length}. Run electron-vite build first.`,
  );
}

const cssFile = cssFiles[0];
const css = readFileSync(resolve(assetsDir, cssFile), "utf8");
const thumbRule = css.match(/:root\[data-skin=zzz\]\s+\[data-slot=switch-thumb\]\{([^}]*)\}/);

if (!thumbRule) {
  throw new Error(`ZZZ switch thumb rule is missing from ${cssFile}.`);
}

if (!/translate\s*:\s*none\s*!important/.test(thumbRule[1])) {
  throw new Error(
    `ZZZ switch thumb lost its independent translate reset in ${cssFile}; production CSS minification may reintroduce knob overflow.`,
  );
}

for (const offset of [4, 5]) {
  if (!css.includes(`data-checked\\:translate-x-${offset}`)) {
    throw new Error(`Expected data-checked:translate-x-${offset} utility in ${cssFile}.`);
  }
}

console.log(`Verified ZZZ switch production CSS: ${cssFile}`);
