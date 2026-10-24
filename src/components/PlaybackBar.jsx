import React from 'react';
import Icon from './Icon.jsx';
import './masthead.css';

/**
 * Campaign playback controls (DEC D14). `variant`:
 * - 'bar' (default): the original control strip; its markup is a test contract (visual-polish).
 * - 'masthead': masthead row 2, "AUTOPLAY OFF · SPEED 2×"; the step button only when `showStep` (spectators).
 * - 'sheet': the phone More sheet, under a fixed "Playback" heading with the state as a muted sub-line.
 * The masthead and sheet variants carry no role=status node; the autoplay button keeps the
 * "Play campaign" / "Pause" names as its aria-label while showing the autoplay state.
 */
export default function PlaybackBar({ speed, autoplay, onSpeed, onStep, onPlay, busy = false, completed = false, stepLabel = 'Next match', paused = false, live = false, onPause, stateLabel, summary,
  variant = 'bar', showStep = true, id = 'campaign-playback' }) {
  const label = stateLabel || (completed ? 'Completed' : paused ? 'Paused' : busy ? 'Drawing' : live ? 'Live' : 'Ready');
  const manual = !autoplay;
  const speedLabel = `Playback speed ${speed} times. Change speed.`;
  if (variant === 'masthead') {
    return (
      <div id={id} className={`playback-mast${paused ? ' is-paused' : ''}`} role="group" aria-label="Campaign playback" tabIndex={-1}>
        {showStep && <button type="button" className="playback-step" onClick={onStep} disabled={busy || completed || paused}>{stepLabel}</button>}
        <button type="button" className="playback-play" onClick={onPlay} disabled={completed} aria-pressed={autoplay}
          aria-label={autoplay ? 'Pause' : 'Play campaign'}>{autoplay ? 'Autoplay on' : 'Autoplay off'}</button>
        <span className="playback-mast__sep" aria-hidden="true"> · </span>
        <button type="button" className="playback-speed" onClick={onSpeed} disabled={completed} aria-label={speedLabel} title="Change playback speed">{`Speed ${speed}×`}</button>
      </div>
    );
  }
  if (variant === 'sheet') {
    return (
      <div id={id} className={`playback-sheet${paused ? ' is-paused' : ''}`} role="group" aria-label="Campaign playback" tabIndex={-1}>
        <div className="playback-sheet__head">
          <h3 className="playback-sheet__title">Playback</h3>
          <p className="playback-sheet__state">{label}{summary && <span className="playback-summary" aria-label={summary.label}> · {summary.text}</span>}</p>
        </div>
        {showStep && <button type="button" className="button playback-step" onClick={onStep} disabled={busy || completed || paused}>{stepLabel}<Icon name="chevronRight" size={16} /></button>}
        <button type="button" className="button playback-play" onClick={onPlay} disabled={completed} aria-pressed={autoplay}
          aria-label={autoplay ? 'Pause' : 'Play campaign'}><span>{autoplay ? 'Autoplay on' : 'Autoplay off'}</span><Icon name={autoplay ? 'pause' : 'play'} size={16} /></button>
        {live && !autoplay && onPause && <button type="button" className="button playback-pause" onClick={onPause} aria-pressed={paused} aria-label={paused ? 'Resume this match' : 'Pause this match'}><span>{paused ? 'Resume match' : 'Pause match'}</span><Icon name={paused ? 'play' : 'pause'} size={16} /></button>}
        <button type="button" className="button playback-speed" onClick={onSpeed} disabled={completed} aria-label={speedLabel} title="Change playback speed"><span>{`Speed ${speed}×`}</span><Icon name="chevron" size={15} /></button>
      </div>
    );
  }
  return (
    <div id={id} className={`playback-bar${paused ? ' is-paused' : ''}`} role="group" aria-label="Campaign playback" tabIndex={-1}>
      <div className="playback-context"><span className={`playback-state${live && !paused ? ' is-live' : ''}`} role="status">{label}</span>{summary && <span className="playback-summary" aria-label={summary.label}>{summary.text}</span>}</div>
      <div className="playback-actions">
      <button type="button" className={`button ${manual && !paused && !busy ? 'button-primary' : 'button-quiet'} playback-step`} onClick={onStep} disabled={busy || completed || paused}>{stepLabel}<Icon name="arrow" size={17} /></button>
      <button type="button" className={`button ${paused ? 'button-primary' : 'button-quiet'} playback-play`} onClick={onPlay} disabled={completed} aria-pressed={autoplay}>
        <Icon name={autoplay ? 'pause' : 'play'} size={17} />{autoplay ? 'Pause' : paused ? 'Resume campaign' : 'Play campaign'}
      </button>
      {live && !autoplay && onPause && <button type="button" className="button button-quiet playback-pause" onClick={onPause} aria-pressed={paused} aria-label={paused ? 'Resume this match' : 'Pause this match'}><Icon name={paused ? 'play' : 'pause'} size={17} /><span>{paused ? 'Resume match' : 'Pause match'}</span></button>}
      <button type="button" className="button button-quiet playback-speed" onClick={onSpeed} disabled={completed} aria-label={speedLabel} title="Change playback speed">{speed}×<Icon name="chevron" size={15} /></button>
      </div>
    </div>
  );
}
