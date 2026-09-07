import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { safeInternalPath } from "@/lib/navigation";
import { recordProductEvent } from "@/lib/product-events";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeInternalPath(request.nextUrl.searchParams.get("next") ?? undefined);
  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await recordProductEvent(
          supabase,
          { userId: data.user.id, client: "web" },
          "auth_succeeded",
        );
        return NextResponse.redirect(new URL(nextPath, request.url));
      }
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "invalid_link");
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}
