import { describe, expect, test } from "bun:test";
import { parseRoute } from "./routes";
import { FORMATS, FORMAT_KEYS, parseFormat, routeForImage, socialImagePath } from "./share";

const url = (s: string) => new URL(s, "https://statsbudgeten.se");

describe("formats", () => {
  test("the link format is the Open Graph size, the others are 1080 wide", () => {
    expect(FORMATS.link).toMatchObject({ w: 1200, h: 630 });
    for (const k of FORMAT_KEYS) if (k !== "link") expect(FORMATS[k].w).toBe(1080);
    expect(FORMATS.square.h).toBe(1080);
    expect(FORMATS.portrait.h / FORMATS.portrait.w).toBeCloseTo(5 / 4);
    expect(FORMATS.story.h / FORMATS.story.w).toBeCloseTo(16 / 9);
  });

  test("the canvas has the output's aspect ratio", () => {
    for (const k of FORMAT_KEYS) expect(FORMATS[k].canvas.w / FORMATS[k].canvas.h).toBeCloseTo(FORMATS[k].w / FORMATS[k].h, 2);
  });

  test("unknown formats fall back to link", () => {
    expect(parseFormat("story")).toBe("story");
    expect(parseFormat("huge")).toBe("link");
    expect(parseFormat(null)).toBe("link");
  });
});

describe("image URLs", () => {
  test("every chart page has an image, about and search do not", () => {
    expect(socialImagePath(url("/"))).toBe("/social/oversikt.png");
    expect(socialImagePath(url("/utgifter"))).toBe("/social/utgifter.png");
    expect(socialImagePath(url("/inkomster/1000/1111"))).toBe("/social/inkomster/1000/1111.png");
    expect(socialImagePath(url("/utgifter/6/ovriga/23?year=2024&inflation=1&andel=inkomster"))).toBe("/social/utgifter/6/ovriga/23.png?year=2024&inflation=1&andel=inkomster");
    expect(socialImagePath(url("/om"))).toBeNull();
    expect(socialImagePath(url("/sok?q=försvar"))).toBeNull();
  });

  test("a format other than link goes in the query", () => {
    expect(socialImagePath(url("/"), "square")).toBe("/social/oversikt.png?format=square");
    expect(socialImagePath(url("/utgifter/6?year=2024"), "story")).toBe("/social/utgifter/6.png?year=2024&format=story");
    expect(socialImagePath(url("/utgifter/6"), "link")).toBe("/social/utgifter/6.png");
  });

  test("an image URL maps back to its page and format", () => {
    for (const page of ["/", "/utgifter", "/inkomster/1000/1111", "/utgifter/6/ovriga/23?year=2024&inflation=1&andel=inkomster"]) {
      for (const format of FORMAT_KEYS) {
        const image = socialImagePath(url(page), format)!;
        expect(routeForImage(url(image))).toEqual({ route: parseRoute(url(page)), format });
      }
    }
  });

  test("other paths under /social/ are not images", () => {
    expect(routeForImage(url("/social/om.png"))).toBeNull();
    expect(routeForImage(url("/social/oversikt.jpg"))).toBeNull();
    expect(routeForImage(url("/social/../social.png"))).toBeNull();
    expect(routeForImage(url("/social/utgifter/6.png/extra.png"))).toBeNull();
  });
});
