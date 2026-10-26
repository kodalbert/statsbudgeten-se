import { cn } from "cn";
import type { ReactNode } from "react";

/** A row of segmented buttons. `label` is the accessible name when there is no separate label element. */
export function Segmented({
  label,
  labelledBy,
  className,
  role = "radiogroup",
  children,
}: {
  label?: string;
  labelledBy?: string;
  className?: string;
  role?: "radiogroup" | "group";
  children: ReactNode;
}) {
  return (
    <div className={cn("seg", className)} role={role} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}

/** A segmented control with its caption above it, as the settings pickers are laid out. */
export function Picker({
  label,
  id,
  className,
  segClassName,
  role = "radiogroup",
  children,
}: {
  label: string;
  id: string;
  className?: string;
  segClassName?: string;
  role?: "radiogroup" | "group";
  children: ReactNode;
}) {
  return (
    <div className={cn("year-picker", className)}>
      <span className="label" id={id}>
        {label}
      </span>
      <Segmented labelledBy={id} className={segClassName} role={role}>
        {children}
      </Segmented>
    </div>
  );
}
