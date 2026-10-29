/**
 * Web interface for browsing the budget JSON files in data/.
 *
 * Usage: bun --hot src/server.ts  (or `bun run web`)
 */
import index from "./web/index.html";
import { BudgetJsonSchema, type BudgetJson } from "../types/BudgetJsonSchema";
import { ChangelogSchema } from "../types/ChangelogSchema";
import { InflationSchema } from "../types/InflationSchema";
import { HEIGHT, WIDTH, pageDescription, pageTitle, renderPng, routeForImage, socialImagePath, type Data } from "./social";
import { buildUrl, parseRoute } from "./web/routes";
import { parseMarkdown } from "./markdown";
import { HEAD_LINKS, canonicalPath, prerender, robotsTxt, sitemapXml, structuredData } from "./seo";
import { createMcp } from "./mcp";

// `import.meta.dir` is a filesystem path. A file-URL pathname (`/C:/...` on
// Windows) makes Bun.Glob fail, so the year list never includes data/*.json.
const root = `${import.meta.dir}/../`;

/** Years that have a data/<year>.json file, newest first. */
function listYears(): number[] {
  return [...new Bun.Glob("data/[0-9][0-9][0-9][0-9].json").scanSync(root)]
    .map((p) => Number(p.match(/(\d{4})\.json$/)?.[1]))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The source workbooks in examples/, for download from the about page. */
function listSources() {
  const files = [...new Bun.Glob("examples/*.{xlsx,xls}").scanSync(root)].map((p) => p.replace(/\\/g, "/").replace(/^examples\//, ""));
  const budgets = files
    .filter((f) => /^\d{4}\.xlsx?$/.test(f))
    .sort()
    .reverse()
    .map((f) => ({ file: f, label: `Statens budget ${f.slice(0, 4)}`, size: Bun.file(`${root}examples/${f}`).size }));
  const others = files
    .filter((f) => !/^\d{4}\.xlsx?$/.test(f))
    .sort()
    .map((f) => ({ file: f, label: /inflation/i.test(f) ? "Inflation i Sverige (SCB)" : f, size: Bun.file(`${root}examples/${f}`).size }));
  return [...budgets, ...others];
}

/** The about page's text, for the static HTML crawlers get (the app bundles its own copy). */
const aboutPromise = Bun.file(`${root}content/om.md`)
  .text()
  .then(parseMarkdown)
  .catch(() => []);

/** The committed changelog (bun run changelog), for the Uppdateringar page. */
const changelogPromise = Bun.file(`${root}data/changelog.json`)
  .json()
  .then((j) => ChangelogSchema.parse(j))
  .catch(() => null);

/** Favicon, app icons, the social share image and the web manifest, from assets/. */
const asset = (file: string, type: string) =>
  new Response(Bun.file(`${root}assets/${file}`), { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });

/** The public origin, for the absolute URLs in the share tags. */
const SITE = process.env.SITE_URL ?? (process.env.NODE_ENV === "production" ? "https://statsbudgeten.se" : null);

/** Every budget year and the inflation rates, read once for the share images. */
let dataPromise: Promise<Data> | null = null;
function loadData(): Promise<Data> {
  dataPromise ??= (async () => {
    const years = listYears();
    const budgets: Record<number, BudgetJson> = {};
    for (const y of years) budgets[y] = BudgetJsonSchema.parse(await Bun.file(`${root}data/${y}.json`).json());
    const file = Bun.file(`${root}data/inflation.json`);
    const inflation = (await file.exists()) ? InflationSchema.safeParse(await file.json()) : null;
    return { years, budgets, rates: inflation?.success ? inflation.data.rates : {} };
  })();
  return dataPromise;
}

/** The MCP server at /mcp (src/mcp.ts), built once from the data. */
let mcpPromise: Promise<ReturnType<typeof createMcp>> | null = null;
const mcp = (req: Request) => (mcpPromise ??= loadData().then((data) => createMcp(data, SITE))).then((m) => m.fetch(req));

/** Rendered share images by their URL, newest last; the oldest go when it is full. */
const images = new Map<string, Uint8Array>();
const IMAGE_CACHE = 64;

/** /social/<page>.png: the chart the page shows, as a PNG in the format the query asks for. */
async function socialImage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const image = routeForImage(url);
  if (!image) return new Response("Not found", { status: 404 });
  const { route, format } = image;
  const data = await loadData();
  // Equivalent URLs (say, the latest year spelled out) share one image.
  const key = `${format} ${buildUrl(route, data.years[0] ?? null)}`;
  let png = images.get(key);
  if (!png) {
    const rendered = renderPng(route, data, format);
    if (!rendered) return new Response("Not found", { status: 404 });
    png = rendered;
    if (images.size >= IMAGE_CACHE) images.delete(images.keys().next().value!);
    images.set(key, png);
  }
  return new Response(png as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}

/**
 * The bundled app page, fetched from this server over loopback.
 *
 * It must not go through the public URL: in production that request would
 * travel through Fly's proxy, which compresses the body. fetch() then
 * decompresses it but keeps the Content-Encoding header, and HTMLRewriter
 * would copy that header onto the rewritten, uncompressed page, which browsers
 * refuse with ERR_CONTENT_DECODING_FAILED. So the fetch stays local and only
 * the headers that describe the body are kept.
 */
async function bundledPage(): Promise<Response> {
  const res = await fetch(`http://127.0.0.1:${server.port}/__index`, { headers: { accept: "text/html" } });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/html;charset=utf-8",
      "cache-control": res.headers.get("cache-control") ?? "no-cache",
    },
  });
}

/**
 * The app page, with the head set for the URL: the title, a description, the
 * canonical URL, an og:image of the chart the page shows (so a link to a
 * drilled-down view previews that view), structured data, and in #root the
 * static HTML that crawlers get until the app mounts (src/seo.ts).
 */
async function page(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const html = await bundledPage();
  const data = await loadData().catch(() => null);
  if (!data) return html;
  const route = parseRoute(url);
  const origin = SITE ?? url.origin;
  const title = `${pageTitle(route, data)} – Statsbudgeten`;
  const description = pageDescription(route, data);
  const imagePath = socialImagePath(url);
  const image = imagePath ? { url: `${origin}${imagePath}`, w: WIDTH, h: HEIGHT, alt: title } : { url: `${origin}/social.png`, w: 1280, h: 640, alt: "Statsbudgeten.se" };
  const canonical = `${origin}${canonicalPath(route, data)}`;
  const jsonLd = structuredData(route, data, origin)
    .map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`)
    .join("");
  const set = (attr: string, value: string) => ({
    element: (el: HTMLRewriterTypes.Element) => {
      el.setAttribute(attr, value);
    },
  });
  const describe = {
    element: (el: HTMLRewriterTypes.Element) => {
      if (description) el.setAttribute("content", description);
    },
  };
  const about = await aboutPromise;
  const changelog = await changelogPromise;
  return new HTMLRewriter()
    .on("title", {
      element: (el) => {
        el.setInnerContent(title);
      },
    })
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:url"]', set("content", canonical))
    .on('link[rel="canonical"]', set("href", canonical))
    .on('meta[property="og:image"]', set("content", image.url))
    .on('meta[property="og:image:width"]', set("content", String(image.w)))
    .on('meta[property="og:image:height"]', set("content", String(image.h)))
    .on('meta[property="og:image:alt"]', set("content", image.alt))
    .on('meta[property="og:description"]', describe)
    .on('meta[name="description"]', describe)
    // Search results are not pages to index; the canonical /sok is.
    .on('meta[name="robots"]', set("content", route.mode === "search" ? "noindex, follow" : "index, follow, max-image-preview:large"))
    .on("head", {
      element: (el) => {
        el.append(HEAD_LINKS + jsonLd, { html: true });
      },
    })
    .on("#root", {
      element: (el) => {
        el.setInnerContent(prerender(route, data, about, changelog), { html: true });
      },
    })
    .transform(html);
}

/** Text responses that search engines fetch; the origin is the public one. */
const text = (body: string, type: string) => new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
async function sitemap(req: Request): Promise<Response> {
  const data = await loadData().catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return text(sitemapXml(data, SITE ?? new URL(req.url).origin), "application/xml; charset=utf-8");
}
const robots = (req: Request) => text(robotsTxt(SITE ?? new URL(req.url).origin), "text/plain; charset=utf-8");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": page,
    // The app owns these paths; they mirror the drill state (src/web/routes.ts).
    "/utgifter": page,
    "/utgifter/*": page,
    "/inkomster": page,
    "/inkomster/*": page,
    "/om": page,
    "/uppdateringar": page,
    "/sok": page,
    // The bundled app page itself; `page` fetches it and fills in the share tags.
    "/__index": index,
    "/social/*": socialImage,
    // Model Context Protocol over HTTP, for LLM clients (src/mcp.ts).
    "/mcp": mcp,
    "/sitemap.xml": sitemap,
    "/robots.txt": robots,
    "/favicon.ico": () => asset("favicon.ico", "image/x-icon"),
    "/favicon.svg": () => asset("favicon.svg", "image/svg+xml"),
    "/favicon-96.png": () => asset("favicon-96.png", "image/png"),
    "/apple-touch-icon.png": () => asset("apple-touch-icon.png", "image/png"),
    "/icon-192.png": () => asset("icon-192.png", "image/png"),
    "/icon-512.png": () => asset("icon-512.png", "image/png"),
    "/icon-maskable-512.png": () => asset("icon-maskable-512.png", "image/png"),
    "/social.png": () => asset("social.png", "image/png"),
    "/site.webmanifest": () => asset("site.webmanifest", "application/manifest+json"),
    "/api/sources": () => Response.json(listSources()),
    "/examples/:file": async (req) => {
      const { file } = req.params;
      if (!/^[\w.-]+\.xlsx?$/i.test(file)) return new Response("Bad file", { status: 400 });
      const f = Bun.file(`${root}examples/${file}`);
      if (!(await f.exists())) return new Response("Not found", { status: 404 });
      return new Response(f, {
        headers: {
          "content-type": XLSX_TYPE,
          "content-disposition": `attachment; filename="${file}"`,
          "cache-control": "public, max-age=86400",
        },
      });
    },
    "/api/years": () => Response.json(listYears()),
    "/api/changelog": async () =>
      Response.json((await changelogPromise) ?? { repo: null, commits: [] }, { headers: { "cache-control": "public, max-age=3600" } }),
    "/api/inflation": async () => {
      const file = Bun.file(`${root}data/inflation.json`);
      if (!(await file.exists())) return Response.json({ rates: {} });
      const parsed = InflationSchema.safeParse(await file.json());
      if (!parsed.success) {
        console.warn("data/inflation.json är ogiltig, ignoreras:", parsed.error.message);
        return Response.json({ rates: {} });
      }
      return Response.json(parsed.data, { headers: { "cache-control": "public, max-age=3600" } });
    },
    "/api/budget/:year": async (req) => {
      const { year } = req.params;
      if (!/^\d{4}$/.test(year)) return new Response("Bad year", { status: 400 });
      const file = Bun.file(`${root}data/${year}.json`);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Statsbudgeten på ${server.url}`);
