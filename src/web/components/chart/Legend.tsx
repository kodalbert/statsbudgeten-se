import { Swatch } from "@/components/ui/Swatch";

export function Legend({ items }: { items: readonly { k: string; label: string; color: string }[] }) {
  return (
    <span className="legend">
      {items.map((s) => (
        <span key={s.k}>
          <Swatch color={s.color} />
          {s.label}
        </span>
      ))}
    </span>
  );
}
