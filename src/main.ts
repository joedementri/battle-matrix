import './ui/theme.css';
import * as S from './data/strings';
import { GameApp } from './ui/app';

/*
 * M8 entry point. The game loop lives in `src/ui/` (`GameApp`), not in
 * `src/sim/` (the sim has no clock).
 *
 * M11 — seed entry + shareable seed. `#seed=<n>` in the URL hash pins the match
 * (default: the mode's launch date, 2025-06-06). A persistent top-right widget
 * shows the current seed, lets you enter and PLAY another one, and copies a
 * shareable link. The hash is normalised on load so the URL is always
 * copy-pasteable even for the default seed.
 */

const DEFAULT_SEED = 20250606;

function readSeedParam(): number {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = params.get('seed');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : DEFAULT_SEED;
}

/** Write `#seed=<n>` into the hash without triggering a navigation/reload. */
function writeSeedParam(seed: number): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.set('seed', String(seed >>> 0));
  const next = `#${params.toString()}`;
  if (window.location.hash !== next) {
    history.replaceState(null, '', next);
  }
}

function shareableUrl(seed: number): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.set('seed', String(seed >>> 0));
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`;
}

// --- Colour-blind assist mode (M11 §3e) ----------------------------------
// An opt-in override layer (`:root[data-cb="1"]` in theme.css) that never
// touches a canonical colour token — it reinforces role / protocol identity
// with shape, pattern and text. Preference persisted per browser.
const CB_KEY = 'bm.cbAssist';

function readCbPref(): boolean {
  try {
    return window.localStorage.getItem(CB_KEY) === '1';
  } catch {
    return false;
  }
}

function applyCb(on: boolean): void {
  if (on) document.documentElement.dataset.cb = '1';
  else delete document.documentElement.dataset.cb;
  try {
    window.localStorage.setItem(CB_KEY, on ? '1' : '0');
  } catch {
    /* private mode / storage disabled — the mode still applies for this session */
  }
}

function cbToggle(): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'bm-cb-toggle';
  wrap.title = S.CB_MODE_LABEL;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = readCbPref();
  box.setAttribute('aria-label', S.CB_MODE_LABEL);
  box.addEventListener('change', () => applyCb(box.checked));
  const txt = document.createElement('span');
  txt.textContent = S.CB_MODE_LABEL;
  wrap.append(box, txt);
  return wrap;
}

/** The persistent seed widget — mounted once, outside `#app`, survives every rebuild. */
function mountSeedBar(currentSeed: number): void {
  const bar = document.createElement('div');
  bar.id = 'bm-seedbar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', S.SEED_INPUT_LABEL);

  const label = document.createElement('span');
  label.className = 'bm-seedbar__label';
  label.textContent = S.SEED_LABEL;

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'bm-seedbar__input';
  input.value = String(currentSeed);
  input.setAttribute('aria-label', S.SEED_INPUT_LABEL);
  input.size = 10;

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'bm-btn bm-seedbar__btn';
  play.textContent = S.SEED_PLAY;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'bm-btn bm-seedbar__btn';
  copy.textContent = S.SEED_COPY_LINK;

  const status = document.createElement('span');
  status.className = 'bm-seedbar__status';
  status.setAttribute('aria-live', 'polite');
  status.title = S.SEED_HINT;

  const parsed = (): number | null => {
    const n = Number(input.value.trim());
    return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n >>> 0 : null;
  };

  const doPlay = (): void => {
    const seed = parsed();
    if (seed === null || seed === currentSeed) return;
    // A fresh seed is a fresh match: set the hash and reload the whole app.
    window.location.hash = `#seed=${seed}`;
    window.location.reload();
  };

  play.addEventListener('click', doPlay);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doPlay();
  });

  copy.addEventListener('click', () => {
    const url = shareableUrl(currentSeed);
    const done = (msg: string): void => {
      status.textContent = msg;
      window.setTimeout(() => {
        status.textContent = '';
      }, 2500);
    };
    if (navigator.clipboard !== undefined) {
      navigator.clipboard.writeText(url).then(
        () => done(S.SEED_LINK_COPIED),
        () => done(S.SEED_COPY_FAILED),
      );
    } else {
      done(S.SEED_COPY_FAILED);
    }
  });

  bar.append(label, input, play, copy, cbToggle(), status);
  document.body.appendChild(bar);
}

const seed = readSeedParam();
writeSeedParam(seed); // keep the URL shareable even on the default seed
applyCb(readCbPref()); // restore the colour-blind-assist preference before first paint

const host = document.getElementById('app');
if (host instanceof HTMLElement) {
  mountSeedBar(seed);
  new GameApp(host, seed).start();
}
