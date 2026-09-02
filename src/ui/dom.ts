/*
 * The whole DOM toolkit for the M8 UI: a ~40-line `h()` element helper and a
 * couple of mount utilities. No framework, no virtual DOM (runtime
 * `dependencies` stays `{}`). Renderers build real elements with this; view
 * models never touch it.
 */

export type Child = Node | string | number | false | null | undefined;

export interface Handlers {
  readonly onClick?: (e: MouseEvent) => void;
  readonly onKeyDown?: (e: KeyboardEvent) => void;
  readonly onInput?: (e: Event) => void;
  readonly onPointerDown?: (e: PointerEvent) => void;
  readonly onPointerUp?: (e: PointerEvent) => void;
  readonly onDragStart?: (e: DragEvent) => void;
  readonly onDragOver?: (e: DragEvent) => void;
  readonly onDrop?: (e: DragEvent) => void;
  readonly onDragEnd?: (e: DragEvent) => void;
}

export type Props = Handlers & {
  readonly class?: string;
  readonly text?: string | number;
  /** data-* / aria-* / role / tabindex / draggable / style / title / … */
  readonly [attr: string]: unknown;
};

const HANDLER_KEYS = new Set([
  'onClick',
  'onKeyDown',
  'onInput',
  'onPointerDown',
  'onPointerUp',
  'onDragStart',
  'onDragOver',
  'onDrop',
  'onDragEnd',
]);

function bind(el: Element, key: string, fn: EventListener): void {
  el.addEventListener(key.slice(2).toLowerCase(), fn);
}

function appendChild(el: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

/** Create an HTML element. `props.text` sets textContent; unknown keys become attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (HANDLER_KEYS.has(key)) {
        bind(el, key, value as EventListener);
      } else if (key === 'class') {
        el.className = String(value);
      } else if (key === 'text') {
        el.textContent = String(value);
      } else if (key === 'style') {
        el.setAttribute('style', String(value));
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) appendChild(el, child);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element (hero-token role shapes). */
export function svg(
  tag: string,
  attrs: Readonly<Record<string, string | number>> = {},
  ...children: Node[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) el.appendChild(child);
  return el;
}

/** Replace all children of `host` with `nodes`. */
export function replaceChildren(host: Element, ...nodes: Child[]): void {
  host.textContent = '';
  for (const node of nodes) appendChild(host, node);
}

/** Set a CSS custom property (used for bar fills, so no JS arithmetic touches health/xp). */
export function setVar(el: HTMLElement, name: string, value: string | number): void {
  el.style.setProperty(name, String(value));
}

/**
 * Make a non-`<button>` element operable by keyboard: focusable, ARIA role
 * button, and Enter / Space fire `onActivate` (M11 needs the shop and board
 * keyboard-operable; building it in once is cheaper than retrofitting).
 */
export function keyActivate(
  el: HTMLElement,
  onActivate: () => void,
  opts: { readonly disabled?: boolean } = {},
): void {
  el.classList.add('bm-focusable');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', opts.disabled ? '-1' : '0');
  if (opts.disabled) {
    el.setAttribute('aria-disabled', 'true');
    return;
  }
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  });
}
