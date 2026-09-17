# Gut Feel - recovered original rules

This is a fidelity reference for the 2009 Gut Feel release. It distinguishes
documented behavior from values read from the shipped configuration, and does
not invent rules where the compiled Director movies are the only possible
source.

## Sources and authority

| Source | What it establishes |
| --- | --- |
| `gutfeel-installed/Client/Gut Feel Manual.pdf`, pp. 7-33 | Player controls, stations, queues, timers, digestion flow and nutrition model. |
| `gutfeel-installed/Client/Gut Feel SCORING GUIDE.pdf`, pp. 3-6 | Score formulae and penalties. |
| `gutfeel-installed/Host/Gut Feel Facilitation Guide.pdf`, pp. 4-15 | Classroom/team format, tutorial and instructional use. |
| `gutfeel-installed/Client/DSConfig.amd`, lines 5-148 | Shipped food inventory, food grids, scenario targets and absorption constants. Host config is byte-for-byte equivalent. |
| `gutfeel-installed/Tutorial/DSConfig.amd`, lines 5-130 | Separate tutorial-era inventory, targets and starter scenario. |
| `gutfeel-installed/Host/Shockwave Multiuser Server 3.0/Scripts/*.ls` | Generic server lifecycle messaging, not game mechanics. |
| `gutfeel-installed/report/GutFeelReporter.air` | `.amr` report association and report UI/output fields. |

When a manual and configuration disagree, preserve the configuration for the
corresponding executable. The manual's examples are explanatory; the client
configuration is the only readable runtime data source for current numeric
food and scenario values.

## Game purpose and team structure

Five Automaton robots operate George Killiney's Gut Replacement Module. The
team must digest food, keep his diet healthy, resolve crises and keep him alive
until recovery (Manual p. 5). The facilitation guide recommends teams of **4 or
5 players**, moving between rooms as needed (Facilitation Guide p. 13). The
teacher rule is that no learner may remain in one room for more than **3
minutes**; that is a classroom disqualification rule, not a confirmed
application-enforced timer (pp. 13-14).

The display exposes an event timer (time of day, month, or meal plus seconds
until the next activity), a five-zone map with numbered players, nutrition
bars, wastage, and team score/contribution (Manual pp. 9-11). The discovered
materials do not expose the event schedule or the exact contribution formula.

## Authoritative play loop

1. **Brain / Diet.** Select available food only when the mouth is empty. Food
   already in the mouth must be swallowed first. Nutrient still in the stomach
   at scenario end counts as wastage and costs score (Manual pp. 13-14).
2. **Mouth / saliva.** Enter the displayed direction-number sequence. Larger,
   drier food has a longer sequence. Fluid food can be swallowed without saliva
   or chewing. Applying saliva begins carbohydrate digestion on exposed
   carbohydrate (pp. 15-16; Scoring Guide p. 3).
3. **Mouth / chewing.** Stop the moving tooth highlight to choose teeth and
   strength; chewing makes boli and sends them to the oesophagus. Saliva and
   chewing can run concurrently. No saliva means no swallowing. At most two
   boli may wait before or after the oesophagus (Manual p. 17).
4. **Oesophagus.** Create contractions and relaxations through three sections.
   At least three of each move a bolus through. Multiple boli may be in transit;
   score is only awarded for perfect peristalsis (pp. 18-19).
5. **Stomach.** Only one bolus may be in the stomach at once. Solve the HCl
   pipe puzzle twice to lower pH to **2**, enabling pepsin on exposed protein.
   Then align three churn symbols to mechanically break the grid; sufficiently
   reduced food exits automatically to the small intestine. The pH control is
   locked until **3 minutes** pass and pH returns to **4** (pp. 21-24).
6. **Enzyme Depot and Small Intestine.** Lead carbohydrate, fat, protein and
   bile helpers to the loader. Each helper delivers **30 enzymes per trip**.
   Turret 1 uses pancreatic enzymes: carbohydrate and protein go to an
   intermediate form; bile emulsifies fat; lipase digests fat. Turret 2 uses
   intestinal enzymes, needs no loading, and finishes carbohydrate/protein.
   Food that skipped the first stage cannot be completed by Turret 2 (Manual
   pp. 25-30; Facilitation Guide pp. 7-9).
7. **Absorption / colon.** Punch only fully digested (diamond-shaped) nutrient
   into its matching pipe. Water can be punched but produces no reward; the
   colon automatically absorbs most water, plus water/minerals/vitamins. Fibre
   is neither digested nor absorbed (Manual pp. 31-32; Facilitation Guide pp.
   8-9).

## Limits, failure states and timers

| Rule | Exact behavior | Source |
| --- | --- | --- |
| Hotseat heat | A seat becomes too hot at **120 seconds**. Above 120, deduct **5 points per second** until the player gets off; its timer must recover to 120. | Manual p. 8; Scoring Guide p. 6 |
| Pre-oesophagus crisis | More than **2 boli** before the oesophagus shuts the module down; deduct **1 point per second** until fixed. | Scoring Guide p. 6 |
| Pre-stomach crisis | More than **2 boli** before the stomach has the same shutdown and **-1 point/second** cost. | Scoring Guide p. 6 |
| Stomach capacity | No more than **1 bolus** in the stomach. | Manual p. 24 |
| HCl cooldown | pH control unavailable for **3 minutes**, returning from pH 2 to pH 4. | Manual p. 22 |
| Scenario end | Nutrients not yet out of the stomach become wasted food and impose a score penalty. The precise end-of-round subtraction is not recovered. | Manual p. 14 |

The manual says a crisis flashes the affected minimap area red and that queues
are a serious crisis; the scoring guide supplies the numerical queue threshold
and cost (Manual p. 33; Scoring Guide p. 6).

## Exact scoring

| Action | Score |
| --- | --- |
| Scenario objective | Scenario-specific. Example: **Burger Jam: +50 per burger leaving stomach**. |
| Saliva | Score depends on remaining sequence time and saliva amount. Correct entries restore some time; wrong entries shorten it. Score is based only on the first operation for that food; leaving mid-sequence lowers it. |
| Saliva enzyme reaction | **+1 per exposed carbohydrate** receiving saliva. |
| Chewing at swallow | Hardness 0-9: **+5**; 10-19: **+4**; 20-29: **+3**; 30-39: **+2**; 40-49: **+1**; 50-59: **0**; 60-69: **-1**; 70-79: **-2**; 80-89: **-3**; 90-99: **-4**; 100: **-5**. |
| Saliva effect on chewing | <=50% saliva: halve chewing strength; >50% and <100%: saliva fraction x chewing strength; 100%: full strength. |
| Perfect oesophagus peristalsis | **+5** each occurrence, regardless of boli in passage. |
| HCl pipe completion | 1-7 sec: **+8**; 8-15: **+4**; 16-25: **+1**; >25: **0**. |
| Stomach churn | Perfect **+15**; good **+10**; either average pattern **+5**; bad **0**. Patterns are defined below. Pepsin digestion itself gives no points. |
| Turret digestion | **+5** for each molecule successfully made simpler. |
| Bile emulsification | **+5** per fat molecule emulsified. |
| Turret enzyme conservation | **-1** for every missed enzyme or enzyme matched to the wrong food. |
| Absorb fully digested nutrient into correct pipe | **+10**. |
| Absorb fully digested nutrient into wrong pipe | **+1**. |
| Waste fully digested nutrient to colon | **-5**. |
| Attempt to absorb fibre | **-5**. |
| Waste undigested or partially digested nutrient to colon | **-5**. |
| Attempt to absorb undigested/partially digested food | **-10**, including the food-wastage penalty. |

Churn patterns: perfect = all three centre-row slots identical; good = two
identical centre-row symbols and the third same symbol off-centre; average A =
two identical centre-row symbols and the third absent; average B = first
centre-row symbol appears off-centre in both other slots; bad = first
centre-row symbol absent from both other slots. These are literal Scoring Guide
p. 4 definitions.

`Client/DSConfig.amd` confirms the absorption score mapping as: correct +10,
wrong +1, no punch -5, undigested wrong -5, and
`DigPunchWrongAbsorbedWrong` -5. Start score is **0**. The guide is the source
for the more specific -10 attempted-undigested case.

## Food economy and nutrition

Food grids are blocks of carbohydrate (C), fat (F), protein (P), fibre and
water. **One nutrient block = 3 g.** Each gram of carbohydrate or protein is
4 kcal; fat is 9 kcal. George's stated daily target is **96 C / 24 F / 24 P
blocks**, about **2100 kcal**, with a healthy range **1622-2359 kcal/day**
(Manual p. 33; Scoring Guide p. 6).

The following are exact `Client/DSConfig.amd` food-grid values. `wave` is the
configured wave number, `seq` the saliva sequence value, and `min bites` /
`hardness` are the values adjacent to each item in the `[CPFPercentage]`
section. Matrix order is **C/F/P/fibre/water** in blocks; grams are the
matching configured C/F/P/fibre/water values.

| Food | wave | seq | min bites | hardness | grid blocks C/F/P/Fi/W | grams C/F/P/Fi/W |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Biscuit | 1 | 30 | 6 | 600 | 3/2/1/2/0 | 9/6/3/6/0 |
| Jawbreaker | 1 | 30 | 10 | 1000 | 8/0/0/0/0 | 24/0/0/0/0 |
| Apple | 1 | 10 | 8 | 800 | 2/0/0/1/5 | 6/0/0/3/15 |
| Baked beans | 2 | 15 | 4 | 350 | 3/0/1/1/11 | 9/0/3/3/33 |
| Fried egg | 2 | 10 | 2 | 200 | 0/2/2/0/12 | 0/6/6/0/36 |
| Chocolate | 2 | 25 | 7 | 700 | 9/5/1/0/1 | 27/15/3/0/3 |
| Muesli bar | 2 | 25 | 9 | 850 | 11/1/3/1/0 | 33/3/9/3/0 |
| Banana | 2 | 20 | 3 | 300 | 6/0/0/3/7 | 18/0/0/9/21 |
| Strawberry yoghurt | 4 | 10 | 1 | 50 | 6/0/1/0/25 | 18/0/3/0/75 |
| Fries | 4 | 25 | 4 | 400 | 12/8/1/1/10 | 36/24/3/3/30 |
| Bowl of noodles | 4 | 15 | 5 | 500 | 15/5/3/2/7 | 45/15/9/6/21 |
| Bowl of rice | 4 | 20 | 5 | 500 | 25/0/2/1/4 | 75/0/6/3/12 |
| Fish | 4 | 10 | 4 | 400 | 0/2/10/0/20 | 0/6/30/0/60 |
| Vegetables | 8 | 15 | 5 | 450 | 13/1/4/10/36 | 39/3/12/30/108 |
| Chicken curry | 8 | 15 | 9 | 850 | 6/7/11/2/38 | 18/21/33/6/114 |
| Burger | 8 | 25 | 9 | 900 | 20/10/8/2/24 | 60/30/24/6/72 |
| Water | 8 | 0 | 0 | 0 | 0/0/0/0/64 | 0/0/0/0/320 |
| Fresh milk | 8 | 0 | 0 | 0 | 5/2/4/0/53 | 15/6/12/0/159 |

The configuration also has a separate `[Score] MinBites` table. It conflicts
with the per-food values above for Baked beans, Fried egg, Chocolate, Banana,
Fries, Bowl of noodles, Bowl of rice, Vegetables, Chicken curry, Fish and
Burger: respectively it says **5, 4, 8, 4, 3, 6, 6, 9, 10, 6, 10**. Both sets
are preserved in `rules.json`; compiled game code is needed to establish which
one controls mastication scoring.

## Shipped scenarios and inventory

The production client and host configs match. Food panels have eight two-item
slots, then an empty ninth. Normal and Army have the same stock: Burger/Fish,
Banana/Chocolate, Vegetables/Fries, Chicken curry/Fried egg, Bowl of
rice/Bowl of noodles, Apple/Strawberry yoghurt, Muesli bar/Jawbreaker,
Biscuit/Baked beans: **five of every listed item**. Competition exposes
**20 Burgers** and nothing else.

| Scenario | Target C/F/P/Fi/W blocks | `ProjectionTimeSpan` | Food stock |
| --- | --- | ---: | --- |
| Normal | 96/24/24/0/0 | 1 | eight pairs, 5 each |
| Army | 100/18/50/0/100 | 9 | eight pairs, 5 each |
| Competition | 60/18/14/0/100 | 0 | 20 Burgers |

`ProjectionTimeSpan` is a field name only; no readable source establishes its
unit or implementation. Do not reinterpret it as seconds/minutes without
recovering Director code.

The tutorial config is different and must stay separate: starter panel = one
burger; its Normal/Army/Diarrhea targets are 83/18/14/0/0,
100/18/50/0/100, and 60/18/14/0/100. It starts at **200** points and has an
older absorption mapping (+10, +2, -5, -10). These are tutorial values, not
the production game.

## Multiplayer, facilitation and rounds

The manuals describe multi-user team play and classroom competition, but no
matchmaking, joining, host selection, or authoritative-state protocol is
recoverable from the supplied server scripts. The server's `ScriptMap.ls`
contains no game script mappings; it only loads generic globals. `Dispatcher.ls`
broadcasts `#groupJoin` and `#groupLeave` with user name, group name and server
member count, and `#userLogon` with user name. The spelling `#userLogff` is
present in the original for the intended logoff case. Those events establish
presence notifications only.

The recommended classroom sequence is:

1. **Phase One - introduction/tutorial:** learners explore the Tutorial,
   identify activities in each compartment, then form teams of 4-5.
2. **Phase Two - base scenario:** teams pursue the base nutrition target;
   suggested play time is **20 minutes**, followed by discussion and optionally
   another round or a chosen scenario.
3. **Phase Three - crisis extension:** teacher announces a scenario; teams
   plan its biological and room-level response; finish with a review.

The guide explicitly says the teacher may release a series of increasingly
complex scenarios or crises. It does not document an automatic scenario/round
progression rule.

## Reporter behavior recovered from the AIR package

`GutFeelReporter.air` registers `.amr` as **"Gut feel Report Handler"**. Its
UI reads and displays a group name, scenario name, player list, host, date,
time, total score, bonus score, wastage, projection, and objective. It provides
room detail panes for saliva, biting, oesophagus, HCl, churning, Turret 1,
Turret 2 and absorption, plus Crisis and Projection toggles. The report text
contains these confirmed fields:

- carbohydrate/protein/fat **absorbed/eaten/recommended (blocks)**;
- final score, burger bonus, wastage-meter score, and crisis faced;
- saliva-enzyme reaction score; biting score; perfect-peristalsis count;
- enzyme successes, wrong shots and penalty; and absorption correct/wrong and
  miss-or-undigested penalty.

The reporter has a **Save as PDF** control and its compiled strings show a
desktop `GFReport/Report.pdf` target. The precise `.amr` schema and calculation
of each displayed total are not recovered, so a replacement should preserve
these fields without assuming a file format.

## Fidelity gaps that remain deliberately unspecified

- exact direction keys, tooth-strength values, saliva timer duration, and
  perfect oesophagus rhythm;
- exact event calendar and scenario-end score calculation;
- player contribution algorithm, server-state synchronization, and `.amr`
  serialization schema;
- scenario objective rules other than the documented Burger Jam example.

These should be recovered from Director cast/script data or observed runtime
behavior, not approximated from the manuals.
