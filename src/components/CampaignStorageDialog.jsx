import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import './campaignStorage.css';

function CampaignPreview({ campaign }) {
  if (!campaign) return null;
  const settings = campaign.settings || {}, alive = campaign.aliveIds?.length ?? campaign.alive;
  const manager = campaign.teams?.[campaign.managedTeamId]?.name || campaign.managedTeamName;
  return <dl className="campaign-storage-preview">
    <div><dt>Sport</dt><dd>{settings.sport === 'basketball' ? 'Basketball' : 'Football'} · {settings.layer === 'clubs' ? 'Clubs' : 'Nations'}</dd></div>
    <div><dt>Theatre</dt><dd>{settings.layer === 'clubs' ? settings.clubScope || 'All clubs' : settings.scope || 'World'}</dd></div>
    <div><dt>Progress</dt><dd>Round {campaign.round || 0} · {campaign.matches || 0} matches · {alive} remaining</dd></div>
    <div><dt>Seed</dt><dd>{campaign.seed ?? 'Legacy campaign'}</dd></div>
    {manager && <div><dt>Manager</dt><dd>{manager}</dd></div>}
  </dl>;
}

/** Preview and choose a checkpoint before altering the active campaign. */
export default function CampaignStorageDialog({ mode = 'slots', campaign, campaigns = [], activeId,
  backup, message, error, onClose, onConfirmImport, onLoad, onRename, onFork, onReload, onRestoreBackup, onExportRaw, onExportCurrent }) {
  const ref = useRef(null), closeRef = useRef(null), callbacks = useRef({ onClose });
  callbacks.current = { onClose };
  const [name, setName] = useState(campaign?.campaignName || (mode === 'conflict' ? 'Campaign fork' : 'Imported campaign'));
  const [names, setNames] = useState({});
  const title = { slots: 'Saved campaigns', import: 'Preview imported campaign', recovery: 'Recover campaign', conflict: 'Campaign changed in another tab' }[mode];
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); callbacks.current.onClose?.(); return; }
      if (event.key !== 'Tab') return;
      const fields = [...(ref.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])];
      if (!fields.length) return;
      if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="campaign-storage-backdrop">
    <section className="campaign-storage" ref={ref} role="dialog" aria-modal="true" aria-labelledby="campaign-storage-title" aria-describedby="campaign-storage-description">
      <div className="campaign-storage-heading"><h1 id="campaign-storage-title">{title}</h1><button ref={closeRef} type="button" className="icon-button" aria-label="Close saved campaigns" onClick={onClose}><Icon name="close" size={18} /></button></div>
      <p id="campaign-storage-description">{message || {
        slots: 'Choose a checkpoint to resume. Each campaign keeps its own progress and name.',
        import: 'Check this campaign before opening it. It will be saved in a new slot; your existing campaigns remain available.',
        recovery: 'The latest save is damaged. Keep a copy of the file or restore a previous checkpoint into a new slot.',
        conflict: 'Your current progress has paused because another tab saved this campaign. Reload its checkpoint or keep both versions by creating a fork.',
      }[mode]}</p>
      {error && <p role="alert" className="campaign-storage-error">{error}</p>}
      {mode === 'slots' && <>
        {!campaigns.length && <p className="campaign-storage-empty">No named campaigns yet. Starting or resuming a campaign creates its first checkpoint.</p>}
        <ul className="campaign-storage-list">{campaigns.map(item => <li key={item.id}>
          <div className="campaign-storage-slot-heading"><strong>{item.name}</strong>{item.id === activeId && <span>Current campaign</span>}</div>
          <CampaignPreview campaign={item} />
          <p className="campaign-storage-date">{item.damaged ? 'Checkpoint damaged · the file is retained' : `Saved ${item.savedAt ? new Date(item.savedAt).toLocaleString() : 'previously'}`}</p>
          <div className="campaign-storage-slot-actions"><button type="button" className="button button-primary" disabled={!onLoad} onClick={() => onLoad?.(item.id)}>{item.damaged ? 'Recover' : 'Resume'} {item.name}</button>
            <form onSubmit={event => { event.preventDefault(); onRename?.(item.id, names[item.id] ?? item.name); }}>
              <label htmlFor={`campaign-name-${item.id}`}>Campaign name</label>
              <input id={`campaign-name-${item.id}`} type="text" maxLength={80} value={names[item.id] ?? item.name} onChange={event => setNames(current => ({ ...current, [item.id]: event.target.value }))} disabled={item.damaged || !onRename} />
              <button type="submit" className="button button-quiet" disabled={item.damaged || !onRename || !(names[item.id] ?? item.name).trim()}>Rename</button>
            </form>
          </div>
        </li>)}</ul>
        {onFork && <form className="campaign-storage-fork" onSubmit={event => { event.preventDefault(); onFork(name.trim()); }}>
          <label htmlFor="campaign-fork-name">Name a copy of your current campaign</label><div><input id="campaign-fork-name" maxLength={80} value={name} onChange={event => setName(event.target.value)} /><button type="submit" className="button button-quiet" disabled={!name.trim()}>Create fork</button></div>
        </form>}
      </>}
      {mode === 'import' && <><CampaignPreview campaign={campaign} /><form className="campaign-storage-fork" onSubmit={event => { event.preventDefault(); onConfirmImport?.(name.trim()); }}>
        <label htmlFor="import-campaign-name">Campaign name</label><input id="import-campaign-name" type="text" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        <div className="campaign-storage-actions">{onExportCurrent && <button type="button" className="button button-quiet" onClick={onExportCurrent}>Export current campaign first</button>}<button type="submit" className="button button-primary" disabled={!campaign || !name.trim()}>Import as new campaign</button><button type="button" className="button button-quiet" onClick={onClose}>Cancel import</button></div>
      </form></>}
      {mode === 'recovery' && <>{backup && <><h2>Previous checkpoint</h2><CampaignPreview campaign={backup} /></>}
        <div className="campaign-storage-actions">{backup && <button type="button" className="button button-primary" onClick={onRestoreBackup}>Restore previous checkpoint</button>}{onExportRaw && <button type="button" className="button button-quiet" onClick={onExportRaw}>Export damaged file</button>}<button type="button" className="button button-quiet" onClick={onClose}>Keep file and close</button></div>
      </>}
      {mode === 'conflict' && <><h2>Checkpoint from the other tab</h2><CampaignPreview campaign={campaign} /><div className="campaign-storage-actions"><button type="button" className="button button-primary" onClick={onReload}>Reload newer checkpoint</button></div>
        <form className="campaign-storage-fork" onSubmit={event => { event.preventDefault(); onFork?.(name.trim()); }}><label htmlFor="conflict-fork-name">Keep your current progress as a separate campaign</label><div><input id="conflict-fork-name" type="text" maxLength={80} value={name} onChange={event => setName(event.target.value)} /><button type="submit" className="button button-quiet" disabled={!name.trim()}>Fork current progress</button></div></form>
      </>}
    </section>
  </div>;
}
