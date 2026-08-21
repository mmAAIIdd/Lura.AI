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
 */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}
