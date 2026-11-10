# Football squads: one person, one nation

Added 2026-11-10, ported from the squad-years work of 19 October 2026 (branch
`claude/football-rating-strategy-ef71dc`, commits 75b47c1, 964d678 and e3cc2e1). The built-in football squads
(`src/data/rosters.js`, 2026/27) combine two databases: EA SPORTS FC 27, and Football Manager 26 filling the
shirts EA cannot. The same footballer is usually in both, under different ids and often different names. Until
this change the builder compared an FM record only with the EA records of its own nation, by name, so three men
started twice:

| Nation | Shirts | Why the name check missed |
| --- | --- | --- |
| Uzbekistan | EA "A. Fayzullaev" (70) and FM "Abbosbek Fayzullayev" (72) | romanisation: Fayzullaev / Fayzullayev |
| Lithuania | EA "G. Paulauskaas" (65) and FM "Gytis Paulauskas" (67) | EA's misspelling |
| Russia and Armenia | EA "N. Tiknizyan" (74) for Russia, FM "Nair Tiknizyan" (71) for Armenia | the records name different nations |

Now each real player is one **person** before any squad is picked, and each person plays for one nation. The
rules are in `resolvePersons` (`scripts/lib/football-data.mjs`); `npm run build-rosters` applies them, and the
audit (`docs/design/football-roster-audit.json`) logs every decision.

## Person keys

A record's person key is assigned in this order:

1. **Reep.** [Reep](https://reep.football/data) is an open register (CC0) that links a footballer's ids across
   providers: Messi is `rp8a503e860b7abe`, holding EA id 158023 and FM unique id 7458500 (EFEM's ids are FM's
   unique ids). `scripts/data/reep-bridge.json` keeps the release 2026-10-18.1 persons that hold an id of a committed
   snapshot (EA FC 27, EA FC 26 and FM 26): 25,909 persons. Reep's own release manifest reports
   `deterministic_quality.passed: false` (precision 99.79%, held-out recall 91.98%), so the reducer checks every
   EA–FM link before it can merge two records: the names must share a surname (folded, one edit allowed from four
   letters and two from eight, for romanisations such as Fayzullaev/Fayzullayev or Al Mousa/Al-Mosa) and FM's age
   must be within a year of an EA birth date. That rejects 3 of 4,885 links: Pote (Pedro Gonçalves), Marezi (Marko
   Milovanović) and Chandrel Massanga (EA Matondo). An id on two Reep persons leaves both. Reep withholds people
   under 18. `npm run sync:reep-bridge` rebuilds the file from Reep's `bridges.csv` saved in the ignored
   `data-src/reep/`, and the bridge records that file's SHA-256, so `--check` refuses any other.
2. **Overrides.** `scripts/data/football-identity-overrides.json` lists hand-checked identities with their evidence:
   `same` joins records (Pote and Massanga, whose Reep links the reducer rejected on the name; Kristall Máni
   Ingason, whom Reep splits; Byron Castillo and Luck Zogbé, whose EA birth dates disagree with FM's ages),
   `distinct` keeps records apart (none yet), and `nations` settles a nation (below).
3. **The name matcher**, only between records no key pairs yet: within a nation, the old name rules, now also with
   FM's age within a year of the EA birth date on the FM age date (1 July before the database date, 2025-07-01 for
   26.3.0); across nations, the same full name, the same age, a shared club word and at most one Reep id. A match is
   one-to-one or nothing. An FM name of one word never joins (FM records carry no birth date: FM's Gavi could be any
   Gavi), and two records that both hold Reep ids are two people. Rejected matches are logged as near misses.

A person with no Reep id is keyed by its EA record id, else its FM id. The squad keeps one record per person, EA's
first, whatever nation the person plays for.

On the built-in data: 29,934 persons from 17,849 EA and 16,856 FM records. Reep keys 14,977 EA records (83.9%) and
11,572 FM records (68.7%), 4,234 persons with both. The name matcher joins 499 more within nations and 3 across
(Ibrahim Karamoko, Bryan Adinany, Johannes Hummelvoll-Nuñez, each the same club in both). It leaves out 13 FM
records as ambiguous and 17 one-word FM names, and logs 103 near misses (69 ages differ, 23 one-word FM names, 6
clubs differ, 5 two Reep persons). FM fills a shirt only with a person who has no EA record.

The audit's linking check compares EA's overall with FM's converted rating over same-person pairs: EA − FM is +0.10
(95% CI 0.02 to 0.19) over the 4,569 one-to-one name matches and +0.13 (0.04 to 0.21) over the 4,234 Reep pairs, so
the two scales agree on average and the builder's "EA first, FM fills gaps" rule mixes like with like.

## One nation per person

When a person's records name different nations, the first rule that applies decides:

1. **override**: a `nations` entry, checked by hand against the person's senior caps;
2. **fresher-ea / fresher-fm**: the nationality of the source dated later. EA FC 27's snapshot (1 November 2026)
   postdates FM 26's database (30 March 2026), so EA decides today; when a newer FM database arrives first, FM will;
3. **ea-nationality**: otherwise (several records of one source) the best-rated EA record's nationality.

A person whose nation has no shape on the map (Cabo Verde, Malta: 18 names, 126 players) enters no squad, as
before.

There are 60 conflicts. In 11 of them the person starts somewhere before or after the change, and each was checked
against the infobox of his English Wikipedia article on 2026-11-10:

| Player | EA nation | FM nation | Senior caps | Decided |
| --- | --- | --- | --- | --- |
| Nair Tiknizyan | Russia | Armenia | Armenia, 35 since March 2023 (Russia U19, U21 only) | Armenia, by override |
| Filimon Gerezgiher | Germany | Eritrea | Eritrea, 2 in 2026 | Eritrea, by override |
| Gibrán Lajud | Mexico | Lebanon | Mexico, 1 (2018) | Mexico |
| Gastón Olveira | Paraguay | Uruguay | Paraguay, 2 in 2026 (in its 2026 World Cup squad) | Paraguay |
| Tesfaldet Tekie | Eritrea | Sweden | Sweden 1 (2019), then Eritrea 2 (2026) | Eritrea |
| Dario Naamo | Iraq | Finland | Iraq, 1 in 2026 (Finland youth) | Iraq |
| Kieran Ngwenya | Trinidad and Tobago | Malawi | Malawi 2 (2021–23), then Trinidad and Tobago 1 (2026) | Trinidad and Tobago |
| Hany Mukhtar | Germany | Sudan | none (Germany youth) | Germany |
| Abdulaziz Noor | Saudi Arabia | Sudan | none | Saudi Arabia |
| Mark Mampassi | Russia | Congo | none (Ukraine youth) | Russia |
| Beckham Baker | Australia | Timor-Leste | none | Australia |

Senior caps back EA's nation in five cases and FM's in two, so the fresher-source rule stays, and the two it gets
wrong are overridden. The four uncapped players follow the rule; a `nations` entry can move any of them once he is
capped. The other 49 conflicts touch no XI (Mason Greenwood, England or Jamaica; Mitchell Weiser, Germany or Algeria,
and so on) and follow the rule unchecked.

## What changed in the built-in squads

Eight national XIs change, by nine shirts; strength (the rounded XI mean) moves in three:

| Nation | Out | In | Strength |
| --- | --- | --- | --- |
| Lithuania | FM Gytis Paulauskas (the duplicate) | Paulius Golubickas (66) | 68 |
| Uzbekistan | FM Abbosbek Fayzullayev (the duplicate) | Oston O'runov (70) | 70 |
| Russia | N. Tiknizyan (74) | G. Tunguliadi (59) | 72 → 71 |
| Armenia | FM Nair Tiknizyan (71) | EA N. Tiknizyan (74), the same player | 69 → 70 |
| Eritrea | FM Filimon Gerezgiher (66) | EA F. Gerezgiher (63), the same player | 57 |
| Sudan | Hany Mukhtar (76), Abdulaziz Noor (66) | Mohamed Abdel Rahman (64), Salaheldin Adil (62) | 66 → 64 |
| Lebanon | Gibrán Lajud (67) | Mostafa Matar (66) | 65 |
| Timor-Leste | Beckham Baker (53) | Pedro Henrique (53) | 50 |

All 173 nations still field eleven natural players (1,257 EA and 646 FM shirts, as before), clubs are unchanged,
and pool sizes (the second number of each `ROSTERS` entry, now persons rather than records) change for 70 nations.
The squad gate's numbers barely move: Spearman against World Football Elo 0.9296 → 0.9291, and the engine scale
passes against the old squads ([football-squad-gate.md](football-squad-gate.md)).

## Checks

`scripts/football-rosters.test.mjs` rebuilds the persons and pools in memory and requires the shipped XIs, pool sizes,
audit person keys and linking numbers to be the build's, so a stale `rosters.js` fails. It also requires that no XI
fields an EA and an FM shirt with one surname and an age within a year; no person starts for two nations, by name
(every EA name form) or by person key; no two records of one Reep person start, rejected links included; no near
miss fields both its records without a `distinct` entry; every override is honoured; every conflict is logged with
the rule that decided it. Unit tests cover the key order, the age, one-word and whole-bridge rules, a `distinct`
entry splitting a Reep person, and `nations` entries that list too few records, name a nation none of them names, or
decide nothing (each stops the build). `scripts/reep-bridge.test.mjs` covers the reducer's name and age checks, the
committed bridge, and its byte-for-byte rebuild from the pinned file when `data-src/reep/` is present.

## At the next rollover

When EA FC 28 or FM 27 replaces a snapshot, run `npm run sync:reep-bridge` with a current Reep release (the bridge
only knows ids of the snapshots it was reduced against), rebuild, and read the audit's `nationArbitration` for
conflicts that touch an XI. Check those against senior caps: the fresher source changes when FM's database is newer
than EA's snapshot, and stale `nations` entries stop the build until removed.

## Call-up evidence: not ported

The squad-years branch also built call-up evidence (ad70ddb, c15d84a, 2b947ab, 0ac02c3, d4c667b): 3,483 martj42 goal
records, 6,214 records from Wikipedia's finals-squad articles (18 tournaments, 2023 Asian Cup to 2026 World Cup) and
650 from EA FC 26's licensed national squads, with two rules. Rule (a) let the latest senior call-up in the 24 months
before the ratings date decide a person's nation; on the same EA FC 27 and FM 26 data it decided 3 persons, moved
none and changed no XI. Rule (b) picked called-up players first; the branch's own method gate kept the existing pick,
since rule (b) improved 2025/26 forecast log loss by 0.0068, inside the 2·SE margin of 0.031. The two XI conflicts
that evidence could have settled are settled above by senior caps (Tiknizyan's own goal for Armenia, 18 November
2023, falls outside the 24-month window anyway). Shipping it would have added about 11,000 lines of data, the
Wikipedia part under CC BY-SA 4.0 (whether share-alike reaches squads built from it was an open question), for no
change in any squad, so it stays out, with the method gate that scored it.

The branch's terms checks of 19 October 2026 still stand for anyone reviving it: FIFA's match and ranking APIs and
UEFA's match API are not allowed (FIFA Terms of Service §5.3 and §6.2; UEFA Terms §6.2 forbid automated collection
into a database); Wikipedia's rendered `/wiki/` pages are allowed (robots.txt disallows `/w/` and `/api/`), at one
request every 2 seconds with every response cached, but Wikimedia's User-Agent policy asks for contact details,
which the project's plain `imperialism-game-data/1.0` lacks, so a fresh pull would need a contact the owner chooses
(a project URL, never a person's email); martj42's goalscorers are CC0.

Also left on the branch: its squad-year picker, per-edition manifest and lazily loaded default edition, which main's
Season choice and per-sport code split replaced; and the fusion candidates it researched but never adopted
(averaging EA and FM ratings was not significantly better than "EA first, FM fills gaps"; see
[football-squad-gate.md](football-squad-gate.md), "Research carried over").
