import React from 'react';
import Icon from './Icon.jsx';
import { setTheme, useTheme } from '../appearance.js';

/** Light / dark switch: in the masthead and the setup header, so it is reachable at every width and on every screen. */
export default function ThemeToggle({ className = '' }) {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;
  return (
    <button type="button" className={`icon-button theme-toggle${className ? ` ${className}` : ''}`} aria-label={label} title={label}
      onClick={() => setTheme(next)}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
