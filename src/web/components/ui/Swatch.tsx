/** A small colour chip in legends, search hits and the list under the map. */
export function Swatch({ color, hidden = false }: { color: string; hidden?: boolean }) {
  return <span className="swatch" style={{ background: color }} aria-hidden={hidden || undefined} />;
}
