import type { SiteActionModule } from "../../src/sdk/types";
// @ts-ignore plain ESM helpers shared with post.mjs
import { openEditor, writePost, setCategory, setVisibility, publishPost, listCategories, readEditor } from "./editor.mjs";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

export const actions: SiteActionModule = {
  /** Fresh editor with title and body pasted in one step each. Nothing is published. */
  async write_post(ctx) {
    const title = str(ctx.input.title), html = str(ctx.input.html);
    if (!title || !html) throw new Error("write_post needs input.title and input.html (an HTML fragment)");
    const blogId = await openEditor(ctx.page, str(ctx.input.blogId));
    const editor = await writePost(ctx.page, { title, html });
    return { blogId, editor, next: "Review the editor (screenshot), then run publish_post with category and visibility." };
  },

  /** Category names of the signed-in blog, read from the publish layer of an open editor. */
  async list_categories(ctx) {
    return { categories: await listCategories(ctx.page) };
  },

  /** Publishes the post open in the editor. External write: run only after the user approved it. */
  async publish_post(ctx) {
    const visibility = str(ctx.input.visibility) || "비공개";
    const category = str(ctx.input.category);
    const before = await readEditor(ctx.page);
    if (!before.title || !before.textLength) throw new Error("The editor has no title or no body; write the post first");
    if (category) await setCategory(ctx.page, category);
    await setVisibility(ctx.page, visibility);
    const result = await publishPost(ctx.page);
    return { ...result, title: before.title, category: category || "(blog default)", visibility };
  },
};
