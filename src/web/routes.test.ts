import { describe, expect, test } from "bun:test";
import { buildUrl, groupKey, groupNumber, parseRoute, windowYears, type Route } from "./routes";

const at = (path: string) => parseRoute(new URL(path, "https://statsbudgeten.se"));

describe("parseRoute", () => {
  test("root is the overview", () => {
    expect(at("/")).toEqual({ mode: "overview", view: "exp", year: null, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" });
    expect(at("/?year=2024&inflation=1")).toMatchObject({ mode: "overview", year: 2024, real: true });
  });

  test("/om is the about page", () => {
    expect(at("/om")).toMatchObject({ mode: "about", group: null });
    expect(at("/om?year=2023&inflation=1")).toMatchObject({ mode: "about", year: 2023, real: true });
    expect(buildUrl({ mode: "about", view: "exp", year: 2023, group: null, rest: false, item: null, real: true, unit: "kr", scale: "zero", from: null, to: null, q: "" }, 2026)).toBe("/om?year=2023&inflation=1");
  });

  test("/uppdateringar is the updates page", () => {
    expect(at("/uppdateringar")).toMatchObject({ mode: "updates", group: null });
    expect(buildUrl({ mode: "updates", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" }, 2026)).toBe("/uppdateringar");
  });

  test("/sok is the search page and keeps the query", () => {
    expect(at("/sok")).toMatchObject({ mode: "search", q: "" });
    expect(at("/sok?q=f%C3%B6rsvar&year=2023")).toMatchObject({ mode: "search", q: "försvar", year: 2023 });
    expect(buildUrl({ mode: "search", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "stöd till" }, 2026)).toBe("/sok?q=st%C3%B6d+till");
    expect(buildUrl({ mode: "search", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" }, 2026)).toBe("/sok");
    // The query is only written for the search page.
    expect(buildUrl({ mode: "overview", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "x" }, 2026)).toBe("/");
  });

  test("/utgifter and /inkomster are the top-level treemaps", () => {
    expect(at("/utgifter")).toEqual({ mode: "explore", view: "exp", year: null, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" });
    expect(at("/inkomster?year=2022")).toMatchObject({ mode: "explore", view: "rev", year: 2022, group: null });
  });

  test("reads group, Övriga and the focused item from the path", () => {
    expect(at("/utgifter/6")).toMatchObject({ view: "exp", group: 6, rest: false, item: null });
    expect(at("/utgifter/6/3")).toMatchObject({ group: 6, rest: false, item: 3 });
    expect(at("/utgifter/6/ovriga")).toMatchObject({ group: 6, rest: true, item: null });
    expect(at("/utgifter/6/ovriga/23")).toMatchObject({ group: 6, rest: true, item: 23 });
    expect(at("/inkomster/1000/1111")).toMatchObject({ view: "rev", group: 1000, item: 1111 });
  });

  test("ignores malformed segments", () => {
    expect(at("/utgifter/x/3")).toMatchObject({ group: null, item: null });
    expect(at("/utgifter/6/x")).toMatchObject({ group: 6, item: null });
    expect(at("/annat/6")).toMatchObject({ mode: "overview" });
    expect(at("/utgifter?year=26")).toMatchObject({ year: null });
  });
});

describe("buildUrl", () => {
  const base: Route = { mode: "explore", view: "exp", year: 2026, group: 6, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" };

  test("writes the explore paths", () => {
    expect(buildUrl({ ...base, group: null }, 2026)).toBe("/utgifter");
    expect(buildUrl(base, 2026)).toBe("/utgifter/6");
    expect(buildUrl({ ...base, item: 3 }, 2026)).toBe("/utgifter/6/3");
    expect(buildUrl({ ...base, rest: true }, 2026)).toBe("/utgifter/6/ovriga");
    expect(buildUrl({ ...base, rest: true, item: 23 }, 2026)).toBe("/utgifter/6/ovriga/23");
    expect(buildUrl({ ...base, view: "rev", group: 1000, item: 1111 }, 2026)).toBe("/inkomster/1000/1111");
  });

  test("year is a query parameter, omitted for the latest year", () => {
    expect(buildUrl({ ...base, year: 2023 }, 2026)).toBe("/utgifter/6?year=2023");
    expect(buildUrl({ ...base, real: true }, 2026)).toBe("/utgifter/6?inflation=1");
    expect(buildUrl({ mode: "overview", view: "exp", year: 2022, group: null, rest: false, item: null, real: true, unit: "kr", scale: "zero", from: null, to: null, q: "" }, 2026)).toBe("/?year=2022&inflation=1");
    expect(buildUrl({ mode: "overview", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", from: null, to: null, q: "" }, 2026)).toBe("/");
  });

  test("the graph unit is a query parameter, omitted for kronor", () => {
    expect(buildUrl({ ...base, unit: "rev" }, 2026)).toBe("/utgifter/6?andel=inkomster");
    expect(buildUrl({ ...base, unit: "exp", real: true }, 2026)).toBe("/utgifter/6?inflation=1&andel=utgifter");
    expect(at("/?andel=inkomster")).toMatchObject({ mode: "overview", unit: "rev" });
    expect(at("/inkomster/1000?andel=utgifter")).toMatchObject({ group: 1000, unit: "exp" });
    expect(at("/utgifter?andel=kronor")).toMatchObject({ unit: "kr" });
  });

  test("the y-axis scale is a query parameter, omitted when it starts at zero", () => {
    expect(buildUrl({ ...base, scale: "relative" }, 2026)).toBe("/utgifter/6?skala=relativ");
    expect(buildUrl({ ...base, scale: "relative", unit: "rev" }, 2026)).toBe("/utgifter/6?andel=inkomster&skala=relativ");
    expect(at("/?skala=relativ")).toMatchObject({ mode: "overview", scale: "relative" });
    expect(at("/utgifter/6?skala=noll")).toMatchObject({ scale: "zero" });
  });

  test("the chart window is fran and till, omitted for the full span", () => {
    expect(at("/?fran=2018&till=2021")).toMatchObject({ from: 2018, to: 2021 });
    expect(buildUrl({ ...base, from: 2018, to: 2021 }, 2026)).toBe("/utgifter/6?fran=2018&till=2021");
    expect(buildUrl({ ...base, from: 2018 }, 2026)).toBe("/utgifter/6?fran=2018");
    expect(at(buildUrl({ ...base, from: 2018, to: 2021 }, 2026))).toMatchObject({ from: 2018, to: 2021, year: null });
  });

  test("round-trips through parseRoute", () => {
    const routes: Route[] = [
      base,
      { ...base, rest: true, real: true },
      { ...base, unit: "rev" },
      { ...base, item: 3, unit: "exp", real: true },
      { ...base, scale: "relative" },
      { ...base, item: 3, year: 2022 },
      { ...base, rest: true, item: 23 },
      { ...base, from: 2018, to: 2021 },
      { ...base, view: "rev", group: 1000, item: 1111 },
      { mode: "overview", view: "exp", year: 2023, group: null, rest: false, item: null, real: true, unit: "kr", scale: "zero", from: null, to: null, q: "" },
    ];
    // The latest year is omitted from the URL and comes back as null for the app to fill in.
    for (const r of routes) expect(at(buildUrl(r, 2026))).toEqual({ ...r, year: r.year === 2026 ? null : r.year });
  });
});

describe("windowYears", () => {
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

  test("null bounds keep every year, in order", () => {
    expect(windowYears(years, null, null)).toEqual(years);
    expect(windowYears([...years].reverse(), null, null)).toEqual(years);
  });

  test("an inclusive range, with the bounds swapped when they are backwards", () => {
    expect(windowYears(years, 2018, 2021)).toEqual([2018, 2019, 2020, 2021]);
    expect(windowYears(years, 2021, 2018)).toEqual([2018, 2019, 2020, 2021]);
    expect(windowYears(years, 2022, null)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  test("a window that misses every year falls back to the whole list", () => {
    expect(windowYears(years, 1990, 1991)).toEqual(years);
    expect(windowYears(years, 2030, null)).toEqual(years);
    expect(windowYears(years, null, 1990)).toEqual(years);
    expect(windowYears(years, 1990, null)).toEqual(years);
  });
});

describe("group keys", () => {
  test("map between URL numbers and internal keys", () => {
    expect(groupKey("exp", 6)).toBe("uo6");
    expect(groupKey("rev", 1000)).toBe("ink1000");
    expect(groupNumber("uo6")).toBe(6);
    expect(groupNumber("ink1000")).toBe(1000);
  });
});
