# Om Statsbudgeten

![De kommer aldrig låta mig bli politiker efter det här...](https://www.youtube.com/watch?v=MbS-d4tSd14)

## Vad är det här?

Statsbudgeten.se visar Sveriges statsbudget. Varje ruta är ett utgiftsområde eller en inkomsttyp och storleken motsvarar beloppet, ungefär (på grund av hur hemsidor fungerar så finns det en pytteliten fast "padding" för att göra det läsvänligt). Genom att klicka på ett utgiftsområde kan du se en graf över hur den utvecklats över tid (med justering för inflation tillgängligt i menyn) och individuella posterna

Alla belopp kommer oförändrade från de officiella källorna nedan. Sajten är fristående och har ingen koppling till Regeringskansliet eller SCB.

## Varför har någon byggt det här?

För att Sveriges statsbudget är ett mer eller mindre helt oläsligt dokument på 3200+ sidor som Finansministern lite halv-cermoniellt dumpar på riksdagens hemsida och trappsteg. Om vi inte förstår hur våra skattepengar används, blir det väldigt svårt att säga om statsministern gjort ett bra jobb eller inte.

## Hur sajten är byggd

Sajten är byggd med [Bun](https://bun.sh), React och TypeScript. Regeringens Excelfiler och SCB:s inflationsserie konverteras till trevlig JSON som sajten sedan använder för att visa grafer. Kartan och diagrammen ritas utan externa diagrambibliotek. Koden är öppen och finns på [GitHub](https://github.com/kodalbert/statsbudgeten-se).

**Om AI.** Sajten har utvecklats tillsammans med Claude, min trogna vapendragare har skrivit merparten av koden utifrån en design, data-modeller och instruktioner från mig, och jag har granskat och styrt arbetet. Ingen AI är inblandad i själva siffrorna, bara för att bygga själva sidan. 

## Vem står bakom

Statsbudgeten.se är byggd av mig i egen hög person. Du hittar mig på [proddalbert.se](https://proddalbert.se) och som @ProddAlbert i sociala medier, och du når mig på [albert@proddalbert.se](mailto:albert@proddalbert.se). Hör gärna av dig med fel, idéer eller frågor.

## Källor

- Statens budget: [Statens budget som Excel](https://www.regeringen.se/sveriges-regering/finansdepartementet/statens-budget/statens-budget-som-excel/) från Regeringskansliet, Finansdepartementet.
- Inflation: [Inflation i Sverige](https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-ekonomiska-tendenser/priser/konsumentprisindex-kpi/pong/tabell-och-diagram/historiska-tal/inflation-i-sverige/) från SCB, konsumentprisindex (KPI).

Budgetfilerna är regeringens specifikation av budgetens utgifter och inkomster för respektive år, i tusental kronor. Inflationsjusteringen använder SCB:s årliga förändring av KPI och räknar om beloppen till prisnivån för det senaste år som har ett fast inflation. T.ex. 2026 har inte en slutgiltig inflation, eftersom året ännu inte är över.

## Källmaterial

Filerna som sajten bygger på, i original:
[sources]

Så läs, njut av siffer-nörderi och granska era politiker!
