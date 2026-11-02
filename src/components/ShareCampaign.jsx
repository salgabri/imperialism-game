// Sharing a campaign (README §Sharing a campaign). "Copy challenge link" copies a link that opens setup filled in
// with a campaign's setup and seed: on setup's last step and on the final results, where "Share image" also hands over
// a picture of the final map. Where the clipboard is unavailable the link shows, selected, for the browser's own Copy.
import React, { useEffect, useRef, useState } from 'react';
import './share.css';

const COPIED = 'Link copied. Whoever opens it gets this setup and seed, ready to launch.';
const NO_CLIPBOARD = 'Copy is unavailable here. The link is selected: use your usual Copy command.';

/**
 * `link` is the challenge link, `note` an optional line above the buttons. `onShareImage` (the results only) makes,
 * then shares or downloads the image, resolving to the status line to show.
 */
export default function ShareCampaign({ link = '', note = '', onShareImage }) {
  // The last action's outcome. A changed link (setup changed) is a new link: an earlier copy no longer speaks for it.
  const [outcome, setOutcome] = useState({ link: '', status: '', manual: false });
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  const current = outcome.link === link ? outcome : { link, status: '', manual: false };
  useEffect(() => {
    if (current.manual) { field.current?.focus(); field.current?.select(); }
  }, [current.manual]);

  async function copy() {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(link);
      setOutcome({ link, status: COPIED, manual: false });
    } catch {
      setOutcome({ link, status: NO_CLIPBOARD, manual: true });
    }
  }

  async function shareImage() {
    setBusy(true);
    setOutcome({ link, status: 'Making the image…', manual: false });
    let status;
    try { status = await onShareImage(); } catch { status = 'The image could not be made.'; }
    setBusy(false);
    setOutcome({ link, status: status || '', manual: false });
  }

  return (
    <div className="share-campaign">
      {note ? <p className="share-campaign__note">{note}</p> : null}
      <div className="share-campaign__actions">
        <button type="button" className="btn-secondary" onClick={copy} disabled={!link}>Copy challenge link</button>
        {onShareImage ? (
          <button type="button" className="btn-secondary" onClick={shareImage} disabled={busy} aria-busy={busy || undefined}>Share image</button>
        ) : null}
      </div>
      {current.manual ? (
        <input ref={field} className="share-campaign__field" type="text" readOnly value={link} aria-label="Challenge link"
          spellCheck={false} onFocus={event => event.target.select()}
          // Setup's last step holds this field inside its form: Enter here must not submit it and launch the campaign.
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
      ) : null}
      <p className="share-campaign__status" role="status" aria-live="polite">{current.status}</p>
    </div>
  );
}
