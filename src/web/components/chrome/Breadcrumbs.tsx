import { cn } from "cn";
import type { Mode } from "@/routes";
import { IconShare } from "@/components/ui/icons";

function Crumb({ label, current, separator, onClick }: { label: string; current: boolean; separator: boolean; onClick: () => void }) {
  return (
    <span className="crumb">
      <button type="button" className={cn(current && "current")} onClick={onClick} disabled={current}>
        {label}
      </button>
      {separator && <span className="sep">/</span>}
    </span>
  );
}

function ShareToggle({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="share-toggle" onClick={onClick} title="Dela som bild eller länk">
      <IconShare />
      <span>Dela</span>
    </button>
  );
}

const PAGE_LABEL: Partial<Record<Mode, string>> = {
  about: "Om sajten",
  updates: "Uppdateringar",
  search: "Sök",
  overview: "Inkomster och utgifter",
};

export function CrumbBar({
  menuOpen,
  mode,
  root,
  groupTitle,
  rest,
  focusedTitle,
  share,
  onRoot,
  onGroup,
  onRest,
  onShare,
}: {
  menuOpen: boolean;
  mode: Mode;
  root: string;
  groupTitle: string | null;
  rest: boolean;
  focusedTitle: string | null;
  share: boolean;
  onRoot: () => void;
  onGroup: () => void;
  onRest: () => void;
  onShare: () => void;
}) {
  const page = PAGE_LABEL[mode];
  const crumbs = page
    ? [{ key: mode, label: page, onClick: () => {} }]
    : [
        { key: "root", label: root, onClick: onRoot },
        ...(groupTitle ? [{ key: "group", label: groupTitle, onClick: onGroup }] : []),
        ...(groupTitle && rest ? [{ key: "rest", label: "Övriga", onClick: onRest }] : []),
        ...(groupTitle && focusedTitle ? [{ key: "item", label: focusedTitle, onClick: () => {} }] : []),
      ];
  return (
    <header className="crumb-row" inert={menuOpen || undefined}>
      <nav className="crumbs" aria-label="Brödsmulor">
        {crumbs.map((c, i) => (
          <Crumb key={c.key} label={c.label} current={i === crumbs.length - 1} separator={i < crumbs.length - 1} onClick={c.onClick} />
        ))}
      </nav>
      {share && <ShareToggle onClick={onShare} />}
    </header>
  );
}
