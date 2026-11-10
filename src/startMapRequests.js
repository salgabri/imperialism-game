// Imported first by main.jsx: the world maps are requested as soon as the page's script starts to run, so they download
// while React and the game's modules are still being evaluated, not once the app has mounted. App.boot takes these
// requests (mapRequests.js). This file and mapRequests.js import nothing else, so they run before any other module.
import { requestMapsEarly } from './mapRequests.js';

// An error here would stop every module after it: boot asks for the maps itself instead.
try { requestMapsEarly(); } catch { /* App.boot requests them */ }
