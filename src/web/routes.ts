/**
 * URL ⇄ app state.
 *
 *   /                            overview: inkomster vs utgifter per year
 *   /om                          about page
 *   /sok?q=försvar               search page, with the query
 *   /utgifter                    treemap of all utgiftsområden (/inkomster: inkomsttyper)
 *   /utgifter/6                  utgiftsområde 6: its history graph above its anslag
 *   /utgifter/6/3                …with anslag 3 focused (the graph shows that anslag)
 *   /utgifter/6/ovriga           the "Övriga" bundle of the group
 *   /utgifter/6/ovriga/23        …with anslag 23 focused
 *   /inkomster/1000/1111         inkomsttyp 1000 with inkomsttitel 1111 focused
 *   …?year=2024                  budget year (omitted for the latest year)
 *   …?inflation=1                amounts adjusted for inflation
 *   …?jamfor=inkomster/1000/1111 a second posting (or group: jamfor=utgifter/4)
 *                                drawn in the focus graph for comparison
 *   …?index=1                    …both series as an index, first year = 100
 */

export type View = "exp" | "rev";
export type Mode = "overview" | "explore" | "about" | "search";

/** A second posting or group drawn in the focus graph for comparison. */
export type Compare = {
  view: View;
  /** Utgiftsområde number or inkomsttyp code (id_start). */
  group: number;
  /** Row id, or null when the whole group is compared. */
  item: number | null;
};

export type Route = {
  mode: Mode;
  view: View;
  /** null until the data has loaded and the latest year is known. */
  year: number | null;
  /** Utgiftsområde number or inkomsttyp code (id_start). */
  group: number | null;
  rest: boolean;
  /** Focused row id within the group. */
  item: number | null;
  real: boolean;
  /** Comparison target; only meaningful in explore mode with a group. */
  cmp: Compare | null;
  /** Draw the compared series as an index (first year = 100). */
  index: boolean;
  /** Search query; only meaningful in search mode. */
  q: string;
};

const VIEW_SLUG: Record<View, string> = { exp: "utgifter", rev: "inkomster" };
const SLUG_VIEW: Record<string, View> = { utgifter: "exp", inkomster: "rev" };

const parseYear = (s: string | null | undefined): number | null => (s && /^\d{4}$/.test(s) ? Number(s) : null);
const parseNat = (s: string | undefined): number | null => (s && /^\d+$/.test(s) ? Number(s) : null);

/** "utgifter/6/3" → { view: "exp", group: 6, item: 3 }; null when malformed. */
export function parseCompare(s: string | null | undefined): Compare | null {
  if (!s) return null;
  const [slug, g, i, ...more] = s.split("/");
  const view = SLUG_VIEW[slug ?? ""];
  const group = parseNat(g);
  if (!view || group == null || more.length) return null;
  if (i !== undefined && !/^\d+$/.test(i)) return null;
  return { view, group, item: parseNat(i) };
}

/** The ?jamfor value for a comparison target. */
export const compareSlug = (c: Compare) => `${VIEW_SLUG[c.view]}/${c.group}${c.item != null ? `/${c.item}` : ""}`;

export function parseRoute(url: URL): Route {
  const parts = url.pathname.split("/").filter(Boolean);
  const real = url.searchParams.get("inflation") === "1";
  const year = parseYear(url.searchParams.get("year"));
  const none = { group: null, rest: false, item: null, real, cmp: null, index: false, q: "" };
  if (parts[0] === "om") return { mode: "about", view: "exp", year, ...none };
  if (parts[0] === "sok") return { mode: "search", view: "exp", year, ...none, q: url.searchParams.get("q")?.trim() ?? "" };
  const view = SLUG_VIEW[parts[0] ?? ""];
  if (!view) return { mode: "overview", view: "exp", year, ...none };
  const group = parseNat(parts[1]);
  if (group == null) return { mode: "explore", view, year, ...none };
  let i = 2;
  let rest = false;
  if (parts[i] === "ovriga") {
    rest = true;
    i++;
  }
  const cmp = parseCompare(url.searchParams.get("jamfor"));
  return { mode: "explore", view, year, group, rest, item: parseNat(parts[i]), real, cmp, index: cmp != null && url.searchParams.get("index") === "1", q: "" };
}

/** Path + query for a route. `latest` lets the URL omit the default year. */
export function buildUrl(r: Route, latest: number | null): string {
  let path = "/";
  if (r.mode === "about") path = "/om";
  if (r.mode === "search") path = "/sok";
  if (r.mode === "explore") {
    const parts = [VIEW_SLUG[r.view]];
    if (r.group != null) {
      parts.push(String(r.group));
      if (r.rest) parts.push("ovriga");
      if (r.item != null) parts.push(String(r.item));
    }
    path = `/${parts.join("/")}`;
  }
  const q = new URLSearchParams();
  if (r.mode === "search" && r.q) q.set("q", r.q);
  if (r.year != null && r.year !== latest) q.set("year", String(r.year));
  if (r.real) q.set("inflation", "1");
  if (r.mode === "explore" && r.group != null && r.cmp) {
    q.set("jamfor", compareSlug(r.cmp));
    if (r.index) q.set("index", "1");
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The app's internal group key for a URL group number. */
export const groupKey = (view: View, group: number) => (view === "rev" ? `ink${group}` : `uo${group}`);
/** The URL group number for an internal group key such as "uo6" or "ink1000". */
export const groupNumber = (key: string) => Number(key.replace(/^\D+/, ""));
