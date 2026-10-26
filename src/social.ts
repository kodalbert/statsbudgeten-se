/**
 * Share images: the chart a page shows, drawn as a PNG. The "link" format is
 * the 1200×630 Open Graph preview (og:image); square, portrait and story are
 * for posting the chart itself, see src/web/share.ts for the formats and the
 * page ⇄ image URL mapping.
 *
 * The scene is built from the same model as the browser app (src/web/model.ts)
 * and written as SVG, then rasterised with resvg using the bundled Inter font,
 * so the result is the same on any machine. About and search pages have no
 * chart and use the static /social.png instead.
 */
import { Resvg } from "@resvg/resvg-js";
import type { BudgetJson } from "../types/BudgetJsonSchema";
import { chooseBaseYear, inflationFactors, type InflationRates } from "./inflation";
import {
  COPY,
  EXPENSE,
  INK,
  NF1,
  PAGE,
  PAPER,
  REVENUE,
  X,
  changeOver,
  colorOf,
  displayFor,
  fmd,
  fpct,
  groupPanelColor,
  historyPoints,
  hueOf,
  layout,
  levelItems,
  niceScale,
  normalize,
  pricesFor,
  readable,
  sign,
  signed,
  type Display,
  type Item,
  type Point,
  type Prices,
  type Series,
} from "./web/model";
import { buildUrl, groupKey, windowYears, type Route, type Scale } from "./web/routes";
import { FORMATS, type Format } from "./web/share";

export { FORMATS, parseFormat, routeForImage, socialImagePath, type Format } from "./web/share";
/** The link preview's size. */
export const WIDTH = FORMATS.link.w;
export const HEIGHT = FORMATS.link.h;

/** Everything the renderer needs: every budget year and the inflation rates. */
export type Data = { years: number[]; budgets: Record<number, BudgetJson>; rates: InflationRates };

const SECONDARY = "#52514e";
const MUTED = "#898781";

// ---- The scene ----------------------------------------------------------------------

type Scene = {
  route: Route;
  year: number;
  years: number[];
  prices: Prices;
  display: Display;
  budget: BudgetJson;
  /** Every year's budget, for the history charts. */
  budgets: Record<number, BudgetJson>;
  /** The view's groups for the year, price-adjusted. */
  all: ReturnType<typeof normalize>;
  group: ReturnType<typeof normalize>[number] | null;
  focused: { key: string; id: number; title: string; v: number } | null;
  items: Item[];
  parentTotal: number;
  gross: number;
  hues: Record<string, number>;
};

/**
 * Resolve a route against the data the way the app does: an unknown year
 * falls back to the latest, an unknown group to the view's root, and the
 * inflation toggle only applies when the rates allow it.
 */
export function resolve(route: Route, data: Data): Scene | null {
  const allYears = [...data.years].sort((a, b) => a - b);
  const years = windowYears(allYears, route.from, route.to);
  const latest = years[years.length - 1];
  if (latest == null) return null;
  const year = route.year != null && years.includes(route.year) ? route.year : latest;
  const budget = data.budgets[year];
  if (!budget) return null;

  const baseYear = chooseBaseYear(data.rates, allYears);
  const { factors, convertible } = inflationFactors(data.rates, years, baseYear ?? 0);
  const hasInflation = baseYear != null && convertible.length > 1;
  const prices = pricesFor(route.real && hasInflation, baseYear, factors);
  const display = displayFor(route.unit, data.budgets, prices.factorOf);

  const view = route.view;
  const all = normalize(budget, view, prices.factorOf(year));
  const group = route.group != null ? (all.find((g) => g.key === groupKey(view, route.group!)) ?? null) : null;
  const rest = group != null && route.rest;
  const focused = group && route.item != null ? (group.rows.find((r) => r.id === route.item) ?? null) : null;
  const { items, parentTotal } = levelItems(all, view, group, rest);
  const gross = all.filter((g) => g.total > 0).reduce((s, g) => s + g.total, 0) || 1;
  return { route, year, years, prices, display, budget, budgets: data.budgets, all, group, focused, items, parentTotal, gross, hues: hueOf(all, view) };
}

/** The document title for a route, as the app sets it. */
export function pageTitle(route: Route, data: Data): string {
  if (route.mode === "about") return "Om sajten";
  if (route.mode === "updates") return "Uppdateringar";
  if (route.mode === "search") return route.q ? `Sök: ${route.q}` : "Sök";
  if (route.mode === "overview") return "Inkomster och utgifter";
  const s = resolve(route, data);
  const T = COPY[route.view];
  if (!s) return T.label;
  const rest = s.group && s.route.rest ? " · Övriga" : "";
  return `${s.focused ? `${s.focused.title} · ` : ""}${s.group ? `${s.group.title}${rest}` : T.root} · ${T.label} ${s.year}`;
}

/** A one-line description of what the page shows, for og:description. */
export function pageDescription(route: Route, data: Data): string | null {
  if (route.mode !== "overview" && route.mode !== "explore") return null;
  const s = resolve(route, data);
  if (!s) return null;
  const { priceNote } = s.prices;
  const f = s.prices.factorOf(s.year);
  if (route.mode === "overview") {
    const exp = s.budget.expensesTotal * f;
    const rev = s.budget.revenuesTotal * f;
    const d = rev - exp;
    return `Statens budget ${s.year}: utgifter ${fmd(exp)}, inkomster ${fmd(rev)}, saldo ${sign(d)}${fmd(Math.abs(d))}${priceNote}. Utveckling ${s.years[0]}–${s.years[s.years.length - 1]}.`;
  }
  const T = COPY[route.view];
  if (s.focused && s.group) {
    return `${s.focused.title} (${s.group.title}) ${s.year}: ${fmd(s.focused.v)}, ${fpct((s.focused.v / s.gross) * 100)} av ${T.all}${priceNote}.`;
  }
  if (s.group) {
    const v = s.route.rest ? s.items.reduce((a, it) => a + it.v, 0) : s.group.total;
    const what = s.route.rest ? `${T.rest.toLowerCase()} inom ${s.group.title}` : s.group.title;
    return `${what} ${s.year}: ${fmd(v)}, ${fpct((v / s.gross) * 100)} av ${T.all}${priceNote}. ${s.items.length} ${T.items} i storleksordning.`;
  }
  const groups = s.all.filter((g) => g.total > 0);
  return `${T.heading} ${s.year}: ${fmd(s.parentTotal)} fördelade på ${groups.length} ${T.areas}${priceNote}.`;
}

// ---- SVG helpers -----------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** oklch(L C H) → #rrggbb; other colours pass through. resvg knows no oklch. */
export function cssColor(c: string): string {
  const m = c.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) return c;
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const gamma = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return `#${lin.map((v) => Math.round(gamma(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Approximate width of a string in Inter, in px. Good enough to wrap and
 * truncate tile labels; the exact glyph metrics are not needed.
 */
export function textWidth(s: string, size: number, weight = 400): number {
  let w = 0;
  for (const ch of s) {
    if (/[   ]/.test(ch)) w += 0.28;
    else if (/[iljtfI.,:;'|!·]/.test(ch)) w += 0.3;
    else if (ch === "r") w += 0.37;
    else if (/[mwMW]/.test(ch)) w += 0.9;
    else if (/[%—]/.test(ch)) w += 0.9;
    else if (/[A-ZÅÄÖ]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else w += 0.56;
  }
  return w * size * (weight >= 600 ? 1.05 : 1);
}

/** Break text into at most `max` lines that fit `width`; a line that is cut gets an ellipsis. */
function wrap(s: string, width: number, size: number, weight: number, max: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const next = line ? `${line} ${word}` : word;
    if (!line || textWidth(next, size, weight) <= width) {
      line = next;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length === max) break;
  }
  // Words left over once the last allowed line was full.
  const cut = out.length === max && i < words.length;
  if (out.length < max && line) out.push(line);
  return out.map((l, k) => (textWidth(l, size, weight) > width || (cut && k === out.length - 1) ? ellipsize(l, width, size, weight) : l));
}

function ellipsize(s: string, width: number, size: number, weight: number): string {
  if (textWidth(s, size, weight) <= width) return s;
  let t = s;
  while (t && textWidth(`${t}…`, size, weight) > width) t = t.slice(0, -1).trimEnd();
  return t ? `${t}…` : "…";
}

/** One line of text; the string is escaped here. */
function text(x: number, y: number, s: string, o: { size: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; opacity?: number; spacing?: string }): string {
  const attrs = [
    `x="${x.toFixed(1)}"`,
    `y="${y.toFixed(1)}"`,
    `font-size="${o.size}"`,
    o.weight ? `font-weight="${o.weight}"` : "",
    o.fill ? `fill="${o.fill}"` : "",
    o.anchor ? `text-anchor="${o.anchor}"` : "",
    o.opacity != null ? `opacity="${o.opacity}"` : "",
    o.spacing ? `letter-spacing="${o.spacing}"` : "",
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${esc(s)}</text>`;
}

/** The mark: a mini treemap, same geometry as assets/favicon.svg. */
function logo(x: number, y: number, size: number): string {
  const k = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${k})">
<rect x="0" y="0" width="17" height="32" rx="3" fill="#3f86e0"/>
<rect x="19" y="0" width="13" height="18" rx="3" fill="#d9577f"/>
<rect x="19" y="20" width="7" height="12" rx="2.5" fill="#e3a12f"/>
<rect x="28" y="20" width="4" height="12" rx="1.5" fill="#33a573"/>
</g>`;
}

// ---- Line chart --------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };

/**
 * The app's line chart in a box: gridlines with labels in the left margin,
 * an area and a line per series, a dot per year with its value, and the
 * years underneath. The chosen year is drawn bigger.
 */
function lineChart(box: Box, series: Series[], years: number[], year: number, nominal: (y: number) => boolean, scale: Scale, paper: string, ink: string, grid: string, fmt: Display["fmt"]): string {
  const n = years.length;
  const { Y, grid: lines, step, base } = niceScale(series.flatMap((s) => s.points.map((p) => p.v)), fmt.minPad, scale);
  const px = (i: number) => box.x + (X(i, n) / 100) * box.w;
  const py = (v: number) => box.y + (Y(v) / 100) * box.h;
  const out: string[] = [];
  for (const g of lines) {
    const y = py(g.v);
    out.push(`<line x1="${box.x}" x2="${box.x + box.w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${g.zero ? ink : grid}" stroke-opacity="${g.zero ? 0.35 : 1}" stroke-width="1"/>`);
    out.push(text(box.x - 10, y + 4, fmt.grid(g.v, step), { size: 12, fill: ink, anchor: "end", opacity: 0.65 }));
  }
  const sel = Math.max(0, years.indexOf(year));
  if (series.length > 1) {
    out.push(`<line x1="${px(sel).toFixed(1)}" x2="${px(sel).toFixed(1)}" y1="${box.y - 8}" y2="${box.y + box.h + 8}" stroke="${ink}" stroke-opacity="0.3" stroke-dasharray="4 3"/>`);
  }
  for (const s of series) {
    const color = s.color ?? ink;
    const pts = s.points.map((p, i) => `${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(" ");
    const floor = (box.y + (base / 100) * box.h).toFixed(1);
    out.push(`<polygon points="${px(0).toFixed(1)},${floor} ${pts} ${px(n - 1).toFixed(1)},${floor}" fill="${color}" opacity="${s.color ? 0.08 : 0.1}"/>`);
    out.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  // With several series, each year's highest value is labelled above its dot
  // and the others below, so labels never collide where the lines run close.
  const below = (s: Series, i: number) => series.length > 1 && series.some((o) => o !== s && (o.points[i]?.v ?? -Infinity) > (s.points[i]?.v ?? -Infinity));
  for (const s of series) {
    const color = s.color ?? ink;
    s.points.forEach((p, i) => {
      const selected = p.y === year;
      const x = px(i);
      const y = py(p.v);
      const r = selected ? 8 : 6;
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r - 1.5}" fill="${selected ? color : paper}" stroke="${color}" stroke-width="3"/>`);
      const ly = below(s, i) ? y + r + 6 + 12 : y - r - 7;
      out.push(text(x, ly, fmt.short(p.v), { size: 13, weight: 600, fill: color, anchor: "middle" }));
    });
  }
  years.forEach((y, i) => {
    const selected = y === year;
    out.push(text(px(i), box.y + box.h + 24, `${y}${nominal(y) ? "*" : ""}`, { size: 13, weight: selected ? 700 : 400, fill: ink, anchor: "middle", opacity: selected ? 1 : 0.7 }));
  });
  return out.join("\n");
}

// ---- Panels -------------------------------------------------------------------------

/** The overview: expenses and revenues per year, with the year's saldo. */
function overviewPanel(box: Box, s: Scene): string {
  const { years, year } = s;
  const { factorOf, nominalNote } = s.prices;
  const { unit, toUnit, fmt, unitNote } = s.display;
  // A share is the same at any price level, so the price notes only apply in kronor.
  const nominal = unit === "kr" ? s.prices.nominal : () => false;
  const priceNote = unit === "kr" ? s.prices.priceNote : "";
  const totals = years.map((y) => {
    const b = s.budgets[y];
    const f = factorOf(y);
    return { y, exp: toUnit((b?.expensesTotal ?? 0) * f, y), rev: toUnit((b?.revenuesTotal ?? 0) * f, y) };
  });
  const sel = totals.find((t) => t.y === year) ?? totals[totals.length - 1]!;
  const saldo = sel.rev - sel.exp;
  const pad = 26;
  const out: string[] = [];
  out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="14" fill="${PAPER}" stroke="${PAGE}" stroke-width="2"/>`);
  const left = box.x + pad;
  const top = box.y + pad;
  out.push(text(left, top + 10, `Statens budget · ${years[0]}–${years[years.length - 1]}${unitNote}${priceNote}`, { size: 12, weight: 600, fill: INK, opacity: 0.7 }));
  out.push(text(left, top + 42, "Inkomster och utgifter", { size: 26, weight: 700, fill: INK, spacing: "-0.5" }));
  let lx = left;
  for (const side of [
    { label: "Utgifter", color: EXPENSE },
    { label: "Inkomster", color: REVENUE },
  ]) {
    out.push(`<circle cx="${lx + 4.5}" cy="${top + 62}" r="4.5" fill="${side.color}"/>`);
    out.push(text(lx + 15, top + 66.5, side.label, { size: 13, weight: 600, fill: SECONDARY }));
    lx += 15 + textWidth(side.label, 13, 600) + 14;
  }
  const right = box.x + box.w - pad;
  out.push(text(right, top + 10, `Saldo ${sel.y}`, { size: 12, weight: 600, fill: INK, anchor: "end", opacity: 0.7 }));
  out.push(text(right, top + 42, `${sign(saldo)}${fmt.short(Math.abs(saldo))}`, { size: 26, weight: 700, fill: saldo < 0 ? REVENUE : EXPENSE, anchor: "end", spacing: "-0.5" }));
  out.push(text(right, top + 66.5, saldo < 0 ? "Underskott – lånebehov" : saldo > 0 ? "Överskott" : "Balans", { size: 13, weight: 600, fill: INK, anchor: "end", opacity: 0.75 }));

  const chart: Box = { x: left + 56, y: top + 110, w: box.w - pad * 2 - 56 - 10, h: box.h - pad * 2 - 110 - 44 };
  const series: Series[] = [
    { key: "exp", label: "Utgifter", color: EXPENSE, points: totals.map((t) => ({ y: t.y, v: t.exp })) },
    { key: "rev", label: "Inkomster", color: REVENUE, points: totals.map((t) => ({ y: t.y, v: t.rev })) },
  ];
  out.push(lineChart(chart, series, years, year, nominal, s.route.scale, PAPER, INK, "rgba(11,11,11,0.12)", fmt));
  if (years.some(nominal)) out.push(text(left, box.y + box.h - 12, nominalNote, { size: 12, fill: INK, opacity: 0.65 }));
  return out.join("\n");
}

/** The history of the group, or of the focused posting, in the group's colour. */
function focusPanel(box: Box, s: Scene): string {
  const { years, year, group, focused, route } = s;
  if (!group) return "";
  const view = route.view;
  const T = COPY[view];
  const { factorOf, nominalNote } = s.prices;
  const { unit, toUnit, fmt, unitNote } = s.display;
  const nominal = unit === "kr" ? s.prices.nominal : () => false;
  const priceNote = unit === "kr" ? s.prices.priceNote : "";
  const focusItem = focused ? s.items.find((it) => it.key === focused.key) : undefined;
  const color = focusItem ? colorOf(focusItem, true) : { bg: groupPanelColor(s.hues[group.key]!), fg: INK };
  const bg = cssColor(color.bg);
  const fg = color.fg;
  const dark = fg !== INK;
  const title = focused ? focused.title : group.title;
  const kicker = focused ? `${group.code} · ${group.title}` : `${group.code} · ${T.kind}`;
  const points: Point[] = historyPoints(years, s.budgets, view, group.key, focused?.key ?? null, factorOf, toUnit);
  const { first, last, pct } = changeOver(points, nominal);
  const d = last.v - first.v;
  const delta =
    unit === "kr"
      ? { big: `${sign(pct)}${NF1.format(Math.abs(pct))} %`, small: signed(d) }
      : { big: `${sign(d)}${NF1.format(Math.abs(d))}`, small: `procentenheter · ${fmt.short(first.v)} → ${fmt.short(last.v)}` };

  const pad = 22;
  const out: string[] = [];
  out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="14" fill="${bg}" stroke="${PAGE}" stroke-width="2"/>`);
  const left = box.x + pad;
  const top = box.y + 16;
  const right = box.x + box.w - pad;
  const deltaW = Math.max(textWidth(delta.big, 20, 700), textWidth(delta.small, 13, 600)) + 24;
  out.push(text(left, top + 10, `${kicker}${unitNote}${priceNote}${years.some(nominal) ? ` · ${nominalNote}` : ""}`, { size: 12, weight: 600, fill: fg, opacity: 0.7 }));
  out.push(text(left, top + 36, ellipsize(title, right - deltaW - left, 20, 700), { size: 20, weight: 700, fill: fg, spacing: "-0.4" }));
  out.push(text(right, top + 10, `${first.y}–${last.y}`, { size: 12, weight: 600, fill: fg, anchor: "end", opacity: 0.7 }));
  out.push(text(right, top + 36, delta.big, { size: 20, weight: 700, fill: fg, anchor: "end", spacing: "-0.4" }));
  out.push(text(right, top + 54, delta.small, { size: 13, weight: 600, fill: fg, anchor: "end", opacity: 0.75 }));
  const chart: Box = { x: left + 56, y: top + 84, w: box.w - pad * 2 - 56 - 10, h: box.h - 16 - 84 - 40 };
  out.push(lineChart(chart, [{ key: "v", label: title, points }], years, year, nominal, s.route.scale, bg, fg, dark ? "rgba(255,255,255,0.22)" : "rgba(11,11,11,0.12)", fmt));
  return out.join("\n");
}

// ---- Treemap ------------------------------------------------------------------------

/** The tiles at the scene's drill level, laid out over the box like the app's map. */
function treemap(box: Box, s: Scene): string {
  const { items, group, focused } = s;
  const share = (it: Item) => fpct((it.v / (group ? s.parentTotal : s.gross)) * 100);
  const out: string[] = [];
  const defs: string[] = [];
  layout(items, box.w, box.h).forEach(({ it, x: x0, y: y0, w, h }, i) => {
    const x = box.x + x0;
    const y = box.y + y0;
    const { bg, fg } = colorOf(it, !!group);
    const fill = cssColor(bg);
    const rx = Math.min(10, w / 2, h / 2);
    // The app's 2 px page-coloured border, drawn inside the tile's box.
    const inner = { x: x + 1, y: y + 1, w: Math.max(0, w - 2), h: Math.max(0, h - 2) };
    out.push(`<rect x="${inner.x.toFixed(1)}" y="${inner.y.toFixed(1)}" width="${inner.w.toFixed(1)}" height="${inner.h.toFixed(1)}" rx="${rx.toFixed(1)}" fill="${fill}"/>`);
    if (focused && it.key === focused.key) {
      out.push(`<rect x="${(inner.x + 1.5).toFixed(1)}" y="${(inner.y + 1.5).toFixed(1)}" width="${Math.max(0, inner.w - 3).toFixed(1)}" height="${Math.max(0, inner.h - 3).toFixed(1)}" rx="${Math.max(0, rx - 1.5).toFixed(1)}" fill="none" stroke="${fg}" stroke-width="3"/>`);
    }
    const minD = Math.min(w, h);
    const showLabel = readable(w, h);
    const showValue = w > 70 && h > 130;
    if (!showLabel && !showValue) return;
    const [padY, padX] = minD > 160 ? [14, 16] : [8, 10];
    const cw = inner.w - padX * 2;
    const id = `t${i}`;
    defs.push(`<clipPath id="${id}"><rect x="${(inner.x + padX).toFixed(1)}" y="${(inner.y + padY).toFixed(1)}" width="${Math.max(0, cw).toFixed(1)}" height="${Math.max(0, inner.h - padY * 2).toFixed(1)}"/></clipPath>`);
    const tx = inner.x + padX;
    const g: string[] = [];
    if (showLabel) {
      const titleSize = minD > 220 ? 18 : minD > 130 ? 15 : w < 130 ? 12 : 13;
      const clamp = h > 170 ? 3 : h > 80 ? 2 : 1;
      let ty = inner.y + padY;
      g.push(text(tx, ty + 10, it.code, { size: 11, weight: 600, fill: fg, opacity: 0.7 }));
      ty += 11 + 4;
      const lines = wrap(it.label, cw, titleSize, 600, clamp);
      lines.forEach((line, k) => g.push(text(tx, ty + titleSize * 0.95 + k * titleSize * 1.15, line, { size: titleSize, weight: 600, fill: fg, spacing: "-0.15" })));
    }
    if (showValue) {
      const area = w * h;
      const shareSize = Math.round(Math.max(18, Math.min(64, Math.sqrt(area) / 5.2)));
      const bottom = inner.y + inner.h - padY;
      g.push(text(tx, bottom - 1, fmd(it.v), { size: 12, weight: 600, fill: fg, opacity: 0.75 }));
      g.push(text(tx, bottom - 12 - 4, share(it), { size: shareSize, weight: 700, fill: fg, spacing: `${(-0.03 * shareSize).toFixed(2)}` }));
    }
    out.push(`<g clip-path="url(#${id})">${g.join("")}</g>`);
  });
  return `<defs>${defs.join("")}</defs>${out.join("\n")}`;
}

// ---- The page ------------------------------------------------------------------------

/**
 * The share image for a route as SVG on the format's canvas, or null when
 * there is no data to draw. The link format is landscape; the others stack
 * the same parts taller and end with the page's address, since a posted
 * image carries no link of its own.
 */
export function renderSvg(route: Route, data: Data, format: Format = "link"): string | null {
  const s = resolve(route, data);
  if (!s) return null;
  const T = COPY[route.view];
  const { year } = s;
  const nominal = s.display.unit === "kr" ? s.prices.nominal : () => false;
  const priceNote = s.display.unit === "kr" ? s.prices.priceNote : "";
  const { canvas: { w: WIDTH, h: HEIGHT }, pad: { x: padX, y: padY } } = FORMATS[format];
  const out: string[] = [];
  out.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${PAGE}"/>`);
  out.push(logo(padX, padY, 36));
  const brandX = padX + 36 + 14;
  out.push(text(brandX, padY + 29, "Statsbudgeten", { size: 30, weight: 700, fill: INK, spacing: "-0.6" }));
  out.push(text(brandX + textWidth("Statsbudgeten", 30, 700) - 1, padY + 29, ".se", { size: 30, weight: 700, fill: MUTED, spacing: "-0.6" }));

  // Posted images end with the page's address.
  const footer = format === "link" ? 0 : 30;
  if (footer) {
    const latest = s.years[s.years.length - 1] ?? null;
    const address = `statsbudgeten.se${buildUrl({ ...route, q: "" }, latest).replace(/^\/$/, "")}`;
    out.push(text(WIDTH / 2, HEIGHT - padY + 4, address, { size: 15, weight: 600, fill: SECONDARY, anchor: "middle" }));
  }
  const body: Box = { x: padX, y: padY + 36 + 24, w: WIDTH - padX * 2, h: HEIGHT - padY * 2 - 36 - 24 - footer };
  if (route.mode === "overview") {
    out.push(text(WIDTH - padX, padY + 27, `Budgetår ${year}${nominal(year) ? "*" : ""}`, { size: 16, weight: 600, fill: SECONDARY, anchor: "end" }));
    out.push(overviewPanel(body, s));
  } else if (!s.group) {
    const groups = s.all.filter((g) => g.total > 0);
    const notes = `${nominal(year) ? "* nominellt" : ""}${s.display.unitNote}${priceNote}`.replace(/^ · /, "");
    if (notes) out.push(text(WIDTH - padX, padY + 27, notes, { size: 16, weight: 600, fill: SECONDARY, anchor: "end" }));
    out.push(text(body.x, body.y + 24, `${T.heading} ${year}${nominal(year) ? "*" : ""}`, { size: 26, weight: 700, fill: INK, spacing: "-0.5" }));
    out.push(text(body.x + body.w, body.y + 24, `${fmd(s.parentTotal)} · ${groups.length} ${T.areas}`, { size: 16, weight: 600, fill: SECONDARY, anchor: "end" }));
    out.push(treemap({ x: body.x, y: body.y + 44, w: body.w, h: body.h - 44 }, s));
  } else {
    out.push(text(WIDTH - padX, padY + 27, `${T.label} ${year}${nominal(year) ? "*" : ""}`, { size: 16, weight: 600, fill: SECONDARY, anchor: "end" }));
    const multiYear = s.years.length > 1;
    const panelH = multiYear ? Math.round(Math.min(320, Math.max(232, body.h * 0.36))) : 0;
    if (multiYear) out.push(focusPanel({ x: body.x, y: body.y, w: body.w, h: panelH }, s));
    const mapY = body.y + panelH + (multiYear ? 8 : 0);
    out.push(treemap({ x: body.x, y: mapY, w: body.w, h: body.y + body.h - mapY }, s));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Inter">
${out.join("\n")}
</svg>`;
}

const fontDir = new URL("../assets/fonts/", import.meta.url).pathname;
const FONTS = ["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf"].map((f) => `${fontDir}${f}`);

/** The share image for a route as PNG bytes in the format's size, or null when there is no data to draw. */
export function renderPng(route: Route, data: Data, format: Format = "link"): Uint8Array | null {
  const svg = renderSvg(route, data, format);
  if (!svg) return null;
  const r = new Resvg(svg, { fitTo: { mode: "width", value: FORMATS[format].w }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" } });
  return r.render().asPng();
}
