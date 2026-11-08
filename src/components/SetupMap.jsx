// Owner: WP-SETUP (see PLAN.md §4). Step 1's map card: the theatre's opening board, each starting territory in its
// team's kick-off pastel over the land nobody holds or, in Flags mode, under its team's flag (a nation) or crest (a
// club), one banner per region as the campaign's Flags mode draws it. A map like the campaign's (useMapViewport): scroll
// or pinch to zoom, drag to pan, double-click to reset, with the −/+/reset group above a Political / Flags switch. Phones
// pinch and get no zoom buttons, as on the campaign map. The territories carry no ids, roles or labels: the step's
// title, description and stats say the same in text, so the drawing itself stays out of the accessibility tree.
import React, { memo, useId, useMemo, useRef } from 'react';
import { useMapViewport } from '../hooks/useMapViewport.js';
import FlagArt from './FlagArt.jsx';
import Icon from './Icon.jsx';
import { themedPaint } from '../theme.js';

/** The camera opens on the preview's frame, its viewBox (the board plus a 4% margin, setupModel), filling the card. */
const FRAME_FIT = Object.freeze({ l: 0, r: 1, t: 0, b: 1, pad: 1 });
const ZOOM_STEP = 1.6;
const stop = event => event.stopPropagation();

/** "x y w h" → { x, y, w, h }, or null. */
export function frameOf(viewBox) {
  const [x, y, w, h] = String(viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * A card with a board: mounted only with a preview, so the camera measures a real canvas from its first render. Land
 * and banners are built once per board and Flags choice; a camera move only changes the viewBox (and, a quarter octave
 * at a time, which artwork the banners draw: FlagArt's `scale`).
 */
function SetupMapCard({ preview, caption, kind, flags, flagsOn, onMode, clubs, resetKey }) {
  const svgRef = useRef(null);
  const clipBase = `setup-map-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const frame = useMemo(() => frameOf(preview.viewBox), [preview.viewBox]);
  const vp = useMapViewport(svgRef, resetKey, frame ? { ...frame, layout: FRAME_FIT } : null);
  const k = vp.view.w / (vp.size.width || 960);
  // Device px per map unit, rounded up to a quarter octave, as WorldMap hands it to FlagArt.
  const flagScale = 2 ** (Math.ceil(Math.log2((typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) / k) * 4) / 4);
  const shown = flagsOn ? flags : null;

  const land = useMemo(() => {
    let clip = 0;
    const parts = [];
    const sections = preview.sections.map(section => {
      const banners = shown?.flagParts.get(section.id);
      for (const part of banners || []) {
        const id = `${clipBase}-${clip++}`;
        parts.push(<React.Fragment key={id}>
          <clipPath id={id}><path d={part.d} /></clipPath>
          <use data-setup-flag={part.id} href={`#fi-flag-${part.id}`} clipPath={`url(#${id})`} />
        </React.Fragment>);
      }
      // Under a banner the land is see-through, its border still drawn; a club with no crest shows its colour.
      const fill = banners?.length ? 'transparent' : shown?.fills.get(section.id) ?? section.fill;
      return <path key={section.id} d={section.d} fill={fill} style={{ fill: themedPaint(fill) }} />;
    });
    return (
      <>
        <g className="setup-map__backdrop">
          {preview.backdrop.map((shape, index) => <path key={`${shape.id}-${index}`} d={shape.d} />)}
        </g>
        {parts.length ? <g className="setup-map__flags" pointerEvents="none">{parts}</g> : null}
        <g className="setup-map__sections">{sections}</g>
      </>
    );
  }, [preview, shown, clipBase]);

  return (
    // The card pans from anywhere on it but its buttons, as the campaign map does (WorldMap).
    <figure className="setup-map" data-state="ready" data-kind={kind} data-map-mode={flagsOn ? 'flags' : 'political'}
      data-panning={vp.panning || undefined} title={caption}
      onPointerDown={event => { if (!event.target.closest?.('button')) vp.handlers.onMouseDown(event); }}
      onPointerMove={vp.handlers.onMouseMove} onPointerUp={vp.handlers.onMouseUp} onPointerCancel={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}>
      <svg ref={svgRef} className="setup-map__chart" viewBox={`${vp.view.x} ${vp.view.y} ${vp.view.w} ${vp.view.h}`}
        preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">
        {shown?.flagPatterns.length ? <defs>{shown.flagPatterns.map(f => <FlagArt key={f.id} flag={f} scale={flagScale} />)}</defs> : null}
        {land}
      </svg>
      <div className="setup-map__zoom" role="group" aria-label="Zoom" onDoubleClick={stop}>
        <button type="button" className="setup-map__zoom-btn" title="Zoom in" aria-label="Zoom in"
          onClick={() => vp.zoomBy(ZOOM_STEP)}><Icon name="plus" size={16} /></button>
        <button type="button" className="setup-map__zoom-btn" title="Zoom out" aria-label="Zoom out"
          onClick={() => vp.zoomBy(1 / ZOOM_STEP)}><Icon name="minus" size={16} /></button>
        <button type="button" className="setup-map__zoom-btn setup-map__reset" title="Reset view" aria-label="Reset view"
          onClick={() => vp.reset()}>{vp.zoom.toFixed(1)}×</button>
      </div>
      <div className="setup-map__modes" role="group" aria-label="Map display" onDoubleClick={stop}>
        <button type="button" className="setup-map__mode" aria-pressed={!flagsOn} title="Each team in its colour"
          onClick={() => { if (flagsOn) onMode?.('political'); }}>Political</button>
        <button type="button" className="setup-map__mode" aria-pressed={flagsOn}
          title={clubs ? 'Each club’s crest on its land' : 'Each nation’s flag on its land'}
          onClick={() => { if (!flagsOn) onMode?.('flags'); }}>{clubs ? 'Crests' : 'Flags'}</button>
      </div>
    </figure>
  );
}

/**
 * `preview` is setupModel's theatreMapPreview or countryMapPreview ({ viewBox, sections, backdrop }); while a country
 * loads (`loading`) the card holds its place. `mode` is 'flags' or anything else (Political); `flags` is App's
 * setupMapFlags() for this board ({ flagParts, flagPatterns, fills }), drawn in Flags mode. `clubs` names the switch
 * Crests. A new `resetKey` (another theatre or country) or another frame reframes the camera; a new sport or season
 * on the same frame keeps it. Memoised: App re-renders setup on every state change.
 */
function SetupMap({ preview, caption, loading = false, kind, flags = null, mode = 'political', onMode, clubs = false, resetKey = null }) {
  if (!preview) {
    return loading ? (
      <figure className="setup-map" data-state="loading" data-kind={kind} title={caption}>
        <div className="setup-map__chart setup-map__placeholder" />
      </figure>
    ) : null;
  }
  return <SetupMapCard preview={preview} caption={caption} kind={kind} flags={flags} flagsOn={mode === 'flags'}
    onMode={onMode} clubs={clubs} resetKey={resetKey} />;
}

export default memo(SetupMap);
