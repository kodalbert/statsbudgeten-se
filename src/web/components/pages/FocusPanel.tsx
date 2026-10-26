import type { BudgetJson } from "@/types/BudgetJsonSchema";
import { changeOver, historyPoints, INK, NF1, sign, signed, type Display, type Prices } from "@/model";
import type { Scale, View } from "@/routes";
import { ChartPanel } from "@/components/chart/ChartPanel";
import { LineChart } from "@/components/chart/LineChart";
import { PanelTop } from "@/components/chart/PanelTop";

export type FocusProps = Prices &
  Display & {
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

export function FocusPanel({ years, budgets, year, scale, view, gkey, row, kicker, title, bg, fg, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: FocusProps) {
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
    <ChartPanel variant="focus" background={bg} color={fg} grid={dark ? "rgba(255,255,255,0.22)" : "rgba(11,11,11,0.12)"}>
      <PanelTop
        kicker={
          <>
            {kicker}
            {unitNote}
            {priceNote}
            {years.some(nominal) ? ` · ${nominalNote}` : ""}
          </>
        }
        title={title}
        deltaKicker={
          <>
            {first.y}–{last.y}
          </>
        }
        delta={delta.big}
        deltaNote={delta.small}
      />
      <LineChart key={`${gkey}/${row ?? ""}`} series={[{ key: "v", label: title, points }]} years={years} year={year} nominal={nominal} scale={scale} paper={bg} fmt={fmt} />
    </ChartPanel>
  );
}
