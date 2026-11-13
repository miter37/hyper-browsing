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

// Ad slots: hosts of ad exchanges, ad-server paths and frame names, and the standard IAB banner sizes on a frame
// from another site. Such frames never hold the content a task is about, so they are counted, not listed.
const AD_HOST = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adtrafficquality\.google|adnxs\.com|amazon-adsystem\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|pubmatic\.com|rubiconproject\.com|openx\.net|casalemedia\.com|3lift\.com|adsrvr\.org|moatads\.com|yieldmo\.com|sharethrough\.com|teads\.tv|smartadserver\.com|media\.net|adform\.net|bidswitch\.net|connatix\.com|imasdk\.googleapis\.com|33across\.com|gumgum\.com|indexww\.com|sonobi\.com|triplelift\.com|primis\.tech|ads\.yahoo\.com|pubgw\.yahoo\.com)$/i;
const AD_PATH = /\/(ads?|adserver|adframe|gampad|safeframe|prebid|sodar)(?![a-z])|[?&](ad_?unit|adslot|slotname)=/i;
const AD_NAME = /^(google_ads_iframe|aswift_|ad[_-]?(slot|frame|unit)|safeframe|sf_|gpt_|div-gpt-ad)/i;
const AD_SIZES = [[300, 250], [728, 90], [160, 600], [300, 600], [320, 50], [320, 100], [970, 90], [970, 250], [468, 60], [336, 280], [250, 250], [200, 200], [120, 600], [300, 50], [320, 480], [970, 66]];
// The box includes the frame border, so sizes match within a few pixels.
const adSized = (w: number, h: number) => AD_SIZES.some(([aw, ah]) => Math.abs(w - aw) <= 6 && Math.abs(h - ah) <= 6);
const siteOf = (host: string) => host.split(".").slice(-2).join(".");

function isAdFrame(page: Page, f: Frame, box: { width: number; height: number }): boolean {
  let u: URL; try { u = new URL(f.url()); } catch { return false; }
  if (AD_HOST.test(u.hostname) || AD_PATH.test(u.pathname + u.search) || AD_NAME.test(f.name())) return true;
  let pageHost = ""; try { pageHost = new URL(page.url()).hostname; } catch {}
  return Boolean(pageHost && siteOf(u.hostname) !== siteOf(pageHost) && adSized(box.width, box.height));
}

/** Frames drawn on screen at a readable size: content there is not part of the page's own snapshot. Ad frames are only counted. */
export async function classifyFrames(page: Page, minArea = 20000): Promise<{ frames: FrameInfo[]; adFrames: number }> {
  const out: FrameInfo[] = [];
  let adFrames = 0;
  for (const f of page.frames()) {
    if (f === page.mainFrame() || f.isDetached() || !/^https?:/.test(f.url())) continue;
    const box = await f.frameElement().then((el) => el.boundingBox()).catch(() => null);
    if (!box || box.width * box.height < minArea) continue;
    if (isAdFrame(page, f, box)) { adFrames++; continue; }
    // Ad and widget frames often carry generated names (markup, JSON, long ids): name a frame by its address then.
    let key = /^[\w.:-]{1,40}$/.test(f.name()) ? f.name() : "";
    if (!key) { try { const u = new URL(f.url()); key = u.host + u.pathname; } catch { key = f.url(); } }
    let url = f.url(); try { const u = new URL(url); url = u.origin + u.pathname; } catch {}
    out.push({ frame: key.slice(0, 80), url: url.slice(0, 120), width: Math.round(box.width), height: Math.round(box.height) });
  }
  return { frames: out.slice(0, 6), adFrames };
}

export async function listFrames(page: Page, minArea = 20000): Promise<FrameInfo[]> {
  return (await classifyFrames(page, minArea)).frames;
}

export const FRAME_HINT = "Part of this page is inside frames (listed in frames). Its content is not in this result: pass frame (a name or URL part from frames) to snapshot, list_items, read_text, click or fill to work inside it.";
