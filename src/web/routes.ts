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
 *   …?bnp=1                      the overview also draws BNP as its own line
 *   …?andel=inkomster            graphs in percent of the year's revenues (andel=utgifter: of expenses, andel=bnp: of BNP)
 *   …?skala=relativ              the graphs' y-axis follows the data instead of starting at zero
 */

export type View = "exp" | "rev";
export type Mode = "overview" | "explore" | "about" | "search";
/** What the graphs show: kronor, or percent of the year's revenues, expenses or BNP. */
export type Unit = "kr" | "rev" | "exp" | "bnp";
/** Where the graphs' y-axis starts: at zero, or just below the data. */
export type Scale = "zero" | "relative";

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
  /** Overview only: draw BNP as its own line in the graph. */
  bnp: boolean;
  unit: Unit;
  scale: Scale;
  /** Search query; only meaningful in search mode. */
  q: string;
};

const VIEW_SLUG: Record<View, string> = { exp: "utgifter", rev: "inkomster" };
const SLUG_VIEW: Record<string, View> = { utgifter: "exp", inkomster: "rev" };
const UNIT_SLUG: Record<Unit, string | null> = { kr: null, rev: "inkomster", exp: "utgifter", bnp: "bnp" };
const SLUG_UNIT: Record<string, Unit> = { inkomster: "rev", utgifter: "exp", bnp: "bnp" };

const parseYear = (s: string | null | undefined): number | null => (s && /^\d{4}$/.test(s) ? Number(s) : null);
const parseNat = (s: string | undefined): number | null => (s && /^\d+$/.test(s) ? Number(s) : null);

export function parseRoute(url: URL): Route {
  const parts = url.pathname.split("/").filter(Boolean);
  const real = url.searchParams.get("inflation") === "1";
  const bnp = url.searchParams.get("bnp") === "1";
  const year = parseYear(url.searchParams.get("year"));
  const unit: Unit = SLUG_UNIT[url.searchParams.get("andel") ?? ""] ?? "kr";
  const scale: Scale = url.searchParams.get("skala") === "relativ" ? "relative" : "zero";
  const none = { group: null, rest: false, item: null, real, bnp, unit, scale, q: "" };
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
  return { mode: "explore", view, year, group, rest, item: parseNat(parts[i]), real, bnp, unit, scale, q: "" };
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
  if (r.bnp) q.set("bnp", "1");
  const andel = UNIT_SLUG[r.unit];
  if (andel) q.set("andel", andel);
  if (r.scale === "relative") q.set("skala", "relativ");
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The app's internal group key for a URL group number. */
export const groupKey = (view: View, group: number) => (view === "rev" ? `ink${group}` : `uo${group}`);
/** The URL group number for an internal group key such as "uo6" or "ink1000". */
export const groupNumber = (key: string) => Number(key.replace(/^\D+/, ""));
