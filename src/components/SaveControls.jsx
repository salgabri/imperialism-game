// Owner: WP-LEDGER (see PLAN.md §4). Save status + file actions, used by the setup wizard and the settings panel.
// v4 classes live in the WP-LEDGER namespace (.save-*, dialogs.css); WP-SETUP only styles them nested under
// .setup-overlay. Contract (ui-interaction L53-65): [role=status] text, file input re-selectable.
import React, { useRef } from 'react';
import './dialogs.css';

export function saveStatusText(status, fallback = 'Autosave after each match') {
  if (typeof status === 'string') return status;
  return status?.message || status?.text || fallback;
}

/** File input stays keyboard accessible through its ordinary button. */
export default function SaveControls({ status, onExport, onImport, onManageSaves, compact = false }) {
  const fileRef = useRef(null);
  const failed = status?.ok === false || status?.state === 'error' || /could not|failed|unsaved/i.test(saveStatusText(status));
  return (
    <div className={`save-controls${compact ? ' save-controls--compact' : ''}`}>
      <p className={`save-status${failed ? ' is-unsaved' : ''}`} role="status" aria-live="polite">
        <i className="save-status__mark" aria-hidden="true" />
        <span>{saveStatusText(status)}</span>
      </p>
      <div className="save-file-actions">
        {onManageSaves && <button type="button" className="save-text-button" onClick={onManageSaves}>Saved campaigns</button>}
        {onExport && <button type="button" className="save-text-button" onClick={onExport}>Export campaign</button>}
        {onImport && <button type="button" className="save-text-button" onClick={() => fileRef.current?.click()}>Import campaign</button>}
      </div>
      {onImport && <input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Import campaign file" onChange={event => {
        const file = event.target.files?.[0];
        if (file) onImport(file);
        event.target.value = '';
      }} />}
    </div>
  );
}
