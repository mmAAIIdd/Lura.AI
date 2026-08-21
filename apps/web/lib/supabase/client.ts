import { createBrowserClient } from "@supabase/ssr";

import { readSupabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase client for code running in the browser. `createBrowserClient` is a
 * singleton internally, so calling this per component is free.
 */
export function createClient() {
  const { url, publishableKey } = readSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}
