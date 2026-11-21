import z from "zod";

/**
 * data/changelog.json: the site's git history, for the Uppdateringar page.
 *
 * Written by `bun run changelog` (src/changelogCli.ts) and committed, so the
 * deployed server — whose image carries no .git — can show the history of the
 * version it runs. Merge commits are left out, and `author` is always a human
 * name: a commit authored by an AI agent or bot is attributed to its first
 * human co-author, or dropped (src/changelog.ts).
 */
export const ChangelogCommitSchema = z.object({
    /** Full commit hash, for linking into the repository. */
    hash: z.string().regex(/^[0-9a-f]{7,40}$/),
    /** Author date as YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The human author's name; never an email. */
    author: z.string().min(1),
    /** The commit's subject line. */
    subject: z.string().min(1),
});

export const ChangelogSchema = z.object({
    /** The repository's web URL, for commit links; null when unknown. */
    repo: z.string().nullable(),
    /** Newest first. */
    commits: z.array(ChangelogCommitSchema),
});

export type ChangelogCommit = z.infer<typeof ChangelogCommitSchema>;
export type Changelog = z.infer<typeof ChangelogSchema>;
