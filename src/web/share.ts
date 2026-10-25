/**
 * Share images, the part both the app and the server need: the formats an
 * image comes in and the mapping between a page URL and its image URL.
 *
 *   /                                   → /social/oversikt.png
 *   /utgifter                           → /social/utgifter.png
 *   /utgifter/6/3?year=2024&inflation=1 → /social/utgifter/6/3.png?year=2024&inflation=1
 *   …?format=story                      the same page as a 9:16 image
 *
 * The rendering itself lives in src/social.ts, which needs resvg and so
 * stays out of the browser bundle.
 */
import { buildUrl, parseRoute, type Route } from "./routes";

/** "link" is the Open Graph preview; the others are for posting the chart itself. */
export type Format = "link" | "square" | "portrait" | "story";

export type FormatSpec = {
  label: string;
  /** Aspect ratio as people name it. */
  ratio: string;
  /** Output pixels. */
  w: number;
  h: number;
  /** The canvas the scene is drawn on; the output is a scaled-up copy. */
  canvas: { w: number; h: number };
  /** Margins on the canvas. Stories keep clear of the app chrome at the top and bottom. */
  pad: { x: number; y: number };
};

export const FORMATS: Record<Format, FormatSpec> = {
  link: { label: "Länk", ratio: "1,91:1", w: 1200, h: 630, canvas: { w: 1200, h: 630 }, pad: { x: 36, y: 36 } },
  square: { label: "Kvadrat", ratio: "1:1", w: 1080, h: 1080, canvas: { w: 720, h: 720 }, pad: { x: 36, y: 36 } },
  portrait: { label: "Porträtt", ratio: "4:5", w: 1080, h: 1350, canvas: { w: 720, h: 900 }, pad: { x: 36, y: 44 } },
  // 168 on the canvas is 252 px in the output, the band Instagram and TikTok cover.
  story: { label: "Story", ratio: "9:16", w: 1080, h: 1920, canvas: { w: 720, h: 1280 }, pad: { x: 48, y: 168 } },
};

export const FORMAT_KEYS = Object.keys(FORMATS) as Format[];

export const parseFormat = (s: string | null | undefined): Format => (s && s in FORMATS ? (s as Format) : "link");

const IMAGE_PREFIX = "/social/";
const OVERVIEW_IMAGE = "oversikt";

/** The image path for an app URL, or null for pages that have no chart. */
export function socialImagePath(url: URL, format: Format = "link"): string | null {
  const route = parseRoute(url);
  if (route.mode === "about" || route.mode === "search" || route.mode === "budgets") return null;
  const app = buildUrl(route, null);
  const [path, query] = app.split("?") as [string, string?];
  const name = path === "/" ? OVERVIEW_IMAGE : path.slice(1);
  const q = new URLSearchParams(query ?? "");
  if (format !== "link") q.set("format", format);
  const s = q.toString();
  return `${IMAGE_PREFIX}${name}.png${s ? `?${s}` : ""}`;
}

/** The app route and format an image URL stands for, or null if it is not an image URL. */
export function routeForImage(url: URL): { route: Route; format: Format } | null {
  if (!url.pathname.startsWith(IMAGE_PREFIX) || !url.pathname.endsWith(".png")) return null;
  const name = url.pathname.slice(IMAGE_PREFIX.length, -".png".length);
  if (!/^[\w/]+$/.test(name)) return null;
  const path = name === OVERVIEW_IMAGE ? "/" : `/${name}`;
  const route = parseRoute(new URL(`${path}${url.search}`, "http://x"));
  if (route.mode !== "overview" && route.mode !== "explore") return null;
  if (route.mode === "overview" && path !== "/") return null;
  return { route, format: parseFormat(url.searchParams.get("format")) };
}
