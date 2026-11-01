/**
 * MCP server for the budget data, served by src/server.ts at /mcp.
 *
 * It speaks the Streamable HTTP transport of the Model Context Protocol
 * (spec 2025-06-18) in its stateless form: each POST carries a JSON-RPC
 * message and gets its reply as JSON in the same response. There are no
 * sessions and no server-to-client stream, so GET and DELETE answer 405.
 *
 * Everything a client can see is derived from the committed data files when
 * the server starts, not per request: the tool list (whose schemas enumerate
 * the budget years and areas that actually exist), the resource list with
 * the raw JSON of every year, and a search index per year. The protocol
 * surface is a handful of JSON-RPC methods, so this needs no SDK and adds no
 * dependency. Zod, already used for the data schemas, validates the tool
 * arguments and writes their JSON Schema.
 */
import { z } from "zod";
import type { BudgetJson } from "../types/BudgetJsonSchema";
import { chooseBaseYear, inflationFactors } from "./inflation";
import { buildIndex, search, type SearchHit } from "./search";
import type { Data } from "./social";
import { historyPoints } from "./web/model";
import { buildUrl, groupKey, type Route, type View } from "./web/routes";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];
const SERVER_INFO = { name: "statsbudgeten", title: "Statsbudgeten.se", version: "1.0.0" };
const UNIT = "tkr";
const DEFAULT_ORIGIN = "https://statsbudgeten.se";

// ---- JSON-RPC ----------------------------------------------------------------------

type Id = string | number | null;
type Message = { jsonrpc: "2.0"; id?: Id; method?: string; params?: unknown; result?: unknown; error?: unknown };
export type RpcError = { code: number; message: string; data?: unknown };
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: RpcError };

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const fail = (code: number, message: string, data?: unknown) => new RpcFailure(code, message, data);

// ---- Tools -------------------------------------------------------------------------

/** A tool's outcome: a result object, or an error the model should see (not a protocol error). */
type ToolOutcome = { ok: unknown } | { error: string };
type Ctx = { origin: string };
type Tool<S extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  schema: S;
  run: (args: z.infer<S>, ctx: Ctx) => ToolOutcome;
};

const VIEWS = { utgifter: "exp", inkomster: "rev" } as const satisfies Record<string, View>;
type ViewSlug = keyof typeof VIEWS;

/** Percent with two decimals; `|| 0` turns the -0 of tiny negative amounts into 0. */
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10000) / 100 || 0 : 0);

export function createMcp(data: Data, site: string | null = null) {
  const years = [...data.years].sort((a, b) => b - a);
  const latest = years[0];
  if (latest == null) throw new Error("No budget years to serve");
  const ascending = [...years].reverse();
  const baseYear = chooseBaseYear(data.rates, years);
  const { factors, convertible } = inflationFactors(data.rates, years, baseYear ?? latest);
  const adjustable = convertible.length > 1;

  const budget = (year: number): BudgetJson => data.budgets[year]!;
  const uos = [...new Set(years.flatMap((y) => budget(y).expenses.map((g) => g.uo)))].sort((a, b) => a - b);
  const codes = [...new Set(years.flatMap((y) => budget(y).revenues.map((g) => g.id_start)))].sort((a, b) => a - b);
  const indexes = new Map<number, SearchHit[]>(years.map((y) => [y, buildIndex(budget(y))]));

  const explore = (view: View, group: number | null, item: number | null, year: number, real = false): Route => ({
    mode: "explore",
    view,
    year,
    group,
    rest: false,
    item,
    real,
    unit: "kr",
    scale: "zero",
    from: null,
    to: null,
    q: "",
  });
  const link = (ctx: Ctx, route: Route) => `${ctx.origin}${buildUrl(route, latest)}`;

  const yearArg = z
    .literal(years)
    .optional()
    .describe(`Budget year. Defaults to the latest, ${latest}.`);
  const uoArg = z.literal(uos).describe("Utgiftsområde number (UO 1–27).");
  const codeArg = z.literal(codes).describe("Inkomsttyp code: the first code of its range, e.g. 1000 for Statens skatteinkomster.");

  const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool<z.ZodObject>;

  const tools: Tool<z.ZodObject>[] = [
    tool({
      name: "list_years",
      title: "Budget years",
      description: "The budget years this server has data for, the latest one, and the price level that inflation-adjusted amounts are expressed in.",
      schema: z.object({}).strict(),
      run: () => ({ ok: { years: ascending, latest, unit: UNIT, inflationBaseYear: adjustable ? baseYear : null } }),
    }),
    tool({
      name: "get_overview",
      title: "Budget overview",
      description:
        "Total expenses and revenues for a budget year, with every utgiftsområde (expense area) and inkomsttyp (revenue type) and their totals. Start here to find the uo or code to drill into.",
      schema: z.object({ year: yearArg }).strict(),
      run: ({ year = latest }, ctx) => {
        const b = budget(year);
        return {
          ok: {
            year,
            unit: UNIT,
            expensesTotal: b.expensesTotal,
            revenuesTotal: b.revenuesTotal,
            balance: b.revenuesTotal - b.expensesTotal,
            url: link(ctx, { ...explore("exp", null, null, year), mode: "overview" }),
            expenses: b.expenses.map((g) => ({ uo: g.uo, title: g.title, total: g.total, percentOfExpenses: pct(g.total, b.expensesTotal), url: link(ctx, explore("exp", g.uo, null, year)) })),
            revenues: b.revenues.map((g) => ({ code: g.id_start, title: g.title, total: g.total, percentOfRevenues: pct(g.total, b.revenuesTotal), url: link(ctx, explore("rev", g.id_start, null, year)) })),
          },
        };
      },
    }),
    tool({
      name: "get_area",
      title: "Utgiftsområde with its anslag",
      description: "One utgiftsområde (expense area) in a budget year with all of its anslag (appropriations), largest first.",
      schema: z.object({ year: yearArg, uo: uoArg }).strict(),
      run: ({ year = latest, uo }, ctx) => {
        const b = budget(year);
        const g = b.expenses.find((e) => e.uo === uo);
        if (!g) return { error: `Utgiftsområde ${uo} does not exist in ${year}.` };
        const items = [...g.rows].sort((a, c) => c.expense - a.expense).map((r) => ({ id: r.id, title: r.title, amount: r.expense, percentOfArea: pct(r.expense, g.total), url: link(ctx, explore("exp", uo, r.id, year)) }));
        return { ok: { year, unit: UNIT, uo, title: g.title, total: g.total, percentOfExpenses: pct(g.total, b.expensesTotal), url: link(ctx, explore("exp", uo, null, year)), items } };
      },
    }),
    tool({
      name: "get_revenue_type",
      title: "Inkomsttyp with its inkomsttitlar",
      description: "One inkomsttyp (revenue type) in a budget year with all of its inkomsttitlar (revenue items), largest first.",
      schema: z.object({ year: yearArg, code: codeArg }).strict(),
      run: ({ year = latest, code }, ctx) => {
        const b = budget(year);
        const g = b.revenues.find((r) => r.id_start === code);
        if (!g) return { error: `Inkomsttyp ${code} does not exist in ${year}.` };
        const items = [...g.rows].sort((a, c) => c.revenue - a.revenue).map((r) => ({ id: r.id, title: r.title, amount: r.revenue, percentOfType: pct(r.revenue, g.total), url: link(ctx, explore("rev", code, r.id, year)) }));
        return { ok: { year, unit: UNIT, code, title: g.title, total: g.total, percentOfRevenues: pct(g.total, b.revenuesTotal), url: link(ctx, explore("rev", code, null, year)), items } };
      },
    }),
    tool({
      name: "search",
      title: "Search the budget",
      description:
        "Find utgiftsområden, inkomsttyper, anslag and inkomsttitlar by name in a budget year. Case- and diacritic-insensitive ('forsvar' finds 'Försvar'); every word must match. Ranked by match quality, then amount.",
      schema: z
        .object({
          query: z.string().min(1).describe("Search words, e.g. 'försvar' or 'studiemedel'."),
          year: yearArg,
          limit: z.int().min(1).max(100).optional().describe("Max hits to return (default 20)."),
        })
        .strict(),
      run: ({ query, year = latest, limit = 20 }, ctx) => {
        const hits = search(indexes.get(year)!, query, limit).map((h) => ({
          view: h.view === "exp" ? "utgifter" : "inkomster",
          group: h.group,
          groupTitle: h.groupTitle,
          id: h.id,
          title: h.title,
          amount: h.v,
          url: link(ctx, explore(h.view, h.group, h.id, year)),
        }));
        return { ok: { year, unit: UNIT, query, count: hits.length, hits } };
      },
    }),
    tool({
      name: "get_history",
      title: "Amount over the years",
      description:
        "How an utgiftsområde, inkomsttyp or a single posting has developed across every budget year, nominal and optionally in a fixed price level. A posting is picked by its id within the group in `year`; expense anslag are matched across years by title, revenue items by id.",
      schema: z
        .object({
          view: z.enum(Object.keys(VIEWS) as [ViewSlug, ...ViewSlug[]]).describe("'utgifter' for an utgiftsområde, 'inkomster' for an inkomsttyp."),
          group: z.int().describe("Utgiftsområde number (1–27) or inkomsttyp code (e.g. 1000)."),
          id: z.int().optional().describe("Id of one anslag or inkomsttitel within the group; omit for the whole group."),
          year: yearArg.describe(`The year that 'id' refers to. Defaults to the latest, ${latest}.`),
          inflation: z.boolean().optional().describe("Also return every amount in the latest fixed price level (default false)."),
        })
        .strict(),
      run: ({ view: slug, group, id, year = latest, inflation = false }, ctx) => {
        const view = VIEWS[slug];
        const b = budget(year);
        const g = view === "exp" ? b.expenses.find((e) => e.uo === group) : b.revenues.find((r) => r.id_start === group);
        if (!g) return { error: `${slug === "utgifter" ? "Utgiftsområde" : "Inkomsttyp"} ${group} does not exist in ${year}.` };
        let rowKey: string | null = null;
        let title = g.title;
        if (id != null) {
          const row = g.rows.find((r) => r.id === id);
          if (!row) return { error: `No posting with id ${id} in ${g.title} ${year}.` };
          rowKey = view === "exp" ? row.title : String(row.id);
          title = row.title;
        }
        const nominal = historyPoints(ascending, data.budgets, view, groupKey(view, group), rowKey, () => 1, (v) => v);
        const adjusted = inflation ? historyPoints(ascending, data.budgets, view, groupKey(view, group), rowKey, (y) => factors.get(y) ?? NaN, (v) => v) : null;
        const points = nominal.map((p, i) => {
          const point: { year: number; amount: number; adjusted?: number | null } = { year: p.y, amount: p.v };
          if (adjusted) {
            const a = adjusted[i]!.v;
            point.adjusted = Number.isFinite(a) ? Math.round(a) : null;
          }
          return point;
        });
        const out: Record<string, unknown> = { view: slug, group, id: id ?? null, title, unit: UNIT, points, url: link(ctx, explore(view, group, id ?? null, year, inflation)) };
        if (inflation) {
          out.priceLevelYear = baseYear;
          if (points.some((p) => p.adjusted === null)) out.note = `Years without a final inflation rate (after ${baseYear}) cannot be converted and have adjusted: null; their amount is nominal.`;
        }
        return { ok: out };
      },
    }),
  ];

  const toolList = tools.map((t) => {
    const { $schema, ...inputSchema } = z.toJSONSchema(t.schema);
    return { name: t.name, title: t.title, description: t.description, inputSchema };
  });
  const byName = new Map(tools.map((t) => [t.name, t]));

  // ---- Resources: the raw data files -------------------------------------------------

  const resources = [
    ...years.map((y) => ({
      uri: `statsbudgeten://budget/${y}`,
      name: `budget-${y}`,
      title: `Statens budget ${y}`,
      description: `Every utgiftsområde and inkomsttyp of ${y} with all their postings, in ${UNIT} (thousands of SEK).`,
      mimeType: "application/json",
    })),
    {
      uri: "statsbudgeten://inflation",
      name: "inflation",
      title: "Inflation per year (KPI)",
      description: "Annual inflation in percent by year, from SCB; the rates behind the inflation adjustment.",
      mimeType: "application/json",
    },
  ];
  const resourceText = new Map<string, string>([
    ...years.map((y) => [`statsbudgeten://budget/${y}`, JSON.stringify(budget(y))] as [string, string]),
    ["statsbudgeten://inflation", JSON.stringify({ rates: data.rates })],
  ]);

  const instructions = [
    "Sweden's state budget (statens budget) as published by Regeringskansliet, one dataset per budget year, with SCB's inflation series for price-level adjustment.",
    `Budget years: ${ascending.join(", ")} (latest ${latest}).`,
    `All amounts are in ${UNIT} (tusen kronor, thousands of SEK), exactly as in the official workbooks.`,
    "Expenses are grouped into 27 utgiftsområden (UO), each holding anslag (appropriations). Revenues are grouped into inkomsttyper, coded 1000–9000 by their first code, each holding inkomsttitlar.",
    adjustable ? `Inflation-adjusted amounts are expressed in ${baseYear} prices, the latest year with a final inflation rate.` : "No inflation rates are available, so amounts are nominal only.",
    "Every result carries the URL of the statsbudgeten.se page that shows it; cite those when answering. The site is independent and not affiliated with the government.",
  ].join("\n");

  // ---- Dispatch ------------------------------------------------------------------------

  const params = (p: unknown): Record<string, unknown> => {
    if (p == null) return {};
    if (typeof p !== "object" || Array.isArray(p)) throw fail(INVALID_PARAMS, "params must be an object");
    return p as Record<string, unknown>;
  };

  function dispatch(method: string, raw: unknown, ctx: Ctx): unknown {
    const p = params(raw);
    switch (method) {
      case "initialize": {
        const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
        const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST_PROTOCOL;
        return { protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: SERVER_INFO, instructions };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: toolList };
      case "tools/call": {
        const t = typeof p.name === "string" ? byName.get(p.name) : undefined;
        if (!t) throw fail(INVALID_PARAMS, `Unknown tool: ${String(p.name)}`);
        const parsed = t.schema.safeParse(p.arguments ?? {});
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`);
          throw fail(INVALID_PARAMS, `Invalid arguments for ${t.name}: ${issues.join("; ")}`, { issues });
        }
        const outcome = t.run(parsed.data, ctx);
        if ("error" in outcome) return { content: [{ type: "text", text: outcome.error }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(outcome.ok) }], structuredContent: outcome.ok };
      }
      case "resources/list":
        return { resources };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "resources/read": {
        const uri = typeof p.uri === "string" ? p.uri : "";
        const text = resourceText.get(uri);
        if (text == null) throw fail(-32002, `Resource not found: ${uri}`, { uri });
        return { contents: [{ uri, mimeType: "application/json", text }] };
      }
      default:
        throw fail(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  /** One JSON-RPC message in, its response out; null for notifications and for responses, which have no reply. */
  function handle(msg: unknown, ctx: Ctx = { origin: site ?? DEFAULT_ORIGIN }): RpcResponse | null {
    const m = (typeof msg === "object" && msg !== null && !Array.isArray(msg) ? msg : {}) as Partial<Message>;
    const id: Id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
    if (m.jsonrpc !== "2.0" || (typeof m.method !== "string" && !("result" in m) && !("error" in m))) {
      return { jsonrpc: "2.0", id, error: { code: INVALID_REQUEST, message: "Invalid Request" } };
    }
    if (typeof m.method !== "string") return null; // a response to a server request; we never send any
    if (!("id" in m) || m.id == null) return null; // notification
    try {
      return { jsonrpc: "2.0", id, result: dispatch(m.method, m.params, ctx) };
    } catch (e) {
      if (e instanceof RpcFailure) return { jsonrpc: "2.0", id, error: { code: e.code, message: e.message, ...(e.data !== undefined && { data: e.data }) } };
      console.error("mcp:", e);
      return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
    }
  }

  // ---- HTTP ----------------------------------------------------------------------------

  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization",
    "access-control-max-age": "86400",
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, "cache-control": "no-store" } });

  async function fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } }, 400);
    }
    const ctx: Ctx = { origin: site ?? new URL(req.url).origin };
    if (Array.isArray(body)) {
      if (body.length === 0) return json({ jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Invalid Request" } }, 400);
      const replies = body.map((m) => handle(m, ctx)).filter((r): r is RpcResponse => r !== null);
      return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS });
    }
    const reply = handle(body, ctx);
    if (!reply) return new Response(null, { status: 202, headers: CORS });
    return json(reply, reply.error?.code === INVALID_REQUEST ? 400 : 200);
  }

  return { fetch, handle, tools: toolList, resources, instructions };
}
