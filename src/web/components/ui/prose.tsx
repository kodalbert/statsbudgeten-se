import { Fragment, type ReactNode } from "react";
import type { Block, Inline } from "@/markdown";

function TextLink({ href, children }: { href: string; children: string }) {
  const external = /^https?:/.test(href);
  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined}>
      {children}
    </a>
  );
}

export function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((n, i) => {
        if (n.t === "link") return <TextLink key={i} href={n.href}>{n.s}</TextLink>;
        if (n.t === "strong") return <strong key={i}>{n.s}</strong>;
        if (n.t === "code") return <code key={i}>{n.s}</code>;
        return <Fragment key={i}>{n.s}</Fragment>;
      })}
    </>
  );
}

function Video({ id, title }: { id: string; title: string }) {
  return (
    <div className="video">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

/** Renders the about page's markdown blocks. The `[sources]` block is the download list. */
export function Prose({ blocks, sources }: { blocks: Block[]; sources: ReactNode }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const Tag = `h${b.level}` as "h1" | "h2" | "h3";
          return (
            <Tag key={i}>
              <Inlines inlines={b.inlines} />
            </Tag>
          );
        }
        if (b.t === "p")
          return (
            <p key={i}>
              <Inlines inlines={b.inlines} />
            </p>
          );
        if (b.t === "ul")
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines inlines={it} />
                </li>
              ))}
            </ul>
          );
        if (b.t === "video") return <Video key={i} id={b.id} title={b.title} />;
        return <Fragment key={i}>{sources}</Fragment>;
      })}
    </>
  );
}
