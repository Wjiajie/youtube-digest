import { createExplanationHttpHandlers } from "@/lib/agent/explanation-http";

export const runtime = "nodejs";
export const POST = createExplanationHttpHandlers("extension").find;
