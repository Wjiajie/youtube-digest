import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { publicSupabaseConfig } from "@/lib/env";
import { localCompanionMode, loopbackHost } from "@/lib/companion/local-config";

export async function proxy(request: NextRequest) {
  if (localCompanionMode()) return loopbackHost(request.headers.get("host"))
    ? NextResponse.next() : NextResponse.json({ ok:false,code:"local_only" },{status:403});
  // These exact routes contain public fiction/artwork only. Do not couple them
  // to Auth availability or refresh a visitor's unrelated expired session.
  if (
    request.nextUrl.pathname === "/preview" ||
    request.nextUrl.pathname === "/scenes/wuxia" ||
    request.nextUrl.pathname === "/scenes/avatar" ||
    request.nextUrl.pathname === "/vrm/avatar-sample.vrm" ||
    request.nextUrl.pathname === "/audio/avatar-p0.wav"
  ) {
    return NextResponse.next();
  }
  // The internal companion review reads only local, hash-pinned assets and must
  // remain usable in an offline development checkout without Auth settings.
  if (process.env.NODE_ENV === "development" && (/^\/design\/companion(?:\/|$)/.test(request.nextUrl.pathname) || request.nextUrl.pathname === "/api/companion/assets")) {
    return NextResponse.next();
  }
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
    "/((?!api/(?:companion|resources/runs|planning/runs|clarification/turns|(?:v1/)?translations/runs(?:/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?|(?:v1/)?explanations/runs(?:/find|/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?|v1/learning-notes|v1/learning-positions)/?$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
