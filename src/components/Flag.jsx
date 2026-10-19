import React from 'react';
import { flagUrl } from '../data/flags.js';

/**
 * A nation's flag as a v4 chip: a 4:3 rectangle on the flag-bg placeholder with a 1px ring shadow and square
 * corners (.flag-chip, README §Surfaces). Rendered alongside the team code rather than instead of it.
 */
export default function Flag({ nationId, width = 20, height = Math.round(width * 0.75), className = 'flag-chip', style }) {
  const url = flagUrl(nationId);
  if (!url) return null;
  return <img src={url} alt="" width={width} height={height} className={className} style={style} />;
}
