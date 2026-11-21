/**
 * Converts the official Swedish state budget specification workbook
 * ("Specifikation av budgetens utgifter och inkomster", regeringen.se)
 * into the JSON structure defined by types/BudgetJsonSchema.
 *
 * The published workbooks are not laid out identically from year to year,
 * so the parser detects the layout per sheet rather than assuming fixed
 * columns. Known variants (2013–2026), all amounts in thousands of SEK:
 *
 *  Sheets are identified by content, not name (2013/2016 use "Blad1"/
 *  "Blad2" — in opposite order — and 2019 truncated long names): the sheet
 *  with a "Summa anslag" row is Utgifter, the one with a "Summa inkomster"
 *  (or the 2018/2022 kassamässigt label) row is Inkomster.
 *
 *  The title wording also varies by year ("Specifikation av budgetens
 *  utgifter för 2019", "… av utgifterna i statens budget för 2013", "… av
 *  statens inkomster 2021", "… av budgetens utgifter och inkomster 2018",
 *  2014/2015 prefix the title with a chapter number). 2016/2020 have no
 *  title on the Inkomster sheet, so the year may come from either sheet.
 *
 *  Utgifter — three levels, two layouts. The number/name/total columns
 *  start at the title cell's column (col A or B depending on year):
 *    2021–2026: utgiftsområde rows carry number, name and total in the
 *      three columns; anslag group headers are bold rows with the number
 *      embedded in the name ("1 Statschefen") and anslag are regular rows
 *      ("1 Kungliga hov- och slottsstaten"). The 2023 file lacks the header
 *      row for utgiftsområde 1, so anslag before any header are collected
 *      into an implicit "1 Rikets styrelse" group.
 *    2013–2020: every row carries its number in the first column — bold
 *      rows are utgiftsområden or anslag group headers, regular rows are
 *      anslag. A bold row starts a new utgiftsområde when the previous one
 *      is complete (its anslag sum to its total) and the number continues
 *      the 1,2,3… sequence; otherwise it is a group header (a subtotal).
 *    A few amounts sit one column further right (2014) or are stored as
 *    text with thousands separators (2019), and one anslag name wraps onto
 *    a continuation row (2014).
 *    One ExpenseGroup per utgiftsområde; rows are the anslag with a 1-based
 *    ordinal id in document order (the official anslag number "grupp:nr"
 *    does not fit a plain numeric id).
 *
 *  Inkomster — code-based hierarchy, two layouts:
 *    Code-column pairs: group headers (typ X000, huvudgrupp XX00,
 *      undergrupp XXX0) carry their code in one column and the leaf
 *      inkomsttitel rows carry theirs one column further right, each with
 *      the name in the next column. The pair of code columns is detected
 *      per sheet (cols A/B in 2013–2020 and 2023+, cols B/C in 2021).
 *    Single code column (2018, 2022): every row carries its code (as text)
 *      in one column with the name next to it; leaves are the codes that
 *      do not end in 0.
 *    In both, the inkomsttyp row (code divisible by 1000) comes AFTER its
 *    content and carries the typ total; the amount is the last numeric
 *    cell of the row. Bold typ-name rows without a code ("Skatt på
 *    arbete"), textual range headers ("1140-1160 Skattereduktioner") and
 *    summary rows ("Totala skatteintäkter") are presentational and
 *    skipped. Long names may wrap onto a continuation row directly below,
 *    which can also carry the amount (typ 8000 in 2013/2014); a few 2017
 *    amounts are stored as text. One RevenueGroup per inkomsttyp
 *    (id_start/id_end = its code range); rows are the inkomsttitlar with
 *    the official code as id. Huvudgrupp/undergrupp levels remain
 *    derivable from code prefixes.
 */
import { BudgetJsonSchema, type BudgetJson } from "../types/BudgetJsonSchema";
import type { ExpenseGroup, ExpenseRow, RevenueGroup, RevenueRow } from "../types/BudgetRowSchema";
import { readWorkbook, type Cell, type Sheet } from "./xlsx";

/**
 * The published workbook rounds each level to thousands independently, so
 * revenue totals can disagree with the sum of their parts by ±1 tkr (the
 * 2026 file does, at inkomsttyp 1000 and 7000 and at "Summa inkomster").
 * Expenditure totals add up exactly and are checked exactly.
 */
const REVENUE_ROUNDING_TOLERANCE = 2;

/** Title wordings by year; 2014/2015 prefix a chapter number ("1 Specifikation …"). */
const TITLE_RES = [
  /^(?:\d+ )?Specifikation av budgetens (?:utgifter|inkomster) för (\d{4})$/, // 2014–2017, 2019–2026
  /^Specifikation av budgetens utgifter och inkomster (\d{4})$/, // 2018 (same title on both sheets)
  /^Specifikation av utgifterna i statens budget för (\d{4})$/, // 2013 utgifter
  /^Specifikation av statens inkomster i budgeten för (\d{4})$/, // 2013 inkomster
  /^Specifikation av statens inkomster (\d{4})$/, // 2021 inkomster
];
const EXPENSE_TOTAL_LABEL = "Summa anslag";
const REVENUE_TOTAL_LABELS = new Set(["Summa inkomster", "Statens budget, inkomster (kassamässigt)"]);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Some files (2023, 2025) carry float noise such as -168015517.00000003. */
const tkr = (v: number) => Math.round(v * 100) / 100;

const num = (cell: Cell | undefined, context: string): number => {
  if (typeof cell?.value !== "number") throw new Error(`Expected a number for ${context}, got ${JSON.stringify(cell?.value)}`);
  return cell.value;
};

/** A 4-digit inkomst code, whether the cell holds a number or text. */
const code4 = (value: string | number | undefined): number | undefined => {
  const s = String(value ?? "").trim();
  return /^\d{4}$/.test(s) ? +s : undefined;
};

const str = (cell: Cell | undefined): string | undefined =>
  typeof cell?.value === "string" && clean(cell.value) ? clean(cell.value) : undefined;

/**
 * An amount cell: a number, or (a handful of 2017/2019 cells) a number
 * stored as text with thousands separators ("1 505 951"). Requiring the
 * separator keeps 4-digit inkomst codes stored as text from matching.
 */
const amountOf = (value: string | number | undefined): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d{1,3}(?:[\s ]\d{3})+$/.test(value.trim())) return +value.replace(/[\s ]/g, "");
  return undefined;
};

/** The last amount in a row at or right of fromCol, which is where every layout puts it. */
const lastAmount = (row: (Cell | undefined)[], fromCol: number): number | undefined => {
  for (let i = row.length - 1; i >= fromCol; i--) {
    const v = amountOf(row[i]?.value);
    if (v !== undefined) return v;
  }
  return undefined;
};

const titleYear = (s: string): number | undefined => {
  for (const re of TITLE_RES) {
    const year = s.match(re)?.[1];
    if (year) return +year;
  }
  return undefined;
};

/** Locates the specification title; returns the year and the title's cell position. */
function findTitle(sheet: Sheet): { year: number; col: number } | undefined {
  for (const row of sheet) {
    if (!row) continue;
    for (const [col, cell] of row.entries()) {
      if (typeof cell?.value !== "string") continue;
      const year = titleYear(clean(cell.value));
      if (year !== undefined) return { year, col };
    }
  }
  return undefined;
}

export type ParsedBudget = { year: number; budget: BudgetJson; warnings: string[] };

/** A bold anslag-group subtotal, tracked to verify the bold/regular classification. */
type BoldGroup = { title: string; total: number; sum: number };

const closeBoldGroup = (boldGroup: BoldGroup | undefined) => {
  if (boldGroup && boldGroup.total !== boldGroup.sum) {
    throw new Error(`Utgifter: group "${boldGroup.title}" totals ${boldGroup.total} but its anslag sum to ${boldGroup.sum}`);
  }
};

/** 2021–2026: numbers only on utgiftsområde rows; groups/anslag have them embedded in the name. */
function parseExpensesNewLayout(sheet: Sheet, offset: number, warnings: string[]): { groups: ExpenseGroup[]; total?: number } {
  const groups: ExpenseGroup[] = [];
  let total: number | undefined;
  let current: ExpenseGroup | undefined;
  let implicitFirst = false;
  let boldGroup: BoldGroup | undefined;

  for (const row of sheet) {
    if (!row) continue;
    const [a, b, c] = [row[offset], row[offset + 1], row[offset + 2]];
    const name = str(b);
    if (!name || titleYear(name) !== undefined) continue;

    if (name === EXPENSE_TOTAL_LABEL) {
      total = num(c, `"${EXPENSE_TOTAL_LABEL}"`);
      continue;
    }

    const areaNumber = a?.value;
    if (areaNumber !== undefined && String(areaNumber).trim() !== "" && Number.isFinite(+areaNumber)) {
      closeBoldGroup(boldGroup);
      boldGroup = undefined;
      current = { uo: +areaNumber, title: name, total: num(c, `utgiftsområde ${+areaNumber}`), rows: [] };
      groups.push(current);
      continue;
    }

    if (typeof c?.value !== "number") continue;
    if (!current) {
      // 2023: the workbook omits the header row for utgiftsområde 1.
      current = { uo: 1, title: "Rikets styrelse", total: 0, rows: [] };
      groups.push(current);
      implicitFirst = true;
      warnings.push('Utgifter: no header row for utgiftsområde 1; assuming "Rikets styrelse" with the sum of its anslag as total');
    }
    if (b!.bold) {
      closeBoldGroup(boldGroup);
      boldGroup = { title: name, total: c.value, sum: 0 };
    } else {
      const expenseRow: ExpenseRow = {
        id: current.rows.length + 1,
        title: name.replace(/^\d+ /, ""),
        expense: c.value,
      };
      current.rows.push(expenseRow);
      if (boldGroup) boldGroup.sum += c.value;
    }
  }
  closeBoldGroup(boldGroup);

  if (implicitFirst && groups.length > 0) {
    const first = groups[0]!;
    first.total = first.rows.reduce((s, r) => s + r.expense, 0);
    if (groups[1] && groups[1].uo !== 2) {
      throw new Error(`Utgifter: anslag before the first utgiftsområde header, but the first header is utgiftsområde ${groups[1].uo}`);
    }
  }
  return { groups, total };
}

/**
 * 2013–2020: every row carries its number in the first column; bold rows
 * are utgiftsområden or anslag group headers, regular rows are anslag. A
 * bold row starts a new utgiftsområde when the previous one is complete
 * (its anslag sum to its total) and its number continues the sequence.
 */
function parseExpensesOldLayout(sheet: Sheet, offset: number): { groups: ExpenseGroup[]; total?: number } {
  const groups: ExpenseGroup[] = [];
  let total: number | undefined;
  let current: ExpenseGroup | undefined;
  let currentSum = 0;
  let boldGroup: BoldGroup | undefined;
  // The row a wrapped name continuation would extend (2014: one anslag
  // name spills onto the row below, in the name column only).
  let wrappable: { row: number; append: (s: string) => void } | undefined;

  for (let r = 0; r < sheet.length; r++) {
    const row = sheet[r];
    if (!row) continue;
    const [a, b] = [row[offset], row[offset + 1]];

    if (str(a) === EXPENSE_TOTAL_LABEL) {
      total = lastAmount(row, offset + 1);
      if (total === undefined) throw new Error(`Utgifter: no amount on the "${EXPENSE_TOTAL_LABEL}" row`);
      total = tkr(total);
      continue;
    }

    const name = str(b);
    if (!name || titleYear(name) !== undefined) continue;

    if (typeof a?.value !== "number") {
      // A lone string in the name column directly below a data row is the
      // continuation of a wrapped name.
      const loneName = row.every((c, i) => i === offset + 1 || !c || (typeof c.value === "string" && !clean(c.value)));
      if (wrappable && r === wrappable.row + 1 && loneName) {
        wrappable.append(name);
        wrappable.row = r;
      }
      continue;
    }

    const amount = lastAmount(row, offset + 2);
    if (amount === undefined) throw new Error(`Utgifter: numbered row "${name}" has no amount`);

    if (b!.bold) {
      closeBoldGroup(boldGroup);
      boldGroup = undefined;
      if (!current || currentSum === current.total) {
        // The previous utgiftsområde is complete, so this starts the next one.
        if (a.value !== (current?.uo ?? 0) + 1) {
          throw new Error(`Utgifter: expected utgiftsområde ${(current?.uo ?? 0) + 1} next, got bold row ${a.value} "${name}"`);
        }
        current = { uo: a.value, title: name, total: tkr(amount), rows: [] };
        currentSum = 0;
        groups.push(current);
        const uo = current;
        wrappable = { row: r, append: (s) => (uo.title += ` ${s}`) };
      } else {
        boldGroup = { title: name, total: tkr(amount), sum: 0 };
        const group = boldGroup;
        wrappable = { row: r, append: (s) => (group.title += ` ${s}`) };
      }
    } else {
      if (!current) throw new Error(`Utgifter: anslag "${name}" before the first utgiftsområde header`);
      const expenseRow: ExpenseRow = { id: current.rows.length + 1, title: name, expense: tkr(amount) };
      current.rows.push(expenseRow);
      currentSum += expenseRow.expense;
      if (boldGroup) boldGroup.sum += expenseRow.expense;
      wrappable = { row: r, append: (s) => (expenseRow.title += ` ${s}`) };
    }
  }
  closeBoldGroup(boldGroup);
  return { groups, total };
}

function parseExpenses(sheet: Sheet, warnings: string[]): { groups: ExpenseGroup[]; total: number } {
  // The number/name/total columns start where the title cell is; without a
  // title, fall back to the column left of the "Summa anslag" label.
  let offset = findTitle(sheet)?.col;
  if (offset === undefined) {
    for (const row of sheet) {
      const col = row?.findIndex((c) => str(c) === EXPENSE_TOTAL_LABEL) ?? -1;
      if (col > 0) {
        offset = col - 1;
        break;
      }
    }
  }
  if (offset === undefined) throw new Error(`Utgifter: could not locate the "${EXPENSE_TOTAL_LABEL}" column`);

  // In the 2013–2020 layout regular (non-bold) anslag rows carry their
  // number in the first column; in the 2021+ layout only bold
  // utgiftsområde rows do.
  const oldLayout = sheet.some(
    (row) =>
      row &&
      typeof row[offset!]?.value === "number" &&
      str(row[offset! + 1]) !== undefined &&
      !row[offset! + 1]!.bold &&
      lastAmount(row, offset! + 2) !== undefined,
  );

  const { groups, total } = oldLayout ? parseExpensesOldLayout(sheet, offset) : parseExpensesNewLayout(sheet, offset, warnings);

  if (total === undefined) throw new Error(`Utgifter: no "${EXPENSE_TOTAL_LABEL}" row found`);
  if (groups.length === 0) throw new Error("Utgifter: no utgiftsområden found");
  for (const group of groups) {
    const sum = group.rows.reduce((s, r) => s + r.expense, 0);
    if (sum !== group.total) {
      throw new Error(`Utgifter: utgiftsområde ${group.uo} totals ${group.total} but its anslag sum to ${sum}`);
    }
  }
  const sum = groups.reduce((s, g) => s + g.total, 0);
  if (sum !== total) throw new Error(`Utgifter: "${EXPENSE_TOTAL_LABEL}" is ${total} but the utgiftsområden sum to ${sum}`);
  return { groups, total };
}

function parseRevenues(sheet: Sheet): { groups: RevenueGroup[]; total: number } {
  // Locate the code columns: cells holding a 4-digit code with a name in
  // the next column. Group headers sit in the leftmost such column; leaf
  // inkomsttitlar either one column further right (2013–2021, 2023+) or in
  // the same column with text codes not ending in 0 (2018, 2022).
  const codeCols = new Set<number>();
  for (const row of sheet) {
    if (!row) continue;
    for (let i = 0; i < row.length; i++) {
      if (code4(row[i]?.value) !== undefined && str(row[i + 1]) !== undefined) codeCols.add(i);
    }
  }
  if (codeCols.size === 0) throw new Error("Inkomster: no inkomst codes found");
  const headerCol = Math.min(...codeCols);
  for (const col of codeCols) {
    if (col !== headerCol && col !== headerCol + 1) {
      throw new Error(`Inkomster: codes in unexpected columns ${[...codeCols].sort().join(", ")}`);
    }
  }
  const twoCodeCols = codeCols.has(headerCol + 1);

  const groups: RevenueGroup[] = [];
  let pending: RevenueRow[] = [];
  let total: number | undefined;
  // The row a wrapped name continuation would extend; the continuation can
  // also carry the amount when the first line has none (typ 8000 2013/2014).
  let wrappable: { row: number; nameCol: number; append: (s: string) => void; setAmount?: (n: number) => void } | undefined;
  let unresolved: RevenueGroup | undefined; // typ group still awaiting its amount

  for (let r = 0; r < sheet.length; r++) {
    const row = sheet[r];
    if (!row) continue;

    const label = row.find((c) => typeof c?.value === "string" && REVENUE_TOTAL_LABELS.has(clean(c.value)));
    if (label) {
      const amount = lastAmount(row, 0);
      if (amount === undefined) throw new Error(`Inkomster: no amount on the "${clean(String(label.value))}" row`);
      total = tkr(amount);
      wrappable = undefined;
      continue;
    }

    let code: number | undefined;
    let col = headerCol;
    for (const i of twoCodeCols ? [headerCol, headerCol + 1] : [headerCol]) {
      const c = code4(row[i]?.value);
      if (c !== undefined && str(row[i + 1]) !== undefined) {
        code = c;
        col = i;
        break;
      }
    }

    if (code === undefined) {
      // A row directly below a data row, holding only a string in its name
      // column and/or an amount to the right of it, continues that row: a
      // wrapped name (2013–2020) or an amount pushed down by a wrapped,
      // merged name cell (2017).
      if (wrappable && r === wrappable.row + 1) {
        const text = str(row[wrappable.nameCol]);
        const amount = lastAmount(row, wrappable.nameCol + 1);
        const noiseFree = row.every(
          (c, i) => i === wrappable!.nameCol || !c || (typeof c.value === "string" && !clean(c.value)) || (i > wrappable!.nameCol && typeof c.value === "number"),
        );
        if (noiseFree && (text || amount !== undefined)) {
          if (text) wrappable.append(text);
          if (amount !== undefined) wrappable.setAmount?.(tkr(amount));
          wrappable.row = r;
        }
      }
      continue;
    }

    const title = str(row[col + 1])!;
    const amount = lastAmount(row, col + 2);
    const isLeaf = twoCodeCols ? col === headerCol + 1 : code % 10 !== 0;

    if (isLeaf) {
      // 2017: some amounts sit on the row below (pushed down by a wrapped,
      // merged name cell); the continuation handling above fills them in.
      const leaf: RevenueRow = { id: code, title, revenue: amount === undefined ? Number.NaN : tkr(amount) };
      pending.push(leaf);
      wrappable = {
        row: r,
        nameCol: col + 1,
        append: (s) => (leaf.title += ` ${s}`),
        setAmount: (n) => {
          if (Number.isNaN(leaf.revenue)) leaf.revenue = n;
        },
      };
      continue;
    }

    // Inkomsttyp rows (code divisible by 1000) follow their content and
    // close the group; huvudgrupp- and undergrupp headers are
    // presentational and skipped (their wrapped continuations too).
    if (code % 1000 === 0) {
      const group: RevenueGroup = { title, id_start: code, id_end: code + 999, total: amount === undefined ? Number.NaN : tkr(amount), rows: pending };
      pending = [];
      groups.push(group);
      if (amount === undefined) unresolved = group;
      wrappable = {
        row: r,
        nameCol: col + 1,
        append: (s) => (group.title += ` ${s}`),
        setAmount: (n) => {
          if (Number.isNaN(group.total)) {
            group.total = n;
            if (unresolved === group) unresolved = undefined;
          }
        },
      };
    } else {
      wrappable = { row: r, nameCol: col + 1, append: () => {} };
    }
  }

  if (unresolved) throw new Error(`Inkomster: inkomsttyp ${unresolved.id_start} has no amount (not even on a continuation row)`);
  for (const group of groups) {
    for (const row of group.rows) {
      if (Number.isNaN(row.revenue)) throw new Error(`Inkomster: inkomsttitel ${row.id} has no amount (not even on a continuation row)`);
    }
  }
  if (total === undefined) throw new Error('Inkomster: no "Summa inkomster" row found');
  if (groups.length === 0) throw new Error("Inkomster: no inkomsttyper found");
  if (pending.length > 0) {
    throw new Error(`Inkomster: ${pending.length} inkomsttitlar after the last inkomsttyp row (first: ${pending[0]!.id})`);
  }
  for (const group of groups) {
    const sum = group.rows.reduce((s, r) => s + r.revenue, 0);
    if (Math.abs(sum - group.total) > REVENUE_ROUNDING_TOLERANCE) {
      throw new Error(`Inkomster: inkomsttyp ${group.id_start} totals ${group.total} but its titlar sum to ${sum}`);
    }
  }
  const sum = groups.reduce((s, g) => s + g.total, 0);
  if (Math.abs(sum - total) > REVENUE_ROUNDING_TOLERANCE) {
    throw new Error(`Inkomster: "Summa inkomster" is ${total} but the inkomsttyper sum to ${sum}`);
  }
  return { groups, total };
}

/** Parses a budget specification workbook and validates the result. */
export function parseBudgetWorkbook(bytes: Uint8Array): ParsedBudget {
  const sheets = readWorkbook(bytes);

  // Sheet names vary by year ("Utgifter", "Blad1", truncated titles), and
  // 2016 even has Inkomster before Utgifter, so identify the sheets by
  // their total rows instead.
  let utgifter: Sheet | undefined;
  let inkomster: Sheet | undefined;
  for (const sheet of sheets.values()) {
    for (const row of sheet) {
      for (const cell of row ?? []) {
        if (typeof cell?.value !== "string") continue;
        const text = clean(cell.value);
        if (text === EXPENSE_TOTAL_LABEL) {
          if (utgifter) throw new Error(`Multiple sheets contain a "${EXPENSE_TOTAL_LABEL}" row`);
          utgifter = sheet;
        } else if (REVENUE_TOTAL_LABELS.has(text)) {
          if (inkomster && inkomster !== sheet) throw new Error('Multiple sheets contain a "Summa inkomster" row');
          inkomster = sheet;
        }
      }
    }
  }
  if (!utgifter || !inkomster || utgifter === inkomster) {
    throw new Error(
      `Could not identify the Utgifter ("${EXPENSE_TOTAL_LABEL}") and Inkomster ("Summa inkomster") sheets, found: ${[...sheets.keys()].join(", ")}`,
    );
  }

  // Not every sheet carries a title (2016/2020 Inkomster); one is enough.
  const expenseYear = findTitle(utgifter)?.year;
  const revenueYear = findTitle(inkomster)?.year;
  if (expenseYear !== undefined && revenueYear !== undefined && expenseYear !== revenueYear) {
    throw new Error(`Sheet years disagree: Utgifter says ${expenseYear}, Inkomster says ${revenueYear}`);
  }
  const year = expenseYear ?? revenueYear;
  if (year === undefined) throw new Error('Could not find a "Specifikation av budgetens ... för <år>" title in either sheet');

  const warnings: string[] = [];
  const expenses = parseExpenses(utgifter, warnings);
  const revenues = parseRevenues(inkomster);

  const budget = BudgetJsonSchema.parse({
    expenses: expenses.groups,
    revenues: revenues.groups,
    expensesTotal: expenses.total,
    revenuesTotal: revenues.total,
  });
  return { year, budget, warnings };
}
