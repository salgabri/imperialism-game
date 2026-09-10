import React, { useMemo, useState } from 'react';
import { NATIONS, SCOPES } from '../data/teams.js';
import { SPORT_LIST, getSport } from '../sports/index.js';
import { CLUB_SCOPES } from '../data/scopes.js';
import Icon from './Icon.jsx';
import './controls.css';

export const PACING_OPTIONS = [['duel', 'One by one'], ['blitz', 'Blitz round'], ['chaos', 'Chaos draw']];
export const RESOLUTION_OPTIONS = [['ticker', 'Live ticker'], ['instant', 'Instant result']];

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
export default function SetupOverlay({ setup, hasSave, savedText, onResume, onDiscard, onPick, onStart }) {
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

  function launch(event) {
    event.preventDefault();
    if (hasSave) setConfirmation('launch');
    else onStart();
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
        <header className="setup-intro">
          <h1 id="setup-title">Start your campaign</h1>
          <p>Choose your sport, teams and theatre.</p>
        </header>

        {hasSave && (
          <div className="setup-save">
            <div><strong>Continue your campaign</strong><p>{savedText}</p></div>
            <div className="setup-save-actions">
              <button type="button" className="button button-quiet" onClick={onResume}>Resume</button>
              <button type="button" className="setup-text-button" onClick={() => setConfirmation('discard')}>Discard save</button>
            </div>
          </div>
        )}

        <form onSubmit={launch}>
          <SegmentedChoice label="Sport" options={SPORT_LIST.map(item => [item.id, item.name])} value={sport.id} onChange={value => onPick('sport', value)} />
          <SegmentedChoice label="Teams" options={[[ 'nations', 'Nations' ], [ 'clubs', 'Clubs' ]]} value={clubLayer ? 'clubs' : 'nations'} onChange={value => onPick('layer', value)} />

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

          <details className="setup-advanced">
            <summary><Icon name="chevron" size={17} /><span>Match settings</span><small>{pacingName} · {resolutionName}</small></summary>
            <div className="setup-settings-fields">
              <label className="control-field" htmlFor="setup-pacing"><span>Pacing</span>
                <select id="setup-pacing" value={setup.pacing} onChange={event => onPick('pacing', event.target.value)}>
                  {PACING_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="control-field" htmlFor="setup-resolution"><span>Match display</span>
                <select id="setup-resolution" value={setup.resolution} onChange={event => onPick('resolution', event.target.value)}>
                  {RESOLUTION_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
          </details>

          {confirmation && hasSave ? (
            <div className="setup-confirmation" role="alert">
              <strong>{confirmation === 'discard' ? 'Discard saved campaign?' : 'Start a new campaign?'}</strong>
              <p>{confirmation === 'discard' ? 'Your saved progress will be removed.' : 'Your saved progress will be replaced by this campaign.'}</p>
              <div className="setup-confirm-actions">
                <button type="button" className="button button-quiet" onClick={() => setConfirmation(null)}>Keep save</button>
                <button type="button" className="button button-primary" onClick={confirm}>{confirmation === 'discard' ? 'Discard save' : 'Launch new campaign'}</button>
              </div>
            </div>
          ) : (
            <button type="submit" className="button button-primary setup-launch"><Icon name="play" size={17} />Launch campaign</button>
          )}
          <p className="setup-autosave">Progress saved after every match.</p>
        </form>
      </section>
    </div>
  );
}
