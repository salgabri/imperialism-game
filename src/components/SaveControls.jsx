// Owner: WP-LEDGER (see PLAN.md §4). Save status + file actions, used by the setup wizard and the settings panel.
// v4 classes live in the WP-LEDGER namespace (.save-*, dialogs.css); WP-SETUP only styles them nested under
// .setup-overlay. Contract (ui-interaction L53-65): [role=status] text, file input re-selectable.
import React, { useRef } from 'react';
import Icon from './Icon.jsx';
import './dialogs.css';

export function saveStatusText(status, fallback = 'Autosave after each match') {
  if (typeof status === 'string') return status;
  return status?.message || status?.text || fallback;
}

/**
 * File input stays keyboard accessible through its ordinary button. `icons`: the actions as icon buttons (their names
 * in `title` and for screen readers), and a healthy save status said to screen readers alone. `quiet`: any status said to
 * screen readers alone, because the same words are on screen nearby.
 */
export default function SaveControls({ status, onExport, onImport, onManageSaves, compact = false, icons = false, quiet = false }) {
  const fileRef = useRef(null);
  const failed = status?.ok === false || status?.state === 'error' || /could not|failed|unsaved/i.test(saveStatusText(status));
  const action = (label, icon, onClick) => (icons
    ? <button type="button" className="icon-button save-icon-button" title={label} onClick={onClick}><Icon name={icon} size={18} /><span className="sr-only">{label}</span></button>
    : <button type="button" className="save-text-button" onClick={onClick}>{label}</button>);
  return (
    <div className={`save-controls${compact ? ' save-controls--compact' : ''}`}>
      <p className={`save-status${failed ? ' is-unsaved' : ''}${quiet || (icons && !failed) ? ' sr-only' : ''}`} role="status" aria-live="polite">
        <i className="save-status__mark" aria-hidden="true" />
        <span>{saveStatusText(status)}</span>
      </p>
      <div className="save-file-actions">
        {onManageSaves && action('Saved campaigns', 'folder', onManageSaves)}
        {onExport && action('Export campaign', 'download', onExport)}
        {onImport && action('Import campaign', 'upload', () => fileRef.current?.click())}
      </div>
      {onImport && <input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Import campaign file" onChange={event => {
        const file = event.target.files?.[0];
        if (file) onImport(file);
        event.target.value = '';
      }} />}
    </div>
  );
}
