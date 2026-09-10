import { ToolLoopAgent, Output, isStepCount, NoObjectGeneratedError, NoOutputGeneratedError, wrapLanguageModel,
  type LanguageModel, type LanguageModelUsage } from "ai";
import type { z } from "zod";

export type SkillUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

function summarizeUsage(usage: LanguageModelUsage): SkillUsage {
  return { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, totalTokens: usage.totalTokens ?? null };
}

/** A provider may ignore abort: stop awaiting it and never accept its eventual result. */
function awaitWithAbort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Generation stopped")); return; }
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("Generation stopped")); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(work).then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Shared inference policy. Stage modules still own Skill selection and domain validation. */
export async function generateStructuredSkill<T>(input: {
  model: Exclude<LanguageModel, string>; instructions: string; prompt: string;
  schema: z.ZodType<T>; maxOutputTokens: number; signal: AbortSignal;
}) {
  const { signal } = input;
  let providerMayHaveRun = false;
  let usage: SkillUsage | null = null;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun, usage };
    const generationSignal = AbortSignal.any([signal, deadline.signal]);
    timer = setTimeout(() => deadline.abort(), 60_000);
    const agent = new ToolLoopAgent({
      model: wrapLanguageModel({ model: input.model, middleware: {
        specificationVersion: "v4",
        // Provider prose may echo private user data; do not mutate a process-wide logger.
        wrapGenerate: async ({ doGenerate }) => ({ ...await doGenerate(), warnings: [] }),
      } }),
      instructions: input.instructions, tools: {}, stopWhen: isStepCount(1), maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens, output: Output.object({ schema: input.schema }),
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    });
    providerMayHaveRun = true;
    const result = await awaitWithAbort(() => agent.generate({ prompt: input.prompt, abortSignal: generationSignal }), generationSignal);
    usage = summarizeUsage(result.totalUsage);
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun, usage };
    if (deadline.signal.aborted) return { status: "timed_out" as const, providerMayHaveRun, usage };
    if (result.finishReason !== "stop") return { status: "invalid_output" as const, providerMayHaveRun, usage };
    return { status: "generated" as const, providerMayHaveRun, usage, output: result.output };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.usage) usage = summarizeUsage(error.usage);
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun, usage };
    if (deadline.signal.aborted) return { status: "timed_out" as const, providerMayHaveRun, usage };
    const status = NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error) ? "invalid_output" as const : "unavailable" as const;
    return { status, providerMayHaveRun, usage };
  } finally {
    clearTimeout(timer);
  }
}
