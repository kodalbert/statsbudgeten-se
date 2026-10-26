import { cn } from "cn";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { BudgetJson } from "@/types/BudgetJsonSchema";
import { buildIndex, search as runSearch, type SearchHit } from "@/search";
import { fmd, NF0 } from "@/model";
import { IconButton } from "@/components/ui/IconButton";
import { IconClose, IconSearch } from "@/components/ui/icons";
import { Swatch } from "@/components/ui/Swatch";

function hitMeta(hit: SearchHit) {
  if (hit.id == null) return hit.view === "rev" ? "Inkomsttyp" : "Utgiftsområde";
  return `${hit.groupCode} · ${hit.groupTitle} · ${hit.view === "rev" ? "Inkomsttitel" : "Anslag"} ${hit.id}${hit.rest ? " · Övriga" : ""}`;
}

export function SearchResult({ hit, active, onHover, onPick }: { hit: SearchHit; active: boolean; onHover: () => void; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={active} className={cn("result", active && "active")} onMouseEnter={onHover} onClick={onPick}>
      <Swatch color={hit.view === "rev" ? "var(--revenue)" : "var(--expense)"} />
      <span className="r-main">
        <span className="r-title">{hit.title}</span>
        <span className="r-sub">{hitMeta(hit)}</span>
      </span>
      <span className="r-val">{fmd(hit.v)}</span>
    </button>
  );
}

function SearchField({ value, onChange, onKey, inputRef }: { value: string; onChange: (q: string) => void; onKey: (e: KeyboardEvent) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  return (
    <div className="search-head">
      <IconSearch />
      <input ref={inputRef} type="search" value={value} placeholder="Sök anslag, inkomsttitel eller område …" aria-label="Sök" autoComplete="off" onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
      {value && (
        <IconButton
          label="Rensa sökningen"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <IconClose size={16} />
        </IconButton>
      )}
    </div>
  );
}

export function Search({ budget, year, q, onChange, onPick }: { budget: BudgetJson | undefined; year: number | null; q: string; onChange: (q: string) => void; onPick: (hit: SearchHit) => void }) {
  const index = useMemo(() => (budget ? buildIndex(budget) : []), [budget]);
  const hits = useMemo(() => runSearch(index, q), [index, q]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setActive(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);
  const postings = index.filter((h) => h.id != null).length;
  const groups = index.length - postings;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active]!);
    }
  };

  return (
    <div className={cn("panel", "search")}>
      <SearchField value={q} onChange={onChange} onKey={onKey} inputRef={inputRef} />
      {q.trim() === "" ? (
        <p className="search-hint">{budget ? `Sök bland ${NF0.format(groups)} områden och ${NF0.format(postings)} poster i budgeten för ${year}.` : "Läser in …"}</p>
      ) : hits.length === 0 ? (
        <p className="search-hint">Inga träffar för ”{q.trim()}”.</p>
      ) : (
        <div className="results" role="listbox" aria-label="Sökträffar">
          {hits.map((h, i) => (
            <SearchResult key={`${h.gkey}/${h.id ?? ""}`} hit={h} active={i === active} onHover={() => setActive(i)} onPick={() => onPick(h)} />
          ))}
        </div>
      )}
    </div>
  );
}
