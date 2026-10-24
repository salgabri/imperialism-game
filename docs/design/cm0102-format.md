# CM 01/02 database format, as read

Status: implemented 2026-10-24 in `src/data/cm0102.js` (reader) and
`scripts/lib/football-set.mjs` (data set builder). The data sets themselves are
described in [football-years.md](football-years.md). This note records what the
reader assumes, so that a file that breaks an assumption fails loudly instead of
being half read.

A PC Data folder holds fixed-width tables in `.dat` files. Everything is
little-endian and packed, with no variable-length data. Text fields are
NUL-terminated, single-byte **windows-1252** (not Latin-1: 0x9E is `ž` in SI's
own second names), and the bytes after the NUL are junk. The reader ships its
own table for 0x80–0x9F, so it needs no `TextDecoder` and runs in Node and in
the browser.

## index.dat

An 8-byte header (two s32: extra competition records and human-manager rows,
both 0 in a database; a saved game has 127), then 22 entries of 67 bytes:

| Offset | Field |
| --- | --- |
| 0 | file name, char[51] |
| 51 | table id, s32 |
| 55 | record count, s32 |
| 59 | byte offset of the first record in that file, s32 |
| 63 | format flag, s32 (1 or 2) |

The reader takes `min(22, floor((length - 8) / 67))` entries. Thirteen of the
known Update Team folders have 1–6 stray bytes after the last entry; they are
ignored. Tables are found **by id, never by position**: SI's files list the
empty youth table 8, editor-saved files drop it and append preferences, 22.

| Id | File | Record bytes | Read |
| --- | --- | --- | --- |
| 3 | continent.dat | 198 | name @4 |
| 4 | nation.dat | 290 | name @4, short name @56, code @83, continent @113 |
| 0 | club.dat | 581 | name @4 (cut at CR/LF), short name @56, nation @83, division @87 |
| 12, 16 | club_comp.dat, nation_comp.dat | 107 | name @4, short name @56, nation @93 |
| 13–15 | first, second, common_names.dat | 60 | text @0, id @51 |
| 6 | staff.dat, people | 157 (format 1) or 110 (format 2) | see below |
| 10 | staff.dat, player data | 70 | CA @5, PA @7, position ratings @15–26 |
| 9, 22 (or 8) | staff.dat | 68, 52 | only for the stride check |

`staff.dat` packs several tables. Format 1 is SI's untouched file (3.9.60,
3.9.65 and 3.9.68): 157-byte people with twelve preference ids inline, player
link @145. Format 2 is every editor-saved file, including all Update Team
databases: 110-byte people, player link @97, then a 52-byte preferences row per
person. The first 97 bytes are the same in both: ids, names @4/@8/@12, date of
birth @16, year of birth @24, nationality @26/@30, caps @34, club @57, job @61,
classification @95.

Links are row numbers. Any negative value (−1 and −2 occur) or a row past the
target table is **none**. Clubs index `club.dat` then `nat_club.dat`;
divisions index `club_comp.dat` then `nation_comp.dat`. A club with no nation is
extinct, and the game unattaches its people, so the reader does too.

## Who is a player

A person is a player when the player link is valid (in range, and that player
row's own id equals the link) and the job at the club is not staff-only (1–10
chairman to physio, 16 retired, 17 pundit). Player-managers (jobs 12–15) and
free agents count. Classification (1 non-player, 2 player, 3 both) is checked
against the link but does not decide.

The display name is the common name when it is set (id > 0 and the row is not
blank), else first and second name. Row 0 of each name table is a placeholder.

## Dates and the birth shift

A date is s16 day of year (0 = 1 January), u16 year and u32 leap flag. The
**flag**, not the year, picks the month table, because SI rows carry flag 0 in
every year and editor rows keep the flag of the year they were typed in. A year
of 1900 or less is unknown.

Update Team databases store years early, so that their seasons start in 2001:
real year = stored year + shift. The shift differs per database and per field
(June 2010: birth 9 but contract 8; September 2005: birth 3). The builder uses
only the birth shift, for dates of birth. A 29 February that lands in a common
year becomes the 28th.

## Identifying a database

No file carries a version or season. `scripts/data/cm0102-databases.json` lists
the 48 known releases by the byte sizes of `club.dat` and `staff.dat`, a pair
that is unique across them (the club size alone collides once), with SHA-256
digests where known, the season, release month, forum topic and shifts. SI's
3.9.60 and 3.9.65 are listed twice: SI's format-1 files and the forum's
format-2 re-saves, which are 5 bytes per person larger. 3.9.68 starts in 2001
but carries 2002/03 squads, so it is season 2002/03.

- A known size pair names the database. A digest that differs is a warning: the
  folder may have been edited.
- An unknown folder must be named with `--label`, `--released`, `--url` and
  `--dob-shift`. A flag of only spaces counts as missing, and the shift is
  written in plain digits.
- Either way, famous players' real birthdays check the birth shift: the most
  common real − stored year among name and day matches, conclusive with five
  agreeing players making up 80 %. A person stored twice counts once, as the
  copy de-duplication keeps. For a known database a disagreement is a loud
  warning and the manifest wins. For an unknown one it stops the build.
- Seasons ending before 2002 are refused (see football-years.md), and so are
  seasons ending after 2100, which the game does not load.

## Positions

CM rates twelve positions 1–20 (0 unset), in SI's order GK, SW, D, DM, M, AM,
F, WB, then sides right, left, centre, then free role. A slot's fit is the lower
of its position rating and its side rating (`cmSlotFit` in
`src/data/cmPlayers.js`): a right-back is `min(max(D, WB), right)`, a right
winger `max(min(AM, right), min(F, right))`. A player's natural positions are
the slots with fit 20, or, when there are none, the best-fitting slots if they
reach 15. That is close to the game's own natural-position mask (ratings of 20,
else 15 and up). A player with neither plays nowhere and is left out.

## Leagues

The seven built-in leagues are found by their stored names, or by
CM0102Patcher's renames, in a competition whose nation is the right country:
English Premier Division, Spanish First Division, Italian Serie A, German
First Division, French First Division, Dutch Premier Division (nation
"Holland") and Portuguese Premier League. Members are the clubs whose division
is that competition, not the clubs of that nation, because cross-border clubs
exist.

## Self-checks

The reader throws on:

- Mac CM 01/02 (3.9.62) data: a 0xF1FFFFF1 trailer, or a `club.dat` that is not
  whole 581-byte records. It is big-endian, with other record sizes.
- An index entry whose name is not a `.dat` file, whose table id is outside
  0–22, or whose format is not 2 where 01/02 data always has 2 (club, nation,
  competitions, player and non-player data).
- Records the index places past the end of a file, or a listed file missing.
- A `staff.dat` segment that does not tile: sorted by offset, each table must
  fill exactly the bytes up to the next one at its record size. The staff stride
  must be 157 or 110. When it disagrees with the format flag, the stride is
  read and the flag is reported.
- Record ids that differ from their row in more than half the rows (the layout
  is wrong).

It warns on fewer than 22 index entries, a non-zero header, a table 8/22 set
that does not match the format, bytes after the indexed records, a few ids off
their row, classification and links that disagree, shared player rows, birth
days outside the year, ratings outside 0–20 or CA outside 0–200, club links
past both club tables, more than 1 % of players without a nationality, and one
day holding more than a tenth of all birthdays (a year changer that rewrote
days).

## Sources

The layout was reconciled from these projects' code and notes, read for facts
only. No code was copied.

- maxevans60/cm0102-bosman-edition: a recompilation of the 3.9.68 game with all
  49 Update Team folders. Signatures, date shifts, loader rules and record
  layouts. Code GPL-3.0 (CC0 before 0.6.0), docs CC-BY-4.0.
- archibalduk/TransferTool: editor record layouts and nation spellings. No
  licence.
- nckstwrt/CM0102Patcher: structures, the staff format by version, competition
  renames. No licence file.
- ChrisReganXP/CMScouter: date vectors. GPL-3.0. Some of its offsets are wrong
  (caps, contract end, competition nation), and the reader does not follow them.
- Skallerup/cm0102-reborn: segment-stride detection. MIT.
- Also kubawerlos/cm0102-data (MIT), agevak/CM0102, Raamses/Champman0102-Remake
  and the CM 01/02 function map (CC-BY-4.0) for cross-checks, and cm0102.co.uk
  for a few known players' values.

The tests in `scripts/cm0102.test.mjs` and `scripts/football-set-build.test.mjs`
run on synthetic folders that `scripts/lib/cm0102-fixture.mjs` writes byte by
byte from this layout, with invented names. No real database is read by a test.
