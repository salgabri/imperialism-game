# Football year by year: permission requests

Status: drafted 2026-10-24, not yet sent. The CM 01/02 community databases are
the planned backbone for historical football years (see
[football-year-sources.md](football-year-sources.md)). None of them carries a
licence, so data derived from them is not committed until the authors agree.
Until then the importer reads a database the user has downloaded into the
ignored `data-src/cm0102/`, and its output stays out of git.

| Request | To | Where | Sent | Answer |
| --- | --- | --- | --- | --- |
| 1. Official data updates, Nov 2007 onwards | CM 01/02 Update Team: Dermotron (Director), Mark (Chairman) | champman0102.co.uk, a new topic in the forum of [t=10789](https://www.champman0102.co.uk/viewtopic.php?t=10789), or a private message to Dermotron | — | — |
| 2. Season 1984/85 Retro Update (v799) | Cam F and the 84/85 retro team | Reply in [t=5042](https://www.champman0102.co.uk/viewtopic.php?t=5042), or a private message to Cam F | — | — |

When an answer arrives, record its date, who gave it, a link to it and its exact
scope here before any derived data is committed.

These requests cover the community's databases. On 2026-11-08 the user chose to
ship five seasons whose data no one has licensed, credited to their makers
([football-years.md](football-years.md#seasons-before-fifa-05)): SI's own CM 01/02
3.9.68 and 3.9.60 databases (free from Eidos since 2008 for personal,
non-commercial use, data rights reserved), SI's CM3 data as Cam F ported it, SI's
CM 97/98 database as baskeyx extracted it, and Sensible World of Soccer 96/97's
national squads. No Update Team or retro-team database is among them.

On 2026-11-09 the user asked to cover every missing season and go back to the 1960s and 1970s, and chose, in their
words "Yes, ship both", to ship the CM0102 Starter Kit's two fan-made retro databases, Cam F's 1993/94 and Simon
Treanor's 1989/90 (Beta 5), credited to their makers, their labels saying the ratings are fans'. Neither fan-made
database names a licence, and neither maker was asked; request 2 does not cover them. Under that request Claude
added four more on the same terms as the 2026-11-08 seasons, credited to their makers: Sensible World of Soccer's own
team files of 1994/95 (the original, v1.0) and 1995/96, with their clubs, as the SWOS United server keeps them; and
SI's own Championship Manager 00/01 (original release 3.81, the UK release-day database rather than SI's later
European pressing) and CM 99/00 (original release 3.70), read data-only from users' uploads of the retail CDs to
archive.org, with the archive.org item as each season's source link
([football-years.md](football-years.md#sis-cm-0001-and-cm-9900-read-from-their-cds-200001-and-199900)). Neither CM
game was ever made free, and no one has licensed their data. The user approved shipping these four on 2026-11-10
("Ship without 2003/04"), after being told the two CM seasons come from games never made free.

**Shipped by the user's choice of 2026-11-10** ("Yes, ship 2003/04", after the
release of the other seasons without it that day): 2003/04 is built from Alex Sawczuk's fan-made
October 2003 update of SI's CM 01/02 3.9.68 database, as the Official
Championship Manager Magazine's issue 5 cover CD (November 2003) carried it,
credited to Sawczuk
([football-years.md](football-years.md#sawczuks-october-2003-update-200304)).
It names no licence, and about 1.4% of its ratings (57% of the Premier League's
players) were changed by hand. The user chose it as published over the
alternatives: SI's 3.9.68 ratings restored to its squads, SI's own CM 03/04
database (undocumented format) or leaving 2003/04 empty.

## 1. To the CM 01/02 Update Team

**Subject:** Permission to use the official databases in a free open-source game

> Hi Dermotron, Mark and the Update Team,
>
> I'm building **Imperialism**, a free, open-source browser game with no ads:
> national teams fight a world war of football, and winning a match annexes the
> loser's territory and one of its players. The code is public at
> https://github.com/salgabri/imperialism-game. Right now it uses one season of
> squads, and I'd like players to be able to pick a season and replay the world
> as it was. Your databases are the only source that covers every nation, every
> season, and I'd like to ask permission before using them, as tafo did in
> t=10789.
>
> What I'd like to do:
>
> - Read the official Update Team databases (November 2007 to the October 2026
>   update, and later ones if you're happy) with my own parser, once per
>   database.
> - Keep only a small extract per season: each nation's and each big club's best
>   players. That's a few thousand players, not the database. For each player:
>   name, date of birth (un-shifted to the real year), nationality, club,
>   current ability and natural positions. No potential, attributes, contracts or
>   staff.
> - Commit that extract to the public GitHub repository and serve it with the
>   game, so anyone can play those seasons without the files.
>
> What I won't do:
>
> - Redistribute the .dat files, the game, or any patch. The game never uses
>   Nick's or davdav's patches or tools.
> - Charge for anything or show ads.
>
> Credit: every player's source tooltip would name the database (e.g. "CM 01/02
> Update Team · May 2026 database") and link to its topic here. The README and
> an attribution file would credit the Update Team and link to
> champman0102.co.uk. I'll take any season down if you ask.
>
> If you'd rather the data never be redistributed, I'll keep it the way tafo
> does: the game would read a database each player downloads from your forum,
> and nothing derived from it would be published. Either answer helps. I'd just
> like to do this the way you're comfortable with.
>
> Thanks for 20+ years of keeping 01/02 alive.
>
> salgabri

## 2. To Cam F and the 1984/85 Retro Update team

**Subject:** Permission to use Season 1984/85 in a free open-source game

> Hi Cam and everyone on the 84/85 Retro Update,
>
> I'm building **Imperialism**, a free, open-source browser game with no ads
> (https://github.com/salgabri/imperialism-game): national teams fight a world
> war of football, and winning a match annexes the loser's territory and one of
> its players. I'd like to offer 1984/85 as a historic season, and your
> database is the only one with real squads for nearly every nation that year.
> The table in your first post (186 nationalities, 72,015 players in v799) is
> exactly what makes it possible.
>
> What I'd like to do is read v799 with my own parser and keep a small extract:
> each nation's and each big club's best players, with name, date of birth,
> nationality, club, current ability and natural positions. I'd then commit that
> extract to the public repository and serve it with the game. I won't
> redistribute the data files or the cm84 exe. Players' tooltips would credit
> "Season 1984/85 Retro Update (Cam F and the retro team)" with a link to
> t=5042, and I'll remove it if you ask.
>
> Two questions:
>
> 1. Is that OK, and is there anyone else on the team I should ask?
> 2. The game never makes up a rating. I read that about 9,000 players who had no
>    CA/PA were filled with a formula (CA = CR − 10). Is there a way to tell
>    which players those are, so I can leave them out or mark them?
>
> USSR, Yugoslavia, Czechoslovakia, West and East Germany would play as
> themselves. On the modern map they'd hold their successor states' land for
> that season.
>
> If you'd rather it not be redistributed, I'll make it a "bring your own
> database" season instead, where players download it from your thread.
>
> Thanks for the work that went into this.
>
> salgabri
