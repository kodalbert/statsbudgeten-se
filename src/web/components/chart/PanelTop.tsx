import type { ReactNode } from "react";

/** The heading and the big figure at the top of a chart panel. */
export function PanelTop({
  kicker,
  title,
  legend,
  deltaKicker,
  delta,
  deltaNote,
  deltaColor,
}: {
  kicker: ReactNode;
  title: string;
  legend?: ReactNode;
  deltaKicker: ReactNode;
  delta: ReactNode;
  deltaNote: ReactNode;
  deltaColor?: string;
}) {
  return (
    <div className="top">
      <div className="heading">
        <span className="kicker">{kicker}</span>
        <span className="name" lang="sv">
          {title}
        </span>
        {legend}
      </div>
      <div className="delta">
        <span className="kicker">{deltaKicker}</span>
        <span className="pct" style={deltaColor ? { color: deltaColor } : undefined}>
          {delta}
        </span>
        <span className="abs">{deltaNote}</span>
      </div>
    </div>
  );
}
