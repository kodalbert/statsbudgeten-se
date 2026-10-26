import { describe, expect, test } from "bun:test";
import { allocatedNet, postingAmount, fmd, levelItems, normalize, reconciliationNote, signedBreakdown, niceScale, placeItems, readable, type Item, type NormGroup } from "./model";
import { BudgetJsonSchema } from "../../types/BudgetJsonSchema";
import { chartHistory, changeOver } from "./model";

test("deduction charts show magnitude and growth without modifying signed data", () => {
  const signed = [{ y: 2024, v: 0 }, { y: 2025, v: -100 }, { y: 2026, v: -150 }];
  const chart = chartHistory(signed, true);
  expect(chart.deduction).toBe(true);
  expect(chart.points.map((p) => p.v)).toEqual([0, 100, 150]);
  expect(changeOver(chart.points.slice(1), () => false).pct).toBe(50);
  expect(signed.map((p) => p.v)).toEqual([0, -100, -150]);
  expect(chartHistory(signed, false)).toEqual({ points: signed, deduction: false });
  for (const amounts of [[-10, 20], [0, 0], [10, 20], []]) {
    const points = amounts.map((v, y) => ({ v, y }));
    expect(chartHistory(points, true)).toEqual({ points, deduction: false });
  }
});

describe("positive-only treemap shares", () => {
  test("negative adjustments do not inflate shares, including Övriga drilldown", () => {
    const group: NormGroup = {
      key: "ink1000", code: "1000", title: "Skatter", total: 100,
      rows: [80, 39, 0.5, 0.5, -20, 0].map((v, id) => ({ key: String(id), id, title: String(id), v })),
    };
    const level = levelItems([group], "rev", group, false);
    expect(level.parentTotal).toBe(120);
    expect(level.items.reduce((s, it) => s + it.v / level.parentTotal, 0)).toBeCloseTo(1, 12);
    const tail = level.items.find((it) => it.rest)!;
    const drilled = levelItems([group], "rev", group, true);
    expect(drilled.parentTotal).toBe(level.parentTotal);
    expect(drilled.items.reduce((s, it) => s + it.v, 0)).toBe(tail.v);
    expect(reconciliationNote(group)).toContain("Andelar av positiva poster");
    expect(signedBreakdown(group)).toMatchObject({ positive: 120, negative: -20, net: 100 });
    expect(signedBreakdown(group).negativeRows.map((r) => r.v)).toEqual([-20]);
    expect(allocatedNet(80, group)).toBeCloseTo(80 * 100 / 120, 12);
    expect(drilled.items.reduce((s, it) => s + allocatedNet(it.v, group), 0)).toBeCloseTo(allocatedNet(tail.v, group), 12);
    expect(allocatedNet(0, { ...group, rows: [] })).toBe(0);
  });

  test("all budget years reconcile while shares sum to one", async () => {
    const directory = new URL("../../data/", import.meta.url).pathname;
    for await (const file of new Bun.Glob("[0-9][0-9][0-9][0-9].json").scan(directory)) {
      const budget = BudgetJsonSchema.parse(await Bun.file(`${directory}/${file}`).json());
      const revenues = normalize(budget, "rev");
      const expenses = normalize(budget, "exp");
      const revenueSum = revenues.reduce((s, g) => s + g.total, 0);
      const expenseSum = expenses.reduce((s, g) => s + g.total, 0);
      expect(Math.abs(revenueSum - budget.revenuesTotal)).toBeLessThanOrEqual(2);
      expect(expenseSum).toBe(budget.expensesTotal);
      expect(Math.abs((expenseSum - revenueSum) - (budget.expensesTotal - budget.revenuesTotal))).toBeLessThanOrEqual(2);
      for (const view of ["rev", "exp"] as const) {
        const groups = view === "rev" ? revenues : expenses;
        for (const group of groups) {
          // Some official groups have a subtotal but no detailed rows.
          if (!group.rows.length) continue;
          const net = group.rows.reduce((s, r) => s + r.v, 0);
          const breakdown = signedBreakdown(group);
          expect(Math.abs(breakdown.positive + breakdown.negative - breakdown.net)).toBeLessThanOrEqual(2);
          expect(breakdown.negativeRows.every((r) => r.v < 0)).toBe(true);
          expect(Math.abs(net - group.total)).toBeLessThanOrEqual(2);
          const level = levelItems(groups, view, group, false);
          if (!level.items.length) continue;
          expect(level.items.reduce((s, it) => s + it.v / level.parentTotal, 0)).toBeCloseTo(1, 12);
          expect(level.items.reduce((s, it) => s + allocatedNet(it.v, group), 0)).toBeCloseTo(group.total, 4);
          expect(level.items.reduce((s, it) => s + it.v * breakdown.netRatio, 0)).toBeCloseTo(group.total, 4);
          // Allocation follows inflation scaling, without changing shares.
          const scaled = { ...group, total: group.total * 1.2, rows: group.rows.map((r) => ({ ...r, v: r.v * 1.2 })) };
          expect(allocatedNet(level.items[0]!.v * 1.2, scaled)).toBeCloseTo(allocatedNet(level.items[0]!.v, group) * 1.2, 4);
        }
      }
    }
  });
});

test("positive / allocated net labels share units only when appropriate", () => {
  const group: NormGroup = { key: "tax", code: "1000", title: "Tax", total: 50_000_000,
    rows: [{ key: "p", id: 1, title: "Positive", v: 100_000_000 }, { key: "n", id: 2, title: "Negative", v: -50_000_000 }] };
  const breakdown = signedBreakdown(group);
  expect(postingAmount(20_000_000, breakdown)).toBe("20 / 10 mdkr");
  expect(postingAmount(150_000, breakdown)).toBe("0,2 mdkr / 75 mnkr");
  expect(postingAmount(-50_000_000, breakdown)).toBe("−50 mdkr");
  expect(postingAmount(20_000_000, null)).toBe("20 mdkr");
  expect(postingAmount(20_000_000, signedBreakdown({ ...group, rows: group.rows.slice(0, 1) }))).toBe("20 mdkr");
});

const values = (s: ReturnType<typeof niceScale>) => s.grid.map((g) => g.v);

describe("fmd", () => {
  test("picks the unit by magnitude, so negative amounts read like positive ones", () => {
    expect(fmd(226_000_000)).toBe("226 mdkr");
    expect(fmd(-226_000_000)).toBe("−226 mdkr");
    expect(fmd(-126_613_000)).toBe("−127 mdkr");
    expect(fmd(1_250_000)).toBe("1,3 mdkr");
    expect(fmd(-1_250_000)).toBe("−1,3 mdkr");
    expect(fmd(45_000)).toBe("45 mnkr");
    expect(fmd(-45_000)).toBe("−45 mnkr");
    expect(fmd(0)).toBe("0 mnkr");
  });
});

describe("niceScale", () => {
  test("starts at zero by default, with headroom above the data", () => {
    const s = niceScale([900, 950, 1000], 1);
    expect(s.Y(0)).toBe(100);
    expect(values(s)[0]).toBe(0);
    // Zero is the axis edge here, not a line to emphasise.
    expect(s.grid.some((g) => g.zero)).toBe(false);
    expect(s.Y(1000)).toBeGreaterThan(0);
    // The area fill ends at the bottom, which is the zero line.
    expect(s.base).toBe(100);
  });

  test("the relative scale hugs the data but never crosses zero without it", () => {
    const s = niceScale([900, 950, 1000], 1, "relative");
    expect(values(s)[0]).toBeGreaterThan(0);
    expect(s.Y(900)).toBeLessThan(100);
    expect(s.base).toBe(100);
    // The gridlines sit on multiples of the step, so the bottom one is one of them.
    for (const v of values(s)) expect(Math.abs(v / s.step - Math.round(v / s.step))).toBeLessThan(1e-9);
  });

  test("negative data pulls the axis below zero and keeps zero as a gridline", () => {
    for (const scale of ["zero", "relative"] as const) {
      const s = niceScale([-300, 200, 400], 1, scale);
      expect(s.Y(-300)).toBeLessThan(100);
      expect(s.Y(400)).toBeGreaterThan(0);
      expect(s.grid.some((g) => g.zero)).toBe(true);
      expect(values(s).some((v) => v < 0)).toBe(true);
      // The area fill ends at the zero line, not at the bottom of the chart.
      expect(s.base).toBeCloseTo(s.Y(0));
      expect(s.base).toBeLessThan(100);
    }
  });

  test("all-negative data has zero at the top", () => {
    const z = niceScale([-500, -400, -450], 1);
    expect(z.Y(0)).toBe(0);
    expect(z.base).toBe(0);
    expect(values(z)[values(z).length - 1]).toBe(0);
    expect(z.Y(-500)).toBeLessThan(100);

    const r = niceScale([-500, -400, -450], 1, "relative");
    expect(r.Y(0)).toBeLessThan(0);
    expect(r.Y(-400)).toBeGreaterThan(0);
    expect(r.base).toBe(0);
    expect(values(r).every((v) => v <= 0)).toBe(true);
  });

  test("gridlines span the axis without running off it", () => {
    for (const vs of [[1, 2, 3], [1234567, 1300000], [0.5, 0.52], [-2, -1], [-1, 1]]) {
      for (const scale of ["zero", "relative"] as const) {
        const s = niceScale(vs, 0.05, scale);
        expect(s.grid.length).toBeGreaterThanOrEqual(2);
        expect(s.grid.length).toBeLessThanOrEqual(8);
        for (const g of s.grid) {
          const top = parseFloat(g.top);
          expect(top).toBeGreaterThanOrEqual(-1e-6);
          expect(top).toBeLessThanOrEqual(100 + 1e-6);
        }
      }
    }
  });
});

describe("placeItems", () => {
  const item = (key: string, v: number): Item => ({ key, id: null, code: key, label: key, v, hue: 0, rank: 0 });

  test("keeps every tile readable and lists the rest, largest first", () => {
    const items = [item("a", 1000), item("b", 500), item("c", 3), item("d", 2), item("e", 1)];
    const { placed, listed } = placeItems(items, 400, 300);
    expect(placed.every((p) => readable(p.w, p.h))).toBe(true);
    expect(placed.map((p) => p.it.key)).toEqual(["a", "b"]);
    expect(listed.map((it) => it.key)).toEqual(["c", "d", "e"]);
    // The tiles left fill the whole map.
    expect(placed.reduce((s, p) => s + p.w * p.h, 0)).toBeCloseTo(400 * 300, 3);
  });

  test("lists nothing when everything fits", () => {
    const { placed, listed } = placeItems([item("a", 2), item("b", 1)], 400, 300);
    expect(placed).toHaveLength(2);
    expect(listed).toEqual([]);
  });

  test("always keeps the largest item as a tile", () => {
    const { placed, listed } = placeItems([item("a", 2), item("b", 1)], 10, 10);
    expect(placed.map((p) => p.it.key)).toEqual(["a"]);
    expect(listed.map((it) => it.key)).toEqual(["b"]);
  });
});
