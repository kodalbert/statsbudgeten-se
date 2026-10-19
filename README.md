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
| `/sok?q=försvar` | Search over areas and postings in the selected year |
| `/om` | About page, written in `content/om.md` |
| `…?year=2024` | Budget year (omitted for the latest year) |
| `…?inflation=1` | Amounts adjusted for inflation |
| `…?andel=inkomster` | Graphs in percent of the year's revenues (`andel=utgifter`: of expenses) |
| `…?jamfor=inkomster/1000/1111` | A second posting (or area: `jamfor=utgifter/4`) drawn in the focus graph for comparison |
| `…?index=1` | …both series as an index, first year = 100 |

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
