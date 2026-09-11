import { createTranslationHttpHandlers } from "@/lib/agent/translation-http";

export const runtime = "nodejs";
const handlers = createTranslationHttpHandlers("extension");
export const GET = handlers.read;
export const POST = handlers.cancel;
