import { cn } from "cn";
import { useEffect, useRef } from "react";
import { trackEvent } from "@/analytics";
import { SCALES, UNITS } from "@/model";
import type { Scale, Unit } from "@/routes";
import { ChoicePicker } from "@/components/ui/ChoicePicker";
import { IconSettings } from "@/components/ui/icons";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { Switch } from "@/components/ui/Switch";
import { YearPicker } from "@/components/ui/YearPicker";

export type SettingsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number | null;
  nominal: (y: number) => boolean;
  unit: Unit;
  scale: Scale;
  hasInflation: boolean;
  real: boolean;
  baseYear: number | null;
  years: number[];
  span: number[];
  spanStart: number | null;
  spanEnd: number | null;
  latest: number | null;
  onReal: (real: boolean) => void;
  onFrom: (from: number | null) => void;
  onTo: (to: number | null) => void;
  onYear: (year: number) => void;
  onUnit: (unit: Unit) => void;
  onScale: (scale: Scale) => void;
};

const UNIT_OPTIONS = UNITS.map((u) => ({
  k: u.k,
  label: u.label,
  title: u.k === "kr" ? "Belopp i kronor" : `Grafer i procent av årets ${u.k === "rev" ? "inkomster" : "utgifter"}`,
}));

export function Settings({
  open,
  onOpenChange,
  year,
  nominal,
  unit,
  scale,
  hasInflation,
  real,
  baseYear,
  years,
  span,
  spanStart,
  spanEnd,
  latest,
  onReal,
  onFrom,
  onTo,
  onYear,
  onUnit,
  onScale,
}: SettingsProps) {
  const root = useRef<HTMLDivElement>(null);
  // The popover closes on a click anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onOpenChange]);

  const unitLabel = UNITS.find((u) => u.k === unit)?.label;
  return (
    <div className={cn("settings", open && "open")} ref={root}>
      <button type="button" className="settings-toggle" aria-expanded={open} aria-controls="settings" aria-label="Inställningar" title="Inställningar" onClick={() => onOpenChange(!open)}>
        {year != null && (
          <span className="now">
            {year}
            {nominal(year) ? "*" : ""}, i {unitLabel}
          </span>
        )}
        <IconSettings />
      </button>
      <div className="popover" id="settings" role="group" aria-label="Inställningar">
        {hasInflation && (
          <Switch
            on={real}
            title={`Räkna om alla belopp till ${baseYear} års prisnivå (KPI)`}
            onClick={() => {
              trackEvent("toggle_inflation", { enabled: !real, base_year: baseYear ?? "" });
              onReal(!real);
            }}
          >
            Justera för inflation
          </Switch>
        )}
        <div className="pickers">
          <PeriodPicker years={years} spanStart={spanStart} spanEnd={spanEnd} latest={latest} onFrom={onFrom} onTo={onTo} />
          <YearPicker years={span} year={year} nominal={nominal} onYear={onYear} />
          <ChoicePicker
            label="Visa"
            id="unit-label"
            className="unit-picker"
            value={unit}
            options={UNIT_OPTIONS}
            onChange={(next) => {
              trackEvent("toggle_unit", { unit: next });
              onUnit(next);
            }}
          />
          <ChoicePicker
            label="Y-axel"
            id="scale-label"
            className="scale-picker"
            value={scale}
            options={SCALES}
            onChange={(next) => {
              trackEvent("toggle_scale", { scale: next });
              onScale(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}
