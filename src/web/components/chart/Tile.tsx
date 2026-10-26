import { cn } from "cn";
import { fmd, type Item } from "@/model";
import type { Info } from "@/components/info";

type TileProps = {
  it: Item;
  rect: { left: string; top: string; width: string; height: string };
  w: number;
  h: number;
  bg: string;
  fg: string;
  share: string;
  info: Info;
  hovered: boolean;
  focused: boolean;
  onHover: (info: Info | null) => void;
  onActivate: () => void;
};

export function Tile({ it, rect, w, h, bg, fg, share, info, hovered, focused, onHover, onActivate }: TileProps) {
  const minD = Math.min(w, h);
  const area = w * h;
  const showValue = w > 70 && h > 130;
  const shareSize = Math.round(Math.max(18, Math.min(64, Math.sqrt(area) / 5.2)));
  const titleSize = minD > 220 ? 18 : minD > 130 ? 15 : w < 130 ? 12 : 13;
  const clamp = h > 170 ? 3 : h > 80 ? 2 : 1;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${info.title}, ${info.value}`}
      aria-pressed={focused || undefined}
      className={cn("tile", hovered && "hovered", focused && "focused")}
      style={{
        ...rect,
        background: bg,
        color: fg,
        padding: minD > 160 ? "14px 16px" : "8px 10px",
        cursor: it.drill ? "zoom-in" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      onMouseEnter={() => onHover(info)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(info)}
      onBlur={() => onHover(null)}
    >
      <span className="head">
        <span className="code">{it.code}</span>
        <span className="title" lang="sv" style={{ fontSize: titleSize, WebkitLineClamp: clamp }}>
          {it.label}
        </span>
      </span>
      <span className="figures" style={{ opacity: showValue ? 1 : 0 }}>
        <span className="share" style={{ fontSize: shareSize }}>
          {share}
        </span>
        <span className="value">{fmd(it.v)}</span>
      </span>
    </div>
  );
}
