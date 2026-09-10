import { parseBlueprintSnapshot, type BlueprintSnapshot } from "@blueprint/domain";

export type BoundNodeContext = {
  goalId: string;
  goalTitle: string;
  stageId: string;
  stageTitle: string;
  nodeId: string;
  nodeTitle: string;
  description: string | null;
  estimatedMinutes: number | null;
  completionCriteria: string;
  resourceBindingId: string;
  videoId: string;
};

export type OutboxCommand = {
  ownerId: string;
  clientMutationId: string;
  nodeId: string;
  resourceBindingId?: string;
  startedAt: string;
  attempts: number;
  failureRecorded?: boolean;
};

export type DeliveryResult = "sent" | "retryable" | "rejected";

export function findBoundNodes(
  snapshotInput: BlueprintSnapshot,
  currentUrl: string,
): BoundNodeContext[] {
  const snapshot = parseBlueprintSnapshot(snapshotInput);
  const videoId = currentYouTubeVideoId(currentUrl);
  if (!videoId) return [];
  const contexts: BoundNodeContext[] = [];
  for (const goal of snapshot.goals) {
    for (const stage of goal.stages) {
      for (const node of stage.nodes) {
        const resources = node.resources.filter(
          (candidate) => candidate.kind === "youtube_video" && candidate.externalId === videoId,
        );
        for (const resource of resources) {
          contexts.push({
            goalId: goal.id,
            goalTitle: goal.title,
            stageId: stage.id,
            stageTitle: stage.title,
            nodeId: node.id,
            nodeTitle: node.title,
            description: node.description ?? null,
            estimatedMinutes: "estimatedMinutes" in node ? node.estimatedMinutes ?? null : null,
            completionCriteria: "completionCriteria" in node ? node.completionCriteria ?? "" : "",
            resourceBindingId: resource.id,
            videoId,
          });
        }
      }
    }
  }
  return contexts;
}

export async function flushOutbox(
  commands: OutboxCommand[],
  currentUserId: string,
  send: (command: OutboxCommand) => Promise<DeliveryResult>,
): Promise<{ remaining: OutboxCommand[]; recovered: number; recoveredCommands: OutboxCommand[]; rejected: number }> {
  const remaining: OutboxCommand[] = [];
  const recoveredCommands: OutboxCommand[] = [];
  let recovered = 0;
  let rejected = 0;
  for (const command of commands) {
    if (command.ownerId !== currentUserId) {
      remaining.push(command);
      continue;
    }
    let delivery: DeliveryResult = "retryable";
    try {
      delivery = await send(command);
    } catch {
      delivery = "retryable";
    }
    if (delivery === "sent") {
      recovered += 1;
      recoveredCommands.push(command);
    }
    else if (delivery === "rejected") rejected += 1;
    else remaining.push({ ...command, attempts: command.attempts + 1 });
  }
  return { remaining, recovered, recoveredCommands, rejected };
}

function currentYouTubeVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(url.hostname)) {
      return null;
    }
    const videoId = url.pathname === "/watch" ? url.searchParams.get("v") : null;
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}
