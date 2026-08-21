import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readSupabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * A fresh client per request is required: the cookies it reads are the ones
 * that arrived with that request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = readSupabaseConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Safe to ignore: the
          // middleware below refreshes and re-writes the session on every
          // request that matters.
        }
      },
    },
  });
}
