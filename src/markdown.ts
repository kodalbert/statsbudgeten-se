/**
 * A small Markdown subset for the site's prose pages (content/*.md):
 * headings (#, ##, ###), paragraphs, bullet lists, links, bold and inline
 * code, an image-style line `![title](youtube url)` that embeds the video,
 * plus a `[sources]` line that the page replaces with its download list.
 * The result is plain JSON so it can be produced at build time (see
 * src/web/content.macro.ts) and rendered with React without innerHTML.
 */

export type Inline =
  | { t: "text"; s: string }
  | { t: "link"; s: string; href: string }
  | { t: "strong"; s: string }
  | { t: "code"; s: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; inlines: Inline[] }
  | { t: "p"; inlines: Inline[] }
  | { t: "ul"; items: Inline[][] }
  /** An embedded YouTube video; `title` is the accessible name of the player. */
  | { t: "video"; id: string; title: string }
  | { t: "sources" };

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

const VIDEO = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/** The YouTube video id in a watch, share or embed URL, or null for any other URL. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null);
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) out.push({ t: "text", s: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "link", s: m[1], href: m[2]! });
    else if (m[3] !== undefined) out.push({ t: "strong", s: m[3] });
    else out.push({ t: "code", s: m[4]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", s: s.slice(last) });
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;

  const flush = () => {
    if (para.length) blocks.push({ t: "p", inlines: parseInline(para.join(" ")) });
    para = [];
    if (list) blocks.push({ t: "ul", items: list });
    list = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3}) +(.*)$/);
    const video = line.trim().match(VIDEO);
    const videoId = video ? youtubeId(video[2]!) : null;
    if (heading) {
      flush();
      blocks.push({ t: "h", level: heading[1]!.length as 1 | 2 | 3, inlines: parseInline(heading[2]!) });
    } else if (video && videoId) {
      flush();
      blocks.push({ t: "video", id: videoId, title: video[1]!.trim() || "Video" });
    } else if (line.trim() === "[sources]") {
      flush();
      blocks.push({ t: "sources" });
    } else if (/^[-*] /.test(line)) {
      if (para.length) flush();
      (list ??= []).push(parseInline(line.slice(2).trim()));
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}
