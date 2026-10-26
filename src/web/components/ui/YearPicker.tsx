import { Picker } from "./Segmented";
import { SegButton } from "./SegButton";

export function YearPicker({ years, year, nominal, onYear }: { years: number[]; year: number | null; nominal: (y: number) => boolean; onYear: (y: number) => void }) {
  return (
    <Picker label="Budgetår" id="year-label" segClassName="budget-years">
      {years.map((y) => (
        <SegButton key={y} active={y === year} title={nominal(y) ? "Nominellt belopp, inflationsdata saknas" : undefined} onClick={() => onYear(y)}>
          {y}
          {nominal(y) ? "*" : ""}
        </SegButton>
      ))}
    </Picker>
  );
}
