export function PeriodPicker({
  years,
  spanStart,
  spanEnd,
  latest,
  onFrom,
  onTo,
}: {
  years: number[];
  spanStart: number | null;
  spanEnd: number | null;
  latest: number | null;
  onFrom: (from: number | null) => void;
  onTo: (to: number | null) => void;
}) {
  const first = years[0];
  return (
    <div className="span-pick">
      <label>
        Från
        <select
          value={spanStart ?? ""}
          onChange={(e) => {
            const y = Number(e.target.value);
            onFrom(first != null && y === first ? null : y);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label>
        Till
        <select
          value={spanEnd ?? ""}
          onChange={(e) => {
            const y = Number(e.target.value);
            onTo(latest != null && y === latest ? null : y);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
