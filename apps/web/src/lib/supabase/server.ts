import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicSupabaseConfig } from "../env";

export async function createServerSupabase(signal?: AbortSignal) {
  const cookieStore = await cookies();
  const { url, publishableKey } = publicSupabaseConfig();
  return createServerClient(url, publishableKey, {
    ...(signal ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
      ...init, cache: "no-store", signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }) } } : {}),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; refresh is handled by request routes.
        }
      },
    },
  });
}
