// Naver Blog (SmartEditor ONE) helpers shared by actions.ts and post.mjs.
// Everything takes a Playwright Page. Nothing here publishes unless publishPost() is called.
//
// Why paste instead of typing: SmartEditor ONE converts pasted HTML into its own components
// (headings, bold, colors, font sizes, lists, tables, quotes, dividers) in one step, so a whole
// post lands at once and already formatted. The paste is dispatched inside the page (a
// ClipboardEvent with a DataTransfer), so the system clipboard is never touched: no clash with
// whatever the user copies meanwhile, and no Windows CF_HTML encoding issues.

export const WRITE_URL = (blogId) => `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}`;

const VISIBILITY = { 전체공개: "open_public", 이웃공개: "open_neighbor", 서로이웃공개: "open_both_neighbor", 비공개: "open_private",
  public: "open_public", neighbor: "open_neighbor", mutual: "open_both_neighbor", private: "open_private" };

/** blogId of the signed-in user, read from the write redirect (GoBlogWrite -> /{blogId}?Redirect=Write). */
export async function myBlogId(page) {
  await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded" });
  const m = page.url().match(/blog\.naver\.com\/([A-Za-z0-9_-]+)\?Redirect=Write/);
  if (!m) throw new Error(`Not signed in to Naver, or the write page moved (landed on ${page.url()})`);
  return m[1];
}

/**
 * Opens the editor directly (the top-level PostWriteForm page, not the framed blog page) and starts
 * a fresh post. If Naver offers to continue an unfinished draft, the offer is declined (the draft
 * itself stays in 임시저장).
 */
export async function openEditor(page, blogId) {
  const id = blogId || await myBlogId(page);
  await page.goto(WRITE_URL(id), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".se-documentTitle", { timeout: 20000 });
  await page.waitForTimeout(800);
  const cancel = page.locator(".se-popup-button-cancel");
  if (await cancel.count()) await cancel.first().click().catch(() => {});
  // The help side panel sometimes opens on first use; it only covers the toolbar.
  const helpClose = page.locator(".se-help-panel-close-button");
  if (await helpClose.count()) await helpClose.first().click().catch(() => {});
  return id;
}

/**
 * The hidden same-origin iframe whose contenteditable body receives SmartEditor's keyboard and paste input.
 * Its URL reads as about:blank in a fresh tab, so it is found by what it is, not by address.
 */
async function inputBuffer(page) {
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const editable = await f.evaluate(() => Boolean(document.body && document.body.isContentEditable)).catch(() => false);
      if (editable) return f;
    }
    await page.waitForTimeout(300);
  }
  return undefined;
}

/** Clicks a spot in the editor, then pastes html/plain text there as if the user pressed Ctrl+V. */
export async function pasteAt(page, selector, { html, text }) {
  await page.locator(selector).first().click();
  await page.waitForTimeout(300);
  const frame = await inputBuffer(page);
  if (!frame) throw new Error("SmartEditor input buffer not found (the editor layout changed)");
  await frame.evaluate(({ html, text }) => {
    const dt = new DataTransfer();
    if (html) dt.setData("text/html", html);
    dt.setData("text/plain", text || "");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { html, text });
  await page.waitForTimeout(1000);
}

/** Plain text of an HTML fragment, used as the text/plain half of the paste. */
export function htmlToText(html) {
  return String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h\d|li|tr|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}

/** Writes title and body into an open, empty editor. Returns what the editor now holds. */
export async function writePost(page, { title, html }) {
  if (!title || !html) throw new Error("title and html are required");
  await pasteAt(page, ".se-documentTitle .se-text-paragraph", { text: title });
  await pasteAt(page, ".se-component.se-text .se-text-paragraph", { html, text: htmlToText(html) });
  return readEditor(page);
}

export async function readEditor(page) {
  return page.evaluate(() => {
    // Placeholders ("제목", "글감과 함께…") are spans inside empty paragraphs; they are not content.
    const text = (el) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
      copy.querySelectorAll(".se-placeholder").forEach((p) => p.remove());
      return (copy.textContent || "").trim();
    };
    const body = [...document.querySelectorAll(".se-component")].filter((c) => !c.classList.contains("se-documentTitle"));
    const kinds = body.map((c) => (c.className.match(/se-(text|table|quotation|horizontalLine|image|sectionTitle|oglink)\b/) || [, "other"])[1]);
    const lengths = body.map((c) => text(c).length);
    return {
      title: text(document.querySelector(".se-documentTitle .se-text-paragraph")),
      // Body components in order, without empty text paragraphs (the editor keeps one after the last component).
      components: kinds.filter((k, i) => k !== "text" || lengths[i] > 0),
      textLength: lengths.reduce((a, b) => a + b, 0),
    };
  });
}

/** Opens the publish layer (category, visibility, tags). Does not publish. */
export async function openPublishLayer(page) {
  if (await page.locator('[data-testid="seOnePublishBtn"]').isVisible().catch(() => false)) return;
  await page.locator("button[class*='publish_btn']").first().click();
  await page.locator('[data-testid="seOnePublishBtn"]').waitFor({ state: "visible", timeout: 5000 });
}

/** Lists category names in the publish layer (sub-categories without the "하위 카테고리" prefix). */
export async function listCategories(page) {
  const ids = await categoryIds(page);
  await page.keyboard.press("Escape").catch(() => {});
  return ids.map((x) => x.replace(/^\d+_/, ""));
}

/** Opens the category menu (its items exist only while it is open) and returns the radio ids, e.g. "32_매일매일". */
async function categoryIds(page) {
  await openPublishLayer(page);
  const button = page.getByRole("button", { name: "카테고리 목록 버튼" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await page.locator('input[data-testid^="categoryBtn_"]').first().waitFor({ state: "attached", timeout: 5000 });
  return page.evaluate(() => [...document.querySelectorAll('input[data-testid^="categoryBtn_"]')].map((i) => i.id));
}

/** Picks a category by its exact name (e.g. "매일매일"). Throws with the available names otherwise. */
export async function setCategory(page, name) {
  const ids = await categoryIds(page);
  const id = ids.find((x) => x.replace(/^\d+_/, "") === name);
  if (!id) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`No category "${name}". Available: ${ids.map((x) => x.replace(/^\d+_/, "")).join(", ")}`);
  }
  await page.locator(`label[for="${id}"]`).click();
  await page.waitForTimeout(300);
  const shown = (await page.getByRole("button", { name: "카테고리 목록 버튼" }).textContent() || "").trim();
  if (!shown.endsWith(name)) throw new Error(`Category did not change (shows "${shown}")`);
}

/** 전체공개 | 이웃공개 | 서로이웃공개 | 비공개 (or public | neighbor | mutual | private). */
export async function setVisibility(page, visibility) {
  const id = VISIBILITY[visibility];
  if (!id) throw new Error(`Unknown visibility "${visibility}". Use 전체공개, 이웃공개, 서로이웃공개 or 비공개`);
  await openPublishLayer(page);
  await page.locator(`label[for="${id}"]`).click();
  if (!(await page.locator(`#${id}`).isChecked())) throw new Error(`Visibility ${visibility} was not selected`);
}

/** Final publish. Resolves with the post URL once Naver redirects to PostView. */
export async function publishPost(page) {
  await openPublishLayer(page);
  await page.locator('[data-testid="seOnePublishBtn"]').click();
  await page.waitForURL(/PostView\.naver\?.*logNo=\d+/, { timeout: 20000 });
  const url = page.url();
  return { url, logNo: url.match(/logNo=(\d+)/)?.[1] };
}
