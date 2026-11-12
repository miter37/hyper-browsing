import type { Frame, Page } from "playwright";

// Element lookups and page scripts run inside the chosen frame; everything about the tab itself (URL, history,
// keyboard, events, screenshots) stays with the page. The engine then works on a frame exactly as on a page.
const FRAME_METHODS = new Set([
  "evaluate", "evaluateHandle", "locator", "frameLocator", "getByRole", "getByText", "getByLabel", "getByPlaceholder",
  "getByTestId", "getByAltText", "getByTitle", "$", "$$", "$eval", "$$eval", "waitForSelector", "waitForFunction", "content",
]);
const views = new WeakMap<Frame, Page>();

export function frameView(page: Page, frame: Frame): Page {
  let view = views.get(frame);
  if (!view) {
    view = new Proxy(page, {
      get(target, prop) {
        if (typeof prop === "string" && FRAME_METHODS.has(prop)) return (frame as any)[prop].bind(frame);
        // Reference stores forget their handles when "their" document navigates: here, the frame's.
        if (prop === "mainFrame") return () => frame;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Page;
    views.set(frame, view);
  }
  return view;
}

/** A frame by its name, or by a part of its URL. */
export function findFrame(page: Page, key: string): Frame | undefined {
  const frames = page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached());
  return frames.find((f) => f.name() === key) || frames.find((f) => f.url().includes(key));
}

export interface FrameInfo { frame: string; url: string; width: number; height: number }

/** Frames drawn on screen at a readable size: content there is not part of the page's own snapshot. */
export async function listFrames(page: Page, minArea = 20000): Promise<FrameInfo[]> {
  const out: FrameInfo[] = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame() || f.isDetached() || !/^https?:/.test(f.url())) continue;
    const box = await f.frameElement().then((el) => el.boundingBox()).catch(() => null);
    if (!box || box.width * box.height < minArea) continue;
    let key = f.name();
    if (!key) { try { const u = new URL(f.url()); key = u.host + u.pathname; } catch { key = f.url(); } }
    out.push({ frame: key.slice(0, 120), url: f.url().slice(0, 200), width: Math.round(box.width), height: Math.round(box.height) });
  }
  return out.slice(0, 8);
}

export const FRAME_HINT = "Part of this page is inside frames (listed in frames). Its content is not in this result: pass frame (a name or URL part from frames) to snapshot, list_items, read_text, click or fill to work inside it.";
