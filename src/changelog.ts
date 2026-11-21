/**
 * The Uppdateringar page's data: the git history as a changelog.
 *
 * `bun run changelog` (src/changelogCli.ts) runs `git ${GIT_LOG_ARGS}` and
 * writes the parsed result to data/changelog.json, which is committed: the
 * production image has no .git, so the deployed site shows the history of
 * the version that was deployed.
 *
 * Only human work is listed. Merge commits are skipped by git itself, and a
 * commit whose author is an AI agent or a bot is attributed to its first
 * human co-author instead — with none, the commit is dropped. Only names are
 * kept, never emails.
 */
import type { ChangelogCommit } from "../types/ChangelogSchema";

// Field and record separators; git expands the %x escapes. Subjects and
// names cannot contain control characters, so the split is unambiguous.
const FS = "\x1f";
const RS = "\x1e";

export const GIT_LOG_ARGS = [
  "log",
  "--no-merges",
  `--format=%H%x1f%as%x1f%an%x1f%ae%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1f)%x1e`,
];

/** Author identities ("Name <email>") that are tools rather than people. */
const AGENTS = [
  /\bclaude\b/i,
  /anthropic\.com/i,
  /\bcopilot\b/i,
  /\bdevin\b/i,
  /\bcodex\b/i,
  /\baider\b/i,
  /\bcursor\b/i,
  /\bopenai\b/i,
  /\[bot\]/i,
  /github-actions/i,
  /\bdependabot\b/i,
  /\brenovate\b/i,
];

export const isAgent = (ident: string): boolean => AGENTS.some((re) => re.test(ident));

/** "Albert <a@b.se>" → "Albert". */
const nameOf = (ident: string): string => ident.replace(/\s*<[^>]*>\s*$/, "").trim();

/** The first human in an identity list, or null when it is agents all the way. */
export function realAuthor(idents: string[]): string | null {
  const human = idents.find((id) => nameOf(id) && !isAgent(id));
  return human ? nameOf(human) : null;
}

/** The output of `git ${GIT_LOG_ARGS}` as changelog entries, agent authors resolved. */
export function parseGitLog(raw: string): ChangelogCommit[] {
  const out: ChangelogCommit[] = [];
  for (const rec of raw.split(RS)) {
    const [hash, date, name, email, subject, ...coauthors] = rec.replace(/^\s+/, "").split(FS);
    if (!hash || !date || !subject) continue;
    const author = realAuthor([`${name ?? ""} <${email ?? ""}>`, ...coauthors]);
    if (!author) continue;
    out.push({ hash, date, author, subject });
  }
  return out;
}

/** A git remote as a web URL: git@github.com:a/b.git → https://github.com/a/b. */
export function repoUrl(remote: string): string | null {
  const r = remote.trim();
  const ssh = r.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const http = r.match(/^(https?:\/\/.+?)(?:\.git)?\/?$/);
  return http ? http[1]! : null;
}
