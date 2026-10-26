import { Picker } from "./Segmented";
import { SegButton } from "./SegButton";

export function ChoicePicker<K extends string>({
  label,
  id,
  className,
  value,
  options,
  onChange,
}: {
  label: string;
  id: string;
  className?: string;
  value: K;
  options: { k: K; label: string; title?: string }[];
  onChange: (k: K) => void;
}) {
  return (
    <Picker label={label} id={id} className={className}>
      {options.map((o) => (
        <SegButton
          key={o.k}
          active={o.k === value}
          title={o.title}
          onClick={() => {
            if (o.k === value) return;
            onChange(o.k);
          }}
        >
          {o.label}
        </SegButton>
      ))}
    </Picker>
  );
}
