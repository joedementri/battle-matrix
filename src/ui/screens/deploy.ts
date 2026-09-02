/*
 * Select Position screen — the 6×4 grid (the player's own half; see
 * `viewmodels/deploy.ts` for the reading), drag-and-drop plus keyboard
 * placement, `EXIT EDITING` / `DEPLOY`. VM → DOM; legality is enforced by
 * `placeHeroAt`, which the app calls before raising `moveHero`.
 */

import { h } from '../dom';
import { heroToken } from '../heroToken';
import type { DeployCell } from '../../sim/board';
import type { UiCallbacks } from '../intents';
import type { BoardCellVM, DeployVM } from '../viewmodels/deploy';

export interface DeployScreenState {
  readonly selectedSlot: number | null;
}

function cellEl(
  cell: BoardCellVM,
  state: DeployScreenState,
  cb: UiCallbacks,
): HTMLElement {
  const selected = state.selectedSlot !== null && cell.occupantSlot === state.selectedSlot;
  const el = h('div', {
    class: `bm-cell${cell.front ? ' bm-cell--front' : ''}${selected ? ' bm-cell--sel' : ''}`,
    role: 'gridcell',
    tabindex: '0',
    'aria-label': `column ${cell.col}, row ${cell.row}${cell.art ? `, ${cell.art.name}` : ''}`,
    'data-col': String(cell.col),
    'data-row': String(cell.row),
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain');
      if (raw === undefined || raw === '') return;
      cb.moveHero(Number(raw), { col: cell.col, row: cell.row });
    },
    onClick: () => {
      const target: DeployCell = { col: cell.col, row: cell.row };
      if (state.selectedSlot !== null) {
        cb.moveHero(state.selectedSlot, target);
        cb.selectBoardSlot(null);
      } else if (cell.occupantSlot !== null) {
        cb.selectBoardSlot(cell.occupantSlot);
      }
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (state.selectedSlot !== null) {
        cb.moveHero(state.selectedSlot, { col: cell.col, row: cell.row });
        cb.selectBoardSlot(null);
      } else if (cell.occupantSlot !== null) {
        cb.selectBoardSlot(cell.occupantSlot);
      }
    },
  });

  if (cell.art && cell.occupantSlot !== null) {
    const token = heroToken(cell.art, { size: 40 });
    token.classList.add('bm-cell__hero');
    token.setAttribute('draggable', 'true');
    const slot = cell.occupantSlot;
    token.addEventListener('dragstart', (event) => {
      (event as DragEvent).dataTransfer?.setData('text/plain', String(slot));
    });
    el.appendChild(token);
  }
  return el;
}

export function renderDeploy(
  vm: DeployVM,
  state: DeployScreenState,
  cb: UiCallbacks,
  onDeploy: () => void,
): HTMLElement {
  const board = h(
    'div',
    { class: 'bm-board', role: 'grid', 'aria-label': vm.title },
    ...vm.cells.map((cell) => cellEl(cell, state, cb)),
  );

  return h(
    'div',
    { class: 'bm-deploy' },
    h('h2', { class: 'bm-screen-title bm-deploy__title', text: vm.title }),
    board,
    h('p', {
      class: 'bm-deploy__hint',
      text: vm.legal ? '' : '!',
    }),
    h(
      'div',
      { class: 'bm-deploy__actions' },
      h('button', { class: 'bm-btn', type: 'button', onClick: () => cb.confirmPhase() }, vm.exitLabel),
      h(
        'button',
        { class: 'bm-btn bm-btn--primary', type: 'button', onClick: () => onDeploy() },
        vm.deployLabel,
      ),
    ),
  );
}
