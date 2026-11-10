import React from 'react';
import { flagUrl } from '../data/flags.js';

/**
 * A nation's flag as a v4 chip: a 4:3 rectangle on the flag-bg placeholder with a 1px ring shadow and square
 * corners (.flag-chip, README §Surfaces). Rendered alongside the team code rather than instead of it.
 * Lazy, as club crests are (TeamMark): setup's hidden role step and long off-screen lists hold dozens of chips, and an
 * eager image loads even inside display:none, so they all downloaded the moment setup was ready. The size attributes
 * and the placeholder keep the chip's box while its image loads. No decoding="async": chips remount every match (turn
 * strip, match card, masthead), and an async decode can draw a frame with the chip blank. `loading` comes before `src`:
 * React 18 sets attributes in the order they are written, and Safari (and Firefox before 131) request the image as soon
 * as src is set, so a loading="lazy" set after it does nothing there (club-logos.test.mjs).
 */
export default function Flag({ nationId, width = 20, height = Math.round(width * 0.75), className = 'flag-chip', style }) {
  const url = flagUrl(nationId);
  if (!url) return null;
  return <img loading="lazy" src={url} alt="" width={width} height={height} className={className} style={style} />;
}
