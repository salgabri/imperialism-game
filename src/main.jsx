import './startMapRequests.js'; // first: the world maps download while the rest of the script runs (App.boot)
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initTheme } from './appearance.js';
import { loadAds } from './ads.js';
import { registerAfterBoot } from './serviceWorker.js';
import './index.css';

initTheme();
loadAds();
// Installable and offline (README §Running it). The dev server builds no worker. A first visit registers it once boot
// is over, so its downloads leave boot's alone (serviceWorker.js).
if (import.meta.env.PROD) registerAfterBoot().catch(() => { /* the game still runs online */ });

// No StrictMode: the campaign runs on a large pool of setTimeout handles keyed to
// component lifetime, and StrictMode's dev-only mount/unmount/remount would boot
// the simulation twice and leave the first run's timers orphaned.
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
