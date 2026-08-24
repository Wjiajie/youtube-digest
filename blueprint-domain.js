(function (root) {
  "use strict";

  const STORAGE_KEY = "blueprint_state_v1";
  const CONVERSATION_KEY = "blueprint_planner_messages_v1";
  const THEMES = Object.freeze(["sci-fi", "cyberpunk", "wuxia", "urban"]);
  const MAX_MARKDOWN_LENGTH = 512_000;
  const MAX_MILESTONES_PER_GOAL = 64;
  const MAX_NODES_PER_MILESTONE = 256;

  function slugify(value, index = 0) {
    const slug = String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return slug || `goal-${index + 1}`;
  }

  function parseBlueprint(markdown) {
    if (typeof markdown !== "string" || markdown.length > MAX_MARKDOWN_LENGTH) {
      throw new Error("蓝图内容无效或过长。");
    }
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const goals = [];
    const usedGoalIds = new Set();
    let currentGoal = null;
    let currentMilestone = null;
    const uniqueId = (base, used) => {
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      return id;
    };
    const parseCanonicalYouTubeUrl = (value) => {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error("学习节点绑定的 YouTube 链接无效。");
      }
      const videoId = url.searchParams.get("v") || "";
      const queryKeys = [...url.searchParams.keys()];
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.youtube.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.pathname !== "/watch" ||
        url.hash ||
        queryKeys.length !== 1 ||
        queryKeys[0] !== "v" ||
        !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)
      ) {
        throw new Error("仅支持规范的 YouTube HTTPS 视频链接。");
      }
      return `https://www.youtube.com/watch?v=${videoId}`;
    };
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const goalMatch = line.match(/^##\s+(.+)$/);
      if (goalMatch) {
        if (goals.length >= 12) throw new Error("一个蓝图最多包含 12 个顶层目标。");
        const baseId = slugify(goalMatch[1], goals.length);
        currentGoal = {
          id: uniqueId(baseId, usedGoalIds),
          title: goalMatch[1].trim().slice(0, 120),
          milestones: [],
        };
        goals.push(currentGoal);
        currentMilestone = null;
        continue;
      }
      const milestoneMatch = line.match(/^###\s+(.+)$/);
      if (milestoneMatch && !currentGoal) {
        throw new Error("里程碑必须位于顶层目标之下。");
      }
      if (milestoneMatch && currentGoal) {
        if (currentGoal.milestones.length >= MAX_MILESTONES_PER_GOAL) {
          throw new Error(`每个目标最多包含 ${MAX_MILESTONES_PER_GOAL} 个里程碑。`);
        }
        const usedMilestoneIds = new Set(currentGoal.milestones.map((item) => item.id));
        const baseMilestoneId = `${currentGoal.id}-${slugify(milestoneMatch[1], currentGoal.milestones.length)}`;
        currentMilestone = {
          id: uniqueId(baseMilestoneId, usedMilestoneIds),
          title: milestoneMatch[1].trim().slice(0, 160),
          nodes: [],
        };
        currentGoal.milestones.push(currentMilestone);
        continue;
      }
      const nodeMatch = line.match(/^[-*]\s+(?:\[([ xX])\]\s+)?(.+)$/);
      if (nodeMatch && !currentGoal) {
        throw new Error("学习节点必须位于顶层目标之下。");
      }
      if (nodeMatch && currentGoal) {
        let title = nodeMatch[2].trim();
        let youtubeUrl = "";
        const bindingSeparator = title.lastIndexOf(" | ");
        if (bindingSeparator >= 0) {
          const attemptedUrl = title.slice(bindingSeparator + 3).trim();
          title = title.slice(0, bindingSeparator).trim();
          youtubeUrl = parseCanonicalYouTubeUrl(attemptedUrl);
        }
        if (!title) throw new Error("学习节点标题不能为空。");
        if (!currentMilestone) {
          currentMilestone = {
            id: `${currentGoal.id}-path`,
            title: "学习路径",
            nodes: [],
          };
          currentGoal.milestones.push(currentMilestone);
        }
        if (currentMilestone.nodes.length >= MAX_NODES_PER_MILESTONE) {
          throw new Error(`每个里程碑最多包含 ${MAX_NODES_PER_MILESTONE} 个学习节点。`);
        }
        currentMilestone.nodes.push({
          id: `${currentMilestone.id}-node-${currentMilestone.nodes.length + 1}`,
          title: title.slice(0, 240),
          completed: String(nodeMatch[1] || "").toLowerCase() === "x",
          youtubeUrl,
        });
      }
    }
    return { goals };
  }

  function normalizeState(input = {}) {
    const markdown = typeof input.markdown === "string" ? input.markdown : "# 我的蓝图\n";
    const parsed = parseBlueprint(markdown);
    return {
      version: Number.isSafeInteger(input.version) && input.version >= 0 ? input.version : 0,
      markdown,
      parsed,
      theme: THEMES.includes(input.theme) ? input.theme : "sci-fi",
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : 0,
    };
  }

  const exported = {
    CONVERSATION_KEY,
    MAX_MARKDOWN_LENGTH,
    STORAGE_KEY,
    THEMES,
    normalizeState,
    parseBlueprint,
  };
  root.BlueprintDomain = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);
