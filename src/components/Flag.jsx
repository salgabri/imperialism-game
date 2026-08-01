import React from 'react';
import { C } from '../theme.js';
import { flagUrl } from '../data/flags.js';

/**
 * A nation's flag at chip size. Rendered alongside the three-letter code rather
 * than instead of it — at 20px a lot of flags are hard to tell apart.
 */
export default function Flag({ nationId, width = 20, style }) {
  const url = flagUrl(nationId);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      width={width}
      height={Math.round(width * 0.75)}
      style={{
        display: 'block',
        flex: 'none',
        objectFit: 'cover',
        border: `1px solid ${C.ink}`,
        borderRadius: 1,
        ...style,
      }}
    />
  );
}
