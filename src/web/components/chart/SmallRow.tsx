import { cn } from "cn";
import { fmd, type Item } from "@/model";
import type { Info } from "@/components/info";
import { Swatch } from "@/components/ui/Swatch";

/** A posting too small for a tile, listed under the map. */
export function SmallRow({
  it,
  bg,
  share,
  info,
  hovered,
  focused,
  onHover,
  onActivate,
}: {
  it: Item;
  bg: string;
  share: string;
  info: Info;
  hovered: boolean;
  focused: boolean;
  onHover: (info: Info | null) => void;
  onActivate: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={cn("row", hovered && "hovered", focused && "focused")}
        aria-pressed={focused || undefined}
        style={{ cursor: it.drill ? "zoom-in" : "pointer" }}
        onClick={onActivate}
        onMouseEnter={() => onHover(info)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(info)}
        onBlur={() => onHover(null)}
      >
        <Swatch color={bg} hidden />
        <span className="code">{it.code}</span>
        <span className="title" lang="sv">
          {it.label}
        </span>
        <span className="value">{fmd(it.v)}</span>
        <span className="share">{share}</span>
      </button>
    </li>
  );
}
