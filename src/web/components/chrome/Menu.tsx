import { cn } from "cn";
import { useEffect, useRef, type MouseEvent, type TouchEvent } from "react";
import type { Mode, View } from "@/routes";
import { Brand } from "@/components/ui/Brand";
import { IconButton } from "@/components/ui/IconButton";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { Settings, type SettingsProps } from "./Settings";
import { ViewNav } from "./ViewNav";

function SheetHead({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-head">
      <Brand />
      <IconButton label="Stäng menyn" onClick={onClose}>
        <IconClose />
      </IconButton>
    </div>
  );
}

/** Swipe the sheet left to close it: it follows the finger, and lets go when dragged far or fast enough. */
function useSheetSwipe(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const touch = {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0]!;
      swipe.current = { x: t.clientX, y: t.clientY, t: performance.now(), axis: null };
    },
    onTouchMove: (e: TouchEvent) => {
      const sw = swipe.current;
      const el = sheetRef.current;
      if (!sw || !el) return;
      const t = e.touches[0]!;
      const dx = t.clientX - sw.x;
      const dy = t.clientY - sw.y;
      if (sw.axis == null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) sw.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (sw.axis !== "x") return;
      el.style.transition = "none";
      el.style.transform = `translateX(${Math.min(0, dx)}px)`;
    },
    onTouchEnd: (e: TouchEvent) => {
      const sw = swipe.current;
      const el = sheetRef.current;
      swipe.current = null;
      if (!sw || !el) return;
      el.style.transition = "";
      el.style.transform = "";
      if (sw.axis !== "x") return;
      const dx = e.changedTouches[0]!.clientX - sw.x;
      const speed = -dx / Math.max(1, performance.now() - sw.t);
      if (dx < -el.clientWidth / 3 || (dx < -40 && speed > 0.5)) onClose();
    },
    onTouchCancel: () => {
      swipe.current = null;
      if (sheetRef.current) {
        sheetRef.current.style.transition = "";
        sheetRef.current.style.transform = "";
      }
    },
  };
  return { sheetRef, touch };
}

export function Menu({
  open,
  onOpenChange,
  year,
  nominalYear,
  mode,
  view,
  expenses,
  revenues,
  onOverview,
  onView,
  onSearch,
  onAbout,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number | null;
  nominalYear: boolean;
  mode: Mode;
  view: View;
  expenses: number | undefined;
  revenues: number | undefined;
  onOverview: () => void;
  onView: (view: View) => void;
  onSearch: () => void;
  onAbout: () => void;
  settings: SettingsProps;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { sheetRef, touch } = useSheetSwipe(() => onOpenChange(false));

  // The open menu is a modal sheet: the page behind it neither scrolls nor
  // takes focus, focus starts at the close button and returns to the toggle,
  // and widening the window past the phone layout dismisses it.
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("menu-open");
    sheetRef.current?.querySelector<HTMLElement>(".sheet-head button")?.focus({ preventScroll: true });
    const desktop = window.matchMedia("(min-width: 721px)");
    const onChange = () => desktop.matches && onOpenChange(false);
    desktop.addEventListener("change", onChange);
    return () => {
      document.documentElement.classList.remove("menu-open");
      desktop.removeEventListener("change", onChange);
      toggleRef.current?.focus({ preventScroll: true });
    };
  }, [open, onOpenChange, sheetRef]);

  const closeIfChoice = (e: MouseEvent) => {
    // On mobile the menu slides in over the page: any choice closes it.
    if ((e.target as HTMLElement).closest("button")) onOpenChange(false);
  };

  return (
    <div className={cn("menu", open && "open")}>
      <Brand />
      <button ref={toggleRef} type="button" className="menu-toggle" aria-expanded={open} aria-controls="menu-items" aria-label={open ? "Stäng menyn" : "Öppna menyn"} onClick={() => onOpenChange(!open)}>
        {year != null && (
          <span className="now">
            {year}
            {nominalYear ? "*" : ""}
          </span>
        )}
        {open ? <IconClose /> : <IconMenu />}
      </button>
      <div
        ref={sheetRef}
        className="menu-items"
        id="menu-items"
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label="Meny"
        onClick={closeIfChoice}
        {...touch}
      >
        <SheetHead onClose={() => onOpenChange(false)} />
        <ViewNav mode={mode} view={view} expenses={expenses} revenues={revenues} onOverview={onOverview} onView={onView} onSearch={onSearch} onAbout={onAbout} />
        <Settings {...settings} />
      </div>
    </div>
  );
}
