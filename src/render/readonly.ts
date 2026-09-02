/*
 * `DeepReadonly<T>` — the type the frame builder's input is stamped with, so an
 * accidental write to a sim-owned value is a COMPILE error, and `deepFreeze`
 * makes the same mistake a loud runtime throw in tests (`tests/render.spec.ts`
 * deep-freezes a frame state and renders a full frame against it).
 *
 * The renderer only ever READS sim state. These two helpers make that a
 * mechanically enforced property rather than a promise in prose.
 */

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends ReadonlyArray<infer U>
      ? readonly DeepReadonly<U>[]
      : T extends (...args: never[]) => unknown
        ? T
        : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** Recursively `Object.freeze` a plain data tree. Returns the same reference, typed deep-readonly. */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value as DeepReadonly<T>;
}
