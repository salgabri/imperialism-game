// Owner: WP-CONQ (see PLAN.md §4). Callout card centred over the taken land (D§2.4, D§3.4; README §D).
// Rendered as a WorldMap anchor node; it fades in after the hatch (A-2, opacity only, none under reduced motion).
// Below 700px it takes the compact (D2) sizes automatically; `compact` forces them at any width.
import React from 'react';
import './conquest.css';

export default function ConquestCallout({ figure = '', label = '', sub = '', compact = false }) {
  return (
    <div className={`callout panel-callout${compact ? ' callout--compact' : ''}`}>
      <span className="callout__figure">{figure}</span>
      <span className="callout__text">
        <span className="callout__label">{label}</span>
        {sub && <span className="callout__sub">{sub}</span>}
      </span>
    </div>
  );
}
