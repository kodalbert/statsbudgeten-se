/**
 * Web interface for browsing the budget JSON files in data/.
 *
 * Usage: bun --hot src/server.ts  (or `bun run web`)
 */
import index from "./web/index.html";
import { InflationSchema } from "../types/InflationSchema";

const root = new URL("..", import.meta.url).pathname;

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
  const files = [...new Bun.Glob("examples/*.{xlsx,xls}").scanSync(root)].map((p) => p.replace(/^examples\//, ""));
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

/** Favicon, app icons, the social share image and the web manifest, from assets/. */
const asset = (file: string, type: string) =>
  new Response(Bun.file(`${root}assets/${file}`), { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,
    // The app owns these paths; they mirror the drill state (src/web/routes.ts).
    "/utgifter": index,
    "/utgifter/*": index,
    "/inkomster": index,
    "/inkomster/*": index,
    "/om": index,
    "/favicon.svg": () => asset("favicon.svg", "image/svg+xml"),
    "/apple-touch-icon.png": () => asset("apple-touch-icon.png", "image/png"),
    "/icon-192.png": () => asset("icon-192.png", "image/png"),
    "/icon-512.png": () => asset("icon-512.png", "image/png"),
    "/icon-maskable-512.png": () => asset("icon-maskable-512.png", "image/png"),
    "/social.png": () => asset("social.png", "image/png"),
    "/site.webmanifest": () => asset("site.webmanifest", "application/manifest+json"),
    "/sok": index,
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
