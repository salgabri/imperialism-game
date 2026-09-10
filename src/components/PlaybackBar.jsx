import React from 'react';
import Icon from './Icon.jsx';
import './controls.css';

export default function PlaybackBar({ speed, autoplay, onSpeed, onStep, onPlay, busy = false, completed = false, stepLabel = 'Next match' }) {
  return (
    <div className="playback-bar" role="group" aria-label="Campaign playback">
      <button type="button" className="button button-quiet playback-step" onClick={onStep} disabled={busy || completed}>{stepLabel}<Icon name="arrow" size={17} /></button>
      <button type="button" className={`button ${autoplay ? 'button-quiet' : 'button-primary'} playback-play`} onClick={onPlay} disabled={completed} aria-pressed={autoplay}>
        <Icon name={autoplay ? 'pause' : 'play'} size={17} />{autoplay ? 'Pause' : 'Play campaign'}
      </button>
      <button type="button" className="button button-quiet playback-speed" onClick={onSpeed} disabled={completed} aria-label={`Playback speed ${speed} times. Change speed.`} title="Change playback speed">{speed}×<Icon name="chevron" size={15} /></button>
    </div>
  );
}
