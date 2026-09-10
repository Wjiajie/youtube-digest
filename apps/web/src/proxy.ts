import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { publicSupabaseConfig } from "@/lib/env";

export async function proxy(request: NextRequest) {
  // This exact route contains public fiction only. Do not couple browsing it
  // to Auth availability or refresh a visitor's unrelated expired session.
  if (request.nextUrl.pathname === "/preview") return NextResponse.next();
  let response = NextResponse.next({ request });
  const { url, publishableKey } = publicSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validate the access token and rotate an expired session when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // These exact routes independently verify Auth. Next's proxy body
    // finalization waits for EOF, hiding a stalled upload from its read deadline.
    "/((?!api/(?:resources/runs|planning/runs|clarification/turns|v1/learning-notes)/?$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
