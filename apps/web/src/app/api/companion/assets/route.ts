import { resolveRequestActor } from "@/lib/supabase/request";
import { privateAsset } from "@/lib/companion/assets";
import { localCompanionMode } from "@/lib/companion/local-config";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const host = new URL(request.url).hostname;
    const localPreview =
      process.env.NODE_ENV === "development" &&
      (localCompanionMode() || process.env.COMPANION_LOCAL_PREVIEW === "true") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (!localPreview) {
      const identity = await resolveRequestActor();
      if (!identity.ok) return new Response("Unauthorized", { status: 401 });
    }
    const data = await privateAsset(
      new URL(request.url).searchParams.get("id") ?? "",
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Shayna private asset unavailable", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
