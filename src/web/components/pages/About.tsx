import { cn } from "cn";
import { useEffect, useState } from "react";
import type { Block } from "@/markdown";
import { aboutContent } from "@/content.macro" with { type: "macro" };
import { NF0 } from "@/model";
import { Prose } from "@/components/ui/prose";

/** content/om.md, converted to JSON when the bundle is built. */
const ABOUT: Block[] = aboutContent();

type Source = { file: string; label: string; size: number };

const fsize = (bytes: number) => `${NF0.format(Math.max(1, Math.round(bytes / 1024)))} kB`;

function SourceList({ sources }: { sources: Source[] | null }) {
  return (
    <ul className="downloads">
      {sources == null && <li className="muted">Hämtar filer …</li>}
      {sources?.length === 0 && <li className="muted">Inga filer tillgängliga.</li>}
      {sources?.map((src) => (
        <li key={src.file}>
          <a href={`/examples/${encodeURIComponent(src.file)}`} download>
            {src.label}
          </a>
          <span className="muted">
            {" "}
            · {src.file} · {fsize(src.size)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function About() {
  const [sources, setSources] = useState<Source[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sources")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => !cancelled && setSources(list as Source[]))
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={cn("panel", "about")}>
      <article className="prose" lang="sv">
        <Prose blocks={ABOUT} sources={<SourceList sources={sources} />} />
      </article>
    </div>
  );
}
