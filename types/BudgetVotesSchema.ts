import z from "zod";

/**
 * Who voted a budget through the riksdag (content/budgetar.json).
 *
 * The content is written by hand, not derived from the workbooks: each budget
 * year names the parties behind the passed budget, the parties that released
 * it through the vote, and at least one source — normally the rambeslut
 * (finansutskottets betänkande FiU1) on riksdagen.se.
 */

/** Party letters as the riksdag writes them; FP is Folkpartiet before the 2015 rename to L. */
export const PartySchema = z.enum(["S", "M", "SD", "C", "V", "KD", "L", "MP", "FP"]);
export type Party = z.infer<typeof PartySchema>;

export const VoteSourceSchema = z.object({
  /** What the link is, e.g. "Rambeslutet, bet. 2022/23:FiU1". */
  label: z.string().min(1),
  url: z.string().url(),
});
export type VoteSource = z.infer<typeof VoteSourceSchema>;

export const BudgetVoteSchema = z.object({
  /** The parties behind the budget that passed (government or winning reservation). */
  parties: z.array(PartySchema).min(1),
  /** Parties that voted for it without being behind it (stödpartier). */
  support: z.array(PartySchema).optional(),
  sources: z.array(VoteSourceSchema).min(1),
});
export type BudgetVote = z.infer<typeof BudgetVoteSchema>;

export const BudgetVotesSchema = z.record(z.string().regex(/^\d{4}$/), BudgetVoteSchema);
export type BudgetVotes = z.infer<typeof BudgetVotesSchema>;
