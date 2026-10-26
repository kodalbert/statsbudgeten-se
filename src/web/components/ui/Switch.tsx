import { cn } from "cn";
import type { ReactNode } from "react";

export function Switch({ on, title, onClick, className, children }: { on: boolean; title?: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={cn("switch", on && "on", className)} title={title} onClick={onClick}>
      <span className="knob" aria-hidden />
      <span>{children}</span>
    </button>
  );
}
