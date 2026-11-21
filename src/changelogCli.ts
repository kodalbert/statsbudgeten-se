/**
 * Writes data/changelog.json from the repository's git history.
 *
 * Usage: bun run changelog
 *
 * Run it (and commit the result) before deploying, so the Uppdateringar page
 * matches the version that goes out — the production image has no .git.
 */
import { $ } from "bun";
import { ChangelogSchema } from "../types/ChangelogSchema";
import { GIT_LOG_ARGS, parseGitLog, repoUrl } from "./changelog";

const root = new URL("..", import.meta.url).pathname;
$.cwd(root);

const raw = await $`git ${GIT_LOG_ARGS}`.text();
const remote = await $`git remote get-url origin`.nothrow().quiet().text();
const changelog = ChangelogSchema.parse({ repo: repoUrl(remote), commits: parseGitLog(raw) });

await Bun.write(`${root}data/changelog.json`, JSON.stringify(changelog, null, 2) + "\n");
console.log(`data/changelog.json: ${changelog.commits.length} ändringar, senast ${changelog.commits[0]?.date ?? "–"}`);
