import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: jsonHeaders });
  }

  const payload = await request.json().catch(() => null);
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !emailPattern.test(email)) {
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    console.error("prepare_invited_login_not_configured");
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: invited, error: inviteError } = await admin.rpc("is_email_invited", {
    candidate_email: email,
  });
  if (inviteError) {
    console.error("prepare_invited_login_invite_check_failed", inviteError.code);
  } else if (invited) {
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createError && createError.code !== "email_exists") {
      console.error("prepare_invited_login_user_create_failed", createError.code);
    }
  }

  // Returning the same shape for invited, used and unknown addresses prevents enumeration.
  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
});
