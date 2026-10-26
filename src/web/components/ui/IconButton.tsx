import { cn } from "cn";
import type { ReactNode } from "react";

export function IconButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={cn("icon-btn", className)} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
