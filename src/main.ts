import './ui/theme.css';
import { GameApp } from './ui/app';

/*
 * M8 entry point. The game loop lives in `src/ui/` (`GameApp`), not in
 * `src/sim/` (the sim has no clock). `?seed=<n>` in the URL hash pins the match;
 * otherwise the mode's launch date (2025-06-06) is the default.
 */

function pickSeed(): number {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = params.get('seed');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : 20250606;
}

const host = document.getElementById('app');
if (host instanceof HTMLElement) {
  new GameApp(host, pickSeed()).start();
}
