(async function () {
  "use strict";
  const domain = globalThis.BlueprintDomain;
  const params = new URLSearchParams(location.search);
  const goalId = params.get("id") || "";
  const result = await chrome.storage.local.get(domain.STORAGE_KEY);
  const state = domain.normalizeState(result[domain.STORAGE_KEY] || {});
  document.documentElement.dataset.theme = state.theme;
  const goal = state.parsed.goals.find((item) => item.id === goalId);
  const list = document.querySelector("#milestoneList");
  const error = document.querySelector("#goalError");

  const goHome = () => { location.href = chrome.runtime.getURL("blueprint.html"); };
  document.querySelector("#backButton").addEventListener("click", goHome);
  document.querySelector("#returnButton").addEventListener("click", goHome);
  document.querySelector("#settingsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());

  if (!goal) {
    document.querySelector("#goalTitle").textContent = "目标不存在";
    error.hidden = false;
    return;
  }

  document.title = `${goal.title} · Blueprint`;
  document.querySelector("#goalTitle").textContent = goal.title;
  goal.milestones.forEach((milestone, index) => {
    const section = document.createElement("section");
    section.className = "milestone";
    section.dataset.index = String(index + 1).padStart(2, "0");
    const heading = document.createElement("h2");
    heading.textContent = milestone.title;
    section.append(heading);
    const nodes = document.createElement("ol");
    nodes.className = "node-list";
    for (const node of milestone.nodes) {
      const item = document.createElement("li");
      item.className = `learning-node${node.completed ? " completed" : ""}`;
      const title = document.createElement("p");
      title.textContent = node.title;
      item.append(title);
      if (node.youtubeUrl) {
        const link = document.createElement("a");
        link.href = node.youtubeUrl;
        link.textContent = "在 YouTube 中开始学习";
        link.addEventListener("click", (event) => {
          event.preventDefault();
          chrome.runtime.sendMessage({ action: "openLearningNode", url: node.youtubeUrl })
            .then((response) => {
              if (!response?.success) location.href = node.youtubeUrl;
            })
            .catch(() => { location.href = node.youtubeUrl; });
        });
        item.append(link);
      } else {
        const status = document.createElement("span");
        status.className = "node-status";
        status.textContent = node.completed ? "已完成" : "尚未绑定学习视频";
        item.append(status);
      }
      nodes.append(item);
    }
    if (!milestone.nodes.length) {
      const item = document.createElement("li");
      item.className = "learning-node";
      item.textContent = "这个里程碑还没有学习节点。可以继续和规划师完善。";
      nodes.append(item);
    }
    section.append(nodes);
    list.append(section);
  });
})();
