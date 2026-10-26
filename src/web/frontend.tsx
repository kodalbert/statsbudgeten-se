/**
 * Statsbudgeten – the Swedish state budget as an overview chart (/) and a
 * click-to-drill treemap (/utgifter, /inkomster). The screen is assembled
 * from the components in ./components; this file owns the state the URL
 * mirrors. See routes.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BudgetJsonSchema, type BudgetJson } from "@/types/BudgetJsonSchema";
import { InflationSchema } from "@/types/InflationSchema";
import { chooseBaseYear, inflationFactors } from "@/inflation";
import type { SearchHit } from "@/search";
import { initAnalytics, trackEvent, trackPageView } from "@/analytics";
import { CrumbBar } from "@/components/chrome/Breadcrumbs";
import { Credit } from "@/components/chrome/Credit";
import { InfoBar } from "@/components/chrome/InfoBar";
import { Menu } from "@/components/chrome/Menu";
import { Share } from "@/components/chrome/Share";
import { Stage } from "@/components/chrome/Stage";
import type { Info } from "@/components/info";
import { LIST_PEEK, MAP_MIN } from "@/components/pages/Treemap";
import {
  COPY,
  INK,
  PAPER,
  colorOf,
  displayFor,
  fmd,
  fpct,
  groupPanelColor,
  hueOf,
  levelItems,
  normalize,
  placeItems,
  pricesFor,
  sign,
  type Item,
} from "./model";
import { buildUrl, groupKey, groupNumber, parseRoute, windowYears } from "./routes";
import "./styles.css";

/**
 * Favicon, home-screen icon and web manifest, served from assets/ by the
 * server. Added here rather than in index.html because Bun's HTML bundler
 * insists on bundling every <link href> itself and rewrites the paths.
 */
function installIcons() {
  const links: [string, string, Record<string, string>?][] = [
    ["icon", "/favicon.svg", { type: "image/svg+xml" }],
    ["apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" }],
    ["manifest", "/site.webmanifest"],
  ];
  for (const [rel, href, attrs] of links) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    for (const [k, v] of Object.entries(attrs ?? {})) link.setAttribute(k, v);
    document.head.appendChild(link);
  }
}

const initialRoute = parseRoute(new URL(window.location.href));

function App() {
  const [yrs, setYrs] = useState<number[]>([]);
  const [budgets, setBudgets] = useState<Record<number, BudgetJson>>({});
  const [mode, setMode] = useState(initialRoute.mode);
  const [year, setYear] = useState<number | null>(initialRoute.year);
  const [view, setView] = useState(initialRoute.view);
  const [uo, setUo] = useState<string | null>(initialRoute.group != null ? groupKey(initialRoute.view, initialRoute.group) : null);
  const [rest, setRest] = useState(initialRoute.rest);
  /** Focused posting: its row key once resolved, and the id from the URL until then. */
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<number | null>(initialRoute.item);
  const [realWanted, setReal] = useState(initialRoute.real);
  const [unit, setUnit] = useState(initialRoute.unit);
  const [scale, setScale] = useState(initialRoute.scale);
  const [from, setFrom] = useState<number | null>(initialRoute.from);
  const [to, setTo] = useState<number | null>(initialRoute.to);
  const [q, setQ] = useState(initialRoute.q);
  const [hover, setHover] = useState<Info | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /** The settings popover on desktop (inflation, year, unit, y-axis). */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({});
  /** The stage's width and the height left for the map under the history panel. */
  const [size, setSize] = useState({ W: 1000, H: 600 });
  const [error, setError] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Load the list of years and every budget file (the charts need all years).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/years");
        if (!res.ok) throw new Error(String(res.status));
        const years = (await res.json()) as unknown;
        if (!Array.isArray(years) || !years.every((y) => typeof y === "number")) throw new Error("Bad year list");
        const sorted = [...(years as number[])].sort((a, b) => a - b);
        // Inflation data is optional: without it the toggle simply stays hidden.
        const inflation = await fetch("/api/inflation")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const parsedInflation = InflationSchema.safeParse(inflation);
        const entries = await Promise.all(
          sorted.map(async (y) => {
            const r = await fetch(`/api/budget/${y}`);
            if (!r.ok) throw new Error(String(r.status));
            return [y, BudgetJsonSchema.parse(await r.json())] as const;
          }),
        );
        if (cancelled) return;
        const latestYear = sorted[sorted.length - 1];
        setYrs(sorted);
        setRates(parsedInflation.success ? parsedInflation.data.rates : {});
        setBudgets(Object.fromEntries(entries));
        // Keep the year from the URL when it exists, otherwise show the latest.
        setYear((y) => (y != null && sorted.includes(y) ? y : (latestYear ?? null)));
        if (latestYear == null) setError(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = yrs.length ? yrs[yrs.length - 1]! : null;
  const span = useMemo(() => windowYears(yrs, from, to), [yrs, from, to]);
  const spanStart = span[0] ?? null;
  const spanEnd = span.length ? span[span.length - 1]! : null;

  // A budget year outside the chart window moves to the window's last year.
  useEffect(() => {
    if (!span.length) return;
    setYear((y) => (y != null && span.includes(y) ? y : span[span.length - 1]!));
  }, [span]);

  const applyRoute = (r: ReturnType<typeof parseRoute>) => {
    setMode(r.mode);
    setView(r.view);
    const next = windowYears(yrs, r.from, r.to);
    setFrom(r.from);
    setTo(r.to);
    setYear(r.year != null && next.includes(r.year) ? r.year : (next[next.length - 1] ?? latest));
    setUo(r.group != null ? groupKey(r.view, r.group) : null);
    setRest(r.rest);
    setItemKey(null);
    setPendingItem(r.item);
    setReal(r.real);
    setUnit(r.unit);
    setScale(r.scale);
    setQ(r.q);
    setHover(null);
  };

  // Back/forward: restore the state the URL describes. Rebound every render so
  // the listener closes over the years loaded so far.
  useEffect(() => {
    const onPop = () => applyRoute(parseRoute(new URL(window.location.href)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  const clearFocus = () => {
    setItemKey(null);
    setPendingItem(null);
  };

  function showOverview() {
    setMode("overview");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  }

  const showAbout = () => {
    setMode("about");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const showUpdates = () => {
    setMode("updates");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const showSearch = () => {
    setMode("search");
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  /** Open the page a search hit points at. */
  const pickHit = (h: SearchHit) => {
    trackEvent("search_pick", { query: q, view: h.view, group: h.gkey, item: h.id ?? "" });
    setMode("explore");
    setView(h.view);
    setUo(h.gkey);
    setRest(h.rest);
    setItemKey(h.key);
    setPendingItem(null);
    setHover(null);
  };

  const showGraph = (k: typeof view) => {
    if (mode === "explore" && view === k) return;
    setMode("explore");
    setView(k);
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const goRoot = () => {
    setUo(null);
    setRest(false);
    clearFocus();
    setHover(null);
  };

  const selectYear = (y: number) => {
    setYear(y);
    setHover(null);
  };

  // Esc: unfocus posting → leave Övriga → back to top level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) return setMenuOpen(false);
      if (shareOpen) return; // the dialog closes itself
      if (settingsOpen) return setSettingsOpen(false);
      if (mode === "about" || mode === "updates") return showOverview();
      if (mode === "search") return q ? setQ("") : showOverview();
      if (itemKey != null || pendingItem != null) {
        setItemKey(null);
        setPendingItem(null);
      } else if (rest) setRest(false);
      else setUo(null);
      setHover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, shareOpen, settingsOpen, mode, q, itemKey, pendingItem, rest]);

  const rev = view === "rev";
  const T = COPY[view];
  const B = year != null ? budgets[year] : undefined;

  // Inflation adjustment: everything is expressed in the prices of the latest
  // year that has a known rate (the newest budget year usually has none yet).
  const baseYear = useMemo(() => chooseBaseYear(rates, yrs), [rates, yrs]);
  const { factors, convertible } = useMemo(() => inflationFactors(rates, yrs, baseYear ?? 0), [rates, yrs, baseYear]);
  const hasInflation = baseYear != null && convertible.length > 1;
  const real = realWanted && hasInflation;
  const prices = pricesFor(real, baseYear, factors);
  const { factorOf, nominal, priceNote, nominalNote } = prices;
  const f = year != null ? factorOf(year) : 1;

  // Graph unit: kronor, or percent of the year's total revenues or expenses.
  const display = displayFor(unit, budgets, factorOf);

  const all = useMemo(() => (B ? normalize(B, view, f) : []), [B, view, f]);
  const total = B ? (rev ? B.revenuesTotal : B.expensesTotal) * f : 0;
  const groups = all.filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const hues = hueOf(all, view);
  const group = uo != null ? (all.find((g) => g.key === uo) ?? null) : null;
  const gross = groups.reduce((s, g) => s + g.total, 0) || 1;
  const negs = all.filter((g) => g.total < 0);
  const negNote = negs.length
    ? ` · brutto ${fmd(gross)}, minus ${negs.map((g) => `${g.title.toLowerCase()} ${fmd(-g.total)}`).join(", ")}`
    : "";

  // A group from the URL that doesn't exist in this year's data: drop it.
  useEffect(() => {
    if (uo != null && B && !group) {
      setUo(null);
      setRest(false);
      clearFocus();
    }
  }, [uo, B, group]);

  // Resolve a focused posting from its URL id once the group is known.
  useEffect(() => {
    if (pendingItem == null || !group) return;
    const row = group.rows.find((r) => r.id === pendingItem);
    setItemKey(row?.key ?? null);
    setPendingItem(null);
  }, [pendingItem, group]);

  const focusedRow = itemKey != null && group ? (group.rows.find((r) => r.key === itemKey) ?? null) : null;
  const itemId = focusedRow?.id ?? pendingItem;

  // Keep the URL and the document title in step with what is on screen.
  const pageTitle =
    mode === "about"
      ? "Om sajten"
      : mode === "updates"
        ? "Uppdateringar"
        : mode === "search"
          ? q
            ? `Sök: ${q}`
            : "Sök"
          : mode === "overview"
            ? "Inkomster och utgifter"
            : year == null
              ? T.label
              : `${focusedRow ? `${focusedRow.title} · ` : ""}${group ? `${group.title}${rest ? " · Övriga" : ""}` : T.root} · ${T.label} ${year}`;
  const synced = useRef<string | null>(null);
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (year == null || spanEnd == null) return;
    const urlYear = span.includes(year) ? year : spanEnd;
    const oldest = yrs[0] ?? null;
    const urlFrom = from != null && oldest != null && from > oldest ? from : null;
    const urlTo = to != null && latest != null && to < latest ? to : null;
    const url = buildUrl({ mode, view, year: urlYear, group: group ? groupNumber(group.key) : null, rest, item: group ? itemId : null, real, unit, scale, from: urlFrom, to: urlTo, q }, latest);
    const current = window.location.pathname + window.location.search;
    if (url !== current) {
      // The first sync only normalises the URL we were opened with, and typing
      // in the search box rewrites the entry instead of piling up history.
      const typing = mode === "search" && synced.current?.startsWith("/sok");
      if (synced.current === null || typing) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    }
    document.title = `${pageTitle} – Statsbudgeten`;
    // One page view per page, not per keystroke.
    const page = url.replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, "");
    if (tracked.current !== page) trackPageView(page, mode === "search" ? "Sök" : pageTitle);
    tracked.current = page;
    synced.current = url;
  }, [mode, view, year, group, rest, itemId, real, unit, scale, from, to, yrs, span, spanEnd, q, latest, pageTitle]);

  // Items at the current drill level, with what a click on each does.
  const level = B ? levelItems(all, view, group, rest) : { items: [], parentTotal: total };
  const parentTotal = level.parentTotal;
  const items: Item[] = level.items;
  const activate = (it: Item) => {
    if (!group) {
      setUo(it.key);
      setRest(false);
    } else if (it.rest) {
      setRest(true);
    } else {
      setItemKey((k) => (k === it.key ? null : it.key));
      setPendingItem(null);
      setHover(null);
      return;
    }
    clearFocus();
    setHover(null);
  };

  const { W, H } = size;
  const sumItems = items.reduce((s, it) => s + it.v, 0) || 1;
  // Tiles too small for their label are listed under the map instead. The
  // layout always leaves room for the first rows of that list, so whether
  // the list shows up cannot change the layout; when nothing is listed the
  // map simply takes the room back. The stage scrolls for the rest of it.
  const mapRoom = Math.max(MAP_MIN, H - LIST_PEEK);
  const { placed, listed } = placeItems(items, W, mapRoom);
  const mapH = listed.length ? mapRoom : Math.max(MAP_MIN, H);
  const infoOf = (it: Item): { info: Info; share: string } => {
    const shareOfParent = (it.v / parentTotal) * 100;
    const shareOfAll = (it.v / gross) * 100;
    return {
      share: fpct(group ? shareOfParent : shareOfAll),
      info: {
        title: `${it.code ? `${it.code} · ` : ""}${it.label}`,
        value: fmd(it.v),
        share: group
          ? `${fpct(shareOfParent)} av ${group.title.toLowerCase()} · ${fpct(shareOfAll)} av ${T.all}`
          : `${fpct(shareOfAll)} av ${T.all}`,
        hint: it.drill ? "Klicka för att utforska" : "Klicka för att visa historik",
      },
    };
  };
  const multiYear = span.length > 1;
  const exploring = mode === "explore";
  const hasPanel = !!group && year != null && multiYear;

  // The treemap is laid out in real pixels. Its room is measured from the
  // stage and the history panel, never from the map itself: the list under
  // the map takes space from it, so measuring the map would feed back into
  // which items are listed and the two would keep resizing each other.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !exploring) return;
    const measure = () => {
      const panel = el.querySelector<HTMLElement>(".panel.focus");
      const gap = parseFloat(getComputedStyle(el).gap) || 0;
      const used = panel ? panel.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + gap : 0;
      setSize({ W: el.clientWidth || 1000, H: Math.max(0, el.clientHeight - used) || 600 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const panel = el.querySelector(".panel.focus");
    if (panel) ro.observe(panel);
    return () => ro.disconnect();
  }, [exploring, hasPanel]);

  // The focus panel takes the group colour, or the focused posting's tile colour.
  const focusItem = focusedRow ? items.find((it) => it.key === focusedRow.key) : undefined;
  const panelColor = focusItem ? colorOf(focusItem, true) : { bg: group ? groupPanelColor(hues[group.key]!) : PAPER, fg: INK };

  const saldoShown = B && year != null ? display.toUnit(B.revenuesTotal * f, year) - display.toUnit(B.expensesTotal * f, year) : 0;
  const base: Info =
    mode === "about"
      ? { title: "Om Statsbudgeten", hint: "Esc eller Översikt för att gå tillbaka" }
      : mode === "updates"
        ? { title: "Uppdateringar", hint: "Esc eller Översikt för att gå tillbaka" }
        : mode === "search"
          ? { title: `Sök i budgeten ${year ?? ""}`, hint: q ? "Pil upp/ner och Enter väljer · Esc rensar" : "Skriv för att söka" }
          : !B
            ? { title: error ? "Kunde inte läsa data" : "Läser in …" }
            : mode === "overview"
              ? {
                  title: `Statens budget ${year}${year != null && nominal(year) ? "*" : ""}`,
                  value: `Saldo ${sign(saldoShown)}${display.fmt.short(Math.abs(saldoShown))}`,
                  share: `Utgifter ${fmd(B.expensesTotal * f)} · Inkomster ${fmd(B.revenuesTotal * f)}${priceNote}`,
                  hint: year != null && nominal(year) ? nominalNote : "Hovra över ett år för exakta siffror",
                }
              : group
                ? {
                    title: rest ? T.rest : group.title,
                    value: fmd(rest ? sumItems : group.total),
                    share: `${fpct(((rest ? sumItems : group.total) / gross) * 100)} av ${T.all} ${year} · ${placed.length} block${listed.length ? ` och ${listed.length} rader` : ""}${priceNote}`,
                    hint: year != null && nominal(year) ? nominalNote : focusedRow ? "Esc för att avmarkera" : "Klicka på ett block för att se dess historik",
                  }
                : {
                    title: `${T.heading} ${year}`,
                    value: fmd(total),
                    share: `${groups.length} ${T.areas}${negNote}${priceNote}`,
                    hint: year != null && nominal(year) ? nominalNote : "Klicka på ett block",
                  };
  const info = hover ?? base;

  return (
    <div className="app" lang="sv">
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        year={year}
        nominalYear={year != null && nominal(year)}
        mode={mode}
        view={view}
        expenses={B ? B.expensesTotal * f : undefined}
        revenues={B ? B.revenuesTotal * f : undefined}
        onOverview={showOverview}
        onView={showGraph}
        onSearch={showSearch}
        onAbout={showAbout}
        settings={{
          open: settingsOpen,
          onOpenChange: setSettingsOpen,
          year,
          nominal,
          unit,
          scale,
          hasInflation,
          real,
          baseYear,
          years: yrs,
          span,
          spanStart,
          spanEnd,
          latest,
          onReal: (next) => {
            setReal(next);
            setHover(null);
          },
          onFrom: (next) => {
            setFrom(next);
            setHover(null);
          },
          onTo: (next) => {
            setTo(next);
            setHover(null);
          },
          onYear: selectYear,
          onUnit: (next) => {
            setUnit(next);
            setHover(null);
          },
          onScale: setScale,
        }}
      />
      <CrumbBar
        menuOpen={menuOpen}
        mode={mode}
        root={T.root}
        groupTitle={group?.title ?? null}
        rest={rest}
        focusedTitle={focusedRow?.title ?? null}
        share={!!B && (mode === "overview" || exploring)}
        onRoot={goRoot}
        onGroup={() => {
          setRest(false);
          clearFocus();
          setHover(null);
        }}
        onRest={() => {
          clearFocus();
          setHover(null);
        }}
        onShare={() => setShareOpen(true)}
      />
      <Share open={shareOpen} onClose={() => setShareOpen(false)} title={pageTitle} />
      <Stage
        stageRef={stageRef}
        menuOpen={menuOpen}
        mode={mode}
        budget={B}
        year={year}
        q={q}
        onQuery={setQ}
        onPick={pickHit}
        overview={mode === "overview" && B && year != null ? { years: span, budgets, year, scale, ...prices, ...display } : null}
        focus={
          exploring && group && year != null && multiYear
            ? {
                years: span,
                budgets,
                year,
                scale,
                view,
                gkey: group.key,
                row: focusedRow?.key ?? null,
                kicker: focusedRow ? `${group.code} · ${group.title}` : `${group.code} · ${T.kind}`,
                title: focusedRow ? focusedRow.title : group.title,
                bg: panelColor.bg,
                fg: panelColor.fg,
                ...prices,
                ...display,
              }
            : null
        }
        treemap={
          exploring
            ? {
                placed,
                listed,
                W,
                mapRoom,
                mapH,
                drilled: !!group,
                focusedKey: focusedRow?.key ?? null,
                hoverTitle: hover?.title,
                infoOf,
                onHover: setHover,
                onActivate: activate,
              }
            : null
        }
      />
      <InfoBar info={info} menuOpen={menuOpen} />
      <Credit menuOpen={menuOpen} onUpdates={showUpdates} />
    </div>
  );
}

installIcons();
initAnalytics();
createRoot(document.getElementById("root")!).render(<App />);
