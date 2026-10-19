// Owner: WP-SQUAD (see PLAN.md §4). Strength profile: 10-segment bars on the 60–95 scale (C§8, DEC misc).
import React from 'react';

const SEGMENTS = Array.from({ length: 10 }, (_, i) => i);

/** `rows`: [{ key, label, value: '84.3', raw, segments: 0..10 }]. */
export default function StrengthProfile({ rows = [], scale = 'Scale 60–95' }) {
  return (
    <section className="profile" aria-labelledby="squad-profile-title">
      <h2 className="kicker squad-kicker">
        <span className="kicker__title" id="squad-profile-title">Strength profile</span>
        <span className="kicker__aside">{scale}</span>
      </h2>
      {rows.map(row => (
        <div key={row.key} className="profile__row">
          <span className="profile__label">{row.label}</span>
          <span className="profile__bar" role="meter" aria-label={row.label} aria-valuemin={60} aria-valuemax={95}
            aria-valuenow={Math.max(60, Math.min(95, Number(row.raw ?? row.value) || 60))} aria-valuetext={row.value}>
            {SEGMENTS.map(i => <i key={i} className={`profile__seg${i < row.segments ? ' is-filled' : ''}`} aria-hidden="true" />)}
          </span>
          <span className="profile__value">{row.value}</span>
        </div>
      ))}
    </section>
  );
}
