import { cn } from "cn";
import { useEffect, useMemo, useState } from "react";
import { ChangelogSchema, type Changelog, type ChangelogCommit } from "@/types/ChangelogSchema";

/** Dates like "25 oktober 2026". */
const DAY = new Intl.DateTimeFormat("sv-SE", { dateStyle: "long" });

function CommitItem({ repo, commit }: { repo: string | null; commit: ChangelogCommit }) {
  return (
    <li>
      {repo ? (
        <a href={`${repo}/commit/${commit.hash}`} target="_blank" rel="noopener">
          {commit.subject}
        </a>
      ) : (
        commit.subject
      )}
      <span className="muted"> · {commit.author}</span>
    </li>
  );
}

function Day({ date, commits, repo }: { date: string; commits: ChangelogCommit[]; repo: string | null }) {
  return (
    <section>
      <h2>
        <time dateTime={date}>{DAY.format(new Date(date))}</time>
      </h2>
      <ul className="commits">
        {commits.map((c) => (
          <CommitItem key={c.hash} repo={repo} commit={c} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The Uppdateringar page: the deployed version's commit history, from the
 * committed data/changelog.json (src/changelog.ts), grouped by day. Subjects
 * link to the commit on GitHub when the repository URL is known.
 */
export function Updates() {
  const [log, setLog] = useState<Changelog | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/changelog")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const parsed = ChangelogSchema.safeParse(j);
        setLog(parsed.success ? parsed.data : null);
      })
      .catch(() => !cancelled && setLog(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    const byDay = new Map<string, ChangelogCommit[]>();
    for (const c of log?.commits ?? []) {
      if (!byDay.has(c.date)) byDay.set(c.date, []);
      byDay.get(c.date)!.push(c);
    }
    return [...byDay.entries()];
  }, [log]);

  return (
    <div className={cn("panel", "about", "updates")}>
      <article className="prose" lang="sv">
        <h1>Uppdateringar</h1>
        <p>
          Vad som ändrats på statsbudgeten.se, ur versionshistoriken för den version av sajten som är i drift.
          {log?.repo && (
            <>
              {" "}
              Hela historiken finns på{" "}
              <a href={log.repo} target="_blank" rel="noopener">
                GitHub
              </a>
              .
            </>
          )}
        </p>
        {log === undefined && <p className="muted">Hämtar ändringar …</p>}
        {log === null && <p className="muted">Kunde inte läsa ändringshistoriken.</p>}
        {log?.commits.length === 0 && <p className="muted">Inga ändringar att visa.</p>}
        {days.map(([date, commits]) => (
          <Day key={date} date={date} commits={commits} repo={log?.repo ?? null} />
        ))}
      </article>
    </div>
  );
}
