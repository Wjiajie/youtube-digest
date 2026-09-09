import { z } from "zod";

import { NODE_TYPES } from "./node-types";
export { NODE_TYPES } from "./node-types";

export const RESOURCE_KINDS = ["youtube_video"] as const;

const idSchema = z.uuid();
const titleSchema = z.string().trim().min(1).max(240);

export const resourceBindingSchema = z
  .object({
    id: idSchema,
    kind: z.enum(RESOURCE_KINDS),
    url: z.url(),
    externalId: z.string().trim().min(1).max(128),
  })
  .superRefine((binding, context) => {
    if (binding.kind !== "youtube_video") return;
    const canonical = canonicalYouTubeUrl(binding.url);
    if (!canonical || canonical.externalId !== binding.externalId) {
      context.addIssue({
        code: "custom",
        message: "YouTube resource must use a canonical watch URL and matching video ID",
      });
    }
  });

export const pathNodeSchema = z
  .object({
    id: idSchema,
    type: z.enum(NODE_TYPES),
    title: titleSchema,
    description: z.string().trim().max(2_000).optional(),
    position: z.int().nonnegative(),
    dependencyIds: z.array(idSchema).max(64),
    resources: z.array(resourceBindingSchema).max(16),
  })
  .superRefine((node, context) => {
    if (new Set(node.dependencyIds).size !== node.dependencyIds.length) {
      addDomainIssue(context, ["dependencyIds"], "Path Node dependency IDs must be unique");
    }
    const resourceIds = node.resources.map((resource) => resource.id);
    if (new Set(resourceIds).size !== resourceIds.length) {
      addDomainIssue(context, ["resources"], "Path Node resource IDs must be unique");
    }
  });

export const stageSchema = z.object({
  id: idSchema,
  title: titleSchema,
  position: z.int().nonnegative(),
  nodes: z.array(pathNodeSchema).max(256),
});

export const goalSchema = z.object({
  id: idSchema,
  title: titleSchema,
  description: z.string().trim().max(2_000).optional(),
  position: z.int().nonnegative(),
  stages: z.array(stageSchema).max(64),
});

export const blueprintSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.int().nonnegative(),
    title: titleSchema,
    goals: z.array(goalSchema).max(12),
  })
  .superRefine((snapshot, context) => {
    const allIds = new Set<string>([snapshot.id]);
    for (const goal of snapshot.goals) {
      if (allIds.has(goal.id)) {
        addDomainIssue(context, ["goals"], "All Blueprint IDs must be unique");
      }
      allIds.add(goal.id);
      const goalNodeIds = new Set(goal.stages.flatMap((stage) => stage.nodes.map((node) => node.id)));

      for (const stage of goal.stages) {
        if (allIds.has(stage.id)) {
          addDomainIssue(context, ["goals"], "All Blueprint IDs must be unique");
        }
        allIds.add(stage.id);
        for (const node of stage.nodes) {
          if (allIds.has(node.id)) {
            addDomainIssue(context, ["goals"], "All Blueprint IDs must be unique");
          }
          allIds.add(node.id);
          for (const dependencyId of node.dependencyIds) {
            if (!goalNodeIds.has(dependencyId)) {
              addDomainIssue(
                context,
                ["goals"],
                "Path node dependencies must stay inside the same Goal",
              );
            }
            if (dependencyId === node.id) {
              addDomainIssue(context, ["goals"], "A Path Node cannot depend on itself");
            }
          }
          for (const resource of node.resources) {
            if (allIds.has(resource.id)) {
              addDomainIssue(context, ["goals"], "All Blueprint IDs must be unique");
            }
            allIds.add(resource.id);
          }
        }
      }

      if (hasDependencyCycle(goal)) {
        addDomainIssue(context, ["goals"], "Path node dependencies must be acyclic");
      }
    }
  });

export type NodeType = (typeof NODE_TYPES)[number];
export type ResourceBinding = z.infer<typeof resourceBindingSchema>;
export type PathNode = z.infer<typeof pathNodeSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type BlueprintSnapshot = z.infer<typeof blueprintSnapshotSchema>;

export type BlueprintDiffEntry = {
  kind: "add" | "update" | "move" | "archive";
  entity: "blueprint" | "goal" | "stage" | "path_node" | "resource_binding";
  id: string;
  label: string;
};

export function parseBlueprintSnapshot(input: unknown): BlueprintSnapshot {
  return blueprintSnapshotSchema.parse(input);
}

export function canonicalYouTubeUrl(
  input: string,
): { url: string; externalId: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const externalId = url.searchParams.get("v") ?? "";
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.youtube.com" ||
    url.pathname !== "/watch" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "v") ||
    !/^[A-Za-z0-9_-]{11}$/.test(externalId)
  ) {
    return null;
  }
  return {
    url: `https://www.youtube.com/watch?v=${externalId}`,
    externalId,
  };
}

export function diffBlueprints(
  beforeInput: BlueprintSnapshot,
  draftInput: BlueprintSnapshot,
): BlueprintDiffEntry[] {
  const before = parseBlueprintSnapshot(beforeInput);
  const draft = parseBlueprintSnapshot(draftInput);
  const previous = flattenBlueprint(before);
  const next = flattenBlueprint(draft);
  const changes: FlatChange[] = [];

  for (const entity of next) {
    const original = previous.find((candidate) => candidate.id === entity.id);
    if (!original) {
      changes.push({ ...entity, kind: "add" });
      continue;
    }
    if (entity.parentId !== original.parentId || entity.position !== original.position) {
      changes.push({ ...entity, kind: "move" });
      continue;
    }
    if (entity.fingerprint !== original.fingerprint) {
      changes.push({ ...entity, kind: "update" });
    }
  }
  for (const entity of previous) {
    if (!next.some((candidate) => candidate.id === entity.id)) {
      changes.push({ ...entity, kind: "archive" });
    }
  }
  return changes.map(({ fingerprint: _fingerprint, parentId: _parentId, position: _position, ...change }) => change);
}

export function toBlueprintMarkdown(snapshotInput: BlueprintSnapshot): string {
  const snapshot = parseBlueprintSnapshot(snapshotInput);
  const labels: Record<NodeType, string> = {
    learn: "学习",
    practice: "实践",
    checkpoint: "检查点",
    reflection: "复盘",
  };
  const lines = [`# ${snapshot.title}`, ""];
  for (const goal of [...snapshot.goals].sort(byPosition)) {
    lines.push(`## ${goal.title}`, "");
    for (const stage of [...goal.stages].sort(byPosition)) {
      lines.push(`### ${stage.title}`, "");
      for (const node of [...stage.nodes].sort(byPosition)) {
        const resource = node.resources[0];
        lines.push(
          `- [${labels[node.type]}] ${node.title}${resource ? ` | ${resource.url}` : ""}`,
        );
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function addDomainIssue(
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", message, path });
}

function hasDependencyCycle(goal: z.infer<typeof goalSchema>): boolean {
  const graph = new Map(
    goal.stages.flatMap((stage) =>
      stage.nodes.map((node) => [node.id, node.dependencyIds] as const),
    ),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependencyId of graph.get(id) ?? []) {
      if (graph.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

type FlatEntity = Omit<BlueprintDiffEntry, "kind"> & {
  parentId: string;
  position: number;
  fingerprint: string;
};

type FlatChange = FlatEntity & Pick<BlueprintDiffEntry, "kind">;

function flattenBlueprint(snapshot: BlueprintSnapshot): FlatEntity[] {
  const entities: FlatEntity[] = [
    {
      entity: "blueprint",
      id: snapshot.id,
      label: snapshot.title,
      parentId: "",
      position: 0,
      fingerprint: snapshot.title,
    },
  ];
  for (const goal of snapshot.goals) {
    entities.push({
      entity: "goal",
      id: goal.id,
      label: goal.title,
      parentId: snapshot.id,
      position: goal.position,
      fingerprint: JSON.stringify([goal.title, goal.description ?? ""]),
    });
    for (const stage of goal.stages) {
      entities.push({
        entity: "stage",
        id: stage.id,
        label: stage.title,
        parentId: goal.id,
        position: stage.position,
        fingerprint: stage.title,
      });
      for (const node of stage.nodes) {
        entities.push({
          entity: "path_node",
          id: node.id,
          label: node.title,
          parentId: stage.id,
          position: node.position,
          fingerprint: JSON.stringify([
            node.type,
            node.title,
            node.description ?? "",
            node.dependencyIds,
          ]),
        });
        for (const resource of node.resources) {
          entities.push({
            entity: "resource_binding",
            id: resource.id,
            label: resource.url,
            parentId: node.id,
            position: 0,
            fingerprint: JSON.stringify(resource),
          });
        }
      }
    }
  }
  return entities;
}

export * from "./application";
export * from "./account-preferences";
export * from "./progress-evidence";
export * from "./goal-brief";

function byPosition<T extends { position: number }>(left: T, right: T): number {
  return left.position - right.position;
}
