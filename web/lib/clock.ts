'use client';

import { useSyncExternalStore } from 'react';

/**
 * A shared ticking clock.
 *
 * Reading `Date.now()` during render makes a component impure — the same props
 * would produce different output. One module-level ticker feeds every consumer
 * through `useSyncExternalStore`, which keeps the countdowns live without an
 * effect writing state on mount.
 *
 * The server snapshot is 0. Components treat that as "time not yet known" and
 * render the static parts, so the server and the first client render agree.
 */

const TICK_MS = 15_000;

let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      notify();
    }, TICK_MS);
    // The first subscriber arrives after the initial render, so tell React the
    // snapshot changed from 0 to the real time.
    queueMicrotask(notify);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      current = 0;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;

/** Milliseconds since the epoch, or 0 before the clock has started. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
