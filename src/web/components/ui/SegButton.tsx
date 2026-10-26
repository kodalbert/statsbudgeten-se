import { cn } from "cn";
import type { ReactNode } from "react";

/** One option in a segmented control. Radios report aria-checked; toggles report aria-pressed. */
export function SegButton({
  active,
  radio = true,
  title,
  onClick,
  className,
  children,
}: {
  active: boolean;
  radio?: boolean;
  title?: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? active : undefined}
      aria-pressed={radio ? undefined : active}
      className={cn(active && "active", className)}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
