import { describe, expect, test } from "bun:test";
import { BudgetJsonSchema, type BudgetJson } from "../types/BudgetJsonSchema";
import { InflationSchema } from "../types/InflationSchema";
import { INVALID_PARAMS, INVALID_REQUEST, LATEST_PROTOCOL, METHOD_NOT_FOUND, PARSE_ERROR, createMcp } from "./mcp";
import type { Data } from "./social";

const root = `${import.meta.dir}/../`;

/** The repo's real data, as the server loads it. */
async function loadData(): Promise<Data> {
  const years = [...new Bun.Glob("data/[0-9][0-9][0-9][0-9].json").scanSync(root)]
    .map((p) => Number(p.match(/(\d{4})\.json$/)?.[1]))
    .sort((a, b) => b - a);
  const budgets: Record<number, BudgetJson> = {};
  for (const y of years) budgets[y] = BudgetJsonSchema.parse(await Bun.file(`${root}data/${y}.json`).json());
  const inflation = InflationSchema.parse(await Bun.file(`${root}data/inflation.json`).json());
  return { years, budgets, rates: inflation.rates };
}

const data = await loadData();
const latest = data.years[0]!;
const oldest = data.years[data.years.length - 1]!;
const mcp = createMcp(data, "https://statsbudgeten.se");

let n = 0;
const rpc = (method: string, params?: unknown) => mcp.handle({ jsonrpc: "2.0", id: ++n, method, params });
const call = (name: string, args?: unknown) => rpc("tools/call", { name, arguments: args });
const result = (r: ReturnType<typeof rpc>) => {
  expect(r?.error).toBeUndefined();
  return r!.result as any;
};
const structured = (name: string, args?: unknown) => {
  const r = result(call(name, args));
  expect(r.isError).toBeUndefined();
  expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  return r.structuredContent;
};

describe("initialize", () => {
  test("answers with the client's version when supported, else the latest", () => {
    expect(result(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } })).protocolVersion).toBe("2025-03-26");
    expect(result(rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "t", version: "0" } })).protocolVersion).toBe(LATEST_PROTOCOL);
  });
  test("declares tools and resources and tells the model the years and the unit", () => {
    const r = result(rpc("initialize", {}));
    expect(r.capabilities).toEqual({ tools: {}, resources: {} });
    expect(r.serverInfo.name).toBe("statsbudgeten");
    expect(r.instructions).toContain(String(latest));
    expect(r.instructions).toContain("tkr");
  });
  test("ping and notifications", () => {
    expect(result(rpc("ping"))).toEqual({});
    expect(mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});

describe("tools/list", () => {
  const tools = result(rpc("tools/list")).tools as any[];
  test("lists the six tools with JSON Schema inputs", () => {
    expect(tools.map((t) => t.name)).toEqual(["list_years", "get_overview", "get_area", "get_revenue_type", "search", "get_history"]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.$schema).toBeUndefined();
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
  test("the year and area arguments enumerate what the data has", () => {
    const area = tools.find((t) => t.name === "get_area")!.inputSchema;
    expect(area.properties.year.enum).toEqual(data.years);
    expect(area.properties.uo.enum).toEqual(data.budgets[latest]!.expenses.map((g) => g.uo).sort((a, b) => a - b));
    expect(area.required).toEqual(["uo"]);
    const rev = tools.find((t) => t.name === "get_revenue_type")!.inputSchema;
    expect(rev.properties.code.enum).toContain(1000);
  });
});

describe("tools", () => {
  const b = data.budgets[latest]!;
  test("list_years", () => {
    const r = structured("list_years");
    expect(r.years).toEqual([...data.years].sort((a, b) => a - b));
    expect(r.latest).toBe(latest);
    expect(r.unit).toBe("tkr");
    expect(typeof r.inflationBaseYear).toBe("number");
  });
  test("get_overview defaults to the latest year and links every group", () => {
    const r = structured("get_overview");
    expect(r.year).toBe(latest);
    expect(r.expensesTotal).toBe(b.expensesTotal);
    expect(r.revenuesTotal).toBe(b.revenuesTotal);
    expect(r.balance).toBe(b.revenuesTotal - b.expensesTotal);
    expect(r.expenses).toHaveLength(b.expenses.length);
    expect(r.expenses[5]).toMatchObject({ uo: b.expenses[5]!.uo, url: `https://statsbudgeten.se/utgifter/${b.expenses[5]!.uo}` });
    expect(r.revenues[0]).toMatchObject({ code: 1000, url: "https://statsbudgeten.se/inkomster/1000" });
    expect(r.url).toBe("https://statsbudgeten.se/");
    const old = structured("get_overview", { year: oldest });
    expect(old.year).toBe(oldest);
    if (oldest !== latest) expect(old.expenses[0].url).toContain(`?year=${oldest}`);
  });
  test("get_area returns every anslag, largest first, with page URLs", () => {
    const g = b.expenses.find((e) => e.uo === 6)!;
    const r = structured("get_area", { uo: 6 });
    expect(r.title).toBe(g.title);
    expect(r.total).toBe(g.total);
    expect(r.items).toHaveLength(g.rows.length);
    const amounts = r.items.map((i: any) => i.amount);
    expect(amounts).toEqual([...amounts].sort((x, y) => y - x));
    expect(r.items[0].url).toBe(`https://statsbudgeten.se/utgifter/6/${r.items[0].id}`);
    expect(r.items.reduce((s: number, i: any) => s + i.percentOfArea, 0)).toBeCloseTo(100, 0);
  });
  test("get_revenue_type", () => {
    const g = b.revenues.find((e) => e.id_start === 1000)!;
    const r = structured("get_revenue_type", { code: 1000 });
    expect(r.title).toBe(g.title);
    expect(r.items).toHaveLength(g.rows.length);
    expect(r.items[0].url).toBe(`https://statsbudgeten.se/inkomster/1000/${r.items[0].id}`);
  });
  test("search ignores case and diacritics and honours the limit", () => {
    const r = structured("search", { query: "forsvar", limit: 5 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.count).toBeLessThanOrEqual(5);
    expect(r.hits[0].title).toMatch(/försvar/i);
    expect(r.hits[0].url).toContain("https://statsbudgeten.se/utgifter/");
    expect(structured("search", { query: "xyzzyqwv" }).count).toBe(0);
  });
  test("get_history gives one point per year, matching the data", () => {
    const r = structured("get_history", { view: "utgifter", group: 6 });
    expect(r.points.map((p: any) => p.year)).toEqual([...data.years].sort((a, b) => a - b));
    for (const p of r.points) expect(p.amount).toBe(data.budgets[p.year]!.expenses.find((e) => e.uo === 6)!.total);
    expect(r.points[0].adjusted).toBeUndefined();
    expect(r.priceLevelYear).toBeUndefined();
    expect(r.url).toBe("https://statsbudgeten.se/utgifter/6");
  });
  test("get_history adjusts for inflation on request", () => {
    const r = structured("get_history", { view: "utgifter", group: 6, inflation: true });
    expect(typeof r.priceLevelYear).toBe("number");
    const base = r.points.find((p: any) => p.year === r.priceLevelYear);
    expect(base.adjusted).toBe(base.amount);
    const earlier = r.points.find((p: any) => p.year < r.priceLevelYear);
    if (earlier) expect(earlier.adjusted).toBeGreaterThan(earlier.amount);
    expect(r.url).toBe("https://statsbudgeten.se/utgifter/6?inflation=1");
  });
  test("get_history for one posting follows the title across years", () => {
    const g = b.expenses.find((e) => e.uo === 6)!;
    const row = g.rows[0]!;
    const r = structured("get_history", { view: "utgifter", group: 6, id: row.id });
    expect(r.title).toBe(row.title);
    for (const p of r.points) {
      const match = data.budgets[p.year]!.expenses.find((e) => e.uo === 6)?.rows.find((x) => x.title === row.title);
      expect(p.amount).toBe(match?.expense ?? 0);
    }
    const rev = structured("get_history", { view: "inkomster", group: 1000, id: b.revenues[0]!.rows[0]!.id });
    expect(rev.points).toHaveLength(data.years.length);
  });
  test("a missing group or posting is a tool error, not a protocol error", () => {
    const r = result(call("get_history", { view: "utgifter", group: 99 }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("99");
    expect(result(call("get_history", { view: "utgifter", group: 6, id: 99999 })).isError).toBe(true);
  });
  test("bad arguments and unknown tools are protocol errors", () => {
    const bad = call("get_area", { uo: 99 });
    expect(bad?.error?.code).toBe(INVALID_PARAMS);
    expect(bad?.error?.message).toContain("uo");
    expect(call("get_area", { uo: 6, extra: 1 })?.error?.code).toBe(INVALID_PARAMS);
    expect(call("nope", {})?.error?.code).toBe(INVALID_PARAMS);
    expect(rpc("prompts/list")?.error?.code).toBe(METHOD_NOT_FOUND);
  });
});

describe("resources", () => {
  test("one per year plus the inflation series, readable as JSON", () => {
    const list = result(rpc("resources/list")).resources as any[];
    expect(list.map((r) => r.uri)).toEqual([...data.years.map((y) => `statsbudgeten://budget/${y}`), "statsbudgeten://inflation"]);
    const read = result(rpc("resources/read", { uri: `statsbudgeten://budget/${latest}` }));
    expect(JSON.parse(read.contents[0].text)).toEqual(data.budgets[latest]);
    expect(rpc("resources/read", { uri: "statsbudgeten://budget/1999" })?.error?.code).toBe(-32002);
  });
});

describe("HTTP transport", () => {
  const post = (body: unknown, init: RequestInit = {}) =>
    mcp.fetch(new Request("http://localhost:3000/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init }));
  test("a request gets its JSON-RPC response", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.result.tools).toHaveLength(6);
  });
  test("URLs in results use the request origin when no site is configured", async () => {
    const local = createMcp(data);
    const res = await local.fetch(new Request("http://localhost:3000/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_area", arguments: { uo: 6 } } }) }));
    expect((await res.json()).result.structuredContent.url).toBe("http://localhost:3000/utgifter/6");
  });
  test("a notification is accepted without a body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
  test("a batch gets an array back", async () => {
    const res = await post([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(res.status).toBe(200);
    expect((await res.json()).map((r: any) => r.id)).toEqual([1, 2]);
  });
  test("malformed input", async () => {
    const parse = await post("{not json");
    expect(parse.status).toBe(400);
    expect((await parse.json()).error.code).toBe(PARSE_ERROR);
    const invalid = await post({ id: 1, method: "ping" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe(INVALID_REQUEST);
  });
  test("no stream, no sessions: GET and DELETE are 405, OPTIONS is a CORS preflight", async () => {
    const get = await mcp.fetch(new Request("http://localhost:3000/mcp"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toContain("POST");
    expect((await mcp.fetch(new Request("http://localhost:3000/mcp", { method: "DELETE" }))).status).toBe(405);
    const opt = await mcp.fetch(new Request("http://localhost:3000/mcp", { method: "OPTIONS" }));
    expect(opt.status).toBe(204);
    expect(opt.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
  });
});
