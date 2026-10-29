"""Turn bilaga 1 of budgetpropositionen (2010–2012) into data/<year>.json.

Those years were published as PDF, not as the Excel workbooks used from 2013.
Amounts are read verbatim, in tkr, and every utgiftsområde, anslag group and
inkomsttyp is checked against the sum of its parts (revenues may differ by
±2 tkr, the same tolerance as the Excel parser).
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
REVENUE_TOLERANCE = 2

# Prop. 2011/12:1 bilaga 1 prints undergrupp 1310 as 31 416 263, while titlar
# 1311–1314 sum to 31 416 357. Inkomsttyp 1000 follows that printed subtotal,
# so its titlar sum to 94 tkr more than the official total. Both figures are
# the ones printed in the source.
SOURCE_LEAF_GAP = {2012: {1000: 94}}

SOURCES = {
    2010: (ROOT / "examples" / "2010.pdf", None),
    2011: (ROOT / "examples" / "2011.pdf", None),
    2012: (ROOT / "examples" / "2012.pdf", None),
}


def cluster_lines(page):
    words = [
        w
        for w in page.extract_words(extra_attrs=["fontname", "size"], keep_blank_chars=False)
        if 50 <= w["top"] <= 760
    ]
    words.sort(key=lambda w: (w["top"], w["x0"]))
    lines = []
    for w in words:
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= 3.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    for line in lines:
        line.sort(key=lambda w: w["x0"])
    return lines


def clean(s: str) -> str:
    s = s.replace("\u00ad", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def append_title(title: str, extra: str) -> str:
    extra = clean(extra)
    if not extra:
        return title
    # A hyphen at a line break joins a split word ("Myndighets-" + "verksamhet").
    # "EU-" and a spaced dash ("fonden -") are part of the printed title.
    if title.endswith("-") and extra[:1].islower():
        if title.endswith(" -"):
            return f"{title} {extra}"
        stem = title[:-1].rstrip().split(" ")[-1]
        if stem.isupper():
            return title + extra
        return title[:-1] + extra
    if title.endswith(("–", "-")) and extra[:1].isdigit():
        return title + extra
    return f"{title} {extra}".strip()


def split_amount(words):
    """The right-aligned amount. A year in the title ("efter 1988") is also
    numeric, but it sits well to the left of the amount with a wide gap."""
    i = len(words)
    prev_x = None
    while i > 0 and re.fullmatch(r"-?\d+", words[i - 1]["text"]):
        x = words[i - 1]["x0"]
        if prev_x is not None and prev_x - x > 45:
            break
        prev_x = x
        i -= 1
    if i == len(words) or words[i]["x0"] < 420:
        return words, None
    return words[:i], int("".join(w["text"] for w in words[i:]))


def line_text(words) -> str:
    return clean(" ".join(w["text"] for w in words))


def is_noise(words) -> bool:
    text = line_text(words)
    if not text:
        return True
    if "PROP." in text or text.startswith("BILAGA"):
        return True
    if re.search(r"1000[\-\u2013]tal", text) or text == "kronor":
        return True
    if max(w["size"] for w in words) >= 18:
        return True
    if re.match(r"I det följande", text) or text.startswith("Samtliga anslag") or text.startswith("Inkomsterna är"):
        return True
    return False


def parse_content_line(words, mode: str):
    """A numbered budget row, or None when the line is a title/amount fragment."""
    rest, amount = split_amount(words)
    if not rest:
        return {"fragment": True, "title": "", "amount": amount}
    first = rest[0]
    title_words = rest[1:] if re.fullmatch(r"\d{1,2}", first["text"]) and first["x0"] < 180 else None
    if mode == "exp" and title_words is not None:
        title = line_text(title_words)
        if not title and amount is None:
            return None
        bold = any("Bold" in w["fontname"] for w in title_words) or (not title_words and "Bold" in first["fontname"])
        size = max((w["size"] for w in title_words), default=first["size"])
        kind = "uo" if bold and size >= 12.5 else "group" if bold else "anslag"
        return {"fragment": False, "kind": kind, "num": int(first["text"]), "title": title, "amount": amount}
    # A code shares its line with the title. A wrapped year ("1999") is four
    # digits too, but it is the whole line, so it must stay a fragment.
    code = next((w for w in rest if re.fullmatch(r"\d{4}", w["text"]) and w["x0"] < 160), None)
    has_title = code is not None and any(not re.fullmatch(r"[\d–\-]+", w["text"]) for w in rest if w is not code)
    if mode == "rev" and code is not None and has_title:
        title = line_text([w for w in rest if w is not code])
        n = int(code["text"])
        kind = "typ" if n % 1000 == 0 else "header" if n % 10 == 0 else "leaf"
        return {"fragment": False, "kind": kind, "num": n, "title": title, "amount": amount}
    title = line_text(rest)
    if title.upper().startswith("SUMMA ANSLAG"):
        return {"total": "exp", "amount": amount}
    if title.lower().startswith("summa inkomster"):
        return {"total": "rev", "amount": amount}
    return {"fragment": True, "title": title, "amount": amount}


def section_of(words):
    if max(w["size"] for w in words) < 18:
        return None
    text = line_text(words).lower()
    if "utgifter" in text:
        return "exp"
    if "inkomster" in text:
        return "rev"
    return None


def parse_pdf(path: Path, year: int):
    expenses = []
    revenues = []
    expenses_total = None
    revenues_total = None
    mode = None
    open_item = None
    pending = []
    group = None
    group_sum = 0

    def fail(msg):
        raise SystemExit(f"{path.name}: {msg}")

    def commit(item):
        nonlocal group, group_sum, pending
        if item is None:
            return
        if item["amount"] is None:
            fail(f"no amount for {item['kind']} {item['num']} {item['title']!r}")
        if item["kind"] == "uo":
            if group and group_sum != group["total"]:
                fail(f"group {group['title']!r} totals {group['total']} but anslag sum to {group_sum}")
            group = None
            group_sum = 0
            if expenses and sum(r["expense"] for r in expenses[-1]["rows"]) != expenses[-1]["total"]:
                got = sum(r["expense"] for r in expenses[-1]["rows"])
                fail(f"utgiftsområde {expenses[-1]['uo']} totals {expenses[-1]['total']} but anslag sum to {got}")
            if item["num"] != len(expenses) + 1:
                fail(f"expected utgiftsområde {len(expenses) + 1}, got {item['num']} {item['title']!r}")
            expenses.append({"total": item["amount"], "title": item["title"], "rows": [], "uo": item["num"]})
        elif item["kind"] == "group":
            if not expenses:
                fail(f"group {item['title']!r} before the first utgiftsområde")
            if group and group_sum != group["total"]:
                fail(f"group {group['title']!r} totals {group['total']} but anslag sum to {group_sum}")
            group = {"title": item["title"], "total": item["amount"]}
            group_sum = 0
        elif item["kind"] == "anslag":
            if not expenses:
                fail(f"anslag {item['title']!r} before the first utgiftsområde")
            expenses[-1]["rows"].append(
                {"title": item["title"], "id": len(expenses[-1]["rows"]) + 1, "expense": item["amount"]}
            )
            group_sum += item["amount"]
        elif item["kind"] == "leaf":
            pending.append({"title": item["title"], "id": item["num"], "revenue": item["amount"]})
        elif item["kind"] == "typ":
            got = sum(r["revenue"] for r in pending)
            gap = got - item["amount"]
            allowed = SOURCE_LEAF_GAP.get(year, {}).get(item["num"])
            if abs(gap) > REVENUE_TOLERANCE and gap != allowed:
                fail(f"inkomsttyp {item['num']} totals {item['amount']} but titlar sum to {got}")
            revenues.append(
                {
                    "rows": pending,
                    "total": item["amount"],
                    "title": item["title"],
                    "id_start": item["num"],
                    "id_end": item["num"] + 999,
                }
            )
            pending = []
        elif item["kind"] == "header":
            return

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for words in cluster_lines(page):
                section = section_of(words)
                if section:
                    mode = section
                    continue
                if mode is None or is_noise(words):
                    continue
                parsed = parse_content_line(words, mode)
                if parsed is None:
                    continue
                if "total" in parsed:
                    commit(open_item)
                    open_item = None
                    if parsed["amount"] is None:
                        fail(f"no amount on {parsed['total']} total")
                    if parsed["total"] == "exp":
                        expenses_total = parsed["amount"]
                    else:
                        revenues_total = parsed["amount"]
                    continue
                if parsed["fragment"]:
                    if open_item is None:
                        continue
                    # A fragment that carries its own amount, after a row that
                    # already has one, is a presentational category such as
                    # "Skatt på arbete", not a wrapped title.
                    if parsed["amount"] is not None and open_item["amount"] is not None:
                        continue
                    if parsed["title"]:
                        open_item["title"] = append_title(open_item["title"], parsed["title"])
                    if parsed["amount"] is not None:
                        open_item["amount"] = parsed["amount"]
                    continue
                commit(open_item)
                open_item = parsed
        commit(open_item)

    if group and group_sum != group["total"]:
        fail(f"group {group['title']!r} totals {group['total']} but anslag sum to {group_sum}")
    if expenses:
        got = sum(r["expense"] for r in expenses[-1]["rows"])
        if got != expenses[-1]["total"]:
            fail(f"utgiftsområde {expenses[-1]['uo']} totals {expenses[-1]['total']} but anslag sum to {got}")
    if expenses_total is None or revenues_total is None:
        fail(f"missing total (expenses={expenses_total}, revenues={revenues_total})")
    exp_sum = sum(g["total"] for g in expenses)
    rev_sum = sum(g["total"] for g in revenues)
    if exp_sum != expenses_total:
        fail(f"Summa anslag is {expenses_total} but utgiftsområden sum to {exp_sum}")
    if abs(rev_sum - revenues_total) > REVENUE_TOLERANCE:
        fail(f"Summa inkomster is {revenues_total} but inkomsttyper sum to {rev_sum}")
    if [g["uo"] for g in expenses] != list(range(1, 28)):
        fail(f"utgiftsområden {[g['uo'] for g in expenses]}")
    if [g["id_start"] for g in revenues] != [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]:
        fail(f"inkomsttyper {[g['id_start'] for g in revenues]}")
    if any(not g["rows"] for g in expenses):
        fail("an utgiftsområde has no anslag")
    return {
        "expenses": expenses,
        "revenues": revenues,
        "expensesTotal": expenses_total,
        "revenuesTotal": revenues_total,
    }


def main():
    years = [int(a) for a in sys.argv[1:]] or [2010, 2011, 2012]
    for year in years:
        path, _ = SOURCES[year]
        budget = parse_pdf(path, year)
        out = ROOT / "data" / f"{year}.json"
        out.write_text(json.dumps(budget, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        anslag = sum(len(g["rows"]) for g in budget["expenses"])
        titlar = sum(len(g["rows"]) for g in budget["revenues"])
        print(f"{year}: {anslag} anslag, {titlar} inkomsttitlar, utgifter {budget['expensesTotal']}, inkomster {budget['revenuesTotal']}")


if __name__ == "__main__":
    main()
