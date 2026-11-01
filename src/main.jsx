import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initTheme } from './appearance.js';
import { loadAds } from './ads.js';
import { registerServiceWorker } from './serviceWorker.js';
import './index.css';

initTheme();
loadAds();
// Installable and offline (README §Running it). The dev server builds no worker.
if (import.meta.env.PROD) registerServiceWorker().catch(() => { /* the game still runs online */ });

// No StrictMode: the campaign runs on a large pool of setTimeout handles keyed to
// component lifetime, and StrictMode's dev-only mount/unmount/remount would boot
// the simulation twice and leave the first run's timers orphaned.
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
