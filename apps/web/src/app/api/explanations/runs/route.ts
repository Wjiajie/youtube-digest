import { createExplanationHttpHandlers } from "@/lib/agent/explanation-http";

export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = createExplanationHttpHandlers("web").start;
