/**
 * The chart model shared by the browser app (frontend.tsx) and the server-side
 * share image (src/social.ts): number formatting, the normalised budget shape,
 * tile colours, the squarified treemap layout and the line-chart scale. Pure
 * functions only, no React and no DOM.
 */
import type { BudgetJson } from "../../types/BudgetJsonSchema";
import type { Scale, Unit, View } from "./routes";

// ---- Design-only tweaks (constants in production) ----------------------------

/** "färg" | "gråskala" */
export const COLOR_MODE: "färg" | "gråskala" = "färg";
/** Bundle rows below 0.6 % of their group into one "Övriga" tile. */
const GROUP_SMALL = true;

export const TAIL_CUT = GROUP_SMALL ? 0.006 : 0;
export const INK = "#0b0b0b";
export const PAPER = "#fcfcfb";
export const PAGE = "#f4f3ef";
export const EXPENSE = "#2a78d6";
export const REVENUE = "#eb6834";

// ---- Formatting ---------------------------------------------------------------

export const NF1 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const NF0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
export const NF2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amounts are in tkr; 1 mdkr = 1e6 tkr. The unit follows the magnitude, so negative amounts read the same as positive ones. */
export const fmd = (tkr: number) => {
  const m = Math.abs(tkr) / 1e6;
  if (m >= 10) return `${NF0.format(tkr / 1e6)} mdkr`;
  if (m >= 0.1) return `${NF1.format(tkr / 1e6)} mdkr`;
  return `${NF0.format(tkr / 1e3)} mnkr`;
};
export const fpct = (p: number) => `${p >= 10 ? NF0.format(p) : p >= 0.1 ? NF1.format(p) : "<0,1"} %`;
export const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmd(Math.abs(v));
/** Exact amount in tkr, e.g. "1 543 317 501 tkr". */
export const ftkr = (tkr: number) => `${NF0.format(Math.round(tkr))} tkr`;
export const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±");

/** How a graph writes its values: in kronor (tkr) or in percent of a year's total. */
export type Fmt = {
  /** Compact, for dot labels and headlines. */
  short: (v: number) => string;
  /** Exact, for the info box and screen readers. */
  exact: (v: number) => string;
  /** Gridline label for value v on an axis with the given step. */
  grid: (v: number, step: number) => string;
  /** Change from one year to the next, with the previous value for a relative figure. */
  diff: (d: number, prev: number) => string;
  /** Smallest headroom above the data, in the value's unit. */
  minPad: number;
};

export const FMT_KR: Fmt = {
  short: fmd,
  exact: ftkr,
  grid: (v, step) => (step >= 1e6 ? NF0 : NF1).format(v / 1e6),
  diff: (d, prev) => `${sign(d)}${ftkr(Math.abs(d))}${prev ? ` (${sign(d)}${NF1.format(Math.abs((d / prev) * 100))} %)` : ""}`,
  minPad: 1,
};

export const FMT_PCT: Fmt = {
  short: (v) => `${NF1.format(v)} %`,
  exact: (v) => `${NF2.format(v)} %`,
  grid: (v, step) => `${(step >= 1 ? NF0 : NF1).format(v)} %`,
  diff: (d) => `${sign(d)}${NF2.format(Math.abs(d))} procentenheter`,
  minPad: 0.05,
};

export const UNITS: { k: Unit; label: string; note: string }[] = [
  { k: "kr", label: "kr", note: "" },
  { k: "rev", label: "% av inkomster", note: " · % av inkomsterna" },
  { k: "exp", label: "% av utgifter", note: " · % av utgifterna" },
];

/** The y-axis options in the settings, see the `skala` query parameter. */
export const SCALES: { k: Scale; label: string; title: string }[] = [
  { k: "zero", label: "Börja på 0", title: "Y-axeln börjar på noll, så linjens höjd visar beloppets storlek" },
  { k: "relative", label: "Relativ", title: "Y-axeln följer värdena, så små förändringar syns tydligare" },
];

// ---- Data model ---------------------------------------------------------------

export type NormRow = { key: string; id: number; title: string; v: number };
export type NormGroup = { key: string; code: string; title: string; total: number; rows: NormRow[] };

/**
 * Normalize expenses and revenues to one shape, as the design handoff specifies.
 * `f` is a price-level factor (1 = nominal) applied to every amount.
 */
export function normalize(b: BudgetJson, view: View, f = 1): NormGroup[] {
  return view === "rev"
    ? b.revenues.map((g) => ({
        key: `ink${g.id_start}`,
        code: String(g.id_start),
        title: g.title,
        total: g.total * f,
        rows: g.rows.map((r) => ({ key: String(r.id), id: r.id, title: r.title, v: r.revenue * f })),
      }))
    : b.expenses.map((g) => ({
        key: `uo${g.uo}`,
        code: `UO ${g.uo}`,
        title: g.title,
        total: g.total * f,
        rows: g.rows.map((r) => ({ key: r.title, id: r.id, title: r.title, v: r.expense * f })),
      }));
}

/** Tile hue per group: spread around the wheel, starting at the view's base hue. */
export function hueOf(all: NormGroup[], view: View): Record<string, number> {
  return Object.fromEntries(all.map((g, i) => [g.key, ((i * 360) / all.length + (view === "rev" ? 30 : 250)) % 360]));
}

export const COPY = {
  exp: {
    label: "Utgifter",
    item: "Anslag",
    items: "anslag",
    areas: "utgiftsområden",
    rest: "Övriga mindre anslag",
    all: "statens utgifter",
    root: "Alla utgiftsområden",
    kind: "Utgiftsområde",
    heading: "Statens utgifter",
  },
  rev: {
    label: "Inkomster",
    item: "Inkomsttitel",
    items: "inkomsttitlar",
    areas: "inkomsttyper",
    rest: "Övriga inkomsttitlar",
    all: "statens inkomster",
    root: "Alla inkomsttyper",
    kind: "Inkomsttyp",
    heading: "Statens inkomster",
  },
} as const;

// ---- Items at a drill level -----------------------------------------------------

export type Item = {
  key: string;
  id: number | null;
  code: string;
  label: string;
  v: number;
  hue: number;
  lv?: number;
  rank: number;
  drill?: boolean;
  rest?: boolean;
};

/**
 * The tiles at one drill level: the groups of a view, or the postings of one
 * group (with the small ones bundled into an "Övriga" tile, or only those
 * when `rest` is set). `parentTotal` is what the tiles' shares are of.
 */
export function levelItems(all: NormGroup[], view: View, group: NormGroup | null, rest: boolean): { items: Item[]; parentTotal: number } {
  const hues = hueOf(all, view);
  if (!group) {
    const groups = all.filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
    const items = groups.map((g, i) => ({
      key: g.key,
      id: null,
      code: g.code,
      label: g.title,
      v: g.total,
      hue: hues[g.key]!,
      lv: i % 3,
      rank: i / groups.length,
      drill: true,
    }));
    return { items, parentTotal: groups.reduce((s, g) => s + g.total, 0) };
  }
  const T = COPY[view];
  const rows = group.rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  const sum = rows.reduce((s, r) => s + r.v, 0) || 1;
  const big = rows.filter((r) => r.v / sum >= TAIL_CUT);
  const tail = rows.filter((r) => r.v / sum < TAIL_CUT);
  const useTail = tail.length > 1 && !rest;
  const list = rest ? tail : useTail ? big : rows;
  const hue = hues[group.key]!;
  const items: Item[] = list.map((r, i) => ({
    key: r.key,
    id: r.id,
    code: `${T.item} ${r.id ?? ""}`,
    label: r.title,
    v: r.v,
    hue,
    rank: i / Math.max(1, list.length),
  }));
  if (useTail) {
    items.push({
      key: "__rest",
      id: null,
      code: `${tail.length} ${T.items}`,
      label: T.rest,
      v: tail.reduce((s, r) => s + r.v, 0),
      hue,
      rank: 1,
      rest: true,
      drill: true,
    });
  }
  return { items, parentTotal: sum };
}

/** Explain the positive-only map without presenting its gross sum as net revenue.
 * The same parent basis applies inside Övriga. Amounts retain the official net
 * subtotal, which can differ from the row sum by a few tkr due to rounding.
 */
export function signedBreakdown(group: NormGroup) {
  const negativeRows = group.rows.filter((r) => r.v < 0).sort((a, b) => a.v - b.v);
  const negative = negativeRows.reduce((s, r) => s + r.v, 0);
  const positive = group.rows.reduce((s, r) => s + Math.max(0, r.v), 0);
  const netRatio = positive > 0 ? group.total / positive : 0;
  return { positive, negative, net: group.total, netRatio, negativeRows };
}

export function reconciliationNote(group: NormGroup): string {
  const { positive, negative } = signedBreakdown(group);
  if (!negative) return "";
  return `Andelar av positiva poster: ${fmd(positive)} · Avdrag och justeringar: ${fmd(negative)} · Netto: ${fmd(group.total)}`;
}

/** Illustrative allocation, not an official net amount for a tax entry.
 * Always use the whole parent group, including when viewing Övriga.
 */
export function allocatedNet(value: number, group: NormGroup): number {
  const positive = group.rows.reduce((s, r) => s + Math.max(0, r.v), 0);
  return positive > 0 ? value * (group.total / positive) : 0;
}

export function postingAmount(value: number, breakdown: ReturnType<typeof signedBreakdown> | null): string {
  const gross = fmd(value);
  if (!breakdown || value <= 0 || breakdown.negative >= 0) return gross;
  const net = fmd(value * breakdown.netRatio);
  // Share the unit when both amounts use the same magnitude.
  const unit = gross.endsWith(" mdkr") ? " mdkr" : " mnkr";
  return net.endsWith(unit) ? `${gross.slice(0, -unit.length)} / ${net}` : `${gross} / ${net}`;
}

export const ALLOCATION_NOTE = "Samma procentuella avdrag fördelas på alla positiva poster. Summan blir gruppens netto före avrundning. Det är en schablon, inte officiellt netto per post.";

/** Tile colour per the design: hue by group, lightness by rank. */
export function colorOf(it: Item, drilled: boolean): { bg: string; fg: string } {
  let L: number, C: number;
  if (COLOR_MODE === "färg") {
    L = it.rest ? 0.9 : drilled ? 0.62 + it.rank * 0.28 : 0.74 + (it.lv ?? 0) * 0.04;
    C = it.rest ? 0.02 : drilled ? 0.13 - it.rank * 0.07 : 0.11;
  } else {
    L = 0.36 + Math.pow(it.rank, 0.7) * 0.54;
    C = 0.02;
  }
  const hue = COLOR_MODE === "färg" ? it.hue : 260;
  return { bg: `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${hue})`, fg: L < 0.66 ? PAPER : INK };
}

/** The history panel's colour for a group, when no posting is focused. */
export const groupPanelColor = (hue: number) => (COLOR_MODE === "färg" ? `oklch(0.80 0.09 ${hue})` : "oklch(0.86 0.01 260)");

// ---- Squarified treemap -------------------------------------------------------

export type Placed<T> = { it: T; a: number; x: number; y: number; w: number; h: number };

export function squarify<T>(items: { it: T; a: number }[], W: number, H: number): Placed<T>[] {
  const out: Placed<T>[] = [];
  let rest = items.slice();
  let x = 0, y = 0, w = W, h = H;
  const worst = (row: { a: number }[], s: number) => {
    const sum = row.reduce((acc, r) => acc + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a));
    const mn = Math.min(...row.map((r) => r.a));
    return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
  };
  while (rest.length) {
    const s = Math.min(w, h);
    const row = [rest[0]!];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]!], s) <= worst(row, s)) {
      row.push(rest[i]!);
      i++;
    }
    rest = rest.slice(i);
    const sum = row.reduce((acc, r) => acc + r.a, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.a / cw;
        out.push({ ...r, x, y: cy, w: cw, h: rh });
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.a / rh;
        out.push({ ...r, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
  }
  return out;
}

/** Lay the items out over W×H pixels, areas in proportion to their values. */
export function layout(items: Item[], W: number, H: number): Placed<Item>[] {
  const sum = items.reduce((s, it) => s + it.v, 0) || 1;
  return squarify(items.map((it) => ({ it, a: (it.v / sum) * W * H })), W, H);
}

/** A tile this small can't carry its label. */
export const readable = (w: number, h: number) => w > 84 && h > 54;

/**
 * The items as tiles over W×H pixels, with the ones that come out too small
 * to read moved to a list instead. Dropping items frees room for the rest,
 * so the layout is redone until every tile left is readable. The largest item
 * is always a tile, so the map is never empty.
 */
export function placeItems(items: Item[], W: number, H: number): { placed: Placed<Item>[]; listed: Item[] } {
  const largest = items.reduce<Item | null>((m, it) => (m == null || it.v > m.v ? it : m), null);
  let tiles = items;
  for (;;) {
    const placed = layout(tiles, W, H);
    const small = new Set(placed.filter((p) => !readable(p.w, p.h) && p.it !== largest).map((p) => p.it.key));
    if (small.size === 0) return { placed, listed: items.filter((it) => !tiles.includes(it)) };
    tiles = tiles.filter((it) => !small.has(it.key));
  }
}

// ---- Line chart scale ---------------------------------------------------------

export type Point = { y: number; v: number };
export type Series = { key: string; points: Point[]; color?: string; label?: string };

/** Chart x position in percent for point i of n, inset 5 %–95 %. */
export const X = (i: number, n: number) => (n === 1 ? 50 : 5 + (i / (n - 1)) * 90);

/**
 * Y axis from the data, with gridline labels in mdkr. The bottom snaps down
 * to a nice step so the lowest gridline is the floor; the top is the data
 * plus a small headroom and is not snapped, so the plot fills the panel
 * instead of leaving an empty band up to the next round number.
 */
/**
 * The y-axis of a line chart: `Y` maps a value to a percentage from the top,
 * `grid` lists the gridlines (the one marked `zero` is a zero line inside the
 * axis, worth drawing stronger) and `base` is where an area fill ends: the
 * zero line when the axis crosses it, else the axis end nearest zero.
 *
 * With `scale` "zero" the axis always reaches zero, so a line's height can be
 * read as its size; with "relative" it hugs the data, which makes small
 * changes visible. Negative data pulls the axis below zero in both modes.
 */
export function niceScale(values: number[], minPad: number, scale: Scale = "zero") {
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const pad = Math.max((mx - mn) * 0.1, Math.max(Math.abs(mx), Math.abs(mn)) * 0.04, minPad);
  // Headroom on the sides where the data is; the axis never crosses zero
  // unless the data does, and in "zero" mode it always reaches it.
  const hi = mx > 0 ? mx + pad : scale === "zero" ? 0 : Math.min(0, mx + pad);
  const loRaw = mn < 0 ? mn - pad : scale === "zero" ? 0 : Math.max(0, mn - pad);
  const raw = (hi - loRaw) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  // The end away from the data snaps to a gridline, so the zero line is always a gridline too.
  const lo = mx <= 0 ? loRaw : Math.max(mn >= 0 ? 0 : -Infinity, Math.floor(loRaw / step) * step);
  const top = mx <= 0 ? Math.min(0, Math.ceil(hi / step) * step) : hi;
  const Y = (v: number) => 100 - ((v - lo) / (top - lo || 1)) * 100;
  const grid: { top: string; v: number; zero: boolean }[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let k = 0; first + k * step <= top + step * 1e-9; k++) {
    const v = first + k * step;
    grid.push({ top: `${Y(v)}%`, v, zero: mn < 0 && mx > 0 && Math.abs(v) < step * 1e-9 });
  }
  const base = Y(Math.min(Math.max(0, lo), top));
  return { Y, grid, step, base };
}

/** Headline change between the first and last year that are in the same prices. */
export function changeOver(points: Point[], nominal: (y: number) => boolean) {
  const comparable = points.filter((p) => !nominal(p.y));
  const span = comparable.length >= 2 ? comparable : points;
  const first = span[0]!;
  const last = span[span.length - 1]!;
  const pct = first.v ? ((last.v - first.v) / first.v) * 100 : 0;
  return { first, last, pct };
}

// ---- Price level and unit -------------------------------------------------------

/** Price-level helpers passed down to the charts. */
export type Prices = {
  /** Factor per year (1 when showing nominal amounts). */
  factorOf: (y: number) => number;
  /** True when a year is shown nominal because inflation data is missing. */
  nominal: (y: number) => boolean;
  priceNote: string;
  nominalNote: string;
};

/** The unit the graphs are drawn in, see the `andel` query parameter. */
export type Display = {
  unit: Unit;
  /** An amount in tkr for year y, converted to the unit. */
  toUnit: (v: number, y: number) => number;
  fmt: Fmt;
  /** Kicker suffix naming the unit, empty for kronor. */
  unitNote: string;
};

/** Price helpers for the inflation toggle: `real` is whether adjustment is on. */
export function pricesFor(real: boolean, baseYear: number | null, factors: Map<number, number | null>): Prices {
  return {
    factorOf: (y) => (real ? (factors.get(y) ?? 1) : 1),
    nominal: (y) => real && factors.get(y) == null,
    priceNote: real && baseYear != null ? ` · i ${baseYear} års priser` : "",
    nominalNote: "* nominellt, inflationsdata saknas",
  };
}

/** Graph unit: kronor, or percent of the year's total revenues or expenses. */
export function displayFor(unit: Unit, budgets: Record<number, BudgetJson>, factorOf: (y: number) => number): Display {
  return {
    unit,
    // Amounts arrive price-adjusted, so the total is adjusted the same way.
    toUnit: (v, y) => {
      if (unit === "kr") return v;
      const b = budgets[y];
      const total = (unit === "rev" ? (b?.revenuesTotal ?? 0) : (b?.expensesTotal ?? 0)) * factorOf(y);
      return total ? (v / total) * 100 : 0;
    },
    fmt: unit === "kr" ? FMT_KR : FMT_PCT,
    unitNote: UNITS.find((u) => u.k === unit)?.note ?? "",
  };
}

export const DEDUCTION_NOTE = "Avdragets storlek · visas som positiva belopp";

/** Presentation only: never change the signed history used by budget calculations
 * or the API. Preserve signs for postings that switch between revenue and deduction.
 */
export function chartHistory(points: Point[], posting: boolean): { points: Point[]; deduction: boolean } {
  const deduction = posting && points.some((p) => p.v < 0) && points.every((p) => Number.isFinite(p.v) && p.v <= 0);
  return { points: deduction ? points.map((p) => ({ ...p, v: Math.abs(p.v) })) : points, deduction };
}

/** The signed points of a group's, or one of its postings', history across the years. */
export function historyPoints(years: number[], budgets: Record<number, BudgetJson>, view: View, gkey: string, row: string | null, factorOf: (y: number) => number, toUnit: (v: number, y: number) => number): Point[] {
  return years.map((y) => {
    const b = budgets[y];
    const g = b ? normalize(b, view, factorOf(y)).find((x) => x.key === gkey) : undefined;
    let v = 0;
    if (g) v = row == null ? g.total : (g.rows.find((r) => r.key === row)?.v ?? 0);
    return { y, v: toUnit(v, y) };
  });
}
