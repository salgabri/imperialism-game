// Owner: WP-SQUAD (see PLAN.md §4). Squad view-models (PLAN §3.6, C§16, DEC D8/D9).
// Pure: no window/document/timers/RNG; tolerates missing teams, history, stats and baseEff.
import { selectLineup, teamSportId } from '../data/teams.js';
import { footballProfile } from '../sports/football.js';
import { basketballProfile } from '../sports/basketball.js';
import { americanFootballProfile } from '../sports/americanFootball.js';
import { getSport, SPORTS } from '../sports/index.js';
import { historyRound, memo, ratingTier, roman, shortName, signedDelta, teamChip } from './format.js';

/** Position order for the table, groups and formation fill (C§5.7; basketball C§17). Unknown codes sort last. */
const POSITION_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3, PG: 0, SG: 1, SF: 2, PF: 3, C: 4,
  QB: 0, RB: 1, WR: 2, TE: 3, OL: 4, DL: 5, LB: 6, CB: 7, S: 8, K: 9 };
/** Group-header copy (C§5.3; DEC misc for basketball: Guards / Forwards / Centres). */
const GROUPS = {
  GK: 'Goalkeeper', DF: 'Defence', MF: 'Midfield', FW: 'Attack',
  PG: 'Guards', SG: 'Guards', SF: 'Forwards', PF: 'Forwards', C: 'Centres',
  QB: 'Quarterback', RB: 'Running back', WR: 'Receivers', TE: 'Receivers', OL: 'Offensive line',
  DL: 'Defensive line', LB: 'Linebackers', CB: 'Secondary', S: 'Secondary', K: 'Kicker',
};
/**
 * Formation slots in % of the pitch box (C§7.4, design V442), the basketball half court (C§17) and the American football
 * field: the offence driving up from below the line of scrimmage, the nickel defence above it, the kicker aside.
 */
const SLOTS = {
  football: {
    GK: [[50, 88]],
    DF: [[13, 69], [37, 72], [63, 72], [87, 69]],
    MF: [[13, 44], [37, 47], [63, 47], [87, 44]],
    FW: [[36, 20], [64, 20]],
  },
  basketball: { PG: [[50, 82]], SG: [[20, 62]], SF: [[80, 62]], PF: [[30, 30]], C: [[70, 30]] },
  'american-football': {
    OL: [[50, 60], [37, 63], [63, 63], [24, 60], [76, 60]],
    WR: [[8, 58], [92, 58], [16, 68]],
    TE: [[88, 70]], QB: [[50, 74]], RB: [[50, 87]], K: [[88, 90]],
    DL: [[37, 41], [63, 41], [24, 44], [76, 44]],
    LB: [[38, 29], [62, 29]],
    CB: [[8, 40], [92, 40], [18, 30]],
    S: [[30, 13], [70, 13]],
  },
};
/** Squad-screen copy per sport: the box the lineup is drawn on and its names. */
const LAYOUTS = {
  football: { layout: 'pitch', viewLabel: 'Pitch' },
  basketball: { layout: 'court', viewLabel: 'Court' },
  'american-football': { layout: 'field', viewLabel: 'Field' },
};
const BACK_LABELS = { map: 'Back to map', ledger: 'Back to standings', chronicle: 'Back to history', match: 'Back to match' };
const DEPTH_ROWS = 5;
const SIDE_CLAIMS = 3;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const finite = value => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);

function byPosition(position) {
  return player => POSITION_ORDER[position(player)] ?? 99;
}

/** Stable sort by position order, then base rating descending (design `byPos`, C§5.7). */
function sortByPosition(players, position) {
  const order = byPosition(position);
  return players.slice().sort((a, b) => order(a) - order(b) || (Number(b.rating) || 0) - (Number(a.rating) || 0));
}

/** `EA FC 26` / `FM 26` / `CM 01/02`: the edition verbatim (DEC misc, C§15 #1); `—` without source data. */
export function sourceLabel(player) {
  const info = player?.sourceInfo;
  if (!info) return '—';
  const short = info.source === 'ea-fc' ? 'EA FC' : info.source === 'football-manager' ? 'FM' : info.source === 'cm0102' ? 'CM 01/02' : '';
  const edition = String(info.edition || '');
  if (edition) return /^\d+$/.test(edition) && short ? `${short} ${edition}` : edition;
  return short || '—';
}

/**
 * The roster evidence PlayerRow exposed (sourced rosters): edition, database version and snapshot, the raw rating on
 * its own scale and the conversion from the database's current ability, joined by " · "; '' without source data. A
 * Championship Manager rating is the CM 01/02 Update Team's own assessment, so the title names them.
 */
export function sourceTitle(player) {
  const info = player?.sourceInfo;
  if (!info) return '';
  const cm = info.source === 'cm0102';
  const name = info.source === 'ea-fc' ? 'EA FC' : cm ? 'CM 01/02' : 'Football Manager';
  const edition = String(info.edition || '');
  const label = edition ? (/^\d+$/.test(edition) ? `${name} ${edition}` : edition) : name;
  const raw = Number.isFinite(info.rawRating)
    ? `Source rating ${info.rawRating}${Number.isFinite(info.rawScale) ? `/${info.rawScale}` : info.rawScale ? ` (${info.rawScale} scale)` : ''}`
    : null;
  return [label, cm && (info.provider || 'CM 01/02 Update Team'), info.version && `Database ${info.version}`,
    info.snapshotDate && `Database snapshot ${info.snapshotDate}`, raw,
    info.conversion && `Game rating converted from ${cm ? 'CM' : 'Football Manager'} current ability: ${info.conversion}`]
    .filter(Boolean).join(' · ');
}

/** The player's page on the source database (sofifa / FM), http(s) only; null otherwise. */
export function sourceUrl(player) {
  const url = player?.sourceInfo?.url;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/** The C1 segment count: clamp((v − 60)/35·100, 4, 100) rounded to 0.1, then /10 rounded (C§8). */
export function profileSegments(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const width = Math.max(4, Math.min(100, (v - 60) / 35 * 100));
  return Math.round(Number(width.toFixed(1)) / 10);
}

/**
 * Attack / Defence / Goalkeeping (football), Offence / Defence (basketball) or Offence / Defence / Kicking (American
 * football) from the sports engines' positional profiles of the lineup (ED§4c; no match-day offset), with the C1
 * segment count.
 */
export function strengthProfile(lineup, sportId) {
  const rows = sportId === 'basketball'
    ? (({ offence, defence }) => [['offence', 'Offence', offence], ['defence', 'Defence', defence]])(basketballProfile(lineup))
    : sportId === 'american-football'
      ? (({ offence, defence, kicking }) => [['offence', 'Offence', offence], ['defence', 'Defence', defence], ['kicking', 'Kicking', kicking]])(americanFootballProfile(lineup))
      : (({ attack, defence, keeper }) => [['attack', 'Attack', attack], ['defence', 'Defence', defence], ['goalkeeping', 'Goalkeeping', keeper]])(footballProfile(lineup));
  return rows.map(([key, label, value]) => {
    const raw = Number.isFinite(Number(value)) ? Number(value) : 0;
    return { key, label, value: raw.toFixed(1), raw: Math.round(raw * 10) / 10, segments: profileSegments(raw) };
  });
}

function loserOf(entry) {
  if (!entry) return null;
  const winnerId = entry.winnerId ?? entry.result?.winnerId;
  const aId = entry.aId ?? entry.a?.teamId ?? entry.a?.tid;
  const dId = entry.dId ?? entry.bId ?? entry.b?.teamId ?? entry.b?.tid;
  const loserSide = winnerId != null && String(winnerId) === String(aId) ? entry.b : entry.a;
  return {
    id: entry.result?.loserId ?? (winnerId != null && String(winnerId) === String(aId) ? dId : aId) ?? null,
    code: loserSide?.code ?? null,
    name: entry.result?.loserName ?? loserSide?.name ?? null,
    flagId: loserSide?.id ?? null,
    isClub: !!loserSide?.isClub,
  };
}

/** Newest history entry in which `teamId` (if given) won and signed this player from the team coded `player.from`. */
function claimEntry(player, history, teamId) {
  if (!Array.isArray(history) || !player?.name) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    const signed = entry?.result?.player;
    if (!signed || signed.name !== player.name) continue;
    const winnerId = entry.winnerId ?? entry.result?.winnerId;
    if (teamId != null && winnerId != null && String(winnerId) !== String(teamId)) continue;
    const loser = loserOf(entry);
    if (player.from != null && loser?.code != null && loser.code !== player.from) continue;
    return entry;
  }
  return null;
}

/**
 * Claimed-player provenance (DEC D8): `fromId`, `from` (code), `joined` (round) and `claimGain` stored on the
 * player by applyConquest; for older saves each missing field is read from the matching `history` entry, and the
 * former team is finally looked up by code (the round then stays unknown). `teamId` (optional) is the owning
 * team, used to pick the right history entry. Returns null for home-grown players.
 */
export function provenanceOf(player, st, teamId = null) {
  if (!player || (player.fromId == null && player.from == null)) return null;
  const teams = st?.teams || {};
  let fromId = player.fromId ?? null;
  let joined = finite(player.joined);
  let claimGain = finite(player.claimGain);
  const entry = claimEntry(player, st?.history, teamId);
  const loser = loserOf(entry);
  if (entry) {
    if (fromId == null) fromId = loser?.id ?? null;
    if (joined == null) joined = historyRound(entry) || null;
    if (claimGain == null) claimGain = finite(entry.result?.strengthGain);
  }
  if ((fromId == null || !teams[fromId]) && player.from != null) {
    const byCode = Object.values(teams).find(team => team?.code === player.from);
    if (byCode && fromId == null) fromId = byCode.id;
  }
  const from = fromId != null ? teams[fromId] || null : null;
  const replaced = entry?.result?.replacedPlayer;
  return {
    fromId: fromId ?? null,
    from: player.from ?? from?.code ?? loser?.code ?? null,
    fromName: from?.name ?? loser?.name ?? player.from ?? '',
    flagId: from ? from.flagId ?? null : loser?.flagId ?? null,
    isClub: from ? from.kind === 'club' : !!loser?.isClub,
    joined: joined && joined > 0 ? joined : null,
    claimGain,
    replaced: replaced ? (typeof replaced === 'string' ? replaced : replaced.name || null) : null,
  };
}

function acquiredOf(prov) {
  if (!prov) return null;
  const code = prov.from || '';
  const round = prov.joined ? `R ${roman(prov.joined)}` : '';
  return { flagId: prov.flagId, teamId: prov.fromId, isClub: prov.isClub, code, roman: round, label: [code, round].filter(Boolean).join(' · ') };
}

function gainOf(prov) {
  if (!prov || prov.claimGain == null) return { text: '—', tone: 'muted' };
  const { text, tone } = signedDelta(prov.claimGain);
  // The gain at signing is never negative in practice; anything ≤ 0 reads as unchanged (C§9).
  return tone === 'gain' ? { text, tone } : { text: '±0.0', tone: 'muted' };
}

/**
 * The Squad screen model for `teamId` (C§16, PLAN §3.5) or null when the team is unknown.
 * Rows: { key, no, pos, name, short, fullName, natural, inRole, outOfPosition, rating, tier, acquired, source, sourceTitle,
 * sourceUrl, generated, player }.
 */
export function buildSquad(st, ctx, teamId) {
  const teams = st?.teams || {};
  const team = teamId != null ? teams[teamId] : null;
  if (!team) return null;
  return memo(ctx?.cache, 'squad:model', [team, teams, st.history, st.aliveIds, st.fallen, st.followedId, st.squadReturn,
    teamId, ctx?.managedId ?? null, ctx?.sport?.id ?? null], () => computeSquad(st, ctx, team));
}

function computeSquad(st, ctx, team) {
  const teams = st.teams || {};
  const teamId = team.id;
  const sportId = Object.hasOwn(SPORTS, ctx?.sport?.id ?? '') ? ctx.sport.id : teamSportId(team);
  const words = getSport(sportId).words;
  // Football's lineup has a shape ("4-4-2"); a five and an NFL lineup are named instead.
  const shaped = sportId === 'football';
  const squad = Array.isArray(team.squad) ? team.squad : [];
  const lineup = selectLineup(team);
  const plan = lineup.slots.length;
  const indexOf = player => {
    const at = squad.indexOf(player);
    return at >= 0 ? at : player?.originalIndex ?? -1;
  };
  const provenance = new Map();
  const provOf = player => {
    const at = indexOf(player);
    if (!provenance.has(at)) provenance.set(at, provenanceOf(squad[at] || player, st, teamId));
    return provenance.get(at);
  };

  const rowOf = (player, i, starter) => {
    const prov = provOf(player);
    const rating = Math.round(Number(player.rating) || 0);
    return {
      key: `p-${indexOf(player)}-${i}`,
      no: starter ? String(i + 1) : '—',
      pos: (starter ? player.assignedPos || player.pos : player.pos) || '',
      name: player.name || '',
      short: shortName(player.name),
      fullName: player.sourceInfo?.fullName || player.name || '',
      natural: player.positions?.length ? player.positions.join(' / ') : player.pos || '',
      inRole: starter ? String(Math.round(Number(player.effectiveRating ?? player.rating) || 0)) : '—',
      outOfPosition: starter && !!player.outOfPosition,
      rating,
      tier: ratingTier(rating),
      acquired: acquiredOf(prov),
      source: sourceLabel(player),
      sourceTitle: sourceTitle(player),
      sourceUrl: sourceUrl(player),
      generated: !!player.gen,
      player,
    };
  };

  const starters = sortByPosition(lineup.starters, player => player.assignedPos || player.pos);
  const starterRows = starters.map((player, i) => rowOf(player, i, true));
  const groups = [];
  for (const row of starterRows) {
    const label = GROUPS[row.pos] || row.pos;
    const last = groups.at(-1);
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ key: `g-${groups.length}-${label}`, label, rows: [row] });
  }
  const bench = sortByPosition(lineup.bench, player => player.pos);
  const benchRows = bench.map((player, i) => rowOf(player, i, false));
  const depth = {
    rows: benchRows.slice(0, DEPTH_ROWS),
    extra: benchRows.slice(DEPTH_ROWS),
    all: benchRows,
    count: benchRows.length,
    more: benchRows.length > DEPTH_ROWS ? `+ ${benchRows.length - DEPTH_ROWS} more in depth` : null,
  };

  const slots = SLOTS[sportId] || SLOTS.football;
  const used = {};
  const pitch = starters.map((player, i) => {
    const pos = player.assignedPos || player.pos;
    const list = slots[pos] || [[50, 50]];
    const at = used[pos] = (used[pos] ?? -1) + 1;
    const [x, y] = list[at % list.length];
    return {
      key: `d-${indexOf(player)}-${i}`, x: `${x}%`, y: `${y}%`, pos,
      name: shortName(player.name), fullName: player.name || '',
      rating: Math.round(Number(player.effectiveRating ?? player.rating) || 0),
      claimed: !!provOf(player),
    };
  });

  const counts = {};
  for (const slot of lineup.slots) counts[slot.position] = (counts[slot.position] || 0) + 1;
  const formation = shaped ? ['DF', 'MF', 'FW'].map(pos => counts[pos] || 0).join('-') : words.lineup;

  const starterSet = new Set(lineup.starters.map(player => player.originalIndex));
  const claims = squad
    .map((player, index) => ({ player, index, prov: provOf(player) }))
    .filter(item => item.prov)
    .sort((a, b) => (b.prov.joined ?? -1) - (a.prov.joined ?? -1) || b.index - a.index)
    .map(({ player, index, prov }) => {
      const gain = gainOf(prov);
      const starter = starterSet.has(index);
      const rating = Math.round(Number(player.rating) || 0);
      return {
        key: `c-${index}`, roman: prov.joined ? `R ${roman(prov.joined)}` : '', joined: prov.joined,
        flagId: prov.flagId, teamId: prov.fromId, isClub: prov.isClub, code: prov.from || '', name: player.name || '',
        fromName: prov.fromName || prov.from || '', gain: gain.text, tone: gain.tone,
        pos: player.pos || '', rating, tier: ratingTier(rating),
        status: starter ? 'Starter' : 'Depth', detail: starter && prov.replaced ? `Starts ahead of ${prov.replaced}` : null,
      };
    });
  const claimedCount = claims.length;
  const claimedStarters = claims.filter(claim => claim.status === 'Starter').length;

  const delta = signedDelta(lineup.rating - (Number.isFinite(team.baseEff) ? team.baseEff : lineup.rating));
  const alive = Array.isArray(st.aliveIds) ? st.aliveIds.includes(teamId) : true;
  const fell = Array.isArray(st.fallen) ? st.fallen.find(entry => entry?.id === teamId) : null;
  const notes = [];
  if (lineup.starters.length < plan && !squad.some(player => player.gen)) {
    notes.push(`Source data covers ${lineup.starters.length} of ${plan} starting places. Unfilled places use a 40-point team-strength baseline.`);
  }
  // The manager's own team for the "Your squad" shortcut (spectators follow instead).
  const ownId = ctx?.managedId ?? null;
  const back = BACK_LABELS[st.squadReturn] ? { label: BACK_LABELS[st.squadReturn] } : null;
  const showSource = [...starterRows, ...benchRows].some(row => row.source !== '—');

  return {
    teamId,
    team: teamChip(team),
    name: team.name || '',
    sport: sportId,
    layout: LAYOUTS[sportId].layout,
    kicker: `First team · ${plural(squad.length, 'player')} · ${claimedCount} claimed in conquest`,
    phoneMeta: `${plural(squad.length, 'player')} · ${claimedCount} claimed in conquest`,
    playerCount: squad.length,
    xi: {
      label: words.lineup, short: words.lineupShort,
      value: lineup.rating.toFixed(1), delta: delta.text, tone: delta.tone,
    },
    claimedCount,
    formation,
    // Basketball reads "Court" / "Starting five" (DEC misc), American football "Field" / "Starting lineup"; the
    // football kicker carries the shape (C§7.1).
    viewLabel: LAYOUTS[sportId].viewLabel,
    formationTitle: shaped ? 'Formation' : words.lineup,
    formationAside: shaped ? `${formation} · ● claimed` : '● claimed',
    pitchLabel: shaped ? `Formation ${formation}` : `${LAYOUTS[sportId].viewLabel}, ${words.lineup.toLowerCase()}`,
    groups,
    depth,
    showSource,
    pitch,
    profile: strengthProfile(lineup, sportId),
    profileScale: 'Scale 60–95',
    claimed: claims.slice(0, SIDE_CLAIMS),
    acquisitions: {
      rows: claims,
      aside: claimedCount ? `${plural(claimedCount, 'player')} · ${claimedStarters} of ${plan} starters were claimed in conquest` : '',
      empty: 'No players claimed yet. Win a conquest to claim one player from the fallen squad.',
    },
    status: alive ? 'alive' : 'fallen',
    statusLabel: alive ? null : `Eliminated${fell?.r ? ` · Round ${roman(fell.r)}` : ''}`,
    canFollow: !ownId,
    following: st.followedId != null && st.followedId === teamId,
    back,
    home: ownId && ownId !== teamId && teams[ownId] ? { teamId: ownId, label: 'Your squad' } : null,
    notes,
  };
}
