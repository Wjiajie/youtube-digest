import { createExplanationHttpHandlers } from "@/lib/agent/explanation-http";

export const runtime = "nodejs";
const handlers = createExplanationHttpHandlers("extension");
export const GET = handlers.read;
export const POST = handlers.cancel;
