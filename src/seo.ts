/**
 * What search engines get from a page: its canonical URL, the sitemap and
 * robots.txt, the structured data in its head, and the static HTML the page
 * carries in #root until the app mounts and replaces it.
 *
 * The app is client-rendered, so without this a crawler that does not run
 * JavaScript sees an empty page. The prerender spells out what the page is
 * about (its title, the numbers, the postings) and links to every page a
 * level down, so the whole site is reachable from plain HTML.
 */
import type { Block, Inline } from "./markdown";
import type { BudgetVotes } from "../types/BudgetVotesSchema";
import { partyNames, voteLine } from "./parties";
import { pageDescription, resolve, type Data } from "./social";
import { COPY, fmd, fpct, sign } from "./web/model";
import { buildUrl, type Route } from "./web/routes";

export const SITE_NAME = "Statsbudgeten";
export const SITE_TAGLINE = "Sveriges statsbudget som en karta";

/**
 * The icon and manifest links. They are added to the head by the server
 * rather than written in index.html, because Bun's HTML bundler tries to
 * resolve every link href as a build asset and fails on these routes. Google
 * only picks up a favicon it finds as a <link rel="icon"> on the front page,
 * and it wants /favicon.ico as well. The 96px PNG is for Google too: it asks
 * for a square icon in a multiple of 48px, and its parser is safest with a
 * plain PNG (the .ico is kept to classic BMP entries for the same reason).
 */
export const HEAD_LINKS = [
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
  '<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/site.webmanifest">',
].join("");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The year as the data knows it: an unknown year is the latest. */
const yearOf = (route: Route, data: Data) => (route.year != null && data.years.includes(route.year) ? route.year : null);

/**
 * The canonical path of a route: the search query, the inflation toggle and
 * the unit never make a separate page, and the "Övriga" bundle is a view of
 * its group, so a group or posting is the same page with or without it.
 */
export function canonicalPath(route: Route, data: Data): string {
  const latest = data.years[0] ?? null;
  return buildUrl({ ...route, q: "", real: false, unit: "kr", rest: false, year: yearOf(route, data) }, latest);
}

// ---- Sitemap and robots -------------------------------------------------------------

/** Every indexable path: the overview, about, and every year's views, groups and postings. */
export function sitemapPaths(data: Data): string[] {
  const latest = data.years[0] ?? null;
  const paths = ["/", "/budgetar", "/om"];
  const base = { mode: "explore" as const, rest: false, real: false, unit: "kr" as const, scale: "zero" as const, q: "" };
  for (const year of data.years) {
    const budget = data.budgets[year];
    if (!budget) continue;
    for (const view of ["exp", "rev"] as const) {
      const r = { ...base, view, year, group: null, item: null };
      paths.push(buildUrl(r, latest));
      const groups =
        view === "exp"
          ? budget.expenses.map((g) => ({ n: g.uo, rows: g.rows }))
          : budget.revenues.map((g) => ({ n: g.id_start, rows: g.rows }));
      for (const g of groups) {
        paths.push(buildUrl({ ...r, group: g.n }, latest));
        for (const row of g.rows) paths.push(buildUrl({ ...r, group: g.n, item: row.id }, latest));
      }
    }
  }
  return paths;
}

export function sitemapXml(data: Data, origin: string): string {
  const urls = sitemapPaths(data).map((p) => `  <url><loc>${esc(origin + p)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Search pages, the API and the raw app bundle are not for indexing; the icons and images are. */
export function robotsTxt(origin: string): string {
  return ["User-agent: *", "Disallow: /sok", "Disallow: /api/", "Disallow: /__index", "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
}

// ---- Structured data ------------------------------------------------------------------

/** JSON-LD for the page: the site (with its search box) on the front page, breadcrumbs when drilled down. */
export function structuredData(route: Route, data: Data, origin: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (route.mode === "overview") {
    out.push({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      alternateName: "Statsbudgeten.se",
      url: `${origin}/`,
      inLanguage: "sv-SE",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${origin}/sok?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    });
  }
  if (route.mode === "explore") {
    const s = resolve({ ...route, real: false, unit: "kr" }, data);
    if (s) {
      const T = COPY[route.view];
      const latest = data.years[0] ?? null;
      const r = { ...route, q: "", real: false, unit: "kr" as const, year: yearOf(route, data) };
      const crumbs: { name: string; path: string }[] = [
        { name: SITE_NAME, path: "/" },
        { name: `${T.label} ${s.year}`, path: buildUrl({ ...r, group: null, rest: false, item: null }, latest) },
      ];
      if (s.group) crumbs.push({ name: s.group.title, path: buildUrl({ ...r, rest: false, item: null }, latest) });
      if (s.focused) crumbs.push({ name: s.focused.title, path: buildUrl({ ...r, rest: false }, latest) });
      out.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: origin + c.path })),
      });
    }
  }
  return out;
}

// ---- The static page ----------------------------------------------------------------

const inlineHtml = (inlines: Inline[]): string =>
  inlines
    .map((i) => {
      if (i.t === "link") return `<a href="${esc(i.href)}">${esc(i.s)}</a>`;
      if (i.t === "strong") return `<strong>${esc(i.s)}</strong>`;
      if (i.t === "code") return `<code>${esc(i.s)}</code>`;
      return esc(i.s);
    })
    .join("");

/** The about page's Markdown as HTML. The `[sources]` download list is the app's. */
export function blocksHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.t === "h") return `<h${b.level}>${inlineHtml(b.inlines)}</h${b.level}>`;
      if (b.t === "p") return `<p>${inlineHtml(b.inlines)}</p>`;
      if (b.t === "ul") return `<ul>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</ul>`;
      return "";
    })
    .join("\n");
}

const link = (path: string, text: string) => `<a href="${esc(path)}">${esc(text)}</a>`;

/** An amount and its share of a total; a negative amount (a deduction) has no share. */
const amount = (v: number, of: number) => (v > 0 ? `${fmd(v)} (${fpct((v / of) * 100)})` : `−${fmd(-v)}`);

/** A posting's or group's amount in every year that has it, oldest first. */
function history(data: Data, view: Route["view"], group: number, item: number | null): { year: number; v: number }[] {
  const out: { year: number; v: number }[] = [];
  for (const year of [...data.years].sort((a, b) => a - b)) {
    const b = data.budgets[year];
    if (!b) continue;
    let v: number | undefined;
    if (view === "exp") {
      const g = b.expenses.find((g) => g.uo === group);
      v = item == null ? g?.total : g?.rows.find((r) => r.id === item)?.expense;
    } else {
      const g = b.revenues.find((g) => g.id_start === group);
      v = item == null ? g?.total : g?.rows.find((r) => r.id === item)?.revenue;
    }
    if (v != null) out.push({ year, v });
  }
  return out;
}

const historyTable = (rows: { year: number; v: number }[], what: string) =>
  rows.length > 1
    ? `<table><caption>${esc(what)} per år, löpande priser</caption><thead><tr><th>År</th><th>Belopp</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${r.year}</td><td>${esc(r.v < 0 ? `−${fmd(-r.v)}` : fmd(r.v))}</td></tr>`)
        .join("")}</tbody></table>`
    : "";

/**
 * The HTML in #root before the app mounts: the page's heading and summary,
 * its numbers as a table, and links to the pages below it. The app replaces
 * it on mount; crawlers and readers without JavaScript keep it.
 */
export function prerender(route: Route, data: Data, about: Block[], votes: BudgetVotes = {}): string {
  const latest = data.years[0] ?? null;
  const nav = `<nav aria-label="Huvudmeny">${[link("/", "Översikt"), link("/utgifter", "Utgifter"), link("/inkomster", "Inkomster"), link("/budgetar", "Budgetar"), link("/om", "Om sajten")].join(" · ")}</nav>`;
  const foot = `<p>Alla belopp kommer oförändrade från Regeringskansliet och SCB. Sajten är fristående och öppen källkod.</p>`;

  if (route.mode === "about") return `<article class="prerender">${nav}${blocksHtml(about)}</article>`;

  if (route.mode === "budgets") {
    const years = [...data.years].sort((a, b) => b - a);
    const items = years
      .map((y) => {
        const b = data.budgets[y];
        const vote = votes[String(y)];
        const r: Route = { mode: "explore", view: "exp", year: y, group: null, rest: false, item: null, real: false, unit: "kr", scale: "zero", q: "" };
        const d = b ? b.revenuesTotal - b.expensesTotal : 0;
        const totals = b ? ` Utgifter ${fmd(b.expensesTotal)}, inkomster ${fmd(b.revenuesTotal)}, saldo ${sign(d)}${fmd(Math.abs(d))}.` : "";
        const voted = vote
          ? ` ${esc(voteLine(vote.parties, vote.support))} (${esc(partyNames([...vote.parties, ...(vote.support ?? [])]))}).${vote.note ? ` ${esc(vote.note)}` : ""} Källa: ${vote.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.label)}</a>`).join(", ")}.`
          : "";
        return `<li>${link(buildUrl(r, latest), `Statens budget ${y}`)}.${esc(totals)}${voted}</li>`;
      })
      .join("");
    return `<article class="prerender">${nav}<h1>Budgetar</h1><p>${esc(pageDescription(route, data) ?? "")}</p><ul>${items}</ul>${foot}</article>`;
  }
  if (route.mode === "search") {
    return `<article class="prerender">${nav}<h1>Sök i statsbudgeten</h1><p>Sök bland utgiftsområden, anslag, inkomsttyper och inkomsttitlar i det valda budgetåret.</p>${foot}</article>`;
  }

  if (route.mode === "overview") {
    const years = [...data.years].sort((a, b) => b - a);
    const rows = years
      .map((y) => {
        const b = data.budgets[y];
        if (!b) return "";
        const r = { mode: "explore" as const, year: y, group: null, rest: false, item: null, real: false, unit: "kr" as const, scale: "zero" as const, q: "" };
        const d = b.revenuesTotal - b.expensesTotal;
        return `<tr><th>${y}</th><td>${link(buildUrl({ ...r, view: "exp" }, latest), fmd(b.expensesTotal))}</td><td>${link(buildUrl({ ...r, view: "rev" }, latest), fmd(b.revenuesTotal))}</td><td>${esc((d < 0 ? "−" : "+") + fmd(Math.abs(d)))}</td></tr>`;
      })
      .join("");
    return `<article class="prerender">${nav}<h1>Sveriges statsbudget ${latest ?? ""}</h1><p>${esc(pageDescription(route, data) ?? SITE_TAGLINE)}</p><p>Statsbudgeten.se visar statens utgifter och inkomster som en karta: varje ruta är ett utgiftsområde eller en inkomsttyp och storleken motsvarar beloppet. Klicka dig ner till enskilda anslag och inkomsttitlar och se hur de utvecklats år för år, med eller utan inflationsjustering.</p><table><caption>Statens budget per år, löpande priser</caption><thead><tr><th>År</th><th>Utgifter</th><th>Inkomster</th><th>Saldo</th></tr></thead><tbody>${rows}</tbody></table>${foot}</article>`;
  }

  const s = resolve({ ...route, real: false, unit: "kr" }, data);
  if (!s) return `<article class="prerender">${nav}<h1>${esc(SITE_NAME)}</h1><p>${esc(SITE_TAGLINE)}</p></article>`;
  const T = COPY[route.view];
  const r = { ...route, q: "", real: false, unit: "kr" as const, year: yearOf(route, data) };
  const description = pageDescription({ ...route, real: false, unit: "kr" }, data) ?? "";
  const crumbs = [link("/", SITE_NAME), link(buildUrl({ ...r, group: null, rest: false, item: null }, latest), `${T.label} ${s.year}`)];
  if (s.group) crumbs.push(link(buildUrl({ ...r, rest: false, item: null }, latest), s.group.title));
  const crumb = `<nav aria-label="Du är här">${crumbs.join(" › ")}</nav>`;
  const otherYears = data.years
    .filter((y) => y !== s.year)
    .map((y) => link(buildUrl({ ...r, year: y }, latest), String(y)));
  const yearsLine = otherYears.length ? `<p>Samma vy för ${otherYears.join(", ")}.</p>` : "";

  let body: string;
  if (s.focused && s.group) {
    const groupNo = route.group!;
    body = `<h1>${esc(s.focused.title)}</h1><p>${esc(description)}</p>${historyTable(history(data, route.view, groupNo, s.focused.id), s.focused.title)}<p>${T.item} ${s.focused.id} inom ${link(buildUrl({ ...r, rest: false, item: null }, latest), s.group.title)}.</p>`;
  } else if (s.group) {
    const groupNo = route.group!;
    const items = s.group.rows
      .filter((row) => row.v !== 0)
      .sort((a, b) => b.v - a.v)
      .map((row) => `<li>${link(buildUrl({ ...r, rest: false, item: row.id }, latest), row.title)}: ${esc(amount(row.v, s.group!.total))}</li>`)
      .join("");
    body = `<h1>${esc(s.group.title)}</h1><p>${esc(description)}</p>${historyTable(history(data, route.view, groupNo, null), s.group.title)}<h2>${esc(T.item)} ${s.year}</h2><ol>${items}</ol>`;
  } else {
    const groups = s.all
      .filter((g) => g.total !== 0)
      .sort((a, b) => b.total - a.total)
      .map((g) => `<li>${link(buildUrl({ ...r, group: Number(g.key.replace(/^\D+/, "")) }, latest), g.title)}: ${esc(amount(g.total, s.gross))}</li>`)
      .join("");
    body = `<h1>${esc(T.heading)} ${s.year}</h1><p>${esc(description)}</p><ol>${groups}</ol>`;
  }
  return `<article class="prerender">${nav}${crumb}${body}${yearsLine}${foot}</article>`;
}
