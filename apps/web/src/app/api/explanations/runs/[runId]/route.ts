import { createExplanationHttpHandlers } from "@/lib/agent/explanation-http";

export const runtime = "nodejs";
const handlers = createExplanationHttpHandlers("web");
export const GET = handlers.read;
export const POST = handlers.cancel;
