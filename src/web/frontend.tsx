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
import { ChangelogSchema, type Changelog, type ChangelogCommit } from "../../types/ChangelogSchema";
import { InflationSchema } from "../../types/InflationSchema";
import { chooseBaseYear, inflationFactors } from "../inflation";
import { initAnalytics, trackEvent, trackPageView } from "./analytics";
import { aboutContent } from "./content.macro" with { type: "macro" };
import type { Block, Inline } from "../markdown";
import { buildIndex, search as runSearch, type SearchHit } from "../search";
import { buildUrl, groupKey, groupNumber, parseRoute, type Mode, type Scale, type Unit, type View } from "./routes";
import { FORMATS, FORMAT_KEYS, socialImagePath, type Format } from "./share";
import {
  COPY,
  INK,
  PAPER,
  NF0,
  NF1,
  SCALES,
  UNITS,
  changeOver,
  colorOf,
  displayFor,
  fmd,
  fpct,
  groupPanelColor,
  historyPoints,
  hueOf,
  levelItems,
  niceScale,
  normalize,
  placeItems,
  pricesFor,
  sign,
  signed,
  X,
  type Display,
  type Fmt,
  type Item,
  type Point,
  type Prices,
  type Series,
} from "./model";
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

/** The map never gets shorter than this, and leaves this much room under itself for the list of small items. */
const MAP_MIN = 140;
const LIST_PEEK = 120;

// ---- Line chart (overview and group/item history) ------------------------------

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
  /** Whether the y-axis starts at zero or hugs the data. */
  scale: Scale;
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
function LineChart({ series, years, year, nominal, scale, paper, extra, fmt }: LineChartProps) {
  const open = useRevealed();
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const [pinnedYear, setPinnedYear] = useState<number | null>(null);
  const n = years.length;
  const { Y, grid, step, base } = niceScale(series.flatMap((s) => s.points.map((p) => p.v)), fmt.minPad, scale);
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
                  {s.color && <span className="swatch" style={{ background: s.color }} />}
                  {s.label}
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
        <div key={g.top} className={`gridline${g.zero ? " zero" : ""}`} style={{ top: g.top }}>
          <span>{fmt.grid(g.v, step)}</span>
        </div>
      ))}
      {series.length > 1 && <div className="band" style={{ left: `${X(selIndex, n)}%` }} />}
      <div className="reveal" style={{ clipPath: `inset(0 ${open ? "0%" : "100%"} 0 0)`, transitionDelay: open ? ".2s" : "0s" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {series.map((s) => (
            <React.Fragment key={s.key}>
              <polygon points={`${X(0, n)},${base.toFixed(2)} ${pts(s)} ${X(n - 1, n)},${base.toFixed(2)}`} fill={s.color ?? "currentColor"} style={{ opacity: s.color ? 0.08 : 0.1 }} />
              <polyline points={pts(s)} fill="none" stroke={s.color ?? "currentColor"} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </React.Fragment>
          ))}
        </svg>
      </div>
      {series.map((s) =>
        s.points.map((p, i) => {
          const selected = p.y === year;
          const active = p.y === shown;
          return (
            <button
              key={`${s.key}-${p.y}`}
              type="button"
              className={`dot${below(s, i) ? " below" : ""}${active ? " active" : ""}${selected ? " selected" : ""}`}
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

type OverviewProps = Prices & Display & {
  years: number[];
  budgets: Record<number, BudgetJson>;
  year: number;
  scale: Scale;
};

const SIDES = [
  { k: "exp", label: "Utgifter", color: "var(--expense)" },
  { k: "rev", label: "Inkomster", color: "var(--revenue)" },
] as const;

function Overview({ years, budgets, year, scale, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: OverviewProps) {
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
          scale={scale}
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
  scale: Scale;
  view: View;
  gkey: string;
  /** Row key of the focused posting, or null for the whole group. */
  row: string | null;
  kicker: string;
  title: string;
  bg: string;
  fg: string;
};

function FocusPanel({ years, budgets, year, scale, view, gkey, row, kicker, title, bg, fg, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: FocusProps) {
  // A share is the same at any price level, so the price notes only apply in kronor.
  const nominal = unit === "kr" ? nominalKr : () => false;
  const priceNote = unit === "kr" ? priceNoteKr : "";
  const points = historyPoints(years, budgets, view, gkey, row, factorOf, toUnit);
  const { first, last, pct } = changeOver(points, nominal);
  const dark = fg !== INK;
  // In kronor the headline is the relative change with the amount below; in
  // percent it is the change in percentage points, with the two shares below.
  const d = last.v - first.v;
  const delta =
    unit === "kr"
      ? { big: `${sign(pct)}${NF1.format(Math.abs(pct))} %`, small: signed(d) }
      : { big: `${sign(d)}${NF1.format(Math.abs(d))}`, small: `procentenheter · ${fmt.short(first.v)} → ${fmt.short(last.v)}` };

  return (
    <div className="panel focus" style={{ background: bg, color: fg, ["--grid-color" as string]: dark ? "rgba(255,255,255,0.22)" : "rgba(11,11,11,0.12)" }}>
      <div className="content">
        <div className="top">
          <div className="heading">
            <span className="kicker">
              {kicker}
              {unitNote}
              {priceNote}
              {years.some(nominal) ? ` · ${nominalNote}` : ""}
            </span>
            <span className="name" lang="sv">
              {title}
            </span>
          </div>
          <div className="delta">
            <span className="kicker">
              {first.y}–{last.y}
            </span>
            <span className="pct">{delta.big}</span>
            <span className="abs">{delta.small}</span>
          </div>
        </div>
        <LineChart
          key={`${gkey}/${row ?? ""}`}
          series={[{ key: "v", label: title, points }]}
          years={years}
          year={year}
          nominal={nominal}
          scale={scale}
          paper={bg}
          fmt={fmt}
        />
      </div>
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
  onHover: (info: Info | null) => void;
  onActivate: () => void;
};

function Tile({ it, rect, w, h, bg, fg, share, info, hovered, focused, onHover, onActivate }: TileProps) {
  const minD = Math.min(w, h);
  const area = w * h;
  const showValue = w > 70 && h > 130;
  const shareSize = Math.round(Math.max(18, Math.min(64, Math.sqrt(area) / 5.2)));
  const titleSize = minD > 220 ? 18 : minD > 130 ? 15 : w < 130 ? 12 : 13;
  const clamp = h > 170 ? 3 : h > 80 ? 2 : 1;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${info.title}, ${info.value}`}
      aria-pressed={focused || undefined}
      className={`tile${hovered ? " hovered" : ""}${focused ? " focused" : ""}`}
      style={{
        ...rect,
        background: bg,
        color: fg,
        padding: minD > 160 ? "14px 16px" : "8px 10px",
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
      <span className="head">
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
          if (b.t === "video")
            return (
              <div key={i} className="video">
                <iframe
                  src={`https://www.youtube.com/embed/${b.id}`}
                  title={b.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
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

// ---- Updates page --------------------------------------------------------------

/** Dates like "25 oktober 2026". */
const DAY = new Intl.DateTimeFormat("sv-SE", { dateStyle: "long" });

/**
 * The Uppdateringar page: the deployed version's commit history, from the
 * committed data/changelog.json (src/changelog.ts), grouped by day. Subjects
 * link to the commit on GitHub when the repository URL is known.
 */
function Updates() {
  const [log, setLog] = useState<Changelog | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/changelog")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const parsed = ChangelogSchema.safeParse(j);
        setLog(parsed.success ? parsed.data : null);
      })
      .catch(() => !cancelled && setLog(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    const byDay = new Map<string, ChangelogCommit[]>();
    for (const c of log?.commits ?? []) {
      if (!byDay.has(c.date)) byDay.set(c.date, []);
      byDay.get(c.date)!.push(c);
    }
    return [...byDay.entries()];
  }, [log]);

  return (
    <div className="panel about updates">
      <article className="prose" lang="sv">
        <h1>Uppdateringar</h1>
        <p>
          Vad som ändrats på statsbudgeten.se, ur versionshistoriken för den version av sajten som är i drift.
          {log?.repo && (
            <>
              {" "}
              Hela historiken finns på{" "}
              <a href={log.repo} target="_blank" rel="noopener">
                GitHub
              </a>
              .
            </>
          )}
        </p>
        {log === undefined && <p className="muted">Hämtar ändringar …</p>}
        {log === null && <p className="muted">Kunde inte läsa ändringshistoriken.</p>}
        {log?.commits.length === 0 && <p className="muted">Inga ändringar att visa.</p>}
        {days.map(([date, commits]) => (
          <section key={date}>
            <h2>
              <time dateTime={date}>{DAY.format(new Date(date))}</time>
            </h2>
            <ul className="commits">
              {commits.map((c) => (
                <li key={c.hash}>
                  {log?.repo ? (
                    <a href={`${log.repo}/commit/${c.hash}`} target="_blank" rel="noopener">
                      {c.subject}
                    </a>
                  ) : (
                    c.subject
                  )}
                  <span className="muted"> · {c.author}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
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

// ---- Share dialog ---------------------------------------------------------------

type ShareProps = {
  open: boolean;
  onClose: () => void;
  /** The page's title, for the share sheet and the file name. */
  title: string;
};

/**
 * Share the chart on screen: pick a format, see the image the server draws
 * for this URL, and share it through the system share sheet where there is
 * one (phones), or download it. The page link can always be copied.
 */
function Share({ open, onClose, title }: ShareProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<Format>("square");
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pageUrl = window.location.href;
  const imagePath = socialImagePath(new URL(pageUrl), format);
  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] });

  // A native dialog: modal, with Esc and a focus trap for free.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setNote(null);
    } else if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => setLoaded(false), [format, imagePath]);

  const fileName = `statsbudgeten-${title.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "")}-${format}.png`;

  const shareImage = async () => {
    if (!imagePath) return;
    setBusy(true);
    try {
      const blob = await (await fetch(imagePath)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const withLink = { files: [file], title, text: `${title} – Statsbudgeten`, url: pageUrl };
      // Some browsers refuse a link next to files; then the text carries it.
      const data = navigator.canShare?.(withLink) ? withLink : { files: [file], title, text: `${title} – ${pageUrl}` };
      await navigator.share(data);
      trackEvent("share", { method: "share_sheet", format });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Kunde inte dela, ladda ner bilden i stället.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setNote("Länken är kopierad.");
      trackEvent("share", { method: "copy_link", format });
    } catch {
      setNote(pageUrl);
    }
  };

  const spec = FORMATS[format];
  return (
    <dialog
      ref={ref}
      className="share"
      aria-label="Dela"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="share-head">
        <span className="share-title">Dela</span>
        <span className="share-page">{title}</span>
        <button type="button" className="icon-btn" aria-label="Stäng" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="seg share-formats" role="radiogroup" aria-label="Format">
        {FORMAT_KEYS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === format} className={k === format ? "active" : ""} onClick={() => setFormat(k)}>
            {FORMATS[k].label}
            <span className="ratio">{FORMATS[k].ratio}</span>
          </button>
        ))}
      </div>
      <div className={`share-preview${loaded ? " loaded" : ""}`} style={{ aspectRatio: `${spec.w} / ${spec.h}` }}>
        {open && imagePath && <img src={imagePath} alt={`${title}, ${spec.label} ${spec.ratio}`} width={spec.w} height={spec.h} onLoad={() => setLoaded(true)} />}
      </div>
      <div className="share-actions">
        {canShareFiles && (
          <button type="button" className="primary" disabled={busy || !loaded} onClick={shareImage}>
            Dela bild
          </button>
        )}
        <a className={canShareFiles ? "" : "primary"} href={imagePath ?? "#"} download={fileName} onClick={() => trackEvent("share", { method: "download", format })}>
          Ladda ner
        </a>
        <button type="button" onClick={copyLink}>
          Kopiera länk
        </button>
      </div>
      <div className="share-note" role="status">
        {note ?? `${spec.w} × ${spec.h} px`}
      </div>
    </dialog>
  );
}

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
  const [unit, setUnit] = useState<Unit>(initialRoute.unit);
  const [scale, setScale] = useState<Scale>(initialRoute.scale);
  const [q, setQ] = useState(initialRoute.q);
  const [hover, setHover] = useState<Info | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /** The settings popover on desktop (inflation, year, unit, y-axis). */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  /** The stage's width and the height left for the map under the history panel. */
  const [size, setSize] = useState({ W: 1000, H: 600 });
  const [error, setError] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

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
    setUnit(r.unit);
    setScale(r.scale);
    setQ(r.q);
    setHover(null);
  };

  // Back/forward: restore the state the URL describes.
  useEffect(() => {
    const onPop = () => applyRoute(parseRoute(new URL(window.location.href)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  // Esc: unfocus posting → leave Övriga → back to top level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) return setMenuOpen(false);
      if (shareOpen) return; // the dialog closes itself
      if (settingsOpen) return setSettingsOpen(false);
      if (mode === "about" || mode === "updates") return showOverview();
      if (mode === "search") return q ? setQ("") : showOverview();
      if (itemKey != null || pendingItem != null) {
        setItemKey(null);
        setPendingItem(null);
      } else if (rest) setRest(false);
      else setUo(null);
      setHover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, shareOpen, settingsOpen, mode, q, itemKey, pendingItem, rest]);

  // The settings popover closes on a click anywhere outside it.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [settingsOpen]);

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

  const clearFocus = () => {
    setItemKey(null);
    setPendingItem(null);
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

  const showUpdates = () => {
    setMode("updates");
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
  const prices = pricesFor(real, baseYear, factors);
  const { factorOf, nominal, priceNote, nominalNote } = prices;
  const f = year != null ? factorOf(year) : 1;

  // Graph unit: kronor, or percent of the year's total revenues or expenses.
  const display = displayFor(unit, budgets, factorOf);

  const all = useMemo(() => (B ? normalize(B, view, f) : []), [B, view, f]);
  const total = B ? (rev ? B.revenuesTotal : B.expensesTotal) * f : 0;
  const groups = all.filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const hues = hueOf(all, view);
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

  // Keep the URL and the document title in step with what is on screen.
  const pageTitle =
    mode === "about"
      ? "Om sajten"
      : mode === "updates"
      ? "Uppdateringar"
      : mode === "search"
      ? q ? `Sök: ${q}` : "Sök"
      : mode === "overview"
      ? "Inkomster och utgifter"
      : year == null
        ? T.label
        : `${focusedRow ? `${focusedRow.title} · ` : ""}${group ? `${group.title}${rest ? " · Övriga" : ""}` : T.root} · ${T.label} ${year}`;
  const synced = useRef<string | null>(null);
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (year == null) return;
    const url = buildUrl({ mode, view, year, group: group ? groupNumber(group.key) : null, rest, item: group ? itemId : null, real, unit, scale, q }, latest);
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
  }, [mode, view, year, group, rest, itemId, real, unit, scale, q, latest, pageTitle]);

  // Items at the current drill level, with what a click on each does.
  const level = B ? levelItems(all, view, group, rest) : { items: [], parentTotal: total };
  const parentTotal = level.parentTotal;
  const items: Item[] = level.items;
  const clickOn = (it: Item) => () => {
    if (!group) {
      setUo(it.key);
      setRest(false);
    } else if (it.rest) {
      setRest(true);
    } else {
      setItemKey((k) => (k === it.key ? null : it.key));
      setPendingItem(null);
      setHover(null);
      return;
    }
    clearFocus();
    setHover(null);
  };

  const { W, H } = size;
  const sumItems = items.reduce((s, it) => s + it.v, 0) || 1;
  // Tiles too small for their label are listed under the map instead. The
  // layout always leaves room for the first rows of that list, so whether
  // the list shows up cannot change the layout; when nothing is listed the
  // map simply takes the room back. The stage scrolls for the rest of it.
  const mapRoom = Math.max(MAP_MIN, H - LIST_PEEK);
  const { placed, listed } = placeItems(items, W, mapRoom);
  const mapH = listed.length ? mapRoom : Math.max(MAP_MIN, H);
  const infoOf = (it: Item): { info: Info; share: string } => {
    // Against the magnitude, so deductions read as negative shares even in a
    // group whose own total is negative.
    const shareOfParent = (it.v / Math.abs(parentTotal)) * 100;
    const shareOfAll = (it.v / gross) * 100;
    return {
      share: fpct(group ? shareOfParent : shareOfAll),
      info: {
        title: `${it.code ? `${it.code} · ` : ""}${it.label}`,
        value: fmd(it.v),
        share: group
          ? `${fpct(shareOfParent)} av ${group.title.toLowerCase()} · ${fpct(shareOfAll)} av ${T.all}`
          : `${fpct(shareOfAll)} av ${T.all}`,
        hint: it.drill ? "Klicka för att utforska" : "Klicka för att visa historik",
      },
    };
  };
  const multiYear = yrs.length > 1;
  const hasPanel = !!group && year != null && multiYear;

  // The treemap is laid out in real pixels. Its room is measured from the
  // stage and the history panel, never from the map itself: the list under
  // the map takes space from it, so measuring the map would feed back into
  // which items are listed and the two would keep resizing each other.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || mode !== "explore") return;
    const measure = () => {
      const panel = el.querySelector<HTMLElement>(".panel.focus");
      const gap = parseFloat(getComputedStyle(el).gap) || 0;
      const used = panel ? panel.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + gap : 0;
      const credit = el.querySelector<HTMLElement>(".credit");
      const foot = credit ? credit.getBoundingClientRect().height + gap : 0;
      setSize({ W: el.clientWidth || 1000, H: Math.max(0, el.clientHeight - used - foot) || 600 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const panel = el.querySelector(".panel.focus");
    if (panel) ro.observe(panel);
    return () => ro.disconnect();
  }, [mode, hasPanel]);

  // The focus panel takes the group colour, or the focused posting's tile colour.
  const focusItem = focusedRow ? items.find((it) => it.key === focusedRow.key) : undefined;
  const panelColor = focusItem
    ? colorOf(focusItem, true)
    : { bg: group ? groupPanelColor(hues[group.key]!) : PAPER, fg: INK };

  const saldoShown = B && year != null ? display.toUnit(B.revenuesTotal * f, year) - display.toUnit(B.expensesTotal * f, year) : 0;
  const base: Info = mode === "about"
    ? { title: "Om Statsbudgeten", hint: "Esc eller Översikt för att gå tillbaka" }
    : mode === "updates"
    ? { title: "Uppdateringar", hint: "Esc eller Översikt för att gå tillbaka" }
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
            share: `${fpct(((rest ? sumItems : group.total) / gross) * 100)} av ${T.all} ${year} · ${
              placed.length ? `${placed.length} block${listed.length ? ` och ${listed.length} rader` : ""}` : `${listed.length} rader`
            }${priceNote}`,
            hint: year != null && nominal(year) ? nominalNote : focusedRow ? "Esc för att avmarkera" : "Klicka på ett block för att se dess historik",
          }
        : {
            title: `${T.heading} ${year}`,
            value: fmd(total),
            share: `${all.filter((g) => g.total !== 0).length} ${T.areas}${negNote}${priceNote}`,
            hint: year != null && nominal(year) ? nominalNote : "Klicka på ett block",
          };
  const info = hover ?? base;
  const overview = mode === "overview";
  const about = mode === "about";
  const updates = mode === "updates";
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
            const active = !overview && !about && !updates && !searching && view === k;
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
                <div className="year-picker scale-picker">
                  <span className="label" id="scale-label">
                    Y-axel
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby="scale-label">
                    {SCALES.map((sc) => (
                      <button
                        key={sc.k}
                        type="button"
                        role="radio"
                        aria-checked={sc.k === scale}
                        className={sc.k === scale ? "active" : ""}
                        title={sc.title}
                        onClick={() => {
                          if (sc.k === scale) return;
                          trackEvent("toggle_scale", { scale: sc.k });
                          setScale(sc.k);
                        }}
                      >
                        {sc.label}
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
          ) : updates ? (
            <span className="crumb">
              <button type="button" className="current" disabled>
                Uppdateringar
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
        {!about && !updates && !searching && B && (
          <button type="button" className="share-toggle" onClick={() => setShareOpen(true)} title="Dela som bild eller länk">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
            </svg>
            <span>Dela</span>
          </button>
        )}
      </header>
      <Share open={shareOpen} onClose={() => setShareOpen(false)} title={pageTitle} />

      <div className="stage" ref={stageRef} inert={menuOpen || undefined}>
        {about && <About />}
        {updates && <Updates />}
        {searching && <Search budget={B} year={year} q={q} onChange={setQ} onPick={pickHit} />}

        {overview && B && year != null && (
          <Overview years={yrs} budgets={budgets} year={year} scale={scale} {...prices} {...display} />
        )}

        {!overview && !about && !updates && !searching && group && year != null && multiYear && (
          <FocusPanel
            years={yrs}
            budgets={budgets}
            year={year}
            scale={scale}
            view={view}
            gkey={group.key}
            row={focusedRow?.key ?? null}
            kicker={focusedRow ? `${group.code} · ${group.title}` : `${group.code} · ${T.kind}`}
            title={focusedRow ? focusedRow.title : group.title}
            bg={panelColor.bg}
            fg={panelColor.fg}
            {...prices}
            {...display}
          />
        )}

        {!overview && !about && !updates && !searching && (
          <>
            {/* A group of only negative postings has no tiles at all: skip the map. */}
            {placed.length > 0 && (
            <div className="map" style={{ height: mapH }}>
              {placed.map(({ it, x, y, w, h }) => {
                const { bg, fg } = colorOf(it, !!group);
                const { info: tileInfo, share } = infoOf(it);
                return (
                  <Tile
                    key={it.key}
                    it={it}
                    rect={{
                      left: `${(x / W) * 100}%`,
                      top: `${(y / mapRoom) * 100}%`,
                      width: `${(w / W) * 100}%`,
                      height: `${(h / mapRoom) * 100}%`,
                    }}
                    w={w}
                    h={(h * mapH) / mapRoom}
                    bg={bg}
                    fg={fg}
                    share={share}
                    info={tileInfo}
                    hovered={hover?.title === tileInfo.title}
                    focused={!!focusedRow && it.key === focusedRow.key}
                    onHover={setHover}
                    onActivate={clickOn(it)}
                  />
                );
              })}
            </div>
            )}
            {listed.length > 0 && (
              <ul className="small" aria-label="Poster som är för små eller negativa och därför visas som rader">
                {listed.map((it) => {
                  const { bg } = colorOf(it, !!group);
                  const { info: rowInfo, share } = infoOf(it);
                  const focused = !!focusedRow && it.key === focusedRow.key;
                  return (
                    <li key={it.key}>
                      <button
                        type="button"
                        className={`row${hover?.title === rowInfo.title ? " hovered" : ""}${focused ? " focused" : ""}`}
                        aria-pressed={focused || undefined}
                        style={{ cursor: it.drill ? "zoom-in" : "pointer" }}
                        onClick={clickOn(it)}
                        onMouseEnter={() => setHover(rowInfo)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(rowInfo)}
                        onBlur={() => setHover(null)}
                      >
                        <span className="swatch" style={{ background: bg }} aria-hidden />
                        <span className="code">{it.code}</span>
                        <span className="title" lang="sv">
                          {it.label}
                        </span>
                        <span className="value">{fmd(it.v)}</span>
                        <span className="share">{share}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {mode !== "explore" && (
          <footer className="info" aria-live="polite">
            <span className="title">{info.title}</span>
            <span className="value">{info.value}</span>
            <span className="share">{info.share}</span>
            <span className="hint">{info.hint}</span>
          </footer>
        )}
        <p className="credit">
          <span>
            © {new Date().getFullYear()} <a href="https://proddalbert.se" target="_blank" rel="noopener">ProddAlbert</a>
          </span>
          <span className="credit-links">
            <a href="https://github.com/kodalbert/statsbudgeten-se" target="_blank" rel="noopener">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
                <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
            <a href="/uppdateringar" onClick={(e) => { e.preventDefault(); showUpdates(); }}>Uppdateringar</a>
          </span>
        </p>
      </div>
    </div>
  );
}

installIcons();
initAnalytics();
createRoot(document.getElementById("root")!).render(<App />);
