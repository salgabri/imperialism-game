import React, { useMemo, useState } from 'react';
import { NATIONS, SCOPES } from '../data/teams.js';
import { SPORT_LIST, getSport } from '../sports/index.js';
import { CLUB_SCOPES } from '../data/scopes.js';
import Icon from './Icon.jsx';
import SaveControls from './SaveControls.jsx';
import './controls.css';

export const PACING_OPTIONS = [['duel', 'One by one'], ['blitz', 'Blitz round'], ['chaos', 'Chaos draw']];
export const RESOLUTION_OPTIONS = [['ticker', 'Live ticker'], ['instant', 'Instant result']];
export const PACING_HELP = {
  duel: 'One attacker and a compass direction choose one reachable opponent. One match per round. Separated teams use coastal sea routes or a neutral transit treaty; neutral land stays unclaimed.',
  blitz: 'Pair every team, preferring neighbours, then other opponents. The field roughly halves each round; an odd team gets a bye. Distant pairings ignore directional route restrictions; neutral land stays unclaimed.',
  chaos: 'Draw neighbour-preferred matchups until a team would repeat, then resolve the batch. Round size varies. Distant pairings ignore directional route restrictions; neutral land stays unclaimed.',
};

export function campaignPreview(count, sport, setup) {
  const matches = Math.max(0, count - 1);
  const extra = setup.finale === 'best-of-three' ? '–' + (matches + 2) : '';
  const seconds = setup.express ? 2.5 : setup.resolution === 'instant' ? 5 : sport.clock.length * sport.clock.msPerUnit / 1000 + 7;
  const minutes = Math.max(1, Math.ceil(matches * seconds / 60));
  return { matches: `${matches}${extra}`, duration: `about ${minutes}–${Math.ceil(minutes * 1.35)} min at 1× autoplay` };
}

function SegmentedChoice({ label, options, value, onChange }) {
  return (
    <fieldset className="setup-choice">
      <legend>{label}</legend>
      <div className="setup-segments">
        {options.map(([id, name]) => (
          <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{name}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** The three campaign choices stay visible; simulation options are optional. */
export default function SetupOverlay({ setup, hasSave, savedText, saveStatus, onResume, onDiscard, onPick, onStart, onExport, onImport, onManageSaves, managerTeams = [] }) {
  const [confirmation, setConfirmation] = useState(null);
  const sport = getSport(setup.sport);
  const clubLayer = setup.layer === 'clubs';
  const clubScopes = useMemo(() => CLUB_SCOPES(sport), [sport]);
  const nationCounts = useMemo(() => {
    const nations = Object.values(NATIONS);
    return Object.fromEntries(SCOPES.map(scope => [scope.id, scope.id === 'world'
      ? nations.length
      : scope.id === 'elite' ? Math.min(32, nations.length) : nations.filter(nation => scope.filter({ conf: nation[2] })).length]));
  }, []);
  const scopes = clubLayer ? clubScopes : SCOPES;
  // Changing sport can leave a league from the previous sport in saved setup.
  // This is the same first-scope fallback used by startCampaign.
  const activeScope = scopes.find(scope => scope.id === (clubLayer ? setup.clubScope : setup.scope)) || scopes[0];
  const pacingName = PACING_OPTIONS.find(([id]) => id === setup.pacing)?.[1] || 'One by one';
  const resolutionName = RESOLUTION_OPTIONS.find(([id]) => id === setup.resolution)?.[1] || 'Live ticker';
  const count = clubLayer ? sport.clubs.filter(activeScope.filter).length : nationCounts[activeScope.id];
  const preview = campaignPreview(count, sport, setup);

  function launch(event) {
    event.preventDefault();
    if (setup.role === 'manager' && !managerTeams.some(team => team.id === setup.managedTeamId)) return;
    onStart();
  }

  function confirm() {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'discard') onDiscard();
    else onStart();
  }

  return (
    <div className="setup-overlay">
      <section className="setup-panel" aria-labelledby="setup-title">
        <form className="setup-form" onSubmit={launch}>
        <div className="setup-body">
        <header className="setup-intro">
          <h1 id="setup-title">Start your campaign</h1>
          <p>Choose your sport, teams and theatre.</p>
          <ol className="setup-rules" aria-label="How conquest works">
            <li>Win a match to take all of the loser's territories.</li>
            <li>Claim a player; some signings add bench options.</li>
            <li>Last team standing wins.</li>
          </ol>
        </header>

        {hasSave && (
          <div className="setup-save">
            <div><strong>Continue your campaign</strong><p>{savedText}</p></div>
            <div className="setup-save-actions">
              <button type="button" className="button button-quiet" onClick={onResume}>Resume</button>
              <button type="button" className="setup-text-button" onClick={() => setConfirmation('discard')}>Clear quick resume</button>
            </div>
          </div>
        )}

          <div className="setup-main-row">
            <SegmentedChoice label="Session" options={[['short', 'Short'], ['standard', 'Standard'], ['world', 'World']]} value={setup.preset || 'standard'} onChange={value => onPick('preset', value)} />
            <SegmentedChoice label="Your role" options={[['spectator', 'Spectator'], ['manager', 'Manager']]} value={setup.role || 'spectator'} onChange={value => onPick('role', value)} />
          </div>
          <p className="control-help setup-role-help">{setup.role === 'manager' ? 'Commit to one team. Choose an approach before its matches and among up to three signings after its wins.' : 'Automatic draws, results and signings. Follow a favourite for match alerts.'}</p>
          <div className="setup-main-row">
            <SegmentedChoice label="Sport" options={SPORT_LIST.map(item => [item.id, item.name])} value={sport.id} onChange={value => onPick('sport', value)} />
            <SegmentedChoice label="Teams" options={[[ 'nations', 'Nations' ], [ 'clubs', 'Clubs' ]]} value={clubLayer ? 'clubs' : 'nations'} onChange={value => onPick('layer', value)} />
          </div>

          {setup.role === 'manager' && <label className="control-field" htmlFor="setup-managed-team"><span>Your managed team</span>
            <select id="setup-managed-team" value={setup.managedTeamId || ''} required onChange={event => onPick('managedTeamId', event.target.value)}>
              <option value="" disabled>Choose your team</option>
              {managerTeams.map(team => <option key={team.id} value={team.id}>{team.name} · {team.rating.toFixed(1)} strength</option>)}
            </select><small className="control-help">Management stays with this team until elimination. You can follow any team independently.</small>
          </label>}

          <div className="setup-theatre-preview">
          <label className="control-field" htmlFor="setup-theatre">
            <span>Theatre</span>
            <select id="setup-theatre" value={activeScope.id} onChange={event => onPick(clubLayer ? 'clubScope' : 'scope', event.target.value)}>
              {scopes.map(scope => (
                <option value={scope.id} key={scope.id}>
                  {scope.name} · {clubLayer ? sport.clubs.filter(scope.filter).length : nationCounts[scope.id]} {clubLayer ? 'clubs' : 'nations'}
                </option>
              ))}
            </select>
          </label>

          <p className="setup-session-preview" role="status"><strong>{count} {clubLayer ? 'clubs' : 'nations'} · {preview.matches} matches</strong><span>{preview.duration}. Ties and manager decisions may take longer.</span></p>
          </div>

          <details className="setup-advanced">
            <summary><Icon name="chevron" size={17} /><span>Match settings</span><small>{pacingName} · {resolutionName}</small></summary>
            <div className="setup-settings-fields">
              <label className="control-field" htmlFor="setup-pacing"><span>Pacing</span>
                <select id="setup-pacing" value={setup.pacing} onChange={event => onPick('pacing', event.target.value)}>
                  {PACING_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <small className="control-help">{PACING_HELP[setup.pacing] || PACING_HELP.duel}</small>
              </label>
              <label className="control-field" htmlFor="setup-uncertainty"><span>Match uncertainty</span>
                <select id="setup-uncertainty" value={setup.uncertainty || 'balanced'} onChange={event => onPick('uncertainty', event.target.value)}>
                  <option value="predictable">Predictable</option><option value="balanced">Balanced</option><option value="wild">Wild</option>
                </select>
                <small className="control-help">{setup.uncertainty === 'predictable' ? 'Strength usually decides the winner.' : setup.uncertainty === 'wild' ? 'More match-day variation and potential upsets.' : 'Strength matters, with room for surprises.'}</small>
              </label>
              <label className="control-field" htmlFor="setup-finale"><span>Final two teams</span>
                <select id="setup-finale" value={setup.finale || 'single'} onChange={event => onPick('finale', event.target.value)}>
                  <option value="single">Single match</option><option value="best-of-three">Best of three</option>
                </select>
                <small className="control-help">{setup.finale === 'best-of-three' ? 'First to two wins claims the final territories and player.' : 'One decisive match crowns the champion.'}</small>
              </label>
              <label className="control-field" htmlFor="setup-recruitment"><span>Automatic recruitment</span>
                <select id="setup-recruitment" value={setup.acquisitionPolicy || 'highest-rated'} onChange={event => onPick('acquisitionPolicy', event.target.value)}>
                  <option value="highest-rated">Highest rated player</option><option value="best-fit">Best fit for the starting lineup</option>
                </select><small className="control-help">Applies to teams without a manager. Best fit maximizes legal lineup improvement, then rating.</small>
              </label>
              {sport.id === 'basketball' && <label className="control-field" htmlFor="setup-roster-preset"><span>Starting ratings</span>
                <select id="setup-roster-preset" value={setup.rosterPreset || 'authentic'} onChange={event => onPick('rosterPreset', event.target.value)}>
                  <option value="authentic">Authentic</option><option value="competitive">Competitive field</option>
                </select><small className="control-help">Competitive narrows the strength gaps between teams and preserves player differences within each roster.</small>
              </label>}
              <label className="control-field" htmlFor="setup-seed"><span>Campaign seed</span>
                <input id="setup-seed" type="number" min="1" max="4294967295" step="1" placeholder="Random seed" value={setup.seed ?? ''} onChange={event => onPick('seed', event.target.value)} />
                <small className="control-help">Share a seed and these settings to replay the same draw. Leave blank for a new seed.</small>
              </label>
              <label className="control-checkbox setup-express"><input type="checkbox" checked={!!setup.express} onChange={event => onPick('express', event.target.checked)} /><span>Express playback<small>Shorter draw and result pauses. Manager choices still wait for you.</small></span></label>
              <label className="control-field" htmlFor="setup-resolution"><span>Match display</span>
                <select id="setup-resolution" value={setup.resolution} onChange={event => onPick('resolution', event.target.value)}>
                  {RESOLUTION_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
          </details>

          </div>
          <footer className="setup-footer">
          {confirmation && hasSave ? (
            <div className="setup-confirmation" role="alert">
              <strong>{confirmation === 'discard' ? 'Clear quick resume?' : 'Start a new campaign?'}</strong>
              <p>{confirmation === 'discard' ? 'The campaign stays available in Saved campaigns.' : 'Your saved campaign stays available in its own slot.'}</p>
              <div className="setup-confirm-actions">
                <button type="button" className="button button-quiet" onClick={() => setConfirmation(null)}>Keep save</button>
                <button type="button" className="button button-primary" onClick={confirm}>{confirmation === 'discard' ? 'Clear quick resume' : 'Launch new campaign'}</button>
              </div>
            </div>
          ) : (
            <button type="submit" className="button button-primary setup-launch" disabled={setup.role === 'manager' && !managerTeams.some(team => team.id === setup.managedTeamId)}><Icon name="play" size={17} />Launch campaign</button>
          )}
          <SaveControls status={saveStatus} onExport={hasSave ? onExport : undefined} onImport={onImport} onManageSaves={onManageSaves} />
          </footer>
        </form>
      </section>
    </div>
  );
}
