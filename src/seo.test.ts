import { describe, expect, test } from "bun:test";
import { BudgetJsonSchema, type BudgetJson } from "../types/BudgetJsonSchema";
import { parseMarkdown } from "./markdown";
import { HEAD_LINKS, blocksHtml, canonicalPath, prerender, robotsTxt, sitemapPaths, sitemapXml, structuredData } from "./seo";
import type { Data } from "./social";
import { parseRoute } from "./web/routes";

const root = `${import.meta.dir}/../`;

/** The repo's real data, as the server loads it; no inflation so the prerender is nominal either way. */
async function loadData(): Promise<Data> {
  const years = [...new Bun.Glob("data/[0-9][0-9][0-9][0-9].json").scanSync(root)]
    .map((p) => Number(p.match(/(\d{4})\.json$/)?.[1]))
    .sort((a, b) => b - a);
  const budgets: Record<number, BudgetJson> = {};
  for (const y of years) budgets[y] = BudgetJsonSchema.parse(await Bun.file(`${root}data/${y}.json`).json());
  return { years, budgets, rates: {} };
}

const data = await loadData();
const latest = data.years[0]!;
const oldest = data.years[data.years.length - 1]!;
const route = (s: string) => parseRoute(new URL(s, "https://statsbudgeten.se"));
const ORIGIN = "https://statsbudgeten.se";
const about = parseMarkdown(await Bun.file(`${root}content/om.md`).text());

describe("canonicalPath", () => {
  test("drops the query, the inflation toggle and the unit", () => {
    expect(canonicalPath(route("/utgifter/6?inflation=1&andel=inkomster"), data)).toBe("/utgifter/6");
    expect(canonicalPath(route("/sok?q=skola"), data)).toBe("/sok");
    expect(canonicalPath(route("/?inflation=1"), data)).toBe("/");
  });
  test("keeps an older year but not an unknown or the latest", () => {
    expect(canonicalPath(route(`/utgifter?year=${oldest}`), data)).toBe(oldest === latest ? "/utgifter" : `/utgifter?year=${oldest}`);
    expect(canonicalPath(route(`/utgifter?year=${latest}`), data)).toBe("/utgifter");
    expect(canonicalPath(route("/utgifter?year=1999"), data)).toBe("/utgifter");
  });
  test("the Övriga bundle is its group, with or without a focused posting", () => {
    expect(canonicalPath(route("/utgifter/6/ovriga"), data)).toBe("/utgifter/6");
    expect(canonicalPath(route("/utgifter/6/ovriga/23"), data)).toBe("/utgifter/6/23");
  });
});

describe("sitemap", () => {
  const paths = sitemapPaths(data);
  test("lists every year's views, groups and postings once, plus the overview, about and updates", () => {
    expect(paths[0]).toBe("/");
    expect(paths).toContain("/om");
    expect(paths).toContain("/uppdateringar");
    expect(paths).toContain("/utgifter");
    expect(paths).toContain("/inkomster");
    expect(new Set(paths).size).toBe(paths.length);
    let expected = 3;
    for (const y of data.years) {
      const b = data.budgets[y]!;
      expected += 2 + b.expenses.length + b.revenues.length;
      for (const g of b.expenses) expected += g.rows.length;
      for (const g of b.revenues) expected += g.rows.length;
    }
    expect(paths.length).toBe(expected);
    expect(paths.length).toBeLessThan(50_000);
  });
  test("uses canonical URLs: no year for the latest, no Övriga, no search", () => {
    const g = data.budgets[latest]!.expenses[0]!;
    expect(paths).toContain(`/utgifter/${g.uo}`);
    expect(paths).toContain(`/utgifter/${g.uo}/${g.rows[0]!.id}`);
    const r = data.budgets[latest]!.revenues[0]!;
    expect(paths).toContain(`/inkomster/${r.id_start}/${r.rows[0]!.id}`);
    if (oldest !== latest) expect(paths).toContain(`/utgifter?year=${oldest}`);
    expect(paths.some((p) => p.includes(`year=${latest}`))).toBe(false);
    expect(paths.some((p) => p.includes("ovriga") || p.startsWith("/sok") || p.includes("inflation"))).toBe(false);
    for (const p of paths) expect(canonicalPath(route(p), data)).toBe(p);
  });
  test("is valid sitemap XML with absolute URLs", () => {
    const xml = sitemapXml(data, ORIGIN);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(xml.match(/<loc>/g)?.length).toBe(paths.length);
    expect(xml).toContain(`<loc>${ORIGIN}/utgifter/1</loc>`);
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;)/);
  });
  test("robots.txt keeps crawlers off search, the API and the raw bundle, and names the sitemap", () => {
    const txt = robotsTxt(ORIGIN);
    expect(txt).toContain("Disallow: /sok");
    expect(txt).toContain("Disallow: /api/");
    expect(txt).toContain("Disallow: /__index");
    expect(txt).not.toContain("Disallow: /favicon");
    expect(txt).not.toContain("Disallow: /social");
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe("structured data", () => {
  test("the front page is a WebSite with its search box", () => {
    const [site] = structuredData(route("/"), data, ORIGIN);
    expect(site?.["@type"]).toBe("WebSite");
    expect(JSON.stringify(site)).toContain(`${ORIGIN}/sok?q={search_term_string}`);
  });
  test("a drilled-down page has breadcrumbs down to the posting", () => {
    const g = data.budgets[latest]!.expenses[0]!;
    const r = g.rows[0]!;
    const [crumbs] = structuredData(route(`/utgifter/${g.uo}/ovriga/${r.id}?inflation=1`), data, ORIGIN);
    expect(crumbs?.["@type"]).toBe("BreadcrumbList");
    const items = (crumbs as { itemListElement: { name: string; item: string; position: number }[] }).itemListElement;
    expect(items.map((i) => i.name)).toEqual(["Statsbudgeten", `Utgifter ${latest}`, g.title, r.title]);
    expect(items.map((i) => i.item)).toEqual([`${ORIGIN}/`, `${ORIGIN}/utgifter`, `${ORIGIN}/utgifter/${g.uo}`, `${ORIGIN}/utgifter/${g.uo}/${r.id}`]);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
  });
  test("about, updates and search have none", () => {
    expect(structuredData(route("/om"), data, ORIGIN)).toEqual([]);
    expect(structuredData(route("/uppdateringar"), data, ORIGIN)).toEqual([]);
    expect(structuredData(route("/sok?q=x"), data, ORIGIN)).toEqual([]);
  });
});

describe("prerender", () => {
  test("the overview names the latest year and links every year's views", () => {
    const html = prerender(route("/"), data, about);
    expect(html).toContain(`<h1>Sveriges statsbudget ${latest}</h1>`);
    expect(html).toContain('<a href="/utgifter">');
    expect(html).toContain('<a href="/inkomster">');
    expect(html).toContain('<a href="/om">');
    if (oldest !== latest) expect(html).toContain(`<a href="/utgifter?year=${oldest}">`);
    expect(html.match(/<tr>/g)?.length).toBe(data.years.length + 1);
  });
  test("a view links every group, a group every posting, and a posting its history", () => {
    const b = data.budgets[latest]!;
    const view = prerender(route("/utgifter"), data, about);
    for (const g of b.expenses) if (g.total !== 0) expect(view).toContain(`<a href="/utgifter/${g.uo}">`);
    const g = b.expenses[0]!;
    const group = prerender(route(`/utgifter/${g.uo}`), data, about);
    expect(group).toContain(`<h1>${g.title}</h1>`);
    for (const r of g.rows) if (r.expense !== 0) expect(group).toContain(`<a href="/utgifter/${g.uo}/${r.id}">`);
    const r = g.rows[0]!;
    const item = prerender(route(`/utgifter/${g.uo}/${r.id}`), data, about);
    expect(item).toContain(`<h1>${r.title}</h1>`);
    expect(item).toContain(`<a href="/utgifter/${g.uo}">`);
    expect(item.match(/<tr><td>\d{4}<\/td>/g)?.length).toBe(data.years.length);
  });
  test("an older year links the other years with its own year kept", () => {
    if (oldest === latest) return;
    const html = prerender(route(`/inkomster?year=${oldest}`), data, about);
    expect(html).toContain(`<h1>Statens inkomster ${oldest}</h1>`);
    expect(html).toContain('<a href="/inkomster">');
    expect(html).toContain(`<a href="/inkomster/1000?year=${oldest}">`);
  });
  test("escapes text and never emits a negative share", () => {
    const html = prerender(route("/inkomster"), data, about);
    expect(html).not.toMatch(/\(−|\(-/);
    expect(html).toContain("&lt;0,1 %");
    expect(html).not.toContain("<0,1");
  });
  test("about renders the markdown, search gets a plain heading", () => {
    expect(prerender(route("/om"), data, about)).toContain("<h1>Om Statsbudgeten</h1>");
    expect(prerender(route("/om"), data, about)).toContain('<a href="https://github.com/kodalbert/statsbudgeten-se">');
    expect(prerender(route("/sok?q=<b>"), data, about)).toContain("<h1>Sök i statsbudgeten</h1>");
    expect(prerender(route("/sok?q=<b>"), data, about)).not.toContain("<b>");
  });
  test("updates lists the changelog's commits with date and author", () => {
    const changelog = {
      repo: "https://github.com/kodalbert/statsbudgeten-se",
      commits: [{ hash: "a".repeat(40), date: "2026-10-25", author: "Albert", subject: "Add <SEO> tags" }],
    };
    const html = prerender(route("/uppdateringar"), data, about, changelog);
    expect(html).toContain("<h1>Uppdateringar</h1>");
    expect(html).toContain('<time datetime="2026-10-25">2026-10-25</time>');
    expect(html).toContain("Add &lt;SEO&gt; tags · Albert");
    expect(html).toContain('<a href="/uppdateringar">');
    // Without the committed changelog the page still stands.
    expect(prerender(route("/uppdateringar"), data, about)).toContain("<h1>Uppdateringar</h1>");
  });
  test("an unknown group falls back to the view's root", () => {
    expect(prerender(route("/utgifter/999"), data, about)).toContain(`<h1>Statens utgifter ${latest}</h1>`);
  });
  test("blocksHtml escapes and renders every block type", () => {
    const html = blocksHtml(parseMarkdown("# A <b>\n\nHej **du** `x` [l](https://e.se/?a=1&b=2)\n\n- en\n- två\n\n[sources]\n"));
    expect(html).toBe('<h1>A &lt;b&gt;</h1>\n<p>Hej <strong>du</strong> <code>x</code> <a href="https://e.se/?a=1&amp;b=2">l</a></p>\n<ul><li>en</li><li>två</li></ul>\n');
  });
  test("the head links name the favicon routes Google looks for", () => {
    expect(HEAD_LINKS).toContain('<link rel="icon" href="/favicon.ico"');
    expect(HEAD_LINKS).toContain('<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96">');
    expect(HEAD_LINKS).toContain('rel="apple-touch-icon"');
    expect(HEAD_LINKS).toContain('rel="manifest"');
  });
});
