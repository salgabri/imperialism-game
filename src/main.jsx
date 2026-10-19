import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// No StrictMode: the campaign runs on a large pool of setTimeout handles keyed to
// component lifetime, and StrictMode's dev-only mount/unmount/remount would boot
// the simulation twice and leave the first run's timers orphaned.
createRoot(document.getElementById('root')).render(<App />);
