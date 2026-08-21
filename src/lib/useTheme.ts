import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'lura-theme';

/** Read what the boot script in index.html already stamped, so the first render
 *  agrees with what is on screen instead of briefly disagreeing with it. */
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Follow the OS only while the visitor has not made a choice of their own.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    function onChange(event: MediaQueryListEvent) {
      if (localStorage.getItem(STORAGE_KEY)) return;
      setTheme(event.matches ? 'light' : 'dark');
    }
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode can refuse storage; the theme still applies for this visit.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
