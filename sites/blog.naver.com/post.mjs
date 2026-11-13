#!/usr/bin/env node
// Writes a Naver Blog post in the agent's Chrome (the hyper-browsing managed browser, CDP port 9223).
//
//   node sites/blog.naver.com/post.mjs --title "제목" --html post.html [--category 매일매일] [--visibility 비공개] [--publish]
//   node sites/blog.naver.com/post.mjs --list-categories
//
// Without --publish it stops with the post written in a new editor tab, for review.
// --publish posts it: that is an external write, so only with the user's go-ahead.
// Works even when code actions are disabled in the daemon (WEBAGENT_ALLOW_CODE_ACTIONS unset).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openEditor, writePost, setCategory, setVisibility, publishPost, listCategories } from "./editor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "..", "package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);
const port = opt("port") || process.env.WEBAGENT_CDP_PORT || "9223";

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = await browser.contexts()[0].newPage();
const out = (o) => { console.log(JSON.stringify(o, null, 2)); };
try {
  const blogId = await openEditor(page, opt("blog"));
  if (flag("list-categories")) {
    out({ blogId, categories: await listCategories(page) });
    await page.close();
  } else {
    const title = opt("title");
    const htmlFile = opt("html");
    if (!title || !htmlFile) throw new Error("--title and --html <file> are required");
    const html = fs.readFileSync(htmlFile, "utf8");
    const editor = await writePost(page, { title, html });
    if (opt("category")) await setCategory(page, opt("category"));
    if (opt("visibility") || flag("publish")) await setVisibility(page, opt("visibility") || "비공개");
    if (flag("publish")) out({ blogId, editor, published: await publishPost(page) });
    else out({ blogId, editor, published: false, note: "Written in a new editor tab; review it, then publish there or rerun with --publish." });
  }
} catch (e) {
  out({ ok: false, error: String(e?.message || e) });
  process.exitCode = 1;
}
// Leave the shared Chrome running: exit without browser.close(), which could close its pages.
setTimeout(() => process.exit(process.exitCode || 0), 100);
