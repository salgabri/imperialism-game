import React from 'react';
import { applyUpdate, dismissUpdate, useAppUpdate } from '../serviceWorker.js';
import './update-prompt.css';

/**
 * A new version is ready (src/serviceWorker.js). It waits for Reload and never reloads a campaign on its own; the
 * reload writes the open campaign's checkpoint (pagehide) and quick resume picks it up.
 */
export default function UpdatePrompt({ campaign = false }) {
  if (!useAppUpdate()) return null;
  return (
    <aside className="app-update" role="status" aria-label="New version" data-testid="update-prompt">
      <p className="app-update__text">
        <strong className="app-update__title">New version ready</strong>
        <span>{campaign ? 'Reload to play it. Your campaign is saved first, then resumes where it is.' : 'Reload to play it.'}</span>
      </p>
      <div className="app-update__actions">
        <button type="button" className="btn-primary" onClick={() => applyUpdate()}>Reload</button>
        <button type="button" className="btn-link" onClick={() => dismissUpdate()}>Later</button>
      </div>
    </aside>
  );
}
