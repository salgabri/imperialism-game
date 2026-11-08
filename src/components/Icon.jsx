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
  // The sports, in the setup wizard's sport tiles. Women's football plays with the same ball.
  football: <><circle cx="12" cy="12" r="9" /><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5ZM12 7.5V3.2M16.3 10.6l4-1.4M14.7 15.6l2.6 3.5M9.3 15.6l-2.6 3.5M7.7 10.6l-4-1.4" /></>,
  'womens-football': <><circle cx="12" cy="12" r="9" /><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5ZM12 7.5V3.2M16.3 10.6l4-1.4M14.7 15.6l2.6 3.5M9.3 15.6l-2.6 3.5M7.7 10.6l-4-1.4" /></>,
  // A stick, its blade along the ice, and a puck.
  hockey: <><path d="M8.5 2.8l5.4 13.1a3 3 0 0 0 2.8 1.9H21" /><ellipse cx="6" cy="18.6" rx="3.2" ry="1.4" /><path d="M2.8 18.6v1.3c0 .8 1.4 1.4 3.2 1.4s3.2-.6 3.2-1.4v-1.3" /></>,
  basketball: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18M5.8 5.5a10 10 0 0 1 0 13M18.2 5.5a10 10 0 0 0 0 13" /></>,
  'american-football': <><path d="M19.8 4.2c1 5.4-.2 10-3 12.6s-7.2 4-12.6 3c-1-5.4.2-10 3-12.6s7.2-4 12.6-3Z" /><path d="m9 15 6-6M10.5 10.5l3 3M8.5 12.5l3 3M12.5 8.5l3 3" /></>,
  baseball: <><circle cx="12" cy="12" r="9" /><path d="M6.2 5.2a10 10 0 0 1 0 13.6M17.8 5.2a10 10 0 0 0 0 13.6" /><path d="m7.6 8.4 1.7-.8M8.5 11l1.8-.3M8.5 13.2l1.8.3M7.6 15.8l1.7.8M16.4 8.4l-1.7-.8M15.5 11l-1.8-.3M15.5 13.2l-1.8.3M16.4 15.8l-1.7.8" /></>,
  // A racket, its strings crossed, and a ball.
  tennis: <><ellipse cx="9.5" cy="9.5" rx="5.2" ry="6.4" transform="rotate(-45 9.5 9.5)" /><path d="M13.2 13.2 20 20M6.6 9.5h5.8M9.5 6.6v5.8" /><circle cx="18.5" cy="5.5" r="2" /></>,
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  upload: <path d="M12 16V5m-4.5 4.5L12 5l4.5 4.5M4 19h16" />,
  download: <path d="M12 5v11m-4.5-4.5L12 16l4.5-4.5M4 19h16" />,
};

export default function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{PATHS[name] || PATHS.globe}</svg>;
}
