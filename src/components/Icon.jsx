import React from 'react';

const PATHS = {
  play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
  pause: <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none" />,
  next: <><path d="M5 12h13m-5-5 5 5-5 5" /><path d="M21 5v14" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  pitch: <><path d="M3 5h18v14H3Z" /><path d="M12 5v14" /><circle cx="12" cy="12" r="2.5" /><path d="M3 9.5h3v5H3M21 9.5h-3v5h3" /></>,
  swap: <path d="M7 7h12m-4-4 4 4-4 4M17 17H5m4-4-4 4 4 4" />,
  layers: <><path d="m12 4 9 5-9 5-9-5Z" /><path d="m3 14 9 5 9-5" /></>,
  more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2ZM16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1" /></>,
  trophy: <><path d="M8 3h8v6a4 4 0 0 1-8 0ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8l-1-3H9Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
  settings: <><path d="m10 3-.6 2.3-2 .9-2.2-.7-2 3.5 1.7 1.7v2.5L3.2 15l2 3.5 2.3-.7 1.9 1L10 21h4l.6-2.2 1.9-1 2.3.7 2-3.5-1.7-1.8v-2.5L20.8 9l-2-3.5-2.2.7-2-.9L14 3Z" /><circle cx="12" cy="12" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5m0 14v2.5M2.5 12H5m14 0h2.5M5.3 5.3l1.8 1.8m9.8 9.8 1.8 1.8M5.3 18.7l1.8-1.8m9.8-9.8 1.8-1.8" /></>,
  moon: <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />,
  // The sports, in the setup wizard's sport tiles, are drawn to one size, the balls': a circle of radius 9, 19.6 across
  // with its stroke. Each other glyph's outline (its convex hull) covers about the balls' area, its box centred on 12,12.
  // A shape that can't do that within 20.6 across (21.6 for Valorant's pointed diamond) spans at least 20 instead: the
  // helmet, the hockey stick, the car, the crosshair and the diamond. scripts/sport-icons.test.mjs measures them.
  // Women's football plays with the same ball.
  football: <><circle cx="12" cy="12" r="9" /><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5ZM12 7.5V3.2M16.3 10.6l4-1.4M14.7 15.6l2.6 3.5M9.3 15.6l-2.6 3.5M7.7 10.6l-4-1.4" /></>,
  'womens-football': <><circle cx="12" cy="12" r="9" /><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5ZM12 7.5V3.2M16.3 10.6l4-1.4M14.7 15.6l2.6 3.5M9.3 15.6l-2.6 3.5M7.7 10.6l-4-1.4" /></>,
  // A stick, its blade along the ice, and a puck.
  hockey: <><path d="M8.5 2.8l5.4 13.1a3 3 0 0 0 2.8 1.9H21" /><ellipse cx="6" cy="18.6" rx="3.2" ry="1.4" /><path d="M2.8 18.6v1.3c0 .8 1.4 1.4 3.2 1.4s3.2-.6 3.2-1.4v-1.3" /></>,
  basketball: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18M5.8 5.5a10 10 0 0 1 0 13M18.2 5.5a10 10 0 0 0 0 13" /></>,
  'american-football': <><path d="M20.65 3.35c1.11 5.99-.22 11.09-3.33 13.97s-7.98 4.43-13.97 3.33c-1.11-5.99 .22-11.09 3.33-13.97s7.98-4.43 13.97-3.33Z" /><path d="m8.67 15.33 6.65-6.65M10.34 10.34l3.33 3.33M8.12 12.55l3.33 3.33M12.55 8.12l3.33 3.33" /></>,
  // A helmet side on, facing right: its shell and stripe, the ear hole and the face mask.
  'college-football': <><path d="M2.89 19.17C1.11 11.35 5.49 3.76 12.37 3.76c4.27 0 7.59 2.49 8.53 6.16l.12 2.25h-7.82l-.83 4.27-4.03 3.08c-2.01 1.07-4.27 .95-5.45-.36Z" /><path d="M13.2 12.18h8.3M12.72 15.97h7.82M21.49 12.18v3.79M17.7 12.18v3.79" /><circle cx="8.57" cy="13.01" r="1.54" /><path d="M7.15 4.95c2.49 2.01 3.91 4.27 4.27 7.23" /></>,
  baseball: <><circle cx="12" cy="12" r="9" /><path d="M6.2 5.2a10 10 0 0 1 0 13.6M17.8 5.2a10 10 0 0 0 0 13.6" /><path d="m7.6 8.4 1.7-.8M8.5 11l1.8-.3M8.5 13.2l1.8.3M7.6 15.8l1.7.8M16.4 8.4l-1.7-.8M15.5 11l-1.8-.3M15.5 13.2l-1.8.3M16.4 15.8l-1.7.8" /></>,
  // A racket, its strings crossed, and a ball. Women's tennis plays with the same racket.
  tennis: <><ellipse cx="9.14" cy="9.51" rx="5.75" ry="7.07" transform="rotate(-45 9.14 9.51)" /><path d="M13.23 13.6 20.74 21.12M5.93 9.51h6.41M9.14 6.31v6.41" /><circle cx="19.09" cy="5.09" r="2.21" /></>,
  'womens-tennis': <><ellipse cx="9.14" cy="9.51" rx="5.75" ry="7.07" transform="rotate(-45 9.14 9.51)" /><path d="M13.23 13.6 20.74 21.12M5.93 9.51h6.41M9.14 6.31v6.41" /><circle cx="19.09" cy="5.09" r="2.21" /></>,
  // Rugby union's ball: its oval, the seam along it and the laces across.
  'rugby-union': <><ellipse cx="12" cy="12" rx="11.4" ry="6.8" transform="rotate(-45 12 12)" /><path d="M5.6 18.4 18.4 5.6M9.62 12.82l1.56 1.56M11.22 11.22l1.56 1.56M12.82 9.62l1.56 1.56" /></>,
  // The H of the posts, and a ball going over the crossbar.
  'rugby-league': <><path d="M5 3v18M19 3v18M5 14h14" /><ellipse cx="12" cy="8" rx="4.1" ry="2.6" transform="rotate(-30 12 8)" /></>,
  // A car side on, nose to the right, and the ball above it.
  'rocket-league': <><path d="M2.7 17.9v-2.9l3.8-1.3 3-2.9h4.6l2.9 2.9 3.4 .8v3.4" /><path d="M9.4 17.9h4.6" /><circle cx="7" cy="18.2" r="2.4" /><circle cx="16.4" cy="18.2" r="2.4" /><circle cx="18.2" cy="6.5" r="3.1" /></>,
  // A crosshair: its ring, the four lines in to the gap at its centre, and the dot.
  'counter-strike': <><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6" /><circle cx="12" cy="12" r="0.9" /></>,
  // A crosshair inside a diamond, the shape of the bomb a team plants.
  valorant: <><path d="M12 2 22 12 12 22 2 12Z" /><path d="M12 6.95v3.15M12 13.9v3.15M6.95 12h3.15M13.9 12h3.15" /></>,
  // A battle arena's map from above: the two bases in opposite corners and the middle lane between them, the outer lanes
  // round its edges.
  'league-of-legends': <><rect x="4" y="4" width="16" height="16" rx="1.9" /><path d="M7.85 16.15 16.15 7.85" /><circle cx="6.9" cy="17.1" r="1.9" /><circle cx="17.1" cy="6.9" r="1.9" /></>,
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  upload: <path d="M12 16V5m-4.5 4.5L12 5l4.5 4.5M4 19h16" />,
  download: <path d="M12 5v11m-4.5-4.5L12 16l4.5-4.5M4 19h16" />,
};

export default function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{PATHS[name] || PATHS.globe}</svg>;
}
