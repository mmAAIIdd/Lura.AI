import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseConfig } from "@/lib/supabase/config";

/**
 * Завершает сессию Supabase — единственную, которая теперь есть. Прежде рядом
 * закрывалась ещё и сессия FastAPI, но сервис из продукта ушёл вместе со
 * старым рабочим пространством.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  // The cookie adapter writes straight onto the response being returned. Going
  // through next/headers would not do: those writes land on the implicit
  // response, not on this one.
  const { url, publishableKey } = readSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  await supabase.auth.signOut();

  return response;
}
