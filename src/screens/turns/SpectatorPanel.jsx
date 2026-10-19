// Owner: WP-TURN (see PLAN.md §4). Spectator panel docked in the Map column (A-1, M§6.5): (a) This turn —
// idle copy, the drawn attacker with "The compass is choosing the target" while the needle spins, then (locked)
// attacker → "compass points to" → defender with the odds bar, or the compact `matchCard`
// slot whenever a match exists (A-14, DEC D17); (b) Following — followed empire, picker (select#followed-team
// behind "Change"), "Pause when <team> plays" switch and the managed-team note after a manager's exit (DEC D16);
// (c) Autoplay status + 1×/2×/4× speed. Phone collapsed sheet shows (a) only (CSS via `sheet`).
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import './turns.css';

const SPEEDS = [1, 2, 4];
// Without a `thisTurn` model (the W1 transitional render) the section still reads as an idle turn.
const IDLE_TURN = { state: 'idle', kickerRight: 'Compass draw', idle: { title: 'Next draw', route: '' }, a: null, b: null, odds: null };

function CompassGlyph() {
  return (
    <svg className="this-turn__compass" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8Z" />
    </svg>
  );
}

function TeamRow({ side, role }) {
  return (
    <div className="this-turn__team" data-side={role}>
      <span className="this-turn__mark" aria-hidden="true">
        <TeamMark id={side.flagId} code={side.code} color={side.color} isClub={side.isClub} width={28} height={21} />
      </span>
      <span className="this-turn__name">{side.name}</span>
      {side.eff && <span className="this-turn__eff num"><span className="sr-only">strength </span>{side.eff}</span>}
    </div>
  );
}

/** The drawn attacker; the defender and odds join once the needle locks (`b` null while it spins, DEC D19). */
function Draw({ a, b, odds, state, pending }) {
  return (
    <div className="this-turn__draw" data-stage={state}>
      <TeamRow side={a} role="attacker" />
      {b ? <>
        <p className="this-turn__connector"><CompassGlyph />compass points to</p>
        <TeamRow side={b} role="defender" />
      </> : <p className="this-turn__pending"><CompassGlyph />{pending || 'The compass is choosing the target'}</p>}
      {b && odds && (
        <div className="this-turn__odds">
          <div className="this-turn__bar" role="img" aria-label={odds.aria}>
            <span className="this-turn__fill" style={{ width: `${odds.fill}%` }} />
          </div>
          <div className="this-turn__labels" aria-hidden="true">
            <span>{odds.aLabel}</span>
            <span className="this-turn__labels-mid">Win chance</span>
            <span>{odds.bLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpectatorPanel({
  thisTurn = null, managed = null, followed = null, teams = [], pauseFollow = false, autoplay = false, speed = 1,
  sheet = 'collapsed', completed = false, matchCard = null, onFollow, onPauseFollow, onToggleAutoplay, onSpeed,
}) {
  const turn = thisTurn || IDLE_TURN;
  const { a, b, odds, idle } = turn;
  // Tolerate partial models (the W1 stub sends `{ id: null, name: undefined }` when nobody is followed).
  const follow = followed?.id && followed?.name ? followed : null;
  const pause = follow ? follow.pauseOnEvents ?? pauseFollow : false;
  const detail = follow ? follow.detail : 'Follow an empire to track its matches';
  const pickerWord = follow ? 'Change' : 'Choose';
  // `managed` is set only after the manager's exit (DEC D16); `ended: false` is the W1 stub's live manager.
  const managedNote = managed?.id && managed?.name && managed.ended !== false ? managed : null;
  return (
    <section className="spectator-panel" aria-label="Spectator" data-sheet={sheet}>
      <section className="this-turn" data-state={turn.state} aria-labelledby="this-turn-title">
        <div className="kicker">
          <span className="kicker__title" id="this-turn-title">This turn</span>
          {turn.kickerRight && <span className="kicker__aside">{turn.kickerRight}</span>}
        </div>
        {matchCard ? <div className="this-turn__card">{matchCard}</div>
          : a && (b || turn.state === 'drawing') ? <Draw a={a} b={b} odds={odds} state={turn.state} pending={turn.pending} />
            : idle ? (
              <div className="this-turn__idle">
                <p className="this-turn__title">{idle.title}</p>
                {idle.route && <p className="this-turn__route">{idle.route}</p>}
              </div>
            ) : null}
      </section>

      <section className="spectator-panel__follow" aria-labelledby="follow-title">
        <div className="kicker"><span className="kicker__title" id="follow-title">Following</span></div>
        {managedNote && (
          <div className="follow-managed" role="group" aria-label="Managed team">
            <span className="follow-managed__label">Your managed team</span>
            <span className="follow-managed__name">{managedNote.name}</span>
            <span className="follow-managed__status">{managedNote.alive === false ? 'Eliminated' : managedNote.ended ? 'Now spectating' : 'In contention'}</span>
          </div>
        )}
        <div className="follow-team" data-empty={follow ? undefined : ''}>
          {follow && (
            <span className="follow-team__mark" aria-hidden="true">
              <TeamMark id={follow.flagId} code={follow.code} color={follow.color} isClub={follow.isClub} width={28} height={21} />
            </span>
          )}
          <span className="follow-team__text">
            <span className="follow-team__name">{follow ? follow.name : 'No team followed'}</span>
            {detail && <span className="follow-team__detail">{detail}</span>}
          </span>
          {onFollow && (
            <span className="follow-change">
              {/* The visible word starts the select's name: "Change followed team" / "Choose a team to follow" (WCAG 2.5.3). */}
              <label className="follow-change__label" htmlFor="followed-team">
                {pickerWord}<span className="sr-only">{follow ? ' followed team' : ' a team to follow'}</span>
              </label>
              <select id="followed-team" className="follow-change__select" value={follow?.id || ''}
                onChange={event => onFollow(event.target.value)}>
                <option value="">No followed team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}{team.alive === false ? ' · eliminated' : ''}</option>
                ))}
              </select>
            </span>
          )}
        </div>
        {/* An eliminated followed team never plays again: no pause switch for it. */}
        {follow && follow.alive !== false && onPauseFollow && (
          <button type="button" className="follow-pause" role="switch" aria-checked={!!pause}
            onClick={() => onPauseFollow(!pause)}>
            <span className="follow-pause__track" aria-hidden="true" />
            <span>Pause when {follow.name} plays</span>
          </button>
        )}
      </section>

      <div className="follow-autoplay">
        <button type="button" className="follow-autoplay__toggle" role="switch" aria-checked={!!autoplay}
          aria-label="Autoplay" disabled={completed || !onToggleAutoplay} onClick={() => onToggleAutoplay?.()}>
          <span className="follow-autoplay__dot" aria-hidden="true" />
          <span aria-hidden="true">{autoplay ? 'Autoplay on' : 'Autoplay off'}</span>
        </button>
        <div className="follow-speed segmented" role="group" aria-label="Playback speed">
          {SPEEDS.map(n => (
            <button key={n} type="button" aria-pressed={speed === n} aria-label={`Speed ${n}×`}
              onClick={() => onSpeed?.(n)}>{n}×</button>
          ))}
        </div>
      </div>
    </section>
  );
}
