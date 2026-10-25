# Statsbudgeten

**[statsbudgeten.se](https://statsbudgeten.se)** shows Sweden's state budget as an
interactive treemap: every utgiftsområde and inkomsttyp is a tile sized by its
amount. Click a tile to drill into its anslag or inkomsttitlar, see how an area
or a single posting has developed over the years, switch budget year, adjust
for inflation, or search for any posting by name.

All amounts come unchanged from the official sources. The site is independent
and has no connection to Regeringskansliet or SCB.

- **Budget:** [Statens budget som Excel](https://www.regeringen.se/sveriges-regering/finansdepartementet/statens-budget/statens-budget-som-excel/)
  from Regeringskansliet, Finansdepartementet. One workbook per budget year.
- **Inflation:** [Inflation i Sverige](https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-ekonomiska-tendenser/priser/konsumentprisindex-kpi/pong/tabell-och-diagram/historiska-tal/inflation-i-sverige/)
  from SCB, consumer price index (KPI), annual averages.

## Running it

Requires [Bun](https://bun.sh) 1.4 or newer (the lockfile is in Bun's version 2
format). There are no runtime dependencies beyond React and Zod; the xlsx files
are read by a small built-in parser.

```bash
bun install
bun run web        # http://localhost:3000, with hot reload
bun test           # parsers, inflation math, markdown, routes, search
```

The server lists every `data/<year>.json` it finds. With more than one year
present, the year picker lets you switch budget year and every area and posting
gets a history line chart. The URL mirrors what is on screen (`src/web/routes.ts`):

| URL | View |
|---|---|
| `/` | Overview: inkomster vs utgifter per year |
| `/utgifter`, `/inkomster` | Treemap of all utgiftsområden / inkomsttyper |
| `/utgifter/6` | Utgiftsområde 6: its history graph above the treemap of its anslag |
| `/utgifter/6/3` | …with anslag 3 focused, so the graph shows that anslag |
| `/utgifter/6/ovriga`, `/utgifter/6/ovriga/23` | The "Övriga" bundle of small postings, optionally with one focused |
| `/inkomster/1000/1111` | Inkomsttyp 1000 with inkomsttitel 1111 focused |
| `/budgetar` | Every budget year, with who voted it through the riksdag (`content/budgetar.json`) and the source |
| `/sok?q=försvar` | Search over areas and postings in the selected year |
| `/om` | About page, written in `content/om.md` (`![title](youtube url)` on its own line embeds a video) |
| `/sitemap.xml`, `/robots.txt` | For search engines: every page of every year, generated from the data |
| `/mcp` | [MCP](https://modelcontextprotocol.io) endpoint for LLM clients, see below |
| `…?year=2024` | Budget year (omitted for the latest year) |
| `…?inflation=1` | Amounts adjusted for inflation |
| `…?andel=inkomster` | Graphs in percent of the year's revenues (`andel=utgifter`: of expenses) |
| `…?skala=relativ` | The graphs' y-axis follows the data instead of starting at zero |

## Search engines

The app renders in the browser, but every page is served with a head and body
a crawler can use without JavaScript (`src/seo.ts`): the title, description and
canonical URL for the view, Open Graph tags with a share image of the chart,
JSON-LD (the site with its search box, breadcrumbs when drilled down), the icon
links, and inside `#root` a static version of the page: its heading, its numbers
as a table, and links to every page below it. The app replaces it on mount.
The canonical URL drops the search query, the inflation toggle and the unit,
and `/sitemap.xml` lists the canonical URL of every view, group and posting in
every year. The icon links are added by the server rather than written in
`index.html`, because Bun's HTML bundler tries to resolve every link href as a
build asset.

## MCP server

The same data is available to LLM clients over the Model Context Protocol at
`https://statsbudgeten.se/mcp` (`src/mcp.ts`), so a model can look up a budget
year, an utgiftsområde, a single anslag or how it has developed over the years,
without scraping the site. Every result includes the URL of the page that shows
it, for citation. It is served by the same Bun process as the site; there is no
separate server or container to run.

Connect from Claude Code:

```bash
claude mcp add --transport http statsbudgeten https://statsbudgeten.se/mcp
```

In Claude (web or desktop), add it under *Settings → Connectors → Add custom
connector* with the same URL. Any client that speaks the Streamable HTTP
transport works; the endpoint needs no authentication.

| Tool | Does |
|---|---|
| `list_years` | The budget years the server has, the latest one, and the price level used for inflation adjustment |
| `get_overview(year?)` | Totals for a year and every utgiftsområde and inkomsttyp with its total |
| `get_area(uo, year?)` | One utgiftsområde with all of its anslag, largest first |
| `get_revenue_type(code, year?)` | One inkomsttyp with all of its inkomsttitlar, largest first |
| `search(query, year?, limit?)` | The site's search: case- and diacritic-insensitive, over areas and postings |
| `get_history(view, group, id?, year?, inflation?)` | An area, type or single posting across every year, nominal and optionally in fixed prices |

The raw JSON of every year and the inflation series are exposed as MCP
resources (`statsbudgeten://budget/2026`, `statsbudgeten://inflation`). All
amounts are in tkr, as everywhere else.

The endpoint is a stateless Streamable HTTP server written against the protocol
directly, without the MCP SDK (which would pull in Express and a few dozen
packages for what is a handful of JSON-RPC methods). Everything a client sees
is built once from the committed data when the server starts: the tool list,
whose argument schemas enumerate the years and areas that actually exist, the
resource list, and a search index per year. A POST carries one JSON-RPC
message and gets the reply as JSON; GET and DELETE answer 405 since there is
no server-to-client stream and no session. To try it without a client:

```bash
curl -s https://statsbudgeten.se/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"försvar","limit":3}}}'
```

## Data

The official workbooks live in `examples/` and are converted to JSON in `data/`
by scripts that validate every subtotal against the sheet's own sums. The JSON
files are committed, so a checkout runs without converting anything.

```bash
bun run convert                  # every examples/<year>.xlsx -> data/<year>.json
bun run convert path/to/2027.xlsx
bun run convert-inflation        # examples/inflation.xlsx -> data/inflation.json
```

- `docs/BUDGET_SCHEMA.md` describes the JSON shape and how the workbooks map to it,
  including the layout quirks that differ between years.
- `data/README.md` describes the inflation file and how amounts are re-expressed
  in the latest year's prices.
- `types/` holds the Zod schemas; `index.ts` re-exports the parsers and schemas
  for use as a library.

Adding a budget year is a matter of dropping the workbook into `examples/` and
running `bun run convert`. The web app adapts to whatever years are present.

## How it is built

Bun serves `src/web/index.html`, which bundles the React app in `src/web/frontend.tsx`
with no build step. The treemap and the line charts are drawn with plain DOM and
SVG, without a charting library. The about page is a small Markdown subset
(`src/markdown.ts`) parsed at bundle time by a Bun macro (`src/web/content.macro.ts`);
the `[sources]` line becomes download links for the workbooks in `examples/`,
which the server serves at `/examples/<file>`.

Link previews show the chart the page shows: the server fills in the share tags
(`og:title`, `og:description`, `og:image`) for each app URL and draws the image
on demand at `/social/<page>.png`, for example `/social/utgifter/6.png?year=2024`.
The image is the same model as the app (`src/web/model.ts`) written as SVG and
rasterised with resvg (`src/social.ts`), using the bundled Inter font so it looks
the same on every machine. The about and search pages use the static `/social.png`. The *Dela* button on
every chart page offers the same image as a square, 4:5 or 9:16 (`?format=square`,
`portrait`, `story`) for posting, through the system share sheet or as a download.

Google Analytics is wired up in `src/web/analytics.ts` (measurement ID at the top
of the file). It is not loaded on localhost. Each URL change is reported as a page
view and flipping the inflation toggle is an event.

## Deploying

The repo ships with a `fly.toml` (app `statsbudgeten-se`, region `arn`/Stockholm)
and a `Dockerfile`. First time, `fly launch --no-deploy` to create the app under
your own account, then:

```bash
fly deploy
```

The server respects `PORT` and disables dev mode when `NODE_ENV=production`,
both set by the Fly config.

## Credits

Made by Albert ([proddalbert.se](https://proddalbert.se), @ProddAlbert). Most of the
code was written together with [Claude](https://claude.com) (Anthropic's AI
assistant, via Claude Code) from Albert's design, data models and direction,
with Albert reviewing and steering the work. No AI is involved in the numbers
themselves; they are parsed verbatim from the official workbooks.

## License

The code is released under the [MIT License](LICENSE). The budget workbooks are
public documents from Regeringskansliet and the inflation series is open data
from SCB; both are redistributed here unchanged, with attribution.
