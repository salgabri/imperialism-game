import React, { useRef } from 'react';

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
      <p className={`save-status${failed ? ' is-unsaved' : ''}`} role="status" aria-live="polite">{saveStatusText(status)}</p>
      <div className="save-file-actions">
        {onManageSaves && <button type="button" className="setup-text-button" onClick={onManageSaves}>Saved campaigns</button>}
        {onExport && <button type="button" className="setup-text-button" onClick={onExport}>Export campaign</button>}
        {onImport && <button type="button" className="setup-text-button" onClick={() => fileRef.current?.click()}>Import campaign</button>}
      </div>
      {onImport && <input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Import campaign file" onChange={event => {
        const file = event.target.files?.[0];
        if (file) onImport(file);
        event.target.value = '';
      }} />}
    </div>
  );
}
