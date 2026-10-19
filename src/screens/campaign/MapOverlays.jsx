// Owner: WP-COL (see PLAN.md §4). Map title card (top-left) and key (bottom-left) — PLAN §3.5 MapOverlays,
// DEC D21, A-11, RM §1.11. Rendered as WorldMap children; both panels are `pointer-events: none` so panning and
// hovering the map keep working underneath. Renders nothing when both models are null (conquest view).
import React from 'react';
import './campaign.css';

function TitleCard({ variant = 'campaign', kicker = '', title = '', phoneTitle = null, meta = null, sub = null, wholeMap = false }) {
  const swap = !!phoneTitle && !wholeMap;
  return (
    <div className={`map-title-card map-title-card--${variant}${swap ? ' map-title-card--swap' : ''}`}>
      {kicker ? <p className="map-title-card__kicker">{kicker}</p> : null}
      <h2 className="map-title-card__title">
        <span className="map-title-card__title-full">{title}</span>
        {swap ? <span className="map-title-card__title--phone">{phoneTitle}</span> : null}
      </h2>
      {sub ? <p className="map-title-card__sub">{sub}</p> : null}
      {meta ? <p className="map-title-card__meta">{meta}</p> : null}
    </div>
  );
}

/** Key glyphs drawn to match the map (DEC D21): ink arrow, 6px capital square, rings as the map outlines. */
function KeyGlyph({ item }) {
  if (item.kind === 'arrow') {
    return (
      <svg className="map-key__glyph map-key__arrow" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" focusable="false">
        <path d="M1 5h14" stroke="currentColor" strokeWidth="3" />
        <path d="M14 0l7 5-7 5z" fill="currentColor" />
      </svg>
    );
  }
  if (item.kind === 'capital') return <i className="map-key__glyph map-key__capital" aria-hidden="true" />;
  if (item.kind === 'dash') {
    return (
      <svg className="map-key__glyph map-key__dash" width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="20" height="12" fill="none" stroke={item.color || 'currentColor'} strokeWidth="2" strokeDasharray="5 3" />
      </svg>
    );
  }
  if (item.kind === 'veil') return <i className="map-key__glyph map-key__swatch map-key__veil" aria-hidden="true" />;
  const style = {};
  if (item.color) style.background = item.color;
  if (item.ring) style.boxShadow = `0 0 0 ${item.ring.width}px ${item.ring.color}`;
  return <i className={`map-key__glyph map-key__swatch${item.color ? '' : ' map-key__swatch--outline'}`} style={style} aria-hidden="true" />;
}

function MapKey({ variant = 'political', heading = 'Key', items = [] }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <div className={`map-key map-key--${variant}`} role="group" aria-label={heading && heading !== 'Key' ? `Map key: ${heading}` : 'Map key'}>
      {heading ? <p className="map-key__heading" aria-hidden="true">{heading}</p> : null}
      <ul className="map-key__items">
        {list.map(item => (
          <li key={item.key} className={`map-key__item map-key__item--${item.kind}`}>
            <KeyGlyph item={item} />
            <span className="map-key__label">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MapOverlays({ titleCard = null, mapKey = null }) {
  if (!titleCard && !mapKey) return null;
  return (
    <>
      {titleCard ? <TitleCard {...titleCard} /> : null}
      {mapKey ? <MapKey {...mapKey} /> : null}
    </>
  );
}
