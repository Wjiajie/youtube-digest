import { executeTool, type ToolContext } from "./tools";
/** Receipt-driven acknowledgement. No model can manufacture storage success. */
export async function acknowledgement(
  ctx: ToolContext,
  receipt: any,
  actionId: string,
) {
  if (receipt?.status === "confirmed" && receipt?.content && receipt?.id) {
    if (process.env.BLUEPRINT_COMPANION_ENABLED !== "true")
      return "目标已保存。管家服务当前关闭，可以稍后继续制定计划。";
    const planning = await executeTool(
      ctx,
      "generate_plan",
      { briefId: receipt.id },
      `confirmed-goal:${actionId}`,
    ).catch(() => ({ ok: false }));
    return planning.ok
      ? "目标已保存，我正在整理执行计划。完成后我们一起确认。"
      : "目标已保存。规划服务暂时不可用，你的目标会保留，可以稍后继续制定计划。";
  }
  if (receipt?.proposal?.status === "applied" || receipt?.evidence) {
    const context = await executeTool(
      ctx,
      "read_goals",
      {},
      `next:${actionId}`,
    ).catch(() => null);
    const next = context?.nextSteps?.[0];
    if (next)
      return `已保存。接下来可以做“${next.title}”。完成标准：${next.completionCriteria}`;
    if (context?.ok)
      return "已保存。当前没有待执行的步骤，可以回顾成果，或者和我制定下一个目标。";
  }
  return "已保存。我们可以继续下一步。";
}
