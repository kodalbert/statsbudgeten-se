/**
 * Pulls Sweden's GDP (BNP till marknadspris, löpande priser) from SCB's
 * statistics database and writes it to data/bnp.json.
 *
 * Source table: TAB3573 (Nationalräkenskaper, ENS2010), sector S1 (totala
 * ekonomin), transaction B1gm (BNP till marknadspris), all available years.
 * SCB reports mnkr; the output is converted to tkr like the rest of data/.
 *
 * Usage: bun run pull-bnp
 */
import z from "zod";
import { BnpSchema } from "../types/BnpSchema";

const API = "https://statistikdatabasen.scb.se/api/v2/tables/TAB3573/data";

// JSON-stat2 dataset, reduced to the parts we read.
const DatasetSchema = z.object({
  updated: z.string(),
  id: z.array(z.string()),
  size: z.array(z.number()),
  dimension: z.object({
    ContentsCode: z.object({
      category: z.object({
        unit: z.record(z.string(), z.object({ base: z.string() })),
      }),
    }),
    Tid: z.object({
      category: z.object({
        index: z.record(z.string().regex(/^\d{4}$/), z.number()),
      }),
    }),
  }),
  value: z.array(z.number()),
});

const url = new URL(API);
url.searchParams.set("lang", "sv");
url.searchParams.set("valueCodes[ContentsCode]", "NR0103DS");
url.searchParams.set("valueCodes[Sektor]", "S1");
url.searchParams.set("valueCodes[Transaktionspost]", "B1gm");
url.searchParams.set("valueCodes[Tid]", "*");
url.searchParams.set("codelist[Transaktionspost]", "vs_TransPostENS2010Ar");

const res = await fetch(url);
if (!res.ok) {
  console.error(`SCB svarade ${res.status} ${res.statusText}`);
  process.exit(1);
}
const dataset = DatasetSchema.parse(await res.json());

// value is indexed by the Tid position once every other dimension has size 1.
const tidAxis = dataset.id.indexOf("Tid");
if (dataset.size.some((n, i) => i !== tidAxis && n !== 1)) {
  console.error(`Oväntad svarsform: size=[${dataset.size}], id=[${dataset.id}]`);
  process.exit(1);
}
const unit = Object.values(dataset.dimension.ContentsCode.category.unit)[0]?.base;
if (unit !== "mnkr") {
  console.error(`Oväntad enhet från SCB: ${unit} (förväntade mnkr)`);
  process.exit(1);
}

const bnp: Record<string, number> = {};
for (const [year, i] of Object.entries(dataset.dimension.Tid.category.index)) {
  const mnkr = dataset.value[i];
  if (mnkr == null) {
    console.error(`Värde saknas för ${year} (index ${i})`);
    process.exit(1);
  }
  bnp[year] = mnkr * 1000; // mnkr -> tkr
}

const json = BnpSchema.parse({
  description:
    "BNP till marknadspris i löpande priser, tkr. Nyckeln är året, värdet är BNP det året. " +
    "SCB publicerar serien i mnkr; värdena här är omräknade till tkr (×1000).",
  source: `SCB, Nationalräkenskaper (tabell TAB3573), BNP till marknadspris (B1gm), sektor S1, data t.o.m. ${Math.max(...Object.keys(bnp).map(Number))}`,
  updated: dataset.updated,
  bnp,
});

const outPath = `${import.meta.dir}/../data/bnp.json`;
await Bun.write(outPath, JSON.stringify(json, null, 2) + "\n");

const years = Object.keys(bnp).map(Number);
const latest = Math.max(...years);
console.log(
  `SCB -> data/bnp.json: ${years.length} år (${Math.min(...years)}–${latest}), ` +
    `senast ${latest}: ${(bnp[String(latest)]! / 1_000_000_000).toFixed(1).replace(".", ",")} biljoner kr`,
);
