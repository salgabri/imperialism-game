// Owner: WP-LEDGER (see PLAN.md §4). The standings table in the v4 table pattern.
// Contract (PLAN §3.5, smoke standingsSnapshot): exactly one table.fi-standings, every alive team (no truncation),
// columns #, Team, Terr., Strength first; cells[1] button.fi-standing-team[data-team-id] > span[title] = name;
// cells[3] .fi-standing-eff + [data-testid=standing-strength-gain].fi-strength-gain only for positive gains.
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';

function StrengthCell({ eff, effGain, delta }) {
  const text = effGain?.text ?? delta?.text ?? '';
  const positive = text.startsWith('+');
  const negative = /^[−-]/.test(text);
  return (
    <td className="num fi-standings__strength" title={text ? `Change since campaign start: ${text}` : undefined}>
      <span className="fi-standing-rating">
        <span className="fi-standing-eff">{eff}</span>
        {positive && <span key={text} className="fi-strength-gain" data-testid="standing-strength-gain"
          aria-label={`Gained ${text} overall strength since campaign start`}>{text}</span>}
        {negative && <span className="fi-standing-delta tone-loss" aria-label={`Lost ${text.slice(1)} overall strength since campaign start`}>{text}</span>}
        {!positive && !negative && text && <span className="fi-standing-delta tone-muted" aria-hidden="true">{text}</span>}
      </span>
    </td>
  );
}

export default function StandingsTable({ rows = [], selectedTeamId = null, youLabel = 'You', onSelectTeam }) {
  return (
    <table className="fi-standings">
      <caption className="sr-only">Empires still in the campaign, strongest first. Select a team to view its squad.</caption>
      <thead>
        <tr>
          <th scope="col" className="fi-standings__rank">#</th>
          <th scope="col" className="fi-standings__team">Team</th>
          <th scope="col" className="num fi-standings__terr"><abbr title="Territories held">Terr.</abbr></th>
          <th scope="col" className="num fi-standings__strength" aria-sort="descending"><abbr title="Overall team strength (EFF), highest first">Strength</abbr></th>
          <th scope="col" className="num fi-standings__conq"><abbr title="Empires annexed">Conq.</abbr></th>
          <th scope="col" className="num fi-standings__claimed"><abbr title="Players claimed in conquest">Claimed</abbr></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(team => {
          const selected = selectedTeamId != null && selectedTeamId === team.tid;
          const className = [selected && 'is-selected', team.you && 'is-you'].filter(Boolean).join(' ') || undefined;
          return (
            <tr key={team.tid} className={className}>
              <td className="num fi-standings__rank">{Number(team.rank) || team.rank}</td>
              <td className="fi-standings__team">
                <button type="button" className="fi-standing-team" data-team-id={team.tid} onClick={() => onSelectTeam?.(team.tid)}
                  aria-label={`View ${team.name} squad`} aria-current={selected ? 'true' : undefined}>
                  <TeamMark id={team.flagId} code={team.code} color={team.color} isClub={team.isClub} width={20} />
                  <span title={team.name}>{team.name}</span>
                  {team.you && youLabel && <span className="fi-standing-you" aria-hidden="true">{youLabel}</span>}
                </button>
              </td>
              <td className="num fi-standings__terr">{String(team.territories ?? '').replace(/^T(?=\d)/, '')}</td>
              <StrengthCell eff={team.eff} effGain={team.effGain} delta={team.delta} />
              <td className={`num fi-standings__conq${String(team.conq ?? '0') === '0' ? ' is-zero' : ''}`}>{team.conq ?? '0'}</td>
              <td className={`num fi-standings__claimed${String(team.claimed ?? '0') === '0' ? ' is-zero' : ''}`}>{team.claimed ?? '0'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
