import type { RefObject } from "react";
import type { BudgetJson } from "@/types/BudgetJsonSchema";
import type { SearchHit } from "@/search";
import type { Mode } from "@/routes";
import { About } from "@/components/pages/About";
import { FocusPanel, type FocusProps } from "@/components/pages/FocusPanel";
import { Overview, type OverviewProps } from "@/components/pages/Overview";
import { Search } from "@/components/pages/Search";
import { Treemap, type TreemapProps } from "@/components/pages/Treemap";
import { Updates } from "@/components/pages/Updates";

export function Stage({
  stageRef,
  menuOpen,
  mode,
  budget,
  year,
  q,
  onQuery,
  onPick,
  overview,
  focus,
  treemap,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  menuOpen: boolean;
  mode: Mode;
  budget: BudgetJson | undefined;
  year: number | null;
  q: string;
  onQuery: (q: string) => void;
  onPick: (hit: SearchHit) => void;
  overview: OverviewProps | null;
  focus: FocusProps | null;
  treemap: TreemapProps | null;
}) {
  return (
    <div className="stage" ref={stageRef} inert={menuOpen || undefined}>
      {mode === "about" && <About />}
      {mode === "updates" && <Updates />}
      {mode === "search" && <Search budget={budget} year={year} q={q} onChange={onQuery} onPick={onPick} />}
      {overview && <Overview {...overview} />}
      {focus && <FocusPanel {...focus} />}
      {treemap && <Treemap {...treemap} />}
    </div>
  );
}
