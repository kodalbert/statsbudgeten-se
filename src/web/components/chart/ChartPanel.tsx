import { cn } from "cn";
import type { ReactNode } from "react";

/** A coloured panel: the overview chart and a group's history chart. */
export function ChartPanel({
  variant,
  background,
  color,
  grid,
  children,
}: {
  variant: string;
  background: string;
  color: string;
  grid: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("panel", variant)} style={{ background, color, ["--grid-color" as string]: grid }}>
      <div className="content">{children}</div>
    </div>
  );
}
