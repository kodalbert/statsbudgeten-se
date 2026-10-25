/**
 * Bun macro: runs at bundle time and inlines its JSON result into the
 * client bundle, so the Markdown in content/ is converted when the site
 * is built, not in the browser. Imported with `with { type: "macro" }`.
 * It reads synchronously so the call site is typed as a plain value.
 */
import { readFileSync } from "node:fs";
import { parseMarkdown, type Block } from "../markdown";
import { BudgetVotesSchema, type BudgetVotes } from "../../types/BudgetVotesSchema";

export function aboutContent(): Block[] {
  return parseMarkdown(readFileSync(`${import.meta.dir}/../../content/om.md`, "utf8"));
}

/** content/budgetar.json: who voted each budget through, validated at build time. */
export function budgetVotes(): BudgetVotes {
  return BudgetVotesSchema.parse(JSON.parse(readFileSync(`${import.meta.dir}/../../content/budgetar.json`, "utf8")));
}
