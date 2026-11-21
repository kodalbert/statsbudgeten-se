import { describe, expect, test } from "bun:test";
import { fmd, fpct, levelItems, niceScale, placeItems, readable, type Item, type NormGroup } from "./model";

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

  test("negative items are never tiles, always list rows", () => {
    const { placed, listed } = placeItems([item("a", 1000), item("b", 500), item("neg", -300)], 400, 300);
    expect(placed.map((p) => p.it.key)).toEqual(["a", "b"]);
    expect(listed.map((it) => it.key)).toEqual(["neg"]);
    expect(placed.reduce((s, p) => s + p.w * p.h, 0)).toBeCloseTo(400 * 300, 3);
  });

  test("a level of only negative items has no tiles and lists everything", () => {
    const { placed, listed } = placeItems([item("x", -2), item("y", -1)], 400, 300);
    expect(placed).toEqual([]);
    expect(listed.map((it) => it.key)).toEqual(["x", "y"]);
  });
});

describe("fpct", () => {
  test("negative shares keep the sign and pick precision by magnitude", () => {
    expect(fpct(24)).toBe("24 %");
    expect(fpct(-24)).toBe("−24 %");
    expect(fpct(-2.4)).toBe("−2,4 %");
    expect(fpct(-0.01)).toBe("<0,1 %");
  });
});

describe("levelItems", () => {
  const group = (key: string, total: number, rows: [number, string, number][]): NormGroup => ({
    key,
    code: key,
    title: key,
    total,
    rows: rows.map(([id, title, v]) => ({ key: String(id), id, title, v })),
  });
  const all: NormGroup[] = [
    group("ink1000", 700, [[1100, "Skatt", 900], [1141, "Pensionsavgift", -200]]),
    group("ink7000", -150, [[7211, "Till fonder", -50], [7221, "Avräknad moms", -100]]),
  ];

  test("negative groups come after the positive ones at the root", () => {
    const { items, parentTotal } = levelItems(all, "rev", null, false);
    expect(items.map((it) => it.key)).toEqual(["ink1000", "ink7000"]);
    expect(items[1]!.v).toBe(-150);
    expect(items[1]!.drill).toBe(true);
    // Shares are of the positive (gross) total only.
    expect(parentTotal).toBe(700);
  });

  test("negative postings come last within their group", () => {
    const { items } = levelItems(all, "rev", all[0]!, false);
    expect(items.map((it) => it.key)).toEqual(["1100", "1141"]);
    expect(items[1]!.v).toBe(-200);
  });

  test("an all-negative group lists its postings, most negative first", () => {
    const { items, parentTotal } = levelItems(all, "rev", all[1]!, false);
    expect(items.map((it) => it.v)).toEqual([-100, -50]);
    expect(parentTotal).toBe(-150);
  });
});
