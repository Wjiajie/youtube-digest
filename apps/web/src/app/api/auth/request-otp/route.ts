import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { publicSupabaseConfig } from "@/lib/env";
import { safeInternalPath } from "@/lib/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = z.object({
    email: z.email().max(320),
    next: z.string().max(2048).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 422 });
  const email = parsed.data.email.trim().toLowerCase();
  const { url, publishableKey } = publicSupabaseConfig();
  const publicClient = createClient(url, publishableKey, { auth: { persistSession: false } });
  // The Edge Function creates an Auth user only when the private invite exists.
  // Membership stays private. Transport failures are not successful preparation.
  const { error: preparationError } = await publicClient.functions.invoke("prepare-invited-login", { body: { email } });
  if (preparationError) {
    return NextResponse.json({ ok: false, code: "temporarily_unavailable" }, { status: 503 });
  }

  const callbackUrl = new URL("/auth/callback", request.url);
  callbackUrl.searchParams.set("next", safeInternalPath(parsed.data.next));
  const auth = await createServerSupabase();
  const { error } = await auth.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: callbackUrl.toString(),
    },
  });
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }
  if (error && error.code !== "otp_disabled" && error.code !== "user_not_found" && error.code !== "signup_disabled") {
    return NextResponse.json({ ok: false, code: "temporarily_unavailable" }, { status: 503 });
  }
  // Accepted is deliberately not a delivery receipt, including unknown emails.
  return NextResponse.json({ ok: true, status: "accepted" });
}
