const authAppUrl = import.meta.env.VITE_AUTH_APP_URL ?? 'http://localhost:3001';

export type AuthPath = '/login' | '/register';

/**
 * Build a link into the auth app, carrying the theme the visitor is looking at.
 *
 * The auth screens run on a separate origin, so they cannot read the choice
 * stored here — without the parameter, someone who switched to light lands on a
 * black page. Read at render time rather than cached: toggling the theme
 * re-renders the layout, and every caller sits inside it.
 */
export function authUrl(path: AuthPath) {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  return `${authAppUrl}${path}?theme=${theme}`;
}
