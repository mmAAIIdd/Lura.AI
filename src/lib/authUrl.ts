export type AuthPath = '/login' | '/register';

/* An unset variable and a blank one have to mean the same thing here, which is
   why this cannot use `??`. Vercel hands over an empty string for a variable
   added without a value, `??` passes it straight through, and every auth link
   becomes a relative path back onto this site — so `/login` rendered the
   redirect below, which navigated to `/login`, which reloaded the page, for as
   long as the visitor was willing to watch. */
const configured = import.meta.env.VITE_AUTH_APP_URL?.trim() ?? '';

/* The auth app answers on :3001 while the marketing site runs on :3000, so this
   is right on a development machine and wrong everywhere else — in production it
   points a visitor at their own computer. Hence the host check rather than
   `import.meta.env.DEV`, which would also drop the default under `npm run
   preview`. */
const DEV_FALLBACK = 'http://localhost:3001';
const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The auth app's base URL, or null when nothing usable is configured.
 *
 * Resolving the candidate against the current document is what catches the two
 * settings that cannot work: a blank value, and one naming this site. Both come
 * back on our own origin, and sending a visitor there is a reload loop rather
 * than a redirect.
 */
export function authAppBase(): string | null {
  const candidate = configured || (DEV_HOSTS.includes(window.location.hostname) ? DEV_FALLBACK : '');
  if (!candidate) return null;

  try {
    const url = new URL(candidate, window.location.href);
    if (url.origin === window.location.origin) return null;
    /* Trailing slashes would double up against the path appended below. */
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Build a link into the auth app.
 *
 * With no auth app configured this returns the in-app route, which explains the
 * situation instead of bouncing the visitor at a page that cannot answer.
 */
export function authUrl(path: AuthPath) {
  const base = authAppBase();
  if (!base) return path;

  return `${base}${path}`;
}
