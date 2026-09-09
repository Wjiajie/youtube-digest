import { NextResponse } from "next/server";

import type { ApplicationResult } from "@blueprint/domain";

export function resultResponse<T>(result: ApplicationResult<T>) {
  // Application results belong to the requesting identity, including errors.
  const headers = { "Cache-Control": "private, no-store" };
  if (result.ok) return NextResponse.json(result.value, { headers });
  const status = {
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    invalid: 422,
    version_conflict: 409,
    unavailable: 503,
  }[result.code];
  return NextResponse.json({ code: result.code, ...(result.message ? { message: result.message } : {}) }, { status, headers });
}
