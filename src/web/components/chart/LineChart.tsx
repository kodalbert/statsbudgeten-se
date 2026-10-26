import { cn } from "cn";
import { Fragment, useState, type MouseEvent, type ReactNode } from "react";
import { niceScale, X, type Fmt, type Series } from "@/model";
import type { Scale } from "@/routes";
import { Swatch } from "@/components/ui/Swatch";
import { useRevealed } from "./useRevealed";

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

type YearHandlers = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClick: (e: MouseEvent) => void;
};

function InfoRow({ label, color, value, diff, named }: { label?: string; color?: string; value: string; diff: string; named: boolean }) {
  return (
    <div className="ib-row">
      {named && (
        <span className="ib-label">
          {color && <Swatch color={color} />}
          {label}
        </span>
      )}
      <span className="ib-val">{value}</span>
      <span className="ib-diff">{diff}</span>
    </div>
  );
}

function InfoBox({
  multi,
  pinned,
  side,
  top,
  year,
  nominal,
  prevYear,
  rows,
  extra,
}: {
  multi: boolean;
  pinned: boolean;
  side: { left?: string; right?: string };
  top: string;
  year: number;
  nominal: boolean;
  prevYear: number | null;
  rows: { key: string; label?: string; color?: string; value: string; diff: string }[];
  extra: string | null;
}) {
  return (
    <div className={cn("infobox", multi && "multi", pinned && "pinned")} role="status" style={{ ...side, top }}>
      <div className="ib-year">
        {year}
        {nominal ? "*" : ""}
        {prevYear != null && <span className="ib-vs"> · jämfört med {prevYear}</span>}
      </div>
      {rows.map((row) => (
        <InfoRow key={row.key} named={multi} label={row.label} color={row.color} value={row.value} diff={row.diff} />
      ))}
      {extra && <div className="ib-extra">{extra}</div>}
    </div>
  );
}

function ChartSeries({ series, n, base, pts }: { series: Series[]; n: number; base: number; pts: (s: Series) => string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {series.map((s) => (
        <Fragment key={s.key}>
          <polygon points={`${X(0, n)},${base.toFixed(2)} ${pts(s)} ${X(n - 1, n)},${base.toFixed(2)}`} fill={s.color ?? "currentColor"} style={{ opacity: s.color ? 0.08 : 0.1 }} />
          <polyline points={pts(s)} fill="none" stroke={s.color ?? "currentColor"} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </Fragment>
      ))}
    </svg>
  );
}

function ChartDot({
  label,
  pressed,
  below,
  active,
  selected,
  left,
  top,
  color,
  open,
  delay,
  value,
  mark,
  paper,
  handlers,
}: {
  label: string;
  pressed: boolean;
  below: boolean;
  active: boolean;
  selected: boolean;
  left: string;
  top: string;
  color?: string;
  open: boolean;
  delay: string;
  value: string;
  mark: number;
  paper: string;
  handlers: YearHandlers;
}) {
  return (
    <button
      type="button"
      className={cn("dot", below && "below", active && "active", selected && "selected")}
      aria-label={label}
      aria-pressed={pressed}
      style={{
        left,
        top,
        color,
        transform: `translate(-50%,-50%) scale(${open ? 1 : 0})`,
        transitionDelay: delay,
      }}
      {...handlers}
    >
      <span className="val">{value}</span>
      <span className="mark" style={{ width: mark, height: mark, background: selected ? "currentColor" : paper }} />
    </button>
  );
}

function YearMark({ year, nominal, selected, shown, pressed, left, handlers }: { year: number; nominal: boolean; selected: boolean; shown: boolean; pressed: boolean; left: string; handlers: YearHandlers }) {
  return (
    <button type="button" className="year" aria-pressed={pressed} style={{ left, fontWeight: selected ? 700 : 500, opacity: selected || shown ? 1 : 0.7 }} {...handlers}>
      {year}
      {nominal ? "*" : ""}
    </button>
  );
}

/**
 * Line chart with an info box: hovering a year's dot or label shows the exact
 * figures and the change from the previous year; clicking pins the box.
 */
export function LineChart({ series, years, year, nominal, scale, paper, extra, fmt }: LineChartProps) {
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
  const handlers = (y: number): YearHandlers => ({
    onMouseEnter: () => setHoverYear(y),
    onMouseLeave: () => setHoverYear(null),
    onFocus: () => setHoverYear(y),
    onBlur: () => setHoverYear(null),
    onClick: (e) => {
      e.stopPropagation();
      toggle(y);
    },
  });

  let box: ReactNode = null;
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
      <InfoBox
        multi={series.length > 1}
        pinned={pinnedYear === y && hoverYear == null}
        side={side}
        top={`clamp(-24px, calc(${mid}% - var(--box-h) / 2), calc(100% - var(--box-h) + 40px))`}
        year={y}
        nominal={nominal(y)}
        prevYear={prevYear}
        rows={series.map((s) => {
          const v = s.points[i]?.v ?? 0;
          const prev = prevYear != null ? (s.points[i - 1]?.v ?? 0) : null;
          const d = prev != null ? v - prev : null;
          return {
            key: s.key,
            label: s.label,
            color: s.color,
            value: fmt.exact(v),
            diff: d != null && prev != null ? `${fmt.diff(d, prev)}${mixed ? "*" : ""}` : "första året i serien",
          };
        })}
        extra={extra?.(i) ?? null}
      />
    );
  }

  return (
    <div className="chart" onClick={() => setPinnedYear(null)}>
      {grid.map((g) => (
        <div key={g.top} className={cn("gridline", g.zero && "zero")} style={{ top: g.top }}>
          <span>{fmt.grid(g.v, step)}</span>
        </div>
      ))}
      {series.length > 1 && <div className="band" style={{ left: `${X(selIndex, n)}%` }} />}
      <div className="reveal" style={{ clipPath: `inset(0 ${open ? "0%" : "100%"} 0 0)`, transitionDelay: open ? ".2s" : "0s" }}>
        <ChartSeries series={series} n={n} base={base} pts={pts} />
      </div>
      {series.map((s) =>
        s.points.map((p, i) => {
          const selected = p.y === year;
          return (
            <ChartDot
              key={`${s.key}-${p.y}`}
              label={`${s.label ? `${s.label} ` : ""}${p.y}: ${fmt.exact(p.v)}`}
              pressed={pinnedYear === p.y}
              below={below(s, i)}
              active={p.y === shown}
              selected={selected}
              left={`${X(i, n)}%`}
              top={`${Y(p.v)}%`}
              color={s.color}
              open={open}
              delay={open ? `${(0.25 + (i / Math.max(1, n - 1)) * 0.6).toFixed(2)}s` : "0s"}
              value={fmt.short(p.v)}
              mark={selected ? 16 : 12}
              paper={paper}
              handlers={handlers(p.y)}
            />
          );
        }),
      )}
      {years.map((y, i) => (
        <YearMark key={y} year={y} nominal={nominal(y)} selected={y === year} shown={y === shown} pressed={pinnedYear === y} left={`${X(i, n)}%`} handlers={handlers(y)} />
      ))}
      {box}
    </div>
  );
}
