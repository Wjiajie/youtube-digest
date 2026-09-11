import { createTranslationHttpHandlers } from "@/lib/agent/translation-http";

export const runtime = "nodejs";
export const maxDuration = 90;
const handlers = createTranslationHttpHandlers("extension");
export const GET = handlers.find;
export const POST = handlers.start;
