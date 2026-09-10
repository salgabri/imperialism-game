import React from 'react';
import { TeamMark } from './MatchCard.jsx';
import Icon from './Icon.jsx';
import './results.css';

/** Brief feedback sits at the map's edge, leaving the campaign visible. */
export function Toast({ code, text, color }) {
  return (
    <div className="fi-match-toast" role="status">
      <span className="fi-toast-code" style={{ color }}>{code}</span><span>{text}</span>
    </div>
  );
}

export function MatchupPopup({ label, a, b }) {
  return (
    <div className="fi-map-notice" role="status" data-testid="matchup-notice">
      <div className="fi-notice-label">{label}</div>
      <div className="fi-matchup-notice-teams">
        <div><TeamMark {...a} isClub={a.isClub || !a.id} width={30} /><span><strong>{a.name}</strong><small>EFF {a.eff}</small></span></div>
        <span className="fi-matchup-vs">vs</span>
        <div><TeamMark {...b} isClub={b.isClub || !b.id} width={30} /><span><strong>{b.name}</strong><small>EFF {b.eff}</small></span></div>
      </div>
    </div>
  );
}

export function ResultPopup({ label, score, title, sub, upset, color }) {
  return (
    <div className="fi-map-notice fi-result-notice" role="status" data-testid="result-notice" style={{ '--notice-color': color }}>
      <div className="fi-notice-label">{label}{upset && <span> · Upset victory</span>}</div>
      <div className="fi-result-notice-main"><Icon name="trophy" size={22} /><div><strong>{title}</strong><span>{score}</span></div></div>
      {sub && <p>{sub}</p>}
    </div>
  );
}

export function StealPopup({ name, meta, from, fromId, fromColor, to, toId, toColor, sub }) {
  return (
    <div className="fi-map-notice fi-transfer-notice" role="status" data-testid="transfer-notice">
      <div className="fi-notice-label"><Icon name="users" size={15} /> Player claimed</div>
      <div className="fi-transfer-player"><strong>{name}</strong><span>{meta}</span></div>
      <div className="fi-transfer-route">
        <TeamMark id={fromId} code={from} color={fromColor} isClub={!fromId} width={24} /><span>{from}</span>
        <Icon name="arrow" size={17} />
        <TeamMark id={toId} code={to} color={toColor} isClub={!toId} width={24} /><span>{to}</span>
      </div>
      {sub && <p>{sub}</p>}
    </div>
  );
}
