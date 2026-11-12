import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import { smartScroll } from "../src/runtime/discovery-tools.ts";

test("smart-scroll accumulates unique list items across virtual DOM replacements", async t => {
  const browser = await chromium.launch(browserOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent([
    '<main><div id="scrollbox" style="height:180px; overflow-y:scroll;"><div id="results"></div><div style="height:5000px"></div></div></main>',
    '<script>',
    'const root = document.querySelector("#results"); let turn = 0;',
    'function paint() { root.innerHTML = Array.from({length:5}, (_,i) =>',
    '  "<article class=result><h3>Item " + (turn*5+i) + "</h3><a href=/items/" + (turn*5+i) + ">Read article</a></article>"',
    ').join(""); }',
    'paint(); document.querySelector("#scrollbox").addEventListener("scroll", () => { turn++; paint(); });',
    '</script>'
  ].join(""));
  const result = await smartScroll(page, { selector: "#scrollbox", maxScrolls: 4, distance: 500, limit: 50 });
  assert.equal(result.observation.complete, false);
  assert.equal(result.observation.reason, "bounded_virtual_scroll");
  assert.ok(result.scrolled <= 4);
  assert.ok(result.found, JSON.stringify(result));
  assert.ok(result.total >= 10, JSON.stringify(result));
  assert.equal(new Set(result.items.map(item => item.href)).size, result.total);
});
