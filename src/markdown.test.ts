import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown, youtubeId } from "./markdown";

describe("parseInline", () => {
  test("plain text", () => {
    expect(parseInline("Hej där")).toEqual([{ t: "text", s: "Hej där" }]);
  });

  test("links, bold and code in running text", () => {
    expect(parseInline("Se [sajten](https://x.se) och **viktigt** samt `kod`.")).toEqual([
      { t: "text", s: "Se " },
      { t: "link", s: "sajten", href: "https://x.se" },
      { t: "text", s: " och " },
      { t: "strong", s: "viktigt" },
      { t: "text", s: " samt " },
      { t: "code", s: "kod" },
      { t: "text", s: "." },
    ]);
  });

  test("mailto links", () => {
    expect(parseInline("[mejl](mailto:a@b.se)")).toEqual([{ t: "link", s: "mejl", href: "mailto:a@b.se" }]);
  });
});

describe("parseMarkdown", () => {
  test("headings, paragraphs, lists and the sources marker", () => {
    const md = ["# Titel", "", "## Del", "Rad ett", "rad två.", "", "- punkt **ett**", "- punkt [två](https://t.se)", "", "[sources]", "", "Sist."].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { t: "h", level: 1, inlines: [{ t: "text", s: "Titel" }] },
      { t: "h", level: 2, inlines: [{ t: "text", s: "Del" }] },
      { t: "p", inlines: [{ t: "text", s: "Rad ett rad två." }] },
      {
        t: "ul",
        items: [
          [{ t: "text", s: "punkt " }, { t: "strong", s: "ett" }],
          [{ t: "text", s: "punkt " }, { t: "link", s: "två", href: "https://t.se" }],
        ],
      },
      { t: "sources" },
      { t: "p", inlines: [{ t: "text", s: "Sist." }] },
    ]);
  });

  test("a list directly after a paragraph closes the paragraph", () => {
    expect(parseMarkdown("Text\n- a\n- b\nMer").map((b) => b.t)).toEqual(["p", "ul", "p"]);
  });

  test("an image-style line with a YouTube URL becomes a video block", () => {
    const md = ["Före.", "![Min film](https://www.youtube.com/watch?v=MbS-d4tSd14)", "Efter."].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { t: "p", inlines: [{ t: "text", s: "Före." }] },
      { t: "video", id: "MbS-d4tSd14", title: "Min film" },
      { t: "p", inlines: [{ t: "text", s: "Efter." }] },
    ]);
    expect(parseMarkdown("![](https://youtu.be/MbS-d4tSd14)")).toEqual([{ t: "video", id: "MbS-d4tSd14", title: "Video" }]);
    // Anything that is not a YouTube URL is left to the inline parser, as before.
    expect(parseMarkdown("![bild](https://x.se/a.png)")).toEqual([{ t: "p", inlines: [{ t: "text", s: "!" }, { t: "link", s: "bild", href: "https://x.se/a.png" }] }]);
  });

  test("youtubeId reads watch, share and embed URLs", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=MbS-d4tSd14",
      "https://youtube.com/watch?v=MbS-d4tSd14&t=10s",
      "https://m.youtube.com/watch?v=MbS-d4tSd14",
      "https://youtu.be/MbS-d4tSd14?si=abc",
      "https://www.youtube.com/embed/MbS-d4tSd14",
      "https://www.youtube-nocookie.com/embed/MbS-d4tSd14",
      "https://www.youtube.com/shorts/MbS-d4tSd14",
    ])
      expect(youtubeId(u)).toBe("MbS-d4tSd14");
    expect(youtubeId("https://www.youtube.com/@proddalbert")).toBeNull();
    expect(youtubeId("https://vimeo.com/123")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });

  test("handles Windows line endings and trailing whitespace", () => {
    expect(parseMarkdown("# A  \r\n\r\nB\r\n")).toEqual([
      { t: "h", level: 1, inlines: [{ t: "text", s: "A" }] },
      { t: "p", inlines: [{ t: "text", s: "B" }] },
    ]);
  });

  test("the shipped about page parses and has the expected sections", async () => {
    const text = await Bun.file(`${import.meta.dir}/../content/om.md`).text();
    const blocks = parseMarkdown(text);
    const headings = blocks.filter((b) => b.t === "h").map((b) => (b.t === "h" ? b.inlines.map((i) => i.s).join("") : ""));
    expect(headings[0]).toBe("Om Statsbudgeten");
    expect(headings).toContain("Källor");
    expect(blocks.some((b) => b.t === "sources")).toBe(true);
    // The video sits right under the title.
    expect(blocks[1]).toEqual({ t: "video", id: "MbS-d4tSd14", title: expect.any(String) });
    const links = blocks.flatMap((b) => (b.t === "p" ? b.inlines : b.t === "ul" ? b.items.flat() : [])).filter((i) => i.t === "link");
    expect(links.map((l) => (l.t === "link" ? l.href : ""))).toEqual(
      expect.arrayContaining(["https://proddalbert.se", "mailto:albert@proddalbert.se"]),
    );
  });
});
