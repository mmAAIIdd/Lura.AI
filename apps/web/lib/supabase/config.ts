/**
 * Supabase project configuration.
 *
 * Both values are public by design: the publishable key only ever grants the
 * `anon` role, and every table it can reach is protected by row-level security.
 * They are read as literal `process.env.NEXT_PUBLIC_*` expressions so Next.js
 * can inline them into the browser bundle at build time.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const MISSING_CONFIG_MESSAGE =
  "Supabase не настроен. Задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY в apps/web/.env.local и перезапустите приложение.";

export function readSupabaseConfig(): { url: string; publishableKey: string } {
  if (!supabaseUrl || !supabasePublishableKey) throw new Error(MISSING_CONFIG_MESSAGE);
  return { url: supabaseUrl, publishableKey: supabasePublishableKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

/**
 * Origin this app is reached on. Supabase rejects an `emailRedirectTo` that is
 * not in the project's redirect allow-list, so this has to match what the
 * dashboard has under Authentication -> URL Configuration.
 *
 * The localhost default is only ever right on a development machine: baked
 * into a confirmation letter it sends the recipient to their own computer,
 * which breaks registration for everyone who is not the developer. So a
 * deployment falls back to the platform's own answer before localhost.
 *
 * A variable added without a value arrives as an empty string rather than
 * undefined, which is why this tests truthiness instead of using `??`.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  /* Vercel fills this in with the project's stable production domain, so a
     fresh import sends working letters with no dashboard step. Deliberately
     not VERCEL_URL: that one changes with every deployment and would never
     match the Supabase allow-list. Server-only, which is fine — every caller
     of this is a server action. */
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/\/+$/, "")}`;

  return "http://localhost:3001";
}
