// Deterministic checks (no LLM, no network, no user profile) for three discovery behaviors:
//   1. ambiguous locators are refused with candidates instead of clicking the first match; --nth picks one
//   2. snapshot carries element state, and a visible label stands in for its hidden custom checkbox
//   3. dismiss-annoyances acts only on consent/popup evidence and hides overlays only with consent text or forceHide
// Run: npx tsx tests/discovery-lessons.mjs   (PW_CHROMIUM_PATH=<chrome.exe> to use an existing Chromium build)
import { chromium } from "playwright";
import { browserOptions } from './browser-options.mjs';
import { resolveUnique } from "../src/engine/locators.ts";
import { captureSnapshot } from "../src/runtime/snapshot.ts";
import { compareSnapshots, dismissAnnoyances, listItems } from "../src/runtime/discovery-tools.ts";
import { actOn, chooseOption, fillOrSelect } from "../src/engine/interact.ts";

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
}

const CARDS = `
<nav><a href="#home">Home</a></nav>
<section><h3>CSS Grid Layout</h3><p>Two-dimensional layout.</p><a href="#grid">Repository</a></section>
<section><h3>CSS Flexbox</h3><p>One-dimensional layout.</p><a href="#flex">Repository</a></section>
<button style="display:none">Save</button><button onclick="location.hash='saved'">Save</button>`;

const STATES = `
<label for="c1">SAMSUNG</label><input id="c1" type="checkbox" style="opacity:0;position:absolute;width:1px;height:1px">
<label for="c2">Kingston</label><input id="c2" type="checkbox" checked style="display:none">
<label for="c3">Visible box</label><input id="c3" type="checkbox">
<select id="s1"><option>One</option><option selected>Two</option></select>
<button aria-expanded="false">Languages</button>
<button aria-pressed="true">Bold</button>
<button disabled>Disabled one</button>
<div role="listbox"><div role="option" aria-selected="true">Stars</div><div role="option" aria-selected="false">Forks</div></div>`;

const ANNOYANCES = `
<script>window.clicked = [];</script>
<main>
  <form><input value="draft"><button type="button" onclick="clicked.push('form-ok')">확인</button></form>
  <button onclick="clicked.push('close-account')">Close account</button>
</main>
<div class="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#eee">
  We use cookies to improve the site. <button onclick="clicked.push('accept');this.parentElement.remove()">Accept all</button>
</div>
<div class="promo-modal" style="position:fixed;top:40px;left:40px;background:#fff;z-index:200">
  Sale today! <button onclick="clicked.push('promo-close');this.parentElement.style.display='none'">Close</button>
</div>
<div role="dialog" style="position:fixed;top:200px;left:40px;background:#fff">
  <input value="Seoul"> <button onclick="clicked.push('dialog-close')">Close</button>
</div>
<div class="modal-backdrop" style="position:fixed;left:0;top:300px;width:200px;height:50px;opacity:.3;background:#000"></div>`;

const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage();

  // 1. Ambiguity
  await page.setContent(CARDS);
  const amb = await resolveUnique(page, { role: "link", name: "Repository" });
  check("two visible 'Repository' links are refused as ambiguous", "ambiguous" in amb && amb.count === 2, JSON.stringify(amb));
  check("candidates name their own card heading",
    "ambiguous" in amb && amb.candidates.map((c) => c.context).join("|") === "CSS Grid Layout|CSS Flexbox",
    JSON.stringify("ambiguous" in amb && amb.candidates));
  const picked = await resolveUnique(page, { role: "link", name: "Repository" }, 1);
  await picked.locator.click();
  check("--nth 1 clicks the second card's link", page.url().endsWith("#flex"), page.url());
  const save = await resolveUnique(page, { role: "button", name: "Save" });
  check("a hidden duplicate does not make a locator ambiguous", !("ambiguous" in save));
  if (!("ambiguous" in save)) await save.locator.click();
  check("the single visible 'Save' button is clicked", page.url().endsWith("#saved"), page.url());
  let threw = false;
  try { await resolveUnique(page, { role: "link", name: "Repository" }, 5); } catch { threw = true; }
  check("--nth out of range is an error, not a guess", threw);

  // 2. Snapshot state
  await page.setContent(STATES);
  const before = await captureSnapshot(page);
  const by = (pred) => before.elements.find(pred);
  const samsung = by((e) => e.tag === "label" && e.name === "SAMSUNG");
  check("label of an opacity:0 checkbox is listed with checked=false", samsung?.checked === false, JSON.stringify(samsung));
  const kingston = by((e) => e.tag === "label" && e.name === "Kingston");
  check("label of a display:none checkbox is listed with checked=true", kingston?.checked === true, JSON.stringify(kingston));
  check("label of a visible checkbox is not listed (the input is)",
    !by((e) => e.tag === "label" && e.name === "Visible box") && by((e) => e.tag === "input" && e.name === "Visible box")?.checked === false);
  check("select shows its selected option text", by((e) => e.tag === "select")?.selectedText === "Two");
  check("aria-expanded=false is reported", by((e) => e.name === "Languages")?.expanded === false);
  check("aria-pressed=true is reported", by((e) => e.name === "Bold")?.pressed === true);
  check("disabled is reported", by((e) => e.name === "Disabled one")?.disabled === true);
  check("role=option selection is reported",
    by((e) => e.name === "Stars")?.selected === true && by((e) => e.name === "Forks")?.selected === false);
  const plain = by((e) => e.name === "Languages");
  check("elements without state carry no state fields", plain && plain.checked === undefined && plain.disabled === undefined);
  await page.getByText("SAMSUNG").click();
  const after = await captureSnapshot(page);
  const diff = compareSnapshots(before, after);
  const change = diff.stateChanges.find((c) => c.element.includes("SAMSUNG"));
  check("diff reports the label click as a checked state change",
    change?.before.checked === false && change?.after.checked === true, JSON.stringify(diff.stateChanges));

  // 3. dismiss-annoyances
  await page.setContent(ANNOYANCES);
  const res = await dismissAnnoyances(page);
  const clicked = await page.evaluate(() => window.clicked);
  check("cookie banner 'Accept all' is clicked", clicked.includes("accept"), JSON.stringify(clicked));
  check("popup 'Close' in a fixed overlay is clicked", clicked.includes("promo-close"), JSON.stringify(clicked));
  check("form '확인' outside any overlay is not clicked", !clicked.includes("form-ok"), JSON.stringify(clicked));
  check("'Close account' is not treated as 'Close'", !clicked.includes("close-account"), JSON.stringify(clicked));
  check("dialog 'Close' is skipped while the dialog holds a filled field", !clicked.includes("dialog-close"), JSON.stringify(res.skipped));
  const backdropShown = await page.evaluate(() => getComputedStyle(document.querySelector(".modal-backdrop")).display !== "none");
  check("non-consent backdrop is reported, not hidden", backdropShown && res.overlays.some((o) => o.includes("modal-backdrop")), JSON.stringify(res));
  await dismissAnnoyances(page, { forceHide: true });
  const backdropHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".modal-backdrop")).display === "none");
  check("forceHide hides the remaining backdrop", backdropHidden);
  // 4. Trial fixes (Haiku run, 2026-10-13)
  await page.setContent(`
    <div id="host"></div>
    <script>
      const root = document.getElementById("host").attachShadow({ mode: "open" });
      root.innerHTML = '<h2>Results</h2><a href="#r1">Shadow result one</a><button>Shadow Save</button>';
    </script>`);
  const shadow = await captureSnapshot(page, { query: "shadow" });
  check("snapshot sees controls inside an open shadow root",
    shadow.elements.some((e) => e.name === "Shadow Save") && shadow.elements.some((e) => e.name === "Shadow result one"), JSON.stringify(shadow.elements));

  await page.setContent(`
    <label for="w1">These words</label><input id="w1">
    <label for="w2">Not these words</label><input id="w2">
    <label for="w3">One of these words</label><input id="w3">
    <a href="/ko">한국어</a><a href="/ko">한국어</a>
    <label>Dropdown <select id="s"><option>Select</option><option>One</option><option>DC - District of Columbia</option></select></label>
    <div><span>Sort by:</span> <button>Popularity</button></div>
    <button><span class="material-icons" style="font-family:'Material Icons'">arrow_drop_down</span> Filter</button>
    <input type="search" placeholder="Search crates">
    <div role="group" aria-label="Toolbar"><button>Bold</button><button>Italic</button></div>
    <h2>Advanced options</h2>
    <input id="out" value="none"><button onclick="document.getElementById('out').value='done'">Set</button>
    <button onclick="const d=document.createElement('div');d.setAttribute('role','dialog');d.setAttribute('aria-label','Filters');d.textContent='x';document.body.append(d)">Open filters</button>
    <input id="upper" oninput="this.value=this.value.toUpperCase()">`);
  const exact = await resolveUnique(page, { label: "These words" });
  check("exact label wins over substring matches", exact.resolvedBy === "exact" && await exact.locator.getAttribute("id") === "w1", JSON.stringify(exact.resolvedBy));
  const sameHref = await resolveUnique(page, { role: "link", name: "한국어" });
  check("links to the same href are one target", sameHref.resolvedBy === "same-href", JSON.stringify(sameHref));
  const noMatch = await resolveUnique(page, { role: "button", name: "Advanced options" }, undefined, 500);
  check("no match returns suggestions instead of a timeout",
    noMatch.noMatch === true && noMatch.suggestions.some((s) => s.name === "Advanced options"), JSON.stringify(noMatch));
  const forms = await captureSnapshot(page);
  const sel = forms.elements.find((e) => e.tag === "select");
  check("select name is its label, not its options", sel?.name === "Dropdown" && sel?.role === "combobox", JSON.stringify(sel));
  check("hint gives the words before a value-named button", forms.elements.find((e) => e.name === "Popularity")?.hint === "Sort by:");
  check("icon-font ligature text is left out of names", forms.elements.some((e) => e.name === "Filter"), JSON.stringify(forms.elements.map((e) => e.name)));
  check("implicit role is shown (search input -> searchbox)", forms.elements.find((e) => e.placeholder === "Search crates")?.role === "searchbox");
  const group = forms.elements.find((e) => e.role === "group");
  check("a container has no giant text name", group && group.name === "Toolbar" && !group.text, JSON.stringify(group));
  const chosen = await fillOrSelect(page, "select", { locator: { css: "#s" }, option: "DC" });
  check("select picks an option by unique partial text", chosen.ok && chosen.selected?.includes("DC - District of Columbia"), JSON.stringify(chosen));
  const viaFill = await fillOrSelect(page, "fill", { locator: { css: "#s" }, value: "One" });
  check("fill on a <select> selects instead of failing", viaFill.ok && viaFill.selected === "One", JSON.stringify(viaFill));
  const upper = await fillOrSelect(page, "fill", { locator: { css: "#upper" }, value: "abc" });
  check("fill reads the value back and flags a mismatch", upper.ok && upper.value === "ABC" && upper.valueMatches === false && upper.warning, JSON.stringify(upper));
  const set = await actOn(page, "click", { locator: { role: "button", name: "Set" } }, (l, t) => l.click({ timeout: t }));
  check("effect reports a value change elsewhere on the page",
    set.effect?.page?.valueChanges?.some((v) => v.after === "done"), JSON.stringify(set.effect));
  const opened = await actOn(page, "click", { locator: { role: "button", name: "Open filters" } }, (l, t) => l.click({ timeout: t }));
  check("effect reports a dialog that opened", opened.effect?.page?.opened?.some((o) => o.includes("Filters")), JSON.stringify(opened.effect));

  await page.setContent(CARDS);
  const within = await resolveUnique(page, { role: "link", name: "Repository" }, undefined, 5000, "Flexbox");
  check("--within picks the card by its heading", within.resolvedBy === "within" && await within.locator.getAttribute("href") === "#flex");

  await page.setContent(`
    <style>.menu li ul { height: 0; overflow: hidden; } .menu li:hover ul { height: auto; }</style>
    <ul class="menu"><li><label><input type="checkbox"> 1TB to 3.9TB</label>
      <ul><li><label><input type="checkbox" id="two"> 2TB</label></li></ul></li></ul>`);
  const collapsed = await captureSnapshot(page, { query: "2TB" });
  check("collapsed sub-item is marked clipped", collapsed.elements.some((e) => e.clipped === true), JSON.stringify(collapsed.elements));
  await actOn(page, "hover", { locator: { text: "1TB to 3.9TB" } }, (l, t) => l.hover({ timeout: t }));
  const ticked = await actOn(page, "click", { locator: { label: "2TB", exact: true } }, (l, t) => l.click({ timeout: t }));
  check("after hover the revealed sub-item is clicked (hit-test beats geometry)",
    ticked.ok && await page.evaluate(() => document.getElementById("two").checked), JSON.stringify(ticked));

  await page.setContent(`<main><h1>Results</h1><ol>
    <li><h3><a href="/a">Alpha crate</a></h3><p>first</p></li>
    <li><h3><a href="/b">Beta crate</a></h3><p>second</p></li>
    <li><h3><a href="/c">Gamma crate</a></h3><p>third</p></li></ol></main>`);
  const list = await listItems(page, { limit: 5 });
  check("list reads repeated items in order", list.found && list.items[0].title === "Alpha crate" && list.total === 3, JSON.stringify(list));

  await page.setContent(`<nav><ul><li><a href="/x">Home</a></li><li><a href="/y">About</a></li><li><a href="/z">Blog</a></li><li><a href="/w">Jobs</a></li></ul></nav>
    <main><div id="res"></div></main>
    <script>
      for (const [id, t] of [["css-grid", "CSS Grid Layout (level 1)"], ["css-subgrid", "CSS Subgrid"], ["css-grid-lanes", "CSS Grid Lanes"]]) {
        const card = document.createElement("feature-card");
        card.attachShadow({ mode: "open" }).innerHTML = '<a href="' + id + '" style="display:contents"><div><h3>' + t + '</h3><p>support table</p></div></a>';
        document.getElementById("res").append(card);
      }
    </script>`);
  const shadowList = await listItems(page, { limit: 5 });
  check("list reads web-component cards (shadow DOM) and skips nav", shadowList.found && shadowList.items[0].title === "CSS Grid Layout (level 1)" && shadowList.items[0].href?.endsWith("css-grid"), JSON.stringify(shadowList));
  const cardSnap = await captureSnapshot(page, { query: "Grid Layout" });
  check("snapshot lists a display:contents link inside a shadow root", cardSnap.elements.some((e) => e.role === "link" && e.href === "css-grid"), JSON.stringify(cardSnap.elements));
  await page.setContent(`<details id="f"><summary>Filters</summary><div id="pane"></div></details>
    <script>
      // The pane's controls are only rendered once the disclosure is opened.
      document.getElementById("f").addEventListener("toggle", (e) => {
        if (e.target.open) document.getElementById("pane").innerHTML = '<label><input type="checkbox"> texts</label>';
      });
    </script>`);
  const closedPane = await captureSnapshot(page, { query: "texts" });
  check("no match points at the closed disclosure that may hold it",
    closedPane.collapsed?.some((c) => c.name === "Filters" && c.use.includes("--text")), JSON.stringify(closedPane.collapsed));
  const summary = (await captureSnapshot(page)).elements.find((e) => e.tag === "summary");
  check("summary shows its open state and no unmatchable role", summary && summary.expanded === false && !summary.role, JSON.stringify(summary));

  await page.setContent(`<div class="card"><h3>CSS Subgrid</h3><p>Partial support</p><a href="css-subgrid">Details</a></div>`);
  const headingClick = await actOn(page, "click", { locator: { text: "CSS Subgrid", exact: true } }, (l, t) => l.click({ timeout: t }));
  check("clicking a non-control with no effect points at the nearest link", headingClick.effect?.note?.includes("css-subgrid"), JSON.stringify(headingClick.effect));
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
