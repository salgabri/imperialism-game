// Owner: WP-SETUP (see PLAN.md §4). Step 1's map card: the theatre's opening board, each starting territory in its
// team's kick-off pastel over the land nobody holds or, in Flags mode, under its team's flag (a nation) or crest (a
// club; its monogram without one), one banner per region as the campaign's Flags mode draws it. A country map's
// territories are its lands (a club's starting sections as one piece), so each outline is a border between clubs or a
// coast, never a line between a club's own sections. A map like the
// campaign's (useMapViewport): scroll or pinch to zoom, drag to pan, double-click to reset, with the −/+/reset group
// above a Political / Flags switch. Phones pinch and get no zoom buttons, as on the campaign map. The territories carry
// no roles or labels: the step's title, description and stats say the same in text, so the drawing itself stays out of
// the accessibility tree. A click (never a pan) on a team's land previews that team (`onTeam`), outlined on the map,
// and the preview (`children`, the wizard's card) floats over the map away from the click, so the land stays in view;
// a click on land nobody holds, or on the sea, closes it. A keyboard reaches the same teams on step 3's wall.
import React, { memo, useId, useMemo, useRef, useState } from 'react';
import { useMapViewport } from '../hooks/useMapViewport.js';
import FlagArt from './FlagArt.jsx';
import Icon from './Icon.jsx';
import { themedPaint } from '../theme.js';

/** The camera opens on the preview's frame, its viewBox (the board plus a 4% margin, setupModel), filling the card. */
const FRAME_FIT = Object.freeze({ l: 0, r: 1, t: 0, b: 1, pad: 1 });
const ZOOM_STEP = 1.6;
const NO_LAND = Object.freeze([]);
/**
 * Where a click puts the preview: away from it, both ways. setup.css reads the side across a map wide enough to seat
 * the card beside the controls (`x`), and the end along a narrower one, where the card spans the map (`y`). The card's
 * room ends at the controls (`zoom`, `modes`: their client rects; a hidden group measures 0×0), so each axis splits
 * there, halfway between the card's two places, rather than at the map's middle: on a short phone map the card's
 * bottom place sits well above the middle.
 */
const OPEN_AT = Object.freeze({ x: 'left', y: 'top' });
export function peekPlace(chart, clientX, clientY, { zoom = null, modes = null } = {}) {
  if (!(chart?.width > 0 && chart.height > 0)) return OPEN_AT;
  const xEnd = zoom?.width > 0 ? zoom.left : chart.left + chart.width;
  const yEnd = modes?.height > 0 ? modes.top : chart.top + chart.height;
  return { x: clientX < (chart.left + xEnd) / 2 ? 'right' : 'left', y: clientY < (chart.top + yEnd) / 2 ? 'bottom' : 'top' };
}
const stop = event => event.stopPropagation();

/** "x y w h" → { x, y, w, h }, or null. */
export function frameOf(viewBox) {
  const [x, y, w, h] = String(viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * A card with a board: mounted only with a preview, so the camera measures a real canvas from its first render. Land
 * and banners are built once per board and Flags choice; a camera move only changes the viewBox (and, a quarter octave
 * at a time, which artwork the banners draw: FlagArt's `scale`). The previewed team's outline is its own layer, so a
 * click redraws only that.
 */
function SetupMapCard({ preview, caption, kind, flags, flagsOn, onMode, clubs, resetKey, peekId, onTeam, children }) {
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const modesRef = useRef(null);
  const [place, setPlace] = useState(OPEN_AT);
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
      // Under a banner the land is see-through, its border still drawn; club land no banner covers shows its colour.
      // See-through land still takes the click that previews its team.
      const fill = banners?.length ? 'transparent' : shown?.fills.get(section.id) ?? section.fill;
      return <path key={section.id} d={section.d} fill={fill} style={{ fill: themedPaint(fill) }} data-team={section.owner ?? undefined} />;
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

  // The previewed team's land, outlined over every banner: a halo under an ink line, clear on any flag in either theme.
  const peekLand = useMemo(() => (peekId == null ? NO_LAND : preview.sections.filter(section => section.owner === peekId)),
    [preview, peekId]);
  const outline = peekLand.length ? (
    <g className="setup-map__peek" data-peek={peekId} pointerEvents="none" fill="none">
      <g className="setup-map__peek-halo">{peekLand.map(section => <path key={section.id} d={section.d} />)}</g>
      <g className="setup-map__peek-line">{peekLand.map(section => <path key={section.id} d={section.d} />)}</g>
    </g>
  ) : null;

  return (
    // The card pans from anywhere on it but its buttons and the preview, as the campaign map does (WorldMap).
    <figure className="setup-map" data-state="ready" data-kind={kind} data-map-mode={flagsOn ? 'flags' : 'political'}
      data-panning={vp.panning || undefined} data-peekable={onTeam ? '' : undefined} title={caption}
      onPointerDown={event => { if (!event.target.closest?.('button, .setup-map__overlay')) vp.handlers.onMouseDown(event); }}
      onPointerMove={vp.handlers.onMouseMove} onPointerUp={vp.handlers.onMouseUp} onPointerCancel={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}>
      <svg ref={svgRef} className="setup-map__chart" viewBox={`${vp.view.x} ${vp.view.y} ${vp.view.w} ${vp.view.h}`}
        preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true"
        // A click on held land previews its team, away from the click; anywhere else on the chart closes the preview.
        // A pan's release is no click.
        onClick={onTeam ? event => {
          if (vp.didPan()) return;
          const team = event.target.closest?.('[data-team]')?.getAttribute('data-team') ?? null;
          if (team != null) {
            const next = peekPlace(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY,
              { zoom: zoomRef.current?.getBoundingClientRect(), modes: modesRef.current?.getBoundingClientRect() });
            setPlace(current => (current.x === next.x && current.y === next.y ? current : next));
          }
          onTeam(team);
        } : undefined}>
        {shown?.flagPatterns.length ? <defs>{shown.flagPatterns.map(f => <FlagArt key={f.id} flag={f} scale={flagScale} />)}</defs> : null}
        {land}
        {outline}
      </svg>
      {/* The preview's own box: its clicks, drags and double-clicks stay its own; its text needs no map caption. */}
      {children ? <div className="setup-map__overlay" data-x={place.x} data-y={place.y} title="" onDoubleClick={stop}>{children}</div> : null}
      <div className="setup-map__zoom" role="group" aria-label="Zoom" onDoubleClick={stop} ref={zoomRef}>
        <button type="button" className="setup-map__zoom-btn" title="Zoom in" aria-label="Zoom in"
          onClick={() => vp.zoomBy(ZOOM_STEP)}><Icon name="plus" size={16} /></button>
        <button type="button" className="setup-map__zoom-btn" title="Zoom out" aria-label="Zoom out"
          onClick={() => vp.zoomBy(1 / ZOOM_STEP)}><Icon name="minus" size={16} /></button>
        <button type="button" className="setup-map__zoom-btn setup-map__reset" title="Reset view" aria-label="Reset view"
          onClick={() => vp.reset()}>{vp.zoom.toFixed(1)}×</button>
      </div>
      <div className="setup-map__modes" role="group" aria-label="Map display" onDoubleClick={stop} ref={modesRef}>
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
 * on the same frame keeps it. `onTeam(teamId | null)` hears a click on a section's `owner` (null: land nobody holds, or
 * the sea); `peekId` is the team previewed, outlined, and `children` its preview, drawn over the map. Memoised: App
 * re-renders setup on every state change, so the wizard hands it a stable `onTeam` and a memoised preview.
 */
function SetupMap({ preview, caption, loading = false, kind, flags = null, mode = 'political', onMode, clubs = false, resetKey = null,
  peekId = null, onTeam, children = null }) {
  if (!preview) {
    return loading ? (
      <figure className="setup-map" data-state="loading" data-kind={kind} title={caption}>
        <div className="setup-map__chart setup-map__placeholder" />
      </figure>
    ) : null;
  }
  return <SetupMapCard preview={preview} caption={caption} kind={kind} flags={flags} flagsOn={mode === 'flags'}
    onMode={onMode} clubs={clubs} resetKey={resetKey} peekId={peekId} onTeam={onTeam}>{children}</SetupMapCard>;
}

export default memo(SetupMap);
