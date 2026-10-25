import { describe, expect, test } from "bun:test";
import { PartySchema } from "../types/BudgetVotesSchema";
import { PARTIES, partyLetters, partyNames, voteLine } from "./parties";
import { budgetVotes } from "./web/content.macro";

describe("party helpers", () => {
  test("every party in the schema has its metadata", () => {
    for (const p of PartySchema.options) expect(PARTIES[p].name.length).toBeGreaterThan(0);
  });

  test("letters read as Swedish prose", () => {
    expect(partyLetters([])).toBe("");
    expect(partyLetters(["S"])).toBe("S");
    expect(partyLetters(["S", "MP"])).toBe("S och MP");
    expect(partyLetters(["M", "KD", "L"])).toBe("M, KD och L");
  });

  test("the vote line names the support parties separately", () => {
    expect(voteLine(["M", "KD", "L"], ["SD"])).toBe("Röstades fram av M, KD och L, med stöd av SD");
    expect(voteLine(["M", "KD", "SD"])).toBe("Röstades fram av M, KD och SD");
    expect(voteLine(["S", "MP"], [])).toBe("Röstades fram av S och MP");
  });

  test("full names for tooltips", () => {
    expect(partyNames(["M", "SD"])).toBe("Moderaterna, Sverigedemokraterna");
  });
});

describe("content/budgetar.json", () => {
  // budgetVotes() validates against the Zod schema, so loading is the test.
  const votes = budgetVotes();

  test("has entries and they look like budget years", () => {
    const years = Object.keys(votes).map(Number);
    expect(years.length).toBeGreaterThan(0);
    for (const y of years) expect(y).toBeWithin(2000, 2101);
  });

  test("every entry cites at least one https source", () => {
    for (const vote of Object.values(votes)) {
      expect(vote.sources.length).toBeGreaterThan(0);
      for (const s of vote.sources) expect(s.url).toStartWith("https://");
    }
  });

  test("a party never both stands behind a budget and merely supports it", () => {
    for (const vote of Object.values(votes)) {
      for (const p of vote.support ?? []) expect(vote.parties).not.toContain(p);
    }
  });
});
