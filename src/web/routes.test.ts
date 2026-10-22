import { describe, expect, test } from "bun:test";
import { buildUrl, compareSlug, groupKey, groupNumber, parseCompare, parseRoute, type Route } from "./routes";

const at = (path: string) => parseRoute(new URL(path, "https://statsbudgeten.se"));

describe("parseRoute", () => {
  test("root is the overview", () => {
    expect(at("/")).toEqual({ mode: "overview", view: "exp", year: null, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "" });
    expect(at("/?year=2024&inflation=1")).toMatchObject({ mode: "overview", year: 2024, real: true });
  });

  test("/om is the about page", () => {
    expect(at("/om")).toMatchObject({ mode: "about", group: null });
    expect(at("/om?year=2023&inflation=1")).toMatchObject({ mode: "about", year: 2023, real: true });
    expect(buildUrl({ mode: "about", view: "exp", year: 2023, group: null, rest: false, item: null, real: true, unit: "kr", cmp: null, index: false, q: "" }, 2026)).toBe("/om?year=2023&inflation=1");
  });

  test("/sok is the search page and keeps the query", () => {
    expect(at("/sok")).toMatchObject({ mode: "search", q: "" });
    expect(at("/sok?q=f%C3%B6rsvar&year=2023")).toMatchObject({ mode: "search", q: "försvar", year: 2023 });
    expect(buildUrl({ mode: "search", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "stöd till" }, 2026)).toBe("/sok?q=st%C3%B6d+till");
    expect(buildUrl({ mode: "search", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "" }, 2026)).toBe("/sok");
    // The query is only written for the search page.
    expect(buildUrl({ mode: "overview", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "x" }, 2026)).toBe("/");
  });

  test("/utgifter and /inkomster are the top-level treemaps", () => {
    expect(at("/utgifter")).toEqual({ mode: "explore", view: "exp", year: null, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "" });
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
  const base: Route = { mode: "explore", view: "exp", year: 2026, group: 6, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "" };

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
    expect(buildUrl({ mode: "overview", view: "exp", year: 2022, group: null, rest: false, item: null, real: true, unit: "kr", cmp: null, index: false, q: "" }, 2026)).toBe("/?year=2022&inflation=1");
    expect(buildUrl({ mode: "overview", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", cmp: null, index: false, q: "" }, 2026)).toBe("/");
  });

  test("the graph unit is a query parameter, omitted for kronor", () => {
    expect(buildUrl({ ...base, unit: "rev" }, 2026)).toBe("/utgifter/6?andel=inkomster");
    expect(buildUrl({ ...base, unit: "exp", real: true }, 2026)).toBe("/utgifter/6?inflation=1&andel=utgifter");
    expect(at("/?andel=inkomster")).toMatchObject({ mode: "overview", unit: "rev" });
    expect(at("/inkomster/1000?andel=utgifter")).toMatchObject({ group: 1000, unit: "exp" });
    expect(at("/utgifter?andel=kronor")).toMatchObject({ unit: "kr" });
  });

  test("the comparison target is a query parameter, only inside a group", () => {
    const cmp = { view: "rev" as const, group: 1000, item: 1111 };
    expect(buildUrl({ ...base, item: 3, cmp }, 2026)).toBe("/utgifter/6/3?jamfor=inkomster%2F1000%2F1111");
    expect(buildUrl({ ...base, cmp: { view: "exp", group: 4, item: null }, index: true }, 2026)).toBe("/utgifter/6?jamfor=utgifter%2F4&index=1");
    // Index without a comparison means nothing, and neither does a comparison outside a group.
    expect(buildUrl({ ...base, index: true }, 2026)).toBe("/utgifter/6");
    expect(buildUrl({ ...base, group: null, cmp }, 2026)).toBe("/utgifter");
    expect(buildUrl({ mode: "overview", view: "exp", year: 2026, group: null, rest: false, item: null, real: false, unit: "kr", cmp, index: true, q: "" }, 2026)).toBe("/");
    expect(at("/utgifter/6/3?jamfor=inkomster/1000/1111&index=1")).toMatchObject({ group: 6, item: 3, cmp, index: true });
    expect(at("/utgifter/6?jamfor=utgifter/4")).toMatchObject({ cmp: { view: "exp", group: 4, item: null }, index: false });
    expect(at("/utgifter/6?index=1")).toMatchObject({ cmp: null, index: false });
    expect(at("/utgifter?jamfor=utgifter/4")).toMatchObject({ group: null, cmp: null });
  });

  test("parseCompare rejects malformed targets", () => {
    expect(parseCompare("utgifter/6/3")).toEqual({ view: "exp", group: 6, item: 3 });
    expect(parseCompare("inkomster/1000")).toEqual({ view: "rev", group: 1000, item: null });
    expect(parseCompare("")).toBeNull();
    expect(parseCompare("annat/6")).toBeNull();
    expect(parseCompare("utgifter/x")).toBeNull();
    expect(parseCompare("utgifter/6/x")).toBeNull();
    expect(parseCompare("utgifter/6/3/extra")).toBeNull();
    expect(compareSlug({ view: "exp", group: 6, item: 3 })).toBe("utgifter/6/3");
    expect(compareSlug({ view: "rev", group: 1000, item: null })).toBe("inkomster/1000");
  });

  test("round-trips through parseRoute", () => {
    const routes: Route[] = [
      base,
      { ...base, item: 3, cmp: { view: "rev", group: 1000, item: 1111 }, index: true },
      { ...base, cmp: { view: "exp", group: 4, item: null }, real: true },
      { ...base, rest: true, real: true },
      { ...base, unit: "rev" },
      { ...base, item: 3, unit: "exp", real: true },
      { ...base, item: 3, year: 2022 },
      { ...base, rest: true, item: 23 },
      { ...base, view: "rev", group: 1000, item: 1111 },
      { mode: "overview", view: "exp", year: 2023, group: null, rest: false, item: null, real: true, unit: "kr", cmp: null, index: false, q: "" },
    ];
    // The latest year is omitted from the URL and comes back as null for the app to fill in.
    for (const r of routes) expect(at(buildUrl(r, 2026))).toEqual({ ...r, year: r.year === 2026 ? null : r.year });
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
