'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'smartguard.theme';

/**
 * The theme lives on `document.documentElement`, put there by the inline boot
 * script before first paint. React subscribes to it as an external store rather
 * than mirroring it into state, so the hook can never disagree with what is
 * actually on screen and no effect has to run to catch up after hydration.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** The server cannot know the visitor's choice; the boot script corrects it. */
function getServerSnapshot(): Theme {
  return 'light';
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked; the choice still applies for this session */
    }
    listeners.forEach((notify) => notify());
  }, []);

  return [theme, toggle];
}
