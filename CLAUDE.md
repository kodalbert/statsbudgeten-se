# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

[statsbudgeten.se](https://statsbudgeten.se) — Sweden's state budget as an interactive treemap. Official Excel workbooks (regeringen.se, SCB) are converted to committed JSON; a single Bun process serves the React app, SEO prerenders, share images, and an MCP endpoint. All amounts are in tkr (tusentals kronor) everywhere. UI text and domain terms are Swedish (utgiftsområde, anslag, inkomsttyp, inkomsttitel).

## Commands

```bash
bun run web                        # dev server with hot reload, http://localhost:3000
bun test                           # all tests
bun test src/search.test.ts        # one file
bun test -t "name"                 # tests matching a name
bun run convert                    # every examples/<year>.xlsx -> data/<year>.json
bun run convert path/to/2027.xlsx  # one workbook
bun run convert-inflation          # examples/inflation.xlsx -> data/inflation.json
bun run changelog                  # git history -> data/changelog.json (the Uppdateringar page)
```

There is no build step: Bun serves `src/web/index.html`, which bundles `src/web/frontend.tsx` directly. Deploys go to Fly.io with `fly deploy` (`fly.toml`, `Dockerfile`).

## Architecture

**Data pipeline.** `examples/*.xlsx` (official workbooks, committed) → `src/parseBudget.ts` / `src/parseInflation.ts` (via `src/cli.ts` / `src/inflationCli.ts`) → `data/<year>.json` + `data/inflation.json` (committed, so a checkout runs without converting). `src/xlsx.ts` is a small built-in xlsx reader — no xlsx dependency. Zod schemas in `types/` validate everything read or written; `index.ts` re-exports parsers and schemas as a library. Parsing validates every subtotal against the sheet's own sums (revenues may differ by ±2 tkr due to the official file's rounding). Workbook layout quirks vary by year; `parseBudget.ts` detects them per sheet — see its header comment and `docs/BUDGET_SCHEMA.md`. Adding a budget year = drop the workbook in `examples/` and run `bun run convert`; the app adapts to whatever years exist in `data/`.

**Server** (`src/server.ts`, ~260 lines). One `Bun.serve()` handles: the HTML-imported app, static assets (icon links injected by the server, not `index.html`, because Bun's HTML bundler tries to resolve link hrefs as build assets), workbook downloads at `/examples/<file>`, SEO (`src/seo.ts`: per-URL title/description/OG tags, JSON-LD, a static no-JS version of each page inside `#root`, `/sitemap.xml`, `/robots.txt`), share images at `/social/<page>.png` (`src/social.ts`: chart drawn as SVG, rasterised with resvg and the bundled Inter font; LRU-cached), and the MCP endpoint at `/mcp`. Respects `PORT` and `NODE_ENV=production`; `SITE_URL` overrides the public origin.

**Shared chart model** (`src/web/model.ts`). Pure functions only — no React, no DOM: number formatting, normalised budget shape, treemap layout, line-chart scales, colours. Both the browser app (`frontend.tsx`) and the server-side share images (`social.ts`) render from this same model, so a change here affects both. Rows below 0.6 % of their group are bundled into an "Övriga" tile.

**Routing** (`src/web/routes.ts`). URL ⇄ app state, used by both the client and the server (SEO, share images). The URL mirrors everything on screen: path for view/group/focused posting, query for `year`, `inflation`, `andel`, `skala`. The route table is documented in the file header and README. Canonical URLs drop the search query, inflation toggle and unit.

**MCP server** (`src/mcp.ts`). Stateless Streamable HTTP, written against the protocol directly — deliberately no MCP SDK. Tool list, argument schemas (enumerating the years/areas that actually exist), resource list and search indexes are built once from the data at startup. POST only; GET/DELETE answer 405.

**Inflation** (`src/inflation.ts`). `rates[Y]` is CPI change from Y−1 to Y; converting year A into year B's prices chains rates A+1…B. Amounts are re-expressed in the latest budget year that has its own rate; years that can't be converted stay nominal and are marked `*`. See `data/README.md`.

**Changelog** (`src/changelog.ts`). The Uppdateringar page (`/uppdateringar`) shows the deployed version's git history from the committed `data/changelog.json`, written by `bun run changelog` (the production image has no `.git`) — run it and commit before deploying. Merge commits are skipped and agent/bot authors (Claude et al.) are replaced by the first human co-author or dropped; only names, never emails.

**Other pieces.** `src/markdown.ts` is a small Markdown subset for the about page (`content/om.md`), parsed at bundle time by a Bun macro (`src/web/content.macro.ts`); a `![title](youtube url)` line embeds a video, and the `[sources]` line becomes workbook download links. `src/search.ts` is case- and diacritic-insensitive search over areas and postings. `src/web/analytics.ts` holds the GA measurement ID; not loaded on localhost. Charts are plain DOM/SVG — no charting library.

## Conventions

- Tests live next to their module (`src/foo.test.ts`), using `bun:test`.
- The numbers are parsed verbatim from the official workbooks — never adjust, estimate or fabricate amounts.
- Requires Bun ≥ 1.4 (the lockfile is in Bun's v2 format).

## Bun

Default to Bun instead of Node.js:

- `bun <file>`, `bun test`, `bun install`, `bun run <script>`, `bunx <pkg>` — not node/ts-node/jest/vitest/npm/yarn/pnpm/npx.
- `Bun.serve()` for HTTP/WebSockets/routes (no express), `bun:sqlite` (no better-sqlite3), `Bun.file` over `node:fs` read/write, `Bun.$\`cmd\`` over execa.
- Bun loads `.env` automatically — no dotenv.
- Frontend via HTML imports with `Bun.serve()` (no vite): HTML files import `.tsx`/`.css` directly and Bun bundles them.
- Bun API docs: `node_modules/bun-types/docs/**.mdx`.
