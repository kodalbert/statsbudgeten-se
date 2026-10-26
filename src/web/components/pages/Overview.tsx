import type { BudgetJson } from "@/types/BudgetJsonSchema";
import { INK, PAPER, sign, type Display, type Prices } from "@/model";
import type { Scale } from "@/routes";
import { ChartPanel } from "@/components/chart/ChartPanel";
import { Legend } from "@/components/chart/Legend";
import { LineChart } from "@/components/chart/LineChart";
import { PanelTop } from "@/components/chart/PanelTop";

export type OverviewProps = Prices &
  Display & {
    years: number[];
    budgets: Record<number, BudgetJson>;
    year: number;
    scale: Scale;
  };

const SIDES = [
  { k: "exp", label: "Utgifter", color: "var(--expense)" },
  { k: "rev", label: "Inkomster", color: "var(--revenue)" },
] as const;

export function Overview({ years, budgets, year, scale, factorOf, nominal: nominalKr, priceNote: priceNoteKr, nominalNote, unit, toUnit, fmt, unitNote }: OverviewProps) {
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
    <ChartPanel variant="overview" background={PAPER} color={INK} grid="rgba(11,11,11,0.12)">
      <PanelTop
        kicker={
          <>
            Statens budget · {years[0]}–{years[years.length - 1]}
            {unitNote}
            {priceNote}
          </>
        }
        title="Inkomster och utgifter"
        legend={<Legend items={SIDES} />}
        deltaKicker={`Saldo ${sel.y}`}
        delta={fsaldo(saldo)}
        deltaNote={saldo < 0 ? "Underskott – lånebehov" : saldo > 0 ? "Överskott" : "Balans"}
        deltaColor={saldo < 0 ? "var(--revenue)" : "var(--expense)"}
      />
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
    </ChartPanel>
  );
}
