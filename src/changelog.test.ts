import { describe, expect, test } from "bun:test";
import { isAgent, parseGitLog, realAuthor, repoUrl } from "./changelog";

const FS = "\x1f";
const RS = "\x1e";

/** A record as `git log` emits it with src/changelog.ts's format string. */
const rec = (hash: string, date: string, name: string, email: string, subject: string, ...coauthors: string[]) =>
  [hash, date, name, email, subject, ...coauthors].join(FS) + RS + "\n";

const HASH = "c02872bafa3d87ff57b7db27469b5ec761acfbf2";

describe("parseGitLog", () => {
  test("keeps hash, date, author name and subject — never the email", () => {
    const raw = rec(HASH, "2026-10-25", "Albert", "albert@example.se", "Parse the 2013-2021 budget workbooks");
    expect(parseGitLog(raw)).toEqual([{ hash: HASH, date: "2026-10-25", author: "Albert", subject: "Parse the 2013-2021 budget workbooks" }]);
  });

  test("a human author with an agent co-author stays the author", () => {
    const raw = rec(HASH, "2026-10-25", "Albert", "a@b.se", "Fix favicon", "Claude Fable 5 <noreply@anthropic.com>");
    expect(parseGitLog(raw)).toEqual([{ hash: HASH, date: "2026-10-25", author: "Albert", subject: "Fix favicon" }]);
  });

  test("an agent-authored commit is attributed to its first human co-author", () => {
    const raw = rec(HASH, "2026-10-25", "Claude", "noreply@anthropic.com", "Add SEO tags", "Claude Opus <noreply@anthropic.com>", "Albert <a@b.se>");
    expect(parseGitLog(raw)).toEqual([{ hash: HASH, date: "2026-10-25", author: "Albert", subject: "Add SEO tags" }]);
  });

  test("a commit with no human at all is dropped", () => {
    const raw = rec(HASH, "2026-10-25", "github-actions[bot]", "actions@github.com", "Bump deps");
    expect(parseGitLog(raw)).toEqual([]);
  });

  test("reads several records and skips blank trailing output", () => {
    const raw =
      rec(HASH, "2026-10-25", "Albert", "a@b.se", "Newer") + rec("a".repeat(40), "2026-10-19", "ProddAlbert", "p@b.se", "Older") + "\n";
    expect(parseGitLog(raw).map((c) => c.subject)).toEqual(["Newer", "Older"]);
  });
});

describe("realAuthor and isAgent", () => {
  test("knows the common agents and bots", () => {
    for (const id of [
      "Claude Fable 5 <noreply@anthropic.com>",
      "GitHub Copilot <copilot@github.com>",
      "dependabot[bot] <x@github.com>",
      "github-actions <actions@github.com>",
    ])
      expect(isAgent(id)).toBe(true);
    expect(isAgent("Albert <78356544+kodalbert@users.noreply.github.com>")).toBe(false);
    expect(isAgent("ProddAlbert <albert@example.se>")).toBe(false);
  });

  test("picks the first human and strips the email", () => {
    expect(realAuthor(["Claude <noreply@anthropic.com>", "Albert <a@b.se>"])).toBe("Albert");
    expect(realAuthor(["Claude <noreply@anthropic.com>"])).toBeNull();
    expect(realAuthor([" <>"])).toBeNull();
  });
});

describe("repoUrl", () => {
  test("normalises ssh and https remotes to a web URL", () => {
    expect(repoUrl("git@github.com:kodalbert/statsbudgeten-se.git\n")).toBe("https://github.com/kodalbert/statsbudgeten-se");
    expect(repoUrl("https://github.com/kodalbert/statsbudgeten-se.git")).toBe("https://github.com/kodalbert/statsbudgeten-se");
    expect(repoUrl("https://github.com/kodalbert/statsbudgeten-se")).toBe("https://github.com/kodalbert/statsbudgeten-se");
    expect(repoUrl("")).toBeNull();
  });
});
