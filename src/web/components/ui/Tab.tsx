import { cn } from "cn";
import type { ReactNode } from "react";

export function Tab({ active, onClick, className, children }: { active: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={cn("tab", active && "active", className)} aria-current={active ? "page" : undefined} onClick={onClick}>
      {children}
    </button>
  );
}
