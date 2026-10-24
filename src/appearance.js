// Light / dark theme: the player's saved choice, else the system preference. Applied as `data-theme` on <html>,
// which switches the tokens in src/styles/tokens.css. UI-only: never part of a campaign save.
import { useEffect, useState } from 'react';

export const THEME_KEY = 'fi-theme';
const listeners = new Set();

const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)') : null);

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}

export function currentTheme() {
  return savedTheme() || (systemQuery()?.matches ? 'dark' : 'light');
}

function applyTheme() {
  const theme = currentTheme();
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
  listeners.forEach(listener => listener(theme));
}

/** Saves the choice (it then wins over the system preference) and applies it. */
export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: applies for this visit only */ }
  applyTheme();
}

/** Runs once before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  applyTheme();
  systemQuery()?.addEventListener?.('change', () => { if (!savedTheme()) applyTheme(); });
}

export function useTheme() {
  const [theme, setState] = useState(currentTheme);
  useEffect(() => {
    listeners.add(setState);
    setState(currentTheme());
    return () => { listeners.delete(setState); };
  }, []);
  return theme;
}
