# content/

Hand-written content, separate from the converted budget data in `data/`.

- `om.md` — the about page, in the Markdown subset `src/markdown.ts` parses.
- `budgetar.json` — who voted each budget through the riksdag, with sources.

## budgetar.json

One entry per budget year, validated by `types/BudgetVotesSchema.ts`:

```json
"2023": {
  "parties": ["M", "KD", "L"],
  "support": ["SD"],
  "sources": [
    { "label": "Rambeslutet i riksdagen, bet. 2022/23:FiU1", "url": "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/betankande/_HA01FiU1/" }
  ]
}
```

- `parties` — the parties behind the budget that passed (the government's, or the
  winning reservation's). Letters as the riksdag writes them; `FP` before the
  2015 rename to `L`. The full list is in `types/BudgetVotesSchema.ts`.
- `support` — parties that voted for it without being behind it (optional).
- `sources` — at least one link, normally the rambeslut (finansutskottets
  betänkande FiU1) on riksdagen.se. The short form
  `https://www.riksdagen.se/sv/dokument-och-lagar/dokument/betankande/_<id>/`
  redirects to the document; the id is the riksmöte code + `01FiU1`
  (2022/23 = `HA`, 2023/24 = `HB`, …).

The data shows up on the `/budgetar` page and in the year info box on the
overview. A year without an entry simply shows no vote information, so a new
budget year can be added to `data/` before its vote is written here.
