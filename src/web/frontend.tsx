/**
 * Statsbudgeten – the Swedish state budget as an overview chart (/) and a
 * click-to-drill treemap (/utgifter, /inkomster). Inside a group the page
 * shows the group's history graph with the treemap of its postings below;
 * clicking a posting focuses it, and the graph follows. The URL mirrors what
 * is on screen, see routes.ts. The treemap is a port of the design handoff
 * (an HTML reference that is not part of the repo).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BudgetJsonSchema, type BudgetJson } from "../../types/BudgetJsonSchema";
import { InflationSchema } from "../../types/InflationSchema";
import { chooseBaseYear, inflationFactors } from "../inflation";
import { initAnalytics, trackEvent, trackPageView } from "./analytics";
import { aboutContent } from "./content.macro" with { type: "macro" };
import type { Block, Inline } from "../markdown";
import { buildIndex, search as runSearch, type SearchHit } from "../search";
import { buildUrl, groupKey, groupNumber, parseRoute, type Compare, type Mode, type Unit, type View } from "./routes";
import "./styles.css";

/**
 * Favicon, home-screen icon and web manifest, served from assets/ by the
 * server. Added here rather than in index.html because Bun's HTML bundler
 * insists on bundling every <link href> itself and rewrites the paths.
 */
function installIcons() {
  const links: [string, string, Record<string, string>?][] = [
    ["icon", "/favicon.svg", { type: "image/svg+xml" }],
    ["apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" }],
    ["manifest", "/site.webmanifest"],
  ];
  for (const [rel, href, attrs] of links) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    for (const [k, v] of Object.entries(attrs ?? {})) link.setAttribute(k, v);
    document.head.appendChild(link);
  }
}

/** content/om.md, converted to JSON when the bundle is built. */
const ABOUT: Block[] = aboutContent();

// ---- Design-only tweaks (constants in production) ----------------------------

/** "färg" | "gråskala" */
const COLOR_MODE: "färg" | "gråskala" = "färg";
/** Bundle rows below 0.6 % of their group into one "Övriga" tile. */
const GROUP_SMALL = true;

const TAIL_CUT = GROUP_SMALL ? 0.006 : 0;
const INK = "#0b0b0b";
const PAPER = "#fcfcfb";

// ---- Formatting ---------------------------------------------------------------

const NF1 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const NF2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amounts are in tkr; 1 mdkr = 1e6 tkr. */
const fmd = (tkr: number) => {
  const m = tkr / 1e6;
  if (m >= 10) return `${NF0.format(m)} mdkr`;
  if (m >= 0.1) return `${NF1.format(m)} mdkr`;
  return `${NF0.format(tkr / 1e3)} mnkr`;
};
const fpct = (p: number) => `${p >= 10 ? NF0.format(p) : p >= 0.1 ? NF1.format(p) : "<0,1"} %`;
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmd(Math.abs(v));
/** Exact amount in tkr, e.g. "1 543 317 501 tkr". */
const ftkr = (tkr: number) => `${NF0.format(Math.round(tkr))} tkr`;
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±");

/** How a graph writes its values: in kronor (tkr) or in percent of a year's total. */
type Fmt = {
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

const FMT_KR: Fmt = {
  short: fmd,
  exact: ftkr,
  grid: (v, step) => (step >= 1e6 ? NF0 : NF1).format(v / 1e6),
  diff: (d, prev) => `${sign(d)}${ftkr(Math.abs(d))}${prev ? ` (${sign(d)}${NF1.format(Math.abs((d / prev) * 100))} %)` : ""}`,
  minPad: 1,
};

const FMT_PCT: Fmt = {
  short: (v) => `${NF1.format(v)} %`,
  exact: (v) => `${NF2.format(v)} %`,
  grid: (v, step) => `${(step >= 1 ? NF0 : NF1).format(v)} %`,
  diff: (d) => `${sign(d)}${NF2.format(Math.abs(d))} procentenheter`,
  minPad: 0.05,
};

/** Both series as an index, first year = 100: the compare view. */
const FMT_INDEX: Fmt = {
  short: (v) => NF0.format(v),
  exact: (v) => NF1.format(v),
  grid: (v) => NF0.format(v),
  diff: (d, prev) => `${sign(d)}${NF1.format(Math.abs(d))}${prev ? ` (${sign(d)}${NF1.format(Math.abs((d / prev) * 100))} %)` : ""}`,
  minPad: 1,
};

const UNITS: { k: Unit; label: string; note: string }[] = [
  { k: "kr", label: "kr", note: "" },
  { k: "rev", label: "% av inkomster", note: " · % av inkomsterna" },
  { k: "exp", label: "% av utgifter", note: " · % av utgifterna" },
];

// ---- Data model ---------------------------------------------------------------

type NormRow = { key: string; id: number; title: string; v: number };
type NormGroup = { key: string; code: string; title: string; total: number; rows: NormRow[] };

/**
 * Normalize expenses and revenues to one shape, as the design handoff specifies.
 * `f` is a price-level factor (1 = nominal) applied to every amount.
 */
function normalize(b: BudgetJson, view: View, f = 1): NormGroup[] {
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

const COPY = {
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

// ---- Squarified treemap -------------------------------------------------------

type Placed<T> = { it: T; a: number; x: number; y: number; w: number; h: number };

function squarify<T>(items: { it: T; a: number }[], W: number, H: number): Placed<T>[] {
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

// ---- Logo ---------------------------------------------------------------------

/** The mark: a mini treemap, same geometry as assets/favicon.svg. */
const Logo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ flex: "none" }} aria-hidden>
    <rect x="0" y="0" width="17" height="32" rx="3" fill="#3f86e0" />
    <rect x="19" y="0" width="13" height="18" rx="3" fill="#d9577f" />
    <rect x="19" y="20" width="7" height="12" rx="2.5" fill="#e3a12f" />
    <rect x="28" y="20" width="4" height="12" rx="1.5" fill="#33a573" />
  </svg>
);

// ---- Shared types -------------------------------------------------------------

type Info = { title: string; value?: string; share?: string; hint?: string };

/** Price-level helpers passed down to the charts. */
type Prices = {
  /** Factor per year (1 when showing nominal amounts). */
  factorOf: (y: number) => number;
  /** True when a year is shown nominal because inflation data is missing. */
  nominal: (y: number) => boolean;
  priceNote: string;
  nominalNote: string;
};

/** The unit the graphs are drawn in, see the `andel` query parameter. */
type Display = {
  unit: Unit;
  /** An amount in tkr for year y, converted to the unit. */
  toUnit: (v: number, y: number) => number;
  fmt: Fmt;
  /** Kicker suffix naming the unit, empty for kronor. */
  unitNote: string;
};

type Item = {
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
  onClick?: () => void;
};

/** Tile colour per the design: hue by group, lightness by rank. */
function colorOf(it: Item, drilled: boolean): { bg: string; fg: string } {
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

// ---- Line chart (overview and group/item history) ------------------------------

type Point = { y: number; v: number };
/** `dash` draws the series dashed with square dots: the compared series in the focus graph. */
type Series = { key: string; points: Point[]; color?: string; label?: string; dash?: boolean };

/** Series marker: a dot, or a square for the compared series. */
const Mark = ({ square, color }: { square?: boolean; color?: string }) => <span className={`mk${square ? " sq" : ""}`} style={{ background: color }} aria-hidden />;

/** Chart x position in percent for point i of n, inset 5 %–95 %. */
const X = (i: number, n: number) => (n === 1 ? 50 : 5 + (i / (n - 1)) * 90);

/**
 * Y axis from the data, with gridline labels in mdkr. The bottom snaps down
 * to a nice step so the lowest gridline is the floor; the top is the data
 * plus a small headroom and is not snapped, so the plot fills the panel
 * instead of leaving an empty band up to the next round number.
 */
function niceScale(values: number[], minPad: number) {
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const pad = Math.max((mx - mn) * 0.1, mx * 0.04, minPad);
  const hi = mx + pad;
  const raw = (hi - Math.max(0, mn - pad)) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const lo = Math.max(0, Math.floor((mn - pad) / step) * step);
  const Y = (v: number) => 100 - ((v - lo) / (hi - lo || 1)) * 100;
  const grid: { top: string; v: number }[] = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) grid.push({ top: `${Y(v)}%`, v });
  return { Y, grid, step };
}

/** True one frame after mount, to drive the enter transitions. */
function useRevealed() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setOn(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return on;
}

type LineChartProps = {
  series: Series[];
  years: number[];
  /** The budget year picked in the menu: drawn bigger. */
  year: number;
  nominal: (y: number) => boolean;
  /** Fill for unselected dots, i.e. the panel background. */
  paper: string;
  /** Extra line at the bottom of the info box for year index i, e.g. the saldo. */
  extra?: (i: number) => string | null;
  /** The points are already in this unit; `fmt` only writes them. */
  fmt: Fmt;
};

/**
 * Line chart with an info box: hovering a year's dot or label shows the exact
 * figures and the change from the previous year; clicking pins the box.
 */
function LineChart({ series, years, year, nominal, paper, extra, fmt }: LineChartProps) {
  const open = useRevealed();
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const [pinnedYear, setPinnedYear] = useState<number | null>(null);
  const n = years.length;
  const { Y, grid, step } = niceScale(series.flatMap((s) => s.points.map((p) => p.v)), fmt.minPad);
  const pts = (s: Series) => s.points.map((p, i) => `${X(i, n).toFixed(2)},${Y(p.v).toFixed(2)}`).join(" ");
  const selIndex = Math.max(0, years.indexOf(year));
  // With several series, each year's highest value is labelled above its dot
  // and the others below, so labels never collide where the lines run close.
  const below = (s: Series, i: number) => series.length > 1 && series.some((o) => o !== s && (o.points[i]?.v ?? -Infinity) > (s.points[i]?.v ?? -Infinity));

  const shown = hoverYear ?? pinnedYear;
  const shownIndex = shown != null ? years.indexOf(shown) : -1;
  const toggle = (y: number) => setPinnedYear((p) => (p === y ? null : y));
  const handlers = (y: number) => ({
    onMouseEnter: () => setHoverYear(y),
    onMouseLeave: () => setHoverYear(null),
    onFocus: () => setHoverYear(y),
    onBlur: () => setHoverYear(null),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle(y);
    },
  });

  let box: React.ReactNode = null;
  if (shownIndex >= 0) {
    const i = shownIndex;
    const y = years[i]!;
    const prevYear = i > 0 ? years[i - 1]! : null;
    const mixed = prevYear != null && nominal(y) !== nominal(prevYear);
    const ys = series.map((s) => Y(s.points[i]?.v ?? 0));
    const mid = ys.reduce((a, b) => a + b, 0) / ys.length;
    const x = X(i, n);
    const side = i < n / 2 ? { left: `calc(${x}% + 28px)` } : { right: `calc(${100 - x}% + 28px)` };
    box = (
      <div
        className={`infobox${series.length > 1 ? " multi" : ""}${pinnedYear === y && hoverYear == null ? " pinned" : ""}`}
        role="status"
        style={{ ...side, top: `clamp(-24px, calc(${mid}% - var(--box-h) / 2), calc(100% - var(--box-h) + 40px))` }}
      >
        <div className="ib-year">
          {y}
          {nominal(y) ? "*" : ""}
          {prevYear != null && <span className="ib-vs"> · jämfört med {prevYear}</span>}
        </div>
        {series.map((s) => {
          const v = s.points[i]?.v ?? 0;
          const prev = prevYear != null ? (s.points[i - 1]?.v ?? 0) : null;
          const d = prev != null ? v - prev : null;
          return (
            <div className="ib-row" key={s.key}>
              {series.length > 1 && (
                <span className="ib-label">
                  <Mark square={s.dash} color={s.color} />
                  <span className="txt">{s.label}</span>
                </span>
              )}
              <span className="ib-val">{fmt.exact(v)}</span>
              <span className="ib-diff">{d != null && prev != null ? `${fmt.diff(d, prev)}${mixed ? "*" : ""}` : "första året i serien"}</span>
            </div>
          );
        })}
        {extra?.(i) && <div className="ib-extra">{extra(i)}</div>}
      </div>
    );
  }

  return (
    <div className="chart" onClick={() => setPinnedYear(null)}>
      {grid.map((g) => (
        <div key={g.top} className="gridline" style={{ top: g.top }}>
          <span>{fmt.grid(g.v, step)}</span>
        </div>
      ))}
      {series.length > 1 && <div className="band" style={{ left: `${X(selIndex, n)}%` }} />}
      <div className="reveal" style={{ clipPath: `inset(0 ${open ? "0%" : "100%"} 0 0)`, transitionDelay: open ? ".2s" : "0s" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {series.map((s) => (
            <React.Fragment key={s.key}>
              <polygon points={`${X(0, n)},100 ${pts(s)} ${X(n - 1, n)},100`} fill={s.color ?? "currentColor"} style={{ opacity: s.dash ? 0.05 : s.color ? 0.08 : 0.1 }} />
              <polyline
                points={pts(s)}
                fill="none"
                stroke={s.color ?? "currentColor"}
                strokeWidth="3"
                strokeDasharray={s.dash ? "7 6" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </React.Fragment>
          ))}
        </svg>
      </div>
      {series.map((s) =>
        s.points.map((p, i) => {
          const selected = p.y === year;
          const active = p.y === shown;
          // A label below a dot near the floor would land on the year labels.
          const under = below(s, i) && Y(p.v) < 84;
          return (
            <button
              key={`${s.key}-${p.y}`}
              type="button"
              className={`dot${s.dash ? " sq" : ""}${under ? " below" : ""}${active ? " active" : ""}${selected ? " selected" : ""}`}
              aria-label={`${s.label ? `${s.label} ` : ""}${p.y}: ${fmt.exact(p.v)}`}
              aria-pressed={pinnedYear === p.y}
              style={{
                left: `${X(i, n)}%`,
                top: `${Y(p.v)}%`,
                color: s.color,
                transform: `translate(-50%,-50%) scale(${open ? 1 : 0})`,
                transitionDelay: open ? `${(0.25 + (i / Math.max(1, n - 1)) * 0.6).toFixed(2)}s` : "0s",
              }}
              {...handlers(p.y)}
            >
              <span className="val">{fmt.short(p.v)}</span>
              <span className="mark" style={{ width: selected ? 16 : 12, height: selected ? 16 : 12, background: selected ? "currentColor" : paper }} />
            </button>
          );
        }),
      )}
      {years.map((y, i) => {
        const selected = y === year;
        return (
          <button
            key={y}
            type="button"
            className="year"
            aria-pressed={pinnedYear === y}
            style={{ left: `${X(i, n)}%`, fontWeight: selected ? 700 : 500, opacity: selected || y === shown ? 1 : 0.7 }}
            {...handlers(y)}
          >
            {y}
            {nominal(y) ? "*" : ""}
          </button>
        );
      })}
      {box}
    </div>
  );
}

/** Headline change between the first and last year that are in the same prices. */
function changeOver(points: Point[], nominal: (y: number) => boolean) {
  const comparable = points.filter((p) => !nominal(p.y));
  const span = comparable.length >= 2 ? comparable : points;
  const first = span[0]!;
  const last = span[span.length - 1]!;
  const pct = first.v ? ((last.v - first.v) / first.v) * 100 : 0;
  return { first, last, pct };
}

// ---- Overview: inkomster vs utgifter per year ----------------------------------

type OverviewProps = Prices & Display & {
  years: number[];
  budgets: Record<number, BudgetJson>;
  year: number;
};

const SIDES = [
  { k: "exp", label: "Utgifter", color: "var(--expense)" },
  { k: "rev", label: "Inkomster", color: "var(--revenue)" },
] as const;

function Overview({ years, budgets, year, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: OverviewProps) {
  // A share is the same at any price level, so the price notes only apply in kronor.
  const nominal = unit === "kr" ? nominalKr : () => false;
  const priceNote = unit === "kr" ? priceNoteKr : "";
  const totals = years.map((y) => {
    const b = budgets[y];
    const f = factorOf(y);
    return { y, exp: toUnit((b?.expensesTotal ?? 0) * f, y), rev: toUnit((b?.revenuesTotal ?? 0) * f, y) };
  });
  const sel = totals.find((t) => t.y === year) ?? totals[totals.length - 1]!;
  const saldo = sel.rev - sel.exp;
  const fsaldo = (d: number) => `${sign(d)}${fmt.short(Math.abs(d))}`;

  return (
    <div className="panel overview" style={{ background: PAPER, color: INK, ["--grid-color" as string]: "rgba(11,11,11,0.12)" }}>
      <div className="content">
        <div className="top">
          <div className="heading">
            <span className="kicker">
              Statens budget · {years[0]}–{years[years.length - 1]}
              {unitNote}
              {priceNote}
            </span>
            <span className="name" lang="sv">
              Inkomster och utgifter
            </span>
            <span className="legend">
              {SIDES.map((s) => (
                <span key={s.k}>
                  <span className="swatch" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </span>
          </div>
          <div className="delta">
            <span className="kicker">Saldo {sel.y}</span>
            <span className="pct" style={{ color: saldo < 0 ? "var(--revenue)" : "var(--expense)" }}>
              {fsaldo(saldo)}
            </span>
            <span className="abs">{saldo < 0 ? "Underskott – lånebehov" : saldo > 0 ? "Överskott" : "Balans"}</span>
          </div>
        </div>
        <LineChart
          series={SIDES.map((s) => ({ key: s.k, label: s.label, color: s.color, points: totals.map((t) => ({ y: t.y, v: t[s.k] })) }))}
          years={years}
          year={year}
          nominal={nominal}
          paper={PAPER}
          fmt={fmt}
          extra={(i) => {
            const t = totals[i]!;
            const d = t.rev - t.exp;
            return `Saldo ${sign(d)}${fmt.exact(Math.abs(d))} · ${d < 0 ? "underskott" : d > 0 ? "överskott" : "balans"}`;
          }}
        />
        <div className="note">{years.some(nominal) ? nominalNote : ""}</div>
      </div>
    </div>
  );
}

// ---- Focus panel: history of the current group or focused posting -------------

type FocusProps = Prices & Display & {
  years: number[];
  budgets: Record<number, BudgetJson>;
  year: number;
  view: View;
  gkey: string;
  /** Row key of the focused posting, or null for the whole group. */
  row: string | null;
  kicker: string;
  title: string;
  bg: string;
  fg: string;
  /** This year's budget, searched by the compare picker. */
  budget: BudgetJson | undefined;
  compare: CompareTarget | null;
  /** Draw both series as an index, first year = 100. */
  index: boolean;
  onCompare: (hit: SearchHit) => void;
  onClearCompare: () => void;
  onToggleIndex: () => void;
};

/** The compared series, resolved against this year's data. */
type CompareTarget = { view: View; gkey: string; row: string | null; title: string; kicker: string };

/** The series as an index: the first year with a value is 100. */
function toIndex(points: Point[]): Point[] {
  const base = points.find((p) => p.v > 0)?.v;
  return points.map((p) => ({ y: p.y, v: base ? (p.v / base) * 100 : 0 }));
}

const fpctSigned = (pct: number) => `${sign(pct)}${NF1.format(Math.abs(pct))} %`;

function FocusPanel({ years, budgets, year, view, gkey, row, kicker, title, bg, fg, budget, compare, index, onCompare, onClearCompare, onToggleIndex, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: FocusProps) {
  // A share is the same at any price level, so the price notes only apply in kronor.
  const nominal = unit === "kr" ? nominalKr : () => false;
  const priceNote = unit === "kr" ? priceNoteKr : "";
  const history = (v: View, k: string, r: string | null) =>
    years.map((y) => {
      const b = budgets[y];
      const g = b ? normalize(b, v, factorOf(y)).find((x) => x.key === k) : undefined;
      let val = 0;
      if (g) val = r == null ? g.total : (g.rows.find((x) => x.key === r)?.v ?? 0);
      return { y, v: toUnit(val, y) };
    });
  const points = history(view, gkey, row);
  const cmpPoints = compare ? history(compare.view, compare.gkey, compare.row) : null;
  const { first, last, pct } = changeOver(points, nominal);
  const cmpChange = cmpPoints ? changeOver(cmpPoints, nominal) : null;
  const dark = fg !== INK;
  // In kronor the headline is the relative change with the amount below; in
  // percent it is the change in percentage points, with the two shares below.
  const d = last.v - first.v;
  const delta =
    unit === "kr"
      ? { big: `${sign(pct)}${NF1.format(Math.abs(pct))} %`, small: signed(d) }
      : { big: `${sign(d)}${NF1.format(Math.abs(d))}`, small: `procentenheter · ${fmt.short(first.v)} → ${fmt.short(last.v)}` };
  /** One headline per series when two are compared: relative change, or percentage points. */
  const headline = (p: number, dd: number) => (unit === "kr" ? fpctSigned(p) : `${sign(dd)}${NF1.format(Math.abs(dd))} procentenheter`);

  const indexed = index && cmpPoints != null;
  const series: Series[] = [{ key: "a", label: title, points: indexed ? toIndex(points) : points }];
  if (cmpPoints && compare) series.push({ key: "b", label: compare.title, points: indexed ? toIndex(cmpPoints) : cmpPoints, dash: true });

  // The picker: a searchable dropdown under the "Jämför med…" button. It
  // closes on a click outside, and focus returns to the button.
  const [picking, setPicking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasPicking = useRef(false);
  useEffect(() => {
    if (!picking && wasPicking.current) triggerRef.current?.focus({ preventScroll: true });
    wasPicking.current = picking;
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [picking]);
  // The focused posting can't be compared with itself, nor with the current target.
  const exclude = (h: SearchHit) =>
    (h.gkey === gkey && (row == null ? h.id == null : h.key === row)) ||
    (compare != null && h.gkey === compare.gkey && (compare.row == null ? h.id == null : h.key === compare.row));

  return (
    <div
      className={`panel focus${compare ? " compared" : ""}${picking ? " picking" : ""}`}
      style={{ background: bg, color: fg, ["--panel-bg" as string]: bg, ["--grid-color" as string]: dark ? "rgba(255,255,255,0.22)" : "rgba(11,11,11,0.12)" }}
    >
      <div className="content">
        <div className="top">
          <div className="heading">
            <span className="kicker">
              {kicker}
              {unitNote}
              {priceNote}
              {indexed ? ` · index, ${points[0]?.y} = 100` : ""}
              {years.some(nominal) ? ` · ${nominalNote}` : ""}
            </span>
            <span className="name" lang="sv">
              {title}
            </span>
            <div className="compare-wrap" ref={wrapRef}>
              <div className="compare-row">
                {compare ? (
                  <>
                    <span className="pill chip" title={compare.kicker}>
                      <button
                        ref={triggerRef}
                        type="button"
                        className="chip-main"
                        aria-haspopup="dialog"
                        aria-expanded={picking}
                        aria-label={`Jämförs med ${compare.title}. Byt jämförelse`}
                        onClick={() => setPicking((o) => !o)}
                      >
                        <Mark square />
                        <span className="txt" lang="sv">
                          {compare.title}
                        </span>
                      </button>
                      <button type="button" className="chip-x" aria-label="Ta bort jämförelsen" onClick={onClearCompare}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={index}
                      className={`pill${index ? " on" : ""}`}
                      title="Visa båda serierna som index där första året är 100"
                      onClick={onToggleIndex}
                    >
                      <span>Index</span>
                    </button>
                  </>
                ) : (
                  <button ref={triggerRef} type="button" className="pill" aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking((o) => !o)}>
                    <span>Jämför med …</span>
                  </button>
                )}
              </div>
              {picking && (
                <ComparePicker
                  budget={budget}
                  exclude={exclude}
                  onPick={(h) => {
                    setPicking(false);
                    onCompare(h);
                  }}
                  onClose={() => setPicking(false)}
                />
              )}
            </div>
          </div>
          <div className="delta">
            <span className="kicker">
              {first.y}–{last.y}
            </span>
            {cmpChange ? (
              <>
                <span className="pct">
                  <Mark />
                  {headline(pct, d)}
                </span>
                <span className="abs">
                  <Mark square />
                  {headline(cmpChange.pct, cmpChange.last.v - cmpChange.first.v)}
                </span>
              </>
            ) : (
              <>
                <span className="pct">{delta.big}</span>
                <span className="abs">{delta.small}</span>
              </>
            )}
          </div>
        </div>
        <LineChart
          key={`${gkey}/${row ?? ""}/${compare?.gkey ?? ""}/${compare?.row ?? ""}/${indexed}`}
          series={series}
          years={years}
          year={year}
          nominal={nominal}
          paper={bg}
          fmt={indexed ? FMT_INDEX : fmt}
          extra={
            cmpPoints
              ? (i) => {
                  const gap = (points[i]?.v ?? 0) - (cmpPoints[i]?.v ?? 0);
                  return `Skillnad: ${sign(gap)}${unit === "kr" ? fmd(Math.abs(gap)) : `${NF2.format(Math.abs(gap))} procentenheter`}`;
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

// ---- Compare picker: searchable dropdown for the second series ------------------

type ComparePickerProps = {
  budget: BudgetJson | undefined;
  /** Hits that can't be picked (the focused posting itself). */
  exclude: (h: SearchHit) => boolean;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
};

function ComparePicker({ budget, exclude, onPick, onClose }: ComparePickerProps) {
  const index = useMemo(() => (budget ? buildIndex(budget) : []), [budget]);
  const [q, setQ] = useState("");
  const hits = useMemo(() => runSearch(index, q, 40).filter((h) => !exclude(h)), [index, q]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".result.active")?.scrollIntoView({ block: "nearest" });
  }, [active, hits]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active]!);
    } else if (e.key === "Escape") {
      // Ours: the app's Esc handler must not also unfocus the posting.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="picker" role="dialog" aria-label="Jämför med">
      <div className="search-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          placeholder="Sök anslag, inkomsttitel eller område …"
          aria-label="Sök något att jämföra med"
          autoComplete="off"
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {q.trim() === "" ? (
        <p className="search-hint">Skriv för att söka. Pil upp/ner och Enter väljer, Esc stänger.</p>
      ) : hits.length === 0 ? (
        <p className="search-hint">Inga träffar för ”{q.trim()}”.</p>
      ) : (
        <div className="results" role="listbox" aria-label="Träffar" ref={listRef}>
          {hits.map((h, i) => (
            <button
              key={`${h.gkey}/${h.id ?? ""}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`result${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(h)}
            >
              <span className="swatch" style={{ background: h.view === "rev" ? "var(--revenue)" : "var(--expense)" }} />
              <span className="r-main">
                <span className="r-title">{h.title}</span>
                <span className="r-sub">
                  {h.id == null
                    ? h.view === "rev" ? "Inkomsttyp" : "Utgiftsområde"
                    : `${h.groupCode} · ${h.groupTitle} · ${h.view === "rev" ? "Inkomsttitel" : "Anslag"} ${h.id}`}
                </span>
              </span>
              <span className="r-val">{fmd(h.v)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Tile ---------------------------------------------------------------------

type TileProps = {
  it: Item;
  rect: { left: string; top: string; width: string; height: string };
  w: number;
  h: number;
  bg: string;
  fg: string;
  share: string;
  info: Info;
  hovered: boolean;
  focused: boolean;
  /** Expanded in place so a tile that was too small to read shows its text. */
  zoomed: boolean;
  onHover: (info: Info | null) => void;
  onActivate: () => void;
};

/** A tile this small can't carry its label; the first click zooms it instead of acting. */
const readable = (w: number, h: number) => w > 84 && h > 54;

function Tile({ it, rect, w, h, bg, fg, share, info, hovered, focused, zoomed, onHover, onActivate }: TileProps) {
  const minD = Math.min(w, h);
  const area = w * h;
  const showLabel = zoomed || readable(w, h);
  const showValue = zoomed || (w > 70 && h > 130);
  const shareSize = zoomed ? 28 : Math.round(Math.max(18, Math.min(64, Math.sqrt(area) / 5.2)));
  const titleSize = zoomed ? 15 : minD > 220 ? 18 : minD > 130 ? 15 : w < 130 ? 12 : 13;
  const clamp = zoomed ? 3 : h > 170 ? 3 : h > 80 ? 2 : 1;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${info.title}, ${info.value}`}
      aria-pressed={focused || undefined}
      className={`tile${hovered ? " hovered" : ""}${focused ? " focused" : ""}${zoomed ? " zoomed" : ""}`}
      style={{
        ...rect,
        background: bg,
        color: fg,
        padding: zoomed || minD > 160 ? "14px 16px" : "8px 10px",
        cursor: it.drill ? "zoom-in" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      onMouseEnter={() => onHover(info)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(info)}
      onBlur={() => onHover(null)}
    >
      <span className="head" style={{ opacity: showLabel ? 1 : 0 }}>
        <span className="code">{it.code}</span>
        <span className="title" lang="sv" style={{ fontSize: titleSize, WebkitLineClamp: clamp }}>
          {it.label}
        </span>
      </span>
      <span className="figures" style={{ opacity: showValue ? 1 : 0 }}>
        <span className="share" style={{ fontSize: shareSize }}>
          {share}
        </span>
        <span className="value">{fmd(it.v)}</span>
      </span>
    </div>
  );
}

// ---- About page ----------------------------------------------------------------

type Source = { file: string; label: string; size: number };

const fsize = (bytes: number) => `${NF0.format(Math.max(1, Math.round(bytes / 1024)))} kB`;

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((n, i) => {
        if (n.t === "link") {
          const external = /^https?:/.test(n.href);
          return (
            <a key={i} href={n.href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined}>
              {n.s}
            </a>
          );
        }
        if (n.t === "strong") return <strong key={i}>{n.s}</strong>;
        if (n.t === "code") return <code key={i}>{n.s}</code>;
        return <React.Fragment key={i}>{n.s}</React.Fragment>;
      })}
    </>
  );
}

function About() {
  const [sources, setSources] = useState<Source[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sources")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => !cancelled && setSources(list as Source[]))
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel about">
      <article className="prose" lang="sv">
        {ABOUT.map((b, i) => {
          if (b.t === "h") {
            const Tag = `h${b.level}` as "h1" | "h2" | "h3";
            return (
              <Tag key={i}>
                <Inlines inlines={b.inlines} />
              </Tag>
            );
          }
          if (b.t === "p")
            return (
              <p key={i}>
                <Inlines inlines={b.inlines} />
              </p>
            );
          if (b.t === "ul")
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines inlines={it} />
                  </li>
                ))}
              </ul>
            );
          return (
            <ul key={i} className="downloads">
              {sources == null && <li className="muted">Hämtar filer …</li>}
              {sources?.length === 0 && <li className="muted">Inga filer tillgängliga.</li>}
              {sources?.map((src) => (
                <li key={src.file}>
                  <a href={`/examples/${encodeURIComponent(src.file)}`} download>
                    {src.label}
                  </a>
                  <span className="muted">
                    {" "}
                    · {src.file} · {fsize(src.size)}
                  </span>
                </li>
              ))}
            </ul>
          );
        })}
      </article>
    </div>
  );
}

// ---- Search page ---------------------------------------------------------------

type SearchProps = {
  budget: BudgetJson | undefined;
  year: number | null;
  q: string;
  onChange: (q: string) => void;
  onPick: (hit: SearchHit) => void;
};

function Search({ budget, year, q, onChange, onPick }: SearchProps) {
  const index = useMemo(() => (budget ? buildIndex(budget) : []), [budget]);
  const hits = useMemo(() => runSearch(index, q), [index, q]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setActive(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);
  const postings = index.filter((h) => h.id != null).length;
  const groups = index.length - postings;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active]!);
    }
  };

  return (
    <div className="panel search">
      <div className="search-head">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={q}
          placeholder="Sök anslag, inkomsttitel eller område …"
          aria-label="Sök"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
        />
        {q && (
          <button type="button" className="icon-btn" aria-label="Rensa sökningen" onClick={() => { onChange(""); inputRef.current?.focus(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
      {q.trim() === "" ? (
        <p className="search-hint">
          {budget ? `Sök bland ${NF0.format(groups)} områden och ${NF0.format(postings)} poster i budgeten för ${year}.` : "Läser in …"}
        </p>
      ) : hits.length === 0 ? (
        <p className="search-hint">Inga träffar för ”{q.trim()}”.</p>
      ) : (
        <div className="results" role="listbox" aria-label="Sökträffar">
          {hits.map((h, i) => (
            <button
              key={`${h.gkey}/${h.id ?? ""}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`result${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(h)}
            >
              <span className="swatch" style={{ background: h.view === "rev" ? "var(--revenue)" : "var(--expense)" }} />
              <span className="r-main">
                <span className="r-title">{h.title}</span>
                <span className="r-sub">
                  {h.id == null
                    ? h.view === "rev" ? "Inkomsttyp" : "Utgiftsområde"
                    : `${h.groupCode} · ${h.groupTitle} · ${h.view === "rev" ? "Inkomsttitel" : "Anslag"} ${h.id}${h.rest ? " · Övriga" : ""}`}
                </span>
              </span>
              <span className="r-val">{fmd(h.v)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- App ----------------------------------------------------------------------

const initialRoute = parseRoute(new URL(window.location.href));

function App() {
  const [yrs, setYrs] = useState<number[]>([]);
  const [budgets, setBudgets] = useState<Record<number, BudgetJson>>({});
  const [mode, setMode] = useState<Mode>(initialRoute.mode);
  const [year, setYear] = useState<number | null>(initialRoute.year);
  const [view, setView] = useState<View>(initialRoute.view);
  const [uo, setUo] = useState<string | null>(initialRoute.group != null ? groupKey(initialRoute.view, initialRoute.group) : null);
  const [rest, setRest] = useState(initialRoute.rest);
  /** Focused posting: its row key once resolved, and the id from the URL until then. */
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<number | null>(initialRoute.item);
  const [realWanted, setReal] = useState(initialRoute.real);
  /** Comparison target as in the URL; resolved against the year's data below. */
  const [cmp, setCmp] = useState<Compare | null>(initialRoute.cmp);
  const [indexWanted, setIndex] = useState(initialRoute.index);
  const [unit, setUnit] = useState<Unit>(initialRoute.unit);
  const [q, setQ] = useState(initialRoute.q);
  const [hover, setHover] = useState<Info | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The settings popover on desktop (inflation, year, unit). */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  /** Key of a too-small tile that has been expanded in place, see `readable`. */
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [size, setSize] = useState({ W: 1000, H: 600 });
  const [error, setError] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  // Load the list of years and every budget file (the charts need all years).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/years");
        if (!res.ok) throw new Error(String(res.status));
        const years = (await res.json()) as unknown;
        if (!Array.isArray(years) || !years.every((y) => typeof y === "number")) throw new Error("Bad year list");
        const sorted = [...(years as number[])].sort((a, b) => a - b);
        // Inflation data is optional: without it the toggle simply stays hidden.
        const inflation = await fetch("/api/inflation")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const parsedInflation = InflationSchema.safeParse(inflation);
        const entries = await Promise.all(
          sorted.map(async (y) => {
            const r = await fetch(`/api/budget/${y}`);
            if (!r.ok) throw new Error(String(r.status));
            return [y, BudgetJsonSchema.parse(await r.json())] as const;
          }),
        );
        if (cancelled) return;
        const latest = sorted[sorted.length - 1];
        setYrs(sorted);
        setRates(parsedInflation.success ? parsedInflation.data.rates : {});
        setBudgets(Object.fromEntries(entries));
        // Keep the year from the URL when it exists, otherwise show the latest.
        setYear((y) => (y != null && sorted.includes(y) ? y : (latest ?? null)));
        if (latest == null) setError(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Treemap is laid out in real pixels.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setSize({ W: el.clientWidth || 1000, H: el.clientHeight || 600 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const latest = yrs.length ? yrs[yrs.length - 1]! : null;

  const applyRoute = (r: ReturnType<typeof parseRoute>) => {
    setMode(r.mode);
    setView(r.view);
    setYear(r.year != null && yrs.includes(r.year) ? r.year : latest);
    setUo(r.group != null ? groupKey(r.view, r.group) : null);
    setRest(r.rest);
    setItemKey(null);
    setPendingItem(r.item);
    setReal(r.real);
    setCmp(r.cmp);
    setIndex(r.index);
    setUnit(r.unit);
    setQ(r.q);
    setHover(null);
  };

  // Back/forward: restore the state the URL describes.
  useEffect(() => {
    const onPop = () => applyRoute(parseRoute(new URL(window.location.href)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  // Esc: drop the comparison → unfocus posting → leave Övriga → back to top level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) return setMenuOpen(false);
      if (settingsOpen) return setSettingsOpen(false);
      if (zoomKey != null) return setZoomKey(null);
      if (mode === "about") return showOverview();
      if (mode === "search") return q ? setQ("") : showOverview();
      if (cmp != null) return setCmp(null);
      if (itemKey != null || pendingItem != null) {
        setItemKey(null);
        setPendingItem(null);
      } else if (rest) setRest(false);
      else setUo(null);
      setHover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, settingsOpen, zoomKey, mode, q, cmp, itemKey, pendingItem, rest]);

  // The settings popover closes on a click anywhere outside it.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [settingsOpen]);
  // A zoomed tile belongs to one level; leave it when the level changes.
  useEffect(() => setZoomKey(null), [mode, view, year, uo, rest]);

  // The open menu is a modal sheet: the page behind it neither scrolls nor
  // takes focus, focus starts at the close button and returns to the toggle,
  // and widening the window past the phone layout dismisses it.
  useEffect(() => {
    if (!menuOpen) return;
    document.documentElement.classList.add("menu-open");
    sheetRef.current?.querySelector<HTMLElement>(".sheet-head button")?.focus({ preventScroll: true });
    const desktop = window.matchMedia("(min-width: 721px)");
    const onChange = () => desktop.matches && setMenuOpen(false);
    desktop.addEventListener("change", onChange);
    return () => {
      document.documentElement.classList.remove("menu-open");
      desktop.removeEventListener("change", onChange);
      toggleRef.current?.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  // Swipe the sheet left to close it: it follows the finger, and lets go when
  // dragged far or fast enough. Vertical movement is left to the scroll.
  const swipe = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const sheetTouch = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]!;
      swipe.current = { x: t.clientX, y: t.clientY, t: performance.now(), axis: null };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const sw = swipe.current;
      const el = sheetRef.current;
      if (!sw || !el) return;
      const t = e.touches[0]!;
      const dx = t.clientX - sw.x;
      const dy = t.clientY - sw.y;
      if (sw.axis == null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) sw.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (sw.axis !== "x") return;
      el.style.transition = "none";
      el.style.transform = `translateX(${Math.min(0, dx)}px)`;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const sw = swipe.current;
      const el = sheetRef.current;
      swipe.current = null;
      if (!sw || !el) return;
      el.style.transition = "";
      el.style.transform = "";
      if (sw.axis !== "x") return;
      const dx = e.changedTouches[0]!.clientX - sw.x;
      const speed = -dx / Math.max(1, performance.now() - sw.t);
      if (dx < -el.clientWidth / 3 || (dx < -40 && speed > 0.5)) setMenuOpen(false);
    },
    onTouchCancel: () => {
      swipe.current = null;
      if (sheetRef.current) {
        sheetRef.current.style.transition = "";
        sheetRef.current.style.transform = "";
      }
    },
  };

  // A comparison belongs to the focused posting: leaving it drops the comparison.
  const clearFocus = () => {
    setItemKey(null);
    setPendingItem(null);
    setCmp(null);
  };

  function showOverview() {
    setMode("overview");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  }

  const showAbout = () => {
    setMode("about");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const showSearch = () => {
    setMode("search");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  /** Open the page a search hit points at. */
  const pickHit = (h: SearchHit) => {
    trackEvent("search_pick", { query: q, view: h.view, group: h.gkey, item: h.id ?? "" });
    setMode("explore");
    setView(h.view);
    setUo(h.gkey);
    setRest(h.rest);
    setItemKey(h.key);
    setPendingItem(null);
    setCmp(null);
    setHover(null);
  };

  /** Draw a search hit as the second series in the focus graph. */
  const pickCompare = (h: SearchHit) => {
    trackEvent("compare_pick", { view: h.view, group: h.gkey, item: h.id ?? "" });
    setCmp({ view: h.view, group: h.group, item: h.id });
    setHover(null);
  };

  const toggleIndex = () => {
    trackEvent("toggle_index", { enabled: !indexWanted });
    setIndex(!indexWanted);
    setHover(null);
  };

  const showGraph = (k: View) => {
    if (mode === "explore" && view === k) return;
    setMode("explore");
    setView(k);
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const goRoot = () => {
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const selectYear = (y: number) => {
    setYear(y);
    setHover(null);
  };

  const rev = view === "rev";
  const T = COPY[view];
  const B = year != null ? budgets[year] : undefined;

  // Inflation adjustment: everything is expressed in the prices of the latest
  // year that has a known rate (the newest budget year usually has none yet).
  const baseYear = useMemo(() => chooseBaseYear(rates, yrs), [rates, yrs]);
  const { factors, convertible } = useMemo(() => inflationFactors(rates, yrs, baseYear ?? 0), [rates, yrs, baseYear]);
  const hasInflation = baseYear != null && convertible.length > 1;
  const real = realWanted && hasInflation;
  const prices: Prices = {
    factorOf: (y) => (real ? (factors.get(y) ?? 1) : 1),
    nominal: (y) => real && factors.get(y) == null,
    priceNote: real && baseYear != null ? ` · i ${baseYear} års priser` : "",
    nominalNote: "* nominellt, inflationsdata saknas",
  };
  const { factorOf, nominal, priceNote, nominalNote } = prices;
  const f = year != null ? factorOf(year) : 1;

  // Graph unit: kronor, or percent of the year's total revenues or expenses.
  // Amounts arrive price-adjusted, so the total is adjusted the same way.
  const display: Display = {
    unit,
    toUnit: (v, y) => {
      if (unit === "kr") return v;
      const b = budgets[y];
      const total = (unit === "rev" ? (b?.revenuesTotal ?? 0) : (b?.expensesTotal ?? 0)) * factorOf(y);
      return total ? (v / total) * 100 : 0;
    },
    fmt: unit === "kr" ? FMT_KR : FMT_PCT,
    unitNote: UNITS.find((u) => u.k === unit)?.note ?? "",
  };

  const all = useMemo(() => (B ? normalize(B, view, f) : []), [B, view, f]);
  const total = B ? (rev ? B.revenuesTotal : B.expensesTotal) * f : 0;
  const groups = all.filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const hueOf = Object.fromEntries(all.map((g, i) => [g.key, ((i * 360) / all.length + (rev ? 30 : 250)) % 360])) as Record<string, number>;
  const group = uo != null ? (all.find((g) => g.key === uo) ?? null) : null;
  const gross = groups.reduce((s, g) => s + g.total, 0) || 1;
  const negs = all.filter((g) => g.total < 0);
  const negNote = negs.length
    ? ` · brutto ${fmd(gross)}, minus ${negs.map((g) => `${g.title.toLowerCase()} ${fmd(-g.total)}`).join(", ")}`
    : "";

  // A group from the URL that doesn't exist in this year's data: drop it.
  useEffect(() => {
    if (uo != null && B && !group) {
      setUo(null);
      setRest(false);
      clearFocus();
    }
  }, [uo, B, group]);

  // Resolve a focused posting from its URL id once the group is known.
  useEffect(() => {
    if (pendingItem == null || !group) return;
    const row = group.rows.find((r) => r.id === pendingItem);
    setItemKey(row?.key ?? null);
    setPendingItem(null);
  }, [pendingItem, group]);

  const focusedRow = itemKey != null && group ? (group.rows.find((r) => r.key === itemKey) ?? null) : null;
  const itemId = focusedRow?.id ?? pendingItem;

  // The comparison target, looked up in this year's data (rows are matched
  // across years by key, so the URL's row id is resolved here).
  const compareTarget = useMemo<CompareTarget | null>(() => {
    if (!cmp || !B) return null;
    const g = normalize(B, cmp.view).find((x) => x.key === groupKey(cmp.view, cmp.group));
    if (!g) return null;
    if (cmp.item == null) return { view: cmp.view, gkey: g.key, row: null, title: g.title, kicker: `${g.code} · ${COPY[cmp.view].kind}` };
    const r = g.rows.find((x) => x.id === cmp.item);
    return r ? { view: cmp.view, gkey: g.key, row: r.key, title: r.title, kicker: `${g.code} · ${g.title}` } : null;
  }, [cmp, B]);
  // A target from the URL that doesn't exist in this year's data: drop it.
  useEffect(() => {
    if (cmp && B && !compareTarget) setCmp(null);
  }, [cmp, B, compareTarget]);
  // The index view belongs to a comparison, as in the URL.
  useEffect(() => {
    if (cmp == null) setIndex(false);
  }, [cmp]);

  // Keep the URL and the document title in step with what is on screen.
  const pageTitle =
    mode === "about"
      ? "Om sajten"
      : mode === "search"
      ? q ? `Sök: ${q}` : "Sök"
      : mode === "overview"
      ? "Inkomster och utgifter"
      : year == null
        ? T.label
        : `${focusedRow ? `${focusedRow.title} · ` : ""}${compareTarget ? `jämfört med ${compareTarget.title} · ` : ""}${group ? `${group.title}${rest ? " · Övriga" : ""}` : T.root} · ${T.label} ${year}`;
  const synced = useRef<string | null>(null);
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (year == null) return;
    const url = buildUrl(
      { mode, view, year, group: group ? groupNumber(group.key) : null, rest, item: group ? itemId : null, real, unit, cmp: group ? cmp : null, index: indexWanted, q },
      latest,
    );
    const current = window.location.pathname + window.location.search;
    if (url !== current) {
      // The first sync only normalises the URL we were opened with, and typing
      // in the search box rewrites the entry instead of piling up history.
      const typing = mode === "search" && synced.current?.startsWith("/sok");
      if (synced.current === null || typing) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    }
    document.title = `${pageTitle} – Statsbudgeten`;
    // One page view per page, not per keystroke.
    const page = url.replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, "");
    if (tracked.current !== page) trackPageView(page, mode === "search" ? "Sök" : pageTitle);
    tracked.current = page;
    synced.current = url;
  }, [mode, view, year, group, rest, itemId, real, unit, cmp, indexWanted, q, latest, pageTitle]);

  // Items at the current drill level.
  let items: Item[] = [];
  let parentTotal = total;
  if (B && !group) {
    items = groups.map((g, i) => ({
      key: g.key,
      id: null,
      code: g.code,
      label: g.title,
      v: g.total,
      hue: hueOf[g.key]!,
      lv: i % 3,
      rank: i / groups.length,
      drill: true,
      onClick: () => {
        setUo(g.key);
        setRest(false);
        clearFocus();
        setHover(null);
      },
    }));
  } else if (B && group) {
    const rows = group.rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
    const sum = rows.reduce((s, r) => s + r.v, 0) || 1;
    const big = rows.filter((r) => r.v / sum >= TAIL_CUT);
    const tail = rows.filter((r) => r.v / sum < TAIL_CUT);
    const useTail = tail.length > 1 && !rest;
    const list = rest ? tail : useTail ? big : rows;
    parentTotal = group.total;
    const hue = hueOf[group.key]!;
    items = list.map((r, i) => ({
      key: r.key,
      id: r.id,
      code: `${T.item} ${r.id ?? ""}`,
      label: r.title,
      v: r.v,
      hue,
      rank: i / Math.max(1, list.length),
      onClick: () => {
        setItemKey((k) => (k === r.key ? null : r.key));
        setPendingItem(null);
        setCmp(null);
        setHover(null);
      },
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
        onClick: () => {
          setRest(true);
          clearFocus();
          setHover(null);
        },
      });
    }
  }

  const { W, H } = size;
  const sumItems = items.reduce((s, it) => s + it.v, 0) || 1;
  const rects = squarify(items.map((it) => ({ it, a: (it.v / sumItems) * W * H })), W, H);
  const multiYear = yrs.length > 1;

  // The focus panel takes the group colour, or the focused posting's tile colour.
  const focusItem = focusedRow ? items.find((it) => it.key === focusedRow.key) : undefined;
  const panelColor = focusItem
    ? colorOf(focusItem, true)
    : { bg: group ? (COLOR_MODE === "färg" ? `oklch(0.80 0.09 ${hueOf[group.key]})` : "oklch(0.86 0.01 260)") : PAPER, fg: INK };

  const saldoShown = B && year != null ? display.toUnit(B.revenuesTotal * f, year) - display.toUnit(B.expensesTotal * f, year) : 0;
  const base: Info = mode === "about"
    ? { title: "Om Statsbudgeten", hint: "Esc eller Översikt för att gå tillbaka" }
    : mode === "search"
    ? { title: `Sök i budgeten ${year ?? ""}`, hint: q ? "Pil upp/ner och Enter väljer · Esc rensar" : "Skriv för att söka" }
    : !B
    ? { title: error ? "Kunde inte läsa data" : "Läser in …" }
    : mode === "overview"
      ? {
          title: `Statens budget ${year}${year != null && nominal(year) ? "*" : ""}`,
          value: `Saldo ${sign(saldoShown)}${display.fmt.short(Math.abs(saldoShown))}`,
          share: `Utgifter ${fmd(B.expensesTotal * f)} · Inkomster ${fmd(B.revenuesTotal * f)}${priceNote}`,
          hint: year != null && nominal(year) ? nominalNote : "Hovra över ett år för exakta siffror",
        }
      : group
        ? {
            title: rest ? T.rest : group.title,
            value: fmd(rest ? sumItems : group.total),
            share: `${fpct(((rest ? sumItems : group.total) / gross) * 100)} av ${T.all} ${year} · ${items.length} block${priceNote}`,
            hint: year != null && nominal(year) ? nominalNote : focusedRow ? "Esc för att avmarkera" : "Klicka på ett block för att se dess historik",
          }
        : {
            title: `${T.heading} ${year}`,
            value: fmd(total),
            share: `${groups.length} ${T.areas}${negNote}${priceNote}`,
            hint: year != null && nominal(year) ? nominalNote : "Klicka på ett block",
          };
  const info = hover ?? base;
  const overview = mode === "overview";
  const about = mode === "about";
  const searching = mode === "search";

  return (
    <div className="app" lang="sv">
      <div className={`menu${menuOpen ? " open" : ""}`}>
        <span className="brand">
          <Logo size={20} />
          <span>Statsbudgeten</span>
        </span>
        <button
          ref={toggleRef}
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="menu-items"
          aria-label={menuOpen ? "Stäng menyn" : "Öppna menyn"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {year != null && (
            <span className="now">
              {year}
              {nominal(year) ? "*" : ""}
            </span>
          )}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <div
          ref={sheetRef}
          className="menu-items"
          id="menu-items"
          role={menuOpen ? "dialog" : undefined}
          aria-modal={menuOpen || undefined}
          aria-label="Meny"
          onClick={(e) => {
            // On mobile the menu slides in over the page: any choice closes it.
            if ((e.target as HTMLElement).closest("button")) setMenuOpen(false);
          }}
          {...sheetTouch}
        >
          <div className="sheet-head">
            <span className="brand">
              <Logo size={20} />
              <span>Statsbudgeten</span>
            </span>
            <button type="button" className="icon-btn" aria-label="Stäng menyn" onClick={() => setMenuOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <nav className="tabs" aria-label="Vy">
          <button type="button" className={`tab${overview ? " active" : ""}`} aria-current={overview ? "page" : undefined} onClick={showOverview}>
            <span>Översikt</span>
          </button>
          {(
            [
              ["exp", "var(--expense)", B ? B.expensesTotal * f : undefined],
              ["rev", "var(--revenue)", B ? B.revenuesTotal * f : undefined],
            ] as const
          ).map(([k, dot, tot]) => {
            const active = !overview && !about && !searching && view === k;
            return (
              <button key={k} type="button" className={`tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => showGraph(k)}>
                <span className="dot" style={{ background: dot }} />
                <span>{COPY[k].label}</span>
                <span className="total">{tot != null ? fmd(tot) : ""}</span>
              </button>
            );
          })}
          <button type="button" className={`tab${searching ? " active" : ""}`} aria-current={searching ? "page" : undefined} onClick={showSearch}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <span>Sök</span>
          </button>
          <button type="button" className={`tab${about ? " active" : ""}`} aria-current={about ? "page" : undefined} onClick={showAbout}>
            <span>Om</span>
          </button>
          </nav>
          <div className={`settings${settingsOpen ? " open" : ""}`} ref={settingsRef}>
            <button
              type="button"
              className="settings-toggle"
              aria-expanded={settingsOpen}
              aria-controls="settings"
              aria-label="Inställningar"
              title="Inställningar"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              {year != null && (
                <span className="now">
                  {year}
                  {nominal(year) ? "*" : ""}, i {UNITS.find((u) => u.k === unit)?.label}
                </span>
              )}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
            <div className="popover" id="settings" role="group" aria-label="Inställningar">
              {hasInflation && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={real}
                  className={`switch${real ? " on" : ""}`}
                  title={`Räkna om alla belopp till ${baseYear} års prisnivå (KPI)`}
                  onClick={() => {
                    trackEvent("toggle_inflation", { enabled: !real, base_year: baseYear ?? "" });
                    setReal(!real);
                    setHover(null);
                  }}
                >
                  <span className="knob" aria-hidden />
                  <span>Justera för inflation</span>
                </button>
              )}
              <div className="pickers">
                <div className="year-picker">
                  <span className="label" id="year-label">
                    Budgetår
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby="year-label">
                    {yrs.map((y) => (
                      <button
                        key={y}
                        type="button"
                        role="radio"
                        aria-checked={y === year}
                        className={y === year ? "active" : ""}
                        title={nominal(y) ? "Nominellt belopp, inflationsdata saknas" : undefined}
                        onClick={() => selectYear(y)}
                      >
                        {y}
                        {nominal(y) ? "*" : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="year-picker unit-picker">
                  <span className="label" id="unit-label">
                    Visa
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby="unit-label">
                    {UNITS.map((u) => (
                      <button
                        key={u.k}
                        type="button"
                        role="radio"
                        aria-checked={u.k === unit}
                        className={u.k === unit ? "active" : ""}
                        title={u.k === "kr" ? "Belopp i kronor" : `Grafer i procent av årets ${u.k === "rev" ? "inkomster" : "utgifter"}`}
                        onClick={() => {
                          if (u.k === unit) return;
                          trackEvent("toggle_unit", { unit: u.k });
                          setUnit(u.k);
                          setHover(null);
                        }}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <header className="crumb-row" inert={menuOpen || undefined}>
        <nav className="crumbs" aria-label="Brödsmulor">
          {about ? (
            <span className="crumb">
              <button type="button" className="current" disabled>
                Om sajten
              </button>
            </span>
          ) : searching ? (
            <span className="crumb">
              <button type="button" className="current" disabled>
                Sök
              </button>
            </span>
          ) : overview ? (
            <span className="crumb">
              <button type="button" className="current" disabled>
                Inkomster och utgifter
              </button>
            </span>
          ) : (
            <>
              <span className="crumb">
                <button type="button" className={group ? "" : "current"} onClick={goRoot} disabled={!group}>
                  {T.root}
                </button>
                {group && <span className="sep">/</span>}
              </span>
              {group && (
                <span className="crumb">
                  <button
                    type="button"
                    className={rest || focusedRow ? "" : "current"}
                    disabled={!rest && !focusedRow}
                    onClick={() => {
                      setRest(false);
                      clearFocus();
                      setHover(null);
                    }}
                  >
                    {group.title}
                  </button>
                  {(rest || focusedRow) && <span className="sep">/</span>}
                </span>
              )}
              {group && rest && (
                <span className="crumb">
                  <button
                    type="button"
                    className={focusedRow ? "" : "current"}
                    disabled={!focusedRow}
                    onClick={() => {
                      clearFocus();
                      setHover(null);
                    }}
                  >
                    Övriga
                  </button>
                  {focusedRow && <span className="sep">/</span>}
                </span>
              )}
              {group && focusedRow && (
                <span className="crumb">
                  <button type="button" className="current" disabled>
                    {focusedRow.title}
                  </button>
                </span>
              )}
            </>
          )}
        </nav>
      </header>

      <div className="stage" inert={menuOpen || undefined}>
        {about && <About />}
        {searching && <Search budget={B} year={year} q={q} onChange={setQ} onPick={pickHit} />}

        {overview && B && year != null && (
          <Overview years={yrs} budgets={budgets} year={year} {...prices} {...display} />
        )}

        {!overview && !about && !searching && group && year != null && multiYear && (
          <FocusPanel
            years={yrs}
            budgets={budgets}
            year={year}
            view={view}
            gkey={group.key}
            row={focusedRow?.key ?? null}
            kicker={focusedRow ? `${group.code} · ${group.title}` : `${group.code} · ${T.kind}`}
            title={focusedRow ? focusedRow.title : group.title}
            bg={panelColor.bg}
            fg={panelColor.fg}
            budget={B}
            compare={compareTarget}
            index={indexWanted}
            onCompare={pickCompare}
            onClearCompare={() => setCmp(null)}
            onToggleIndex={toggleIndex}
            {...prices}
            {...display}
          />
        )}

        {!overview && !about && !searching && (
          <div className="map" ref={mapRef} onClick={() => setZoomKey(null)}>
            {rects.map(({ it, x: x0, y: y0, w: w0, h: h0 }) => {
              const { bg, fg } = colorOf(it, !!group);
              const zoomed = zoomKey === it.key;
              // Expand a zoomed tile to a readable size, kept inside the map.
              let [x, y, w, h] = [x0, y0, w0, h0];
              if (zoomed) {
                w = Math.min(W, Math.max(w0, 230));
                h = Math.min(H, Math.max(h0, 150));
                x = Math.max(0, Math.min(W - w, x0 - (w - w0) / 2));
                y = Math.max(0, Math.min(H - h, y0 - (h - h0) / 2));
              }
              const shareOfParent = (it.v / parentTotal) * 100;
              const shareOfAll = (it.v / gross) * 100;
              const tileInfo: Info = {
                title: `${it.code ? `${it.code} · ` : ""}${it.label}`,
                value: fmd(it.v),
                share: group
                  ? `${fpct(shareOfParent)} av ${group.title.toLowerCase()} · ${fpct(shareOfAll)} av ${T.all}`
                  : `${fpct(shareOfAll)} av ${T.all}`,
                hint: zoomed
                  ? it.drill
                    ? "Klicka igen för att utforska"
                    : "Klicka igen för att visa historik"
                  : it.drill
                    ? "Klicka för att utforska"
                    : "Klicka för att visa historik",
              };
              const act = it.onClick ?? (() => setHover(tileInfo));
              const activate = () => {
                if (!zoomed && !readable(w0, h0)) {
                  // Too small to read: show it first, act on the next click.
                  setZoomKey(it.key);
                  setHover({ ...tileInfo, hint: it.drill ? "Klicka igen för att utforska" : "Klicka igen för att visa historik" });
                  return;
                }
                setZoomKey(null);
                act();
              };
              return (
                <Tile
                  key={it.key}
                  it={it}
                  rect={{
                    left: `${(x / W) * 100}%`,
                    top: `${(y / H) * 100}%`,
                    width: `${(w / W) * 100}%`,
                    height: `${(h / H) * 100}%`,
                  }}
                  w={w}
                  h={h}
                  bg={bg}
                  fg={fg}
                  share={fpct(group ? shareOfParent : shareOfAll)}
                  info={tileInfo}
                  hovered={hover?.title === tileInfo.title}
                  focused={!!focusedRow && it.key === focusedRow.key}
                  zoomed={zoomed}
                  onHover={setHover}
                  onActivate={activate}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="info" aria-live="polite" inert={menuOpen || undefined}>
        <span className="title">{info.title}</span>
        <span className="value">{info.value}</span>
        <span className="share">{info.share}</span>
        <span className="hint">{info.hint}</span>
      </footer>
    </div>
  );
}

installIcons();
initAnalytics();
createRoot(document.getElementById("root")!).render(<App />);
