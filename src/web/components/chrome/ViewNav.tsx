import { COPY, fmd } from "@/model";
import type { Mode, View } from "@/routes";
import { IconSearch } from "@/components/ui/icons";
import { Tab } from "@/components/ui/Tab";

const VIEWS = ["exp", "rev"] as const;

export function ViewNav({
  mode,
  view,
  expenses,
  revenues,
  onOverview,
  onView,
  onSearch,
  onAbout,
}: {
  mode: Mode;
  view: View;
  expenses: number | undefined;
  revenues: number | undefined;
  onOverview: () => void;
  onView: (view: View) => void;
  onSearch: () => void;
  onAbout: () => void;
}) {
  const totals = { exp: expenses, rev: revenues };
  return (
    <nav className="tabs" aria-label="Vy">
      <Tab active={mode === "overview"} onClick={onOverview}>
        <span>Översikt</span>
      </Tab>
      {VIEWS.map((k) => {
        const tot = totals[k];
        return (
          <Tab key={k} active={mode === "explore" && view === k} onClick={() => onView(k)}>
            <span className="dot" style={{ background: k === "exp" ? "var(--expense)" : "var(--revenue)" }} />
            <span>{COPY[k].label}</span>
            <span className="total">{tot != null ? fmd(tot) : ""}</span>
          </Tab>
        );
      })}
      <Tab active={mode === "search"} onClick={onSearch}>
        <IconSearch size={15} strokeWidth={2.4} />
        <span>Sök</span>
      </Tab>
      <Tab active={mode === "about"} onClick={onAbout}>
        <span>Om</span>
      </Tab>
    </nav>
  );
}
