/* A variable added without a value arrives as an empty string rather than
   undefined, which is why this tests truthiness instead of using `??`. That
   distinction has already cost this project an afternoon once. */
const configured = process.env.NEXT_PUBLIC_MARKETING_URL?.trim();

const DEV_DEFAULT = "http://localhost:3000";
const DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Where the marketing site lives, or null when nothing usable is configured.
 *
 * The localhost default is only ever right on a development machine. Left
 * unguarded it ships to production and points every visitor at their own
 * computer — which is exactly what the deployed build was doing.
 */
export function marketingUrl(): string | null {
  if (configured) return configured.replace(/\/+$/, "");

  const local =
    typeof window === "undefined"
      ? process.env.NODE_ENV === "development"
      : DEV_HOSTS.includes(window.location.hostname);

  return local ? DEV_DEFAULT : null;
}
