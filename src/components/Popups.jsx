// Owner: WP-CONQ (see PLAN.md §4). Transient map notices and the match toast, restyled as v4 white floating panels
// (DEC D15; README §Surfaces). FROZEN named exports and props: Toast({ code, text, color }),
// MatchupPopup({ label, a, b }), ResultPopup({ label, score, title, sub, upset, color }), StealPopup({ … }).
// A side's optional `teamId` (`fromTeamId`/`toTeamId`) finds a club's crest.
// v4 drops team colours from chrome, so `color`/`fromColor`/`toColor` only reach club monograms.
import React from 'react';
import TeamMark from './TeamMark.jsx';
import Icon from './Icon.jsx';
import './popups.css';

/** Brief feedback at the map's edge (goals, draw problems), leaving the campaign visible. */
export function Toast({ code, text }) {
  return (
    <div className="fi-match-toast" role="status">
      {code && <span className="fi-toast-code">{code}</span>}
      <span className="fi-toast-text">{text}</span>
    </div>
  );
}

function MatchupSide({ team = {} }) {
  return (
    <div className="fi-matchup-side">
      <TeamMark id={team.id} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub || !team.id} width={28} />
      <span className="fi-matchup-team">
        <strong className="fi-matchup-name">{team.name}</strong>
        {team.eff != null && team.eff !== '' && <small className="fi-matchup-eff">Strength {team.eff}</small>}
      </span>
    </div>
  );
}

/** Kick-off notice: "<A> attacks <B>" with both strengths. */
export function MatchupPopup({ label, a, b }) {
  return (
    <div className="fi-map-notice fi-matchup-notice" role="status" data-testid="matchup-notice">
      {label && <div className="fi-notice-label">{label}</div>}
      <div className="fi-matchup-notice-teams">
        <MatchupSide team={a} />
        <span className="fi-matchup-vs" aria-hidden="true">v</span>
        <MatchupSide team={b} />
      </div>
    </div>
  );
}

/** Result notice for a decided match (spectator / AI conquests and the manager's applied conquest). */
export function ResultPopup({ label, score, title, sub, upset }) {
  return (
    <div className="fi-map-notice fi-result-notice" role="status" data-testid="result-notice">
      {(label || upset) && (
        <div className="fi-notice-label">
          {label && <span className="fi-result-notice-round">{label}</span>}
          {upset && <span className="fi-result-notice-upset">Upset victory</span>}
        </div>
      )}
      <div className="fi-result-notice-main">
        <strong className="fi-result-notice-title">{title}</strong>
        {score && <span className="fi-result-notice-score">{score}</span>}
      </div>
      {sub && <p className="fi-result-notice-sub">{sub}</p>}
    </div>
  );
}

/** The claimed player moving from the loser to the winner. */
export function StealPopup({ name, meta, from, fromId, fromTeamId, fromColor, to, toId, toTeamId, toColor, sub }) {
  return (
    <div className="fi-map-notice fi-transfer-notice" role="status" data-testid="transfer-notice">
      <div className="fi-notice-label">Player claimed</div>
      <div className="fi-transfer-player"><strong>{name}</strong>{meta && <span>{meta}</span>}</div>
      <div className="fi-transfer-route">
        <TeamMark id={fromId} teamId={fromTeamId} code={from} color={fromColor} isClub={!fromId} width={24} />
        <span className="fi-transfer-code">{from}</span>
        <span className="fi-transfer-arrow"><Icon name="arrow" size={16} strokeWidth="2" /><span className="sr-only">to</span></span>
        <TeamMark id={toId} teamId={toTeamId} code={to} color={toColor} isClub={!toId} width={24} />
        <span className="fi-transfer-code">{to}</span>
      </div>
      {sub && <p className="fi-transfer-sub">{sub}</p>}
    </div>
  );
}
