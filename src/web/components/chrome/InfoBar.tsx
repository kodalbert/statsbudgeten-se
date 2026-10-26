import type { Info } from "@/components/info";

export function InfoBar({ info, menuOpen }: { info: Info; menuOpen: boolean }) {
  return (
    <footer className="info" aria-live="polite" inert={menuOpen || undefined}>
      <span className="title">{info.title}</span>
      <span className="value">{info.value}</span>
      <span className="share">{info.share}</span>
      <span className="hint">{info.hint}</span>
    </footer>
  );
}
