/**
 * The riksdag parties: full names and the colours their marks are drawn in.
 * Pure data shared by the app (party badges) and the server (prerender text).
 * The colours are the ones Swedish media convention uses for each party.
 */
import type { Party } from "../types/BudgetVotesSchema";

export type PartyInfo = {
  /** Full name, e.g. "Moderaterna". */
  name: string;
  /** Badge background. */
  color: string;
  /** Text colour that reads on the badge. */
  fg: string;
};

export const PARTIES: Record<Party, PartyInfo> = {
  S: { name: "Socialdemokraterna", color: "#e8112d", fg: "#ffffff" },
  M: { name: "Moderaterna", color: "#52bdec", fg: "#0b2a46" },
  SD: { name: "Sverigedemokraterna", color: "#dddd00", fg: "#3a3a00" },
  C: { name: "Centerpartiet", color: "#009933", fg: "#ffffff" },
  V: { name: "Vänsterpartiet", color: "#af0000", fg: "#ffffff" },
  KD: { name: "Kristdemokraterna", color: "#000077", fg: "#ffffff" },
  L: { name: "Liberalerna", color: "#006ab3", fg: "#ffffff" },
  MP: { name: "Miljöpartiet", color: "#83cf39", fg: "#1d3a06" },
  FP: { name: "Folkpartiet", color: "#006ab3", fg: "#ffffff" },
};

/** "M, KD och L" — party letters as Swedish prose. */
export function partyLetters(parties: Party[]): string {
  if (parties.length <= 1) return parties[0] ?? "";
  return `${parties.slice(0, -1).join(", ")} och ${parties[parties.length - 1]}`;
}

/** "Röstades fram av M, KD och L, med stöd av SD." */
export function voteLine(parties: Party[], support?: Party[]): string {
  const base = `Röstades fram av ${partyLetters(parties)}`;
  return support?.length ? `${base}, med stöd av ${partyLetters(support)}` : base;
}

/** The full party names behind a letter list, for tooltips and plain-HTML text. */
export const partyNames = (parties: Party[]): string => parties.map((p) => PARTIES[p].name).join(", ");
