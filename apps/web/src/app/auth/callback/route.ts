import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { safeInternalPath } from "@/lib/navigation";
import { recordProductEvent } from "@/lib/product-events";
import { createServerSupabase } from "@/lib/supabase/server";

function callbackRedirect(url: URL) {
  return NextResponse.redirect(url, {
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const nextPath = safeInternalPath(request.nextUrl.searchParams.get("next") ?? undefined);
  let failure = "invalid_link";

  if (code) {
    try {
      const supabase = await createServerSupabase();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId === null ? undefined : { flowId });
      if (!error && data.user) {
        // The exchange response comes from Auth and the SDK has persisted the
        // session. Protected destinations validate it without replaying this code.
        await recordProductEvent(
          supabase,
          { userId: data.user.id, client: "web" },
          "auth_succeeded",
        );
        return callbackRedirect(new URL(nextPath, request.url));
      }
      if (!error?.status || ![400, 401, 403, 422].includes(error.status)) {
        failure = "exchange_unavailable";
      }
    } catch {
      failure = "exchange_unavailable";
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", failure);
  loginUrl.searchParams.set("next", nextPath);
  return callbackRedirect(loginUrl);
}
