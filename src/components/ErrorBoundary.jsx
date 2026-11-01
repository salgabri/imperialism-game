import React, { useEffect, useMemo, useRef } from 'react';
import { SAVE_KEY } from '../config.js';
import { applyUpdate } from '../serviceWorker.js';
import './crash.css';

const ISSUES_URL = 'https://github.com/salgabri/imperialism-game/issues/new';

/** The active campaign's last checkpoint exactly as stored (Import campaign reads it as it is), or null. */
function storedCheckpoint() {
  try { return localStorage.getItem(SAVE_KEY) || null; } catch { return null; }
}

/** Named as Export campaign names its files: "imperialism-<seed>-match-<n>.json". */
function checkpointFilename(text) {
  try {
    const { seed, matches } = JSON.parse(text);
    return `imperialism-${seed ?? 'campaign'}-match-${matches ?? 0}.json`;
  } catch { return 'imperialism-campaign.json'; }
}

/** The error as plain text: "Name: message" and the first stack frames. */
function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  const head = `${error.name}: ${error.message}`;
  const frames = typeof error.stack === 'string' ? error.stack.split('\n').map(line => line.trim()).filter(Boolean) : [];
  if (frames[0]?.includes(error.message)) frames.shift();
  return [head, ...frames.slice(0, 12)].join('\n');
}

function reportUrl(details) {
  const title = `Crash: ${details.split('\n')[0]}`.slice(0, 120);
  const body = `What were you doing when the game stopped?\n\n\n**Error**\n\n\`\`\`\n${details}\n\`\`\`\n`;
  return `${ISSUES_URL}?${new URLSearchParams({ title, body })}`;
}

function CrashScreen({ error }) {
  const heading = useRef(null);
  const saved = useMemo(storedCheckpoint, []);
  const details = useMemo(() => errorText(error), [error]);
  useEffect(() => { heading.current?.focus(); }, []);

  // A plain reload opens the version the offline worker has cached, so a new one waiting (perhaps the fix) takes over
  // first and reloads the page itself.
  const reload = () => { if (!applyUpdate()) window.location.reload(); };

  const exportCampaign = () => {
    const anchor = document.createElement('a');
    // Never revoked: this screen only leaves by reloading the page.
    anchor.href = URL.createObjectURL(new Blob([saved], { type: 'application/json' }));
    anchor.download = checkpointFilename(saved);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <main className="crash-screen" aria-labelledby="crash-title">
      <div className="crash-screen__panel">
        <p className="crash-screen__wordmark">Imperialism</p>
        <h1 id="crash-title" className="crash-screen__title" ref={heading} tabIndex={-1}>Something went wrong</h1>
        <p className="crash-screen__lead">
          {saved
            ? 'The game hit an error and stopped. Your campaign is saved up to its last checkpoint: reload to return to setup and resume it, or export it to keep a copy.'
            : 'The game hit an error and stopped. Reload to start again.'}
        </p>
        <div className="crash-screen__actions">
          <button type="button" className="button button-primary" onClick={reload}>Reload</button>
          {saved ? <button type="button" className="button" onClick={exportCampaign}>Export campaign</button> : null}
          <a className="btn-link" href={reportUrl(details)} target="_blank" rel="noreferrer">Report it on GitHub</a>
        </div>
        <details className="crash-screen__details">
          <summary>Error details</summary>
          <p className="crash-screen__error">{details}</p>
        </details>
      </div>
    </main>
  );
}

/**
 * Around the whole App (main.jsx). An error while rendering would otherwise unmount the tree and leave a blank page.
 * The App's autosaves stop with it, so the stored checkpoint is the last good one: Reload returns to setup and its
 * resume card, and Export campaign downloads that checkpoint for Import campaign.
 */
export default class ErrorBoundary extends React.Component {
  state = { crashed: false, error: null };

  static getDerivedStateFromError(error) { return { crashed: true, error }; }

  render() {
    return this.state.crashed ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}
