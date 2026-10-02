import React from 'react';
import Icon from './Icon.jsx';
import './controls.css';

export default function PlaybackBar({ speed, autoplay, onSpeed, onStep, onPlay, busy = false, completed = false, stepLabel = 'Next match', paused = false, live = false, onPause, stateLabel, summary }) {
  const label = stateLabel || (completed ? 'Completed' : paused ? 'Paused' : busy ? 'Drawing' : live ? 'Live' : 'Ready');
  const manual = !autoplay;
  return (
    <div id="campaign-playback" className={`playback-bar${paused ? ' is-paused' : ''}`} role="group" aria-label="Campaign playback" tabIndex={-1}>
      <div className="playback-context"><span className={`playback-state${live && !paused ? ' is-live' : ''}`} role="status">{label}</span>{summary && <span className="playback-summary" aria-label={summary.label}>{summary.text}</span>}</div>
      <div className="playback-actions">
      <button type="button" className={`button ${manual && !paused && !busy ? 'button-primary' : 'button-quiet'} playback-step`} onClick={onStep} disabled={busy || completed || paused}>{stepLabel}<Icon name="arrow" size={17} /></button>
      <button type="button" className={`button ${paused ? 'button-primary' : 'button-quiet'} playback-play`} onClick={onPlay} disabled={completed} aria-pressed={autoplay}>
        <Icon name={autoplay ? 'pause' : 'play'} size={17} />{autoplay ? 'Pause' : paused ? 'Resume campaign' : 'Play campaign'}
      </button>
      {live && !autoplay && onPause && <button type="button" className="button button-quiet playback-pause" onClick={onPause} aria-pressed={paused} aria-label={paused ? 'Resume this match' : 'Pause this match'}><Icon name={paused ? 'play' : 'pause'} size={17} /><span>{paused ? 'Resume match' : 'Pause match'}</span></button>}
      <button type="button" className="button button-quiet playback-speed" onClick={onSpeed} disabled={completed} aria-label={`Playback speed ${speed} times. Change speed.`} title="Change playback speed">{speed}×<Icon name="chevron" size={15} /></button>
      </div>
    </div>
  );
}
