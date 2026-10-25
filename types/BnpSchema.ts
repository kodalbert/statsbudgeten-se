import z from "zod";

/**
 * data/bnp.json: Sweden's GDP (BNP till marknadspris, B1gm) per year.
 *
 * `bnp[Y]` is the nominal GDP for year Y in tkr (current prices). SCB
 * publishes the series in mnkr; the pull script multiplies by 1000 so the
 * file uses the same unit as everything else in data/.
 */
export const BnpSchema = z.object({
    description: z.string().optional(),
    source: z.string().optional(),
    updated: z.string().optional(),
    bnp: z.record(z.string().regex(/^\d{4}$/), z.number()),
});

export type Bnp = z.infer<typeof BnpSchema>;
