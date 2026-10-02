import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import './results.css';

/** The same checkpoint can be downloaded or copied when file downloads are unavailable. */
export default function ExportCheckpoint({ text = '', filename = 'campaign.json', onDownload, onClose }) {
  const dialogRef = useRef(null);
  const copyRef = useRef(null);
  const textRef = useRef(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    copyRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeCallback.current?.(); return; }
      if (event.key !== 'Tab') return;
      const fields = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), textarea') || [])];
      if (!fields.length) return;
      if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, []);

  async function copy() {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(text);
      setCopyStatus(`Copied. Paste into a text file and save as ${filename}.`);
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setCopyStatus('Copy is unavailable here. The checkpoint text is selected; use your usual Copy command, then paste into a .json file.');
    }
  }

  return <div className="fi-export-backdrop">
    <section className="fi-export" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="export-title" aria-describedby="export-description">
      <div className="fi-export-heading"><h1 id="export-title">Export campaign</h1><button type="button" className="icon-button" aria-label="Close export" onClick={onClose}><Icon name="close" size={18} /></button></div>
      <p id="export-description">Download this checkpoint, or copy it into a text file to keep your campaign.</p>
      <p className="fi-export-filename">{filename}</p>
      <label htmlFor="campaign-checkpoint-json">Campaign checkpoint JSON</label>
      <textarea id="campaign-checkpoint-json" ref={textRef} readOnly value={text} rows={8} spellCheck={false} aria-describedby="export-description export-copy-status" />
      <p id="export-copy-status" className="fi-export-status" role="status" aria-live="polite">{copyStatus || 'Import this JSON file later to resume from this checkpoint.'}</p>
      <div className="fi-export-actions"><button ref={copyRef} type="button" className="button button-primary" onClick={copy} disabled={!text}>Copy JSON</button><button type="button" className="button button-quiet" onClick={onDownload} disabled={!text}>Download JSON</button><button type="button" className="button button-quiet" onClick={onClose}>Close</button></div>
    </section>
  </div>;
}
