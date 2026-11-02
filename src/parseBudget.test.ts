import { beforeAll, describe, expect, test } from "bun:test";
import { BudgetJsonSchema, type BudgetJson } from "../types/BudgetJsonSchema";
import { parseBudgetWorkbook } from "./parseBudget";

let year: number;
let budget: BudgetJson;

beforeAll(async () => {
  const bytes = new Uint8Array(await Bun.file(`${import.meta.dir}/../examples/2026.xlsx`).arrayBuffer());
  ({ year, budget } = parseBudgetWorkbook(bytes));
});

test("extracts the budget year from the sheet titles", () => {
  expect(year).toBe(2026);
});

test("output validates against BudgetJsonSchema", () => {
  expect(BudgetJsonSchema.safeParse(budget).success).toBe(true);
});

describe("expenses", () => {
  test("matches the workbook's Summa anslag", () => {
    expect(budget.expensesTotal).toBe(1_543_317_501);
  });

  test("has the 27 utgiftsområden in order", () => {
    expect(budget.expenses.map((g) => g.uo)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  test("every utgiftsområde total equals the sum of its anslag", () => {
    for (const group of budget.expenses) {
      expect(group.rows.reduce((s, r) => s + r.expense, 0)).toBe(group.total);
    }
    expect(budget.expenses.reduce((s, g) => s + g.total, 0)).toBe(budget.expensesTotal);
  });

  test("anslag get 1-based ordinal ids and number-stripped titles", () => {
    const uo1 = budget.expenses[0]!;
    expect(uo1.title).toBe("Rikets styrelse");
    expect(uo1.total).toBe(21_614_324);
    expect(uo1.rows[0]).toEqual({ id: 1, title: "Kungliga hov- och slottsstaten", expense: 190_457 });
    expect(uo1.rows.map((r) => r.id)).toEqual(uo1.rows.map((_, i) => i + 1));
    // Bold group-header rows ("Statschefen", "Riksdagen och dess myndigheter")
    // are subtotals and must not appear among the anslag.
    expect(uo1.rows.some((r) => r.title === "Statschefen")).toBe(false);
  });

  test("handles utgiftsområden without anslag groups and single-anslag areas", () => {
    const uo2 = budget.expenses.find((g) => g.uo === 2)!; // no bold group level
    expect(uo2.rows[0]).toEqual({ id: 1, title: "Kammarkollegiet", expense: 179_196 });
    const uo27 = budget.expenses.find((g) => g.uo === 27)!;
    expect(uo27.rows).toEqual([{ id: 1, title: "Avgiften till Europeiska unionen", expense: 54_199_851 }]);
  });
});

describe("revenues", () => {
  test("matches the workbook's Summa inkomster", () => {
    expect(budget.revenuesTotal).toBe(1_374_910_661);
  });

  test("has the nine inkomsttyper with their code ranges", () => {
    expect(budget.revenues.map((g) => g.id_start)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
    for (const group of budget.revenues) expect(group.id_end).toBe(group.id_start + 999);
    expect(budget.revenues[0]!.title).toBe("Statens skatteinkomster");
    expect(budget.revenues[0]!.total).toBe(1_419_590_649);
  });

  test("rows are inkomsttitlar with their official 4-digit code as id", () => {
    const skatt = budget.revenues[0]!;
    expect(skatt.rows).toContainEqual({ id: 1111, title: "Statlig inkomstskatt", revenue: 69_132_050 });
    expect(skatt.rows).toContainEqual({ id: 1153, title: "Jobbskatteavdrag", revenue: -226_138_393 });
    for (const group of budget.revenues) {
      for (const row of group.rows) {
        expect(row.id).toBeGreaterThanOrEqual(group.id_start);
        expect(row.id).toBeLessThanOrEqual(group.id_end);
        expect(Number.isInteger(row.id)).toBe(true);
      }
    }
    // Header rows (huvudgrupper like 1100, undergrupper like 1110) must not
    // leak in as titlar.
    expect(skatt.rows.some((r) => r.id % 10 === 0)).toBe(false);
  });

  test("group totals match the sum of titlar within the file's own rounding", () => {
    // The published file rounds every level independently, so ±1 tkr
    // differences are genuine (inkomsttyp 1000 and 7000 in the 2026 file).
    for (const group of budget.revenues) {
      const sum = group.rows.reduce((s, r) => s + r.revenue, 0);
      expect(Math.abs(sum - group.total)).toBeLessThanOrEqual(2);
    }
    const typSum = budget.revenues.reduce((s, g) => s + g.total, 0);
    expect(Math.abs(typSum - budget.revenuesTotal)).toBeLessThanOrEqual(2);
  });

  test("keeps empty inkomsttyper (9000 has no titlar in 2026)", () => {
    const typ9000 = budget.revenues.find((g) => g.id_start === 9000)!;
    expect(typ9000.rows).toEqual([]);
    expect(typ9000.total).toBe(0);
  });
});

describe("every workbook in examples/", () => {
  const files = [...new Bun.Glob("[0-9][0-9][0-9][0-9].xlsx").scanSync(`${import.meta.dir}/../examples`)].sort();

  // The "Summa anslag" / "Summa inkomster" rows of each year's workbook, so
  // a parser change that silently misreads a file cannot go unnoticed.
  const knownTotals: Record<string, { expenses: number; revenues: number }> = {
    2013: { expenses: 834_470_983, revenues: 829_578_474 },
    2014: { expenses: 856_758_035, revenues: 824_219_318 },
    2015: { expenses: 890_900_386, revenues: 854_073_839 },
    2016: { expenses: 926_249_927, revenues: 924_260_869 },
    2017: { expenses: 971_169_281, revenues: 979_733_829 },
    2018: { expenses: 1_000_514_994, revenues: 1_042_901_177 },
    2019: { expenses: 1_026_634_185, revenues: 1_097_499_553 },
    2020: { expenses: 1_062_385_804, revenues: 1_116_107_806 },
    2021: { expenses: 1_165_822_520, revenues: 1_105_994_084 },
    2022: { expenses: 1_204_219_603, revenues: 1_190_994_234 },
    2023: { expenses: 1_251_870_933, revenues: 1_279_473_213.3 },
    2024: { expenses: 1_346_694_314, revenues: 1_324_263_505 },
    2025: { expenses: 1_441_595_890, revenues: 1_373_862_450.64 },
    2026: { expenses: 1_543_317_501, revenues: 1_374_910_661 },
  };

  test("there are workbooks to test", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${file} parses, validates and reports the year from its filename`, async () => {
      const bytes = new Uint8Array(await Bun.file(`${import.meta.dir}/../examples/${file}`).arrayBuffer());
      const { year, budget } = parseBudgetWorkbook(bytes);
      expect(String(year)).toBe(file.replace(".xlsx", ""));
      expect(BudgetJsonSchema.safeParse(budget).success).toBe(true);
      // 27 utgiftsområden in order, every one with anslag.
      expect(budget.expenses.map((g) => g.uo)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      expect(budget.expenses.every((g) => g.rows.length > 0)).toBe(true);
      expect(budget.expenses[0]!.title).toBe("Rikets styrelse");
      // The nine inkomsttyper, the big ones with titlar.
      expect(budget.revenues.map((g) => g.id_start)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
      expect(budget.revenues[0]!.rows.length).toBeGreaterThan(100);
      expect(budget.revenues[0]!.rows.some((r) => r.id === 1111)).toBe(true);
      // No float noise in the output.
      for (const g of budget.revenues) for (const r of g.rows) expect(r.revenue).toBe(Math.round(r.revenue * 100) / 100);
      // The workbook's own totals, pinned per year.
      const known = knownTotals[file.replace(".xlsx", "")];
      if (known) {
        expect(budget.expensesTotal).toBe(known.expenses);
        expect(budget.revenuesTotal).toBe(known.revenues);
      } else {
        // A new year without pinned totals yet: at least a plausible magnitude.
        expect(budget.expensesTotal).toBeGreaterThan(1_000_000_000);
        expect(budget.revenuesTotal).toBeGreaterThan(1_000_000_000);
      }
    });
  }
});

describe("budgets published as PDF before the excel series", () => {
  // Printed "Summa anslag" / "Summa inkomster" in bilaga 1 of each budget bill.
  const known: Record<string, { expenses: number; revenues: number }> = {
    2010: { expenses: 810_621_184, revenues: 723_028_754 },
    2011: { expenses: 810_746_352, revenues: 832_988_162 },
    2012: { expenses: 816_657_851, revenues: 833_113_027 },
  };

  for (const [year, totals] of Object.entries(known)) {
    test(`${year} keeps the printed totals, 27 utgiftsområden and nine inkomsttyper`, async () => {
      const budget = BudgetJsonSchema.parse(await Bun.file(`${import.meta.dir}/../data/${year}.json`).json());
      expect(budget.expenses.map((g) => g.uo)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      expect(budget.expenses.every((g) => g.rows.length > 0)).toBe(true);
      expect(budget.expenses[0]!.title).toBe("Rikets styrelse");
      expect(budget.revenues.map((g) => g.id_start)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
      expect(budget.expensesTotal).toBe(totals.expenses);
      expect(budget.revenuesTotal).toBe(totals.revenues);
      for (const g of budget.expenses) {
        expect(g.rows.reduce((s, r) => s + r.expense, 0)).toBe(g.total);
      }
    });
  }

  test("2012 keeps the source's 94 tkr gap between inkomsttyp 1000 and its titlar", async () => {
    const budget = BudgetJsonSchema.parse(await Bun.file(`${import.meta.dir}/../data/2012.json`).json());
    const tax = budget.revenues.find((g) => g.id_start === 1000)!;
    expect(tax.rows.reduce((s, r) => s + r.revenue, 0) - tax.total).toBe(94);
  });
});
