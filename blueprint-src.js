import * as THREE from "three";

const domain = globalThis.BlueprintDomain;
const canvas = document.querySelector("#blueprintCanvas");
const goalButtons = document.querySelector("#goalButtons");
const emptyBlueprint = document.querySelector("#emptyBlueprint");
const plannerForm = document.querySelector("#plannerForm");
const plannerInput = document.querySelector("#plannerInput");
const conversation = document.querySelector("#conversation");
const plannerStatus = document.querySelector("#plannerStatus");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");
const proposalDialog = document.querySelector("#proposalDialog");
const proposalPreview = document.querySelector("#proposalPreview");
const proposalSummary = document.querySelector("#proposalSummary");
const proposalError = document.querySelector("#proposalError");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let state = domain.normalizeState();
let pendingProposal = null;
let plannerPort = null;
let plannerRunning = false;
let collapsed = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07101f, 0.055);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 1.4, 9.2);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const world = new THREE.Group();
scene.add(world);

const ambient = new THREE.HemisphereLight(0xbfefff, 0x14213c, 2.4);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0x9cfbff, 3.8);
keyLight.position.set(4, 7, 6);
scene.add(keyLight);

function material(color, emissive = color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.22,
    metalness: 0.62,
    roughness: 0.28,
  });
}

const avatar = new THREE.Group();
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.7, 8, 18), material(0x284c72, 0x123956));
torso.scale.set(1, 1.08, 0.7);
avatar.add(torso);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24), material(0x78dce8, 0x2c99ad));
head.position.y = 1.75;
head.scale.z = 0.88;
avatar.add(head);
const visor = new THREE.Mesh(
  new THREE.BoxGeometry(0.74, 0.18, 0.2),
  new THREE.MeshBasicMaterial({ color: 0xd4ffff }),
);
visor.position.set(0, 1.82, 0.54);
avatar.add(visor);
for (const side of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.25, 6, 12), material(0x234666));
  arm.position.set(side * 1.03, 0.08, 0);
  arm.rotation.z = side * 0.12;
  avatar.add(arm);
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.45, 6, 12), material(0x1d3855));
  leg.position.set(side * 0.38, -1.78, 0);
  avatar.add(leg);
}
avatar.position.y = 0.35;
world.add(avatar);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(2.35, 0.025, 8, 120),
  new THREE.MeshBasicMaterial({ color: 0x71f4ff, transparent: true, opacity: 0.34 }),
);
ring.rotation.x = Math.PI / 2;
ring.position.y = -2.55;
world.add(ring);

const particleGeometry = new THREE.BufferGeometry();
const particles = new Float32Array(420 * 3);
for (let i = 0; i < particles.length; i += 3) {
  const radius = 4 + Math.random() * 9;
  const angle = Math.random() * Math.PI * 2;
  particles[i] = Math.cos(angle) * radius;
  particles[i + 1] = (Math.random() - 0.5) * 11;
  particles[i + 2] = Math.sin(angle) * radius - 2;
}
particleGeometry.setAttribute("position", new THREE.BufferAttribute(particles, 3));
scene.add(
  new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({ color: 0x8be9ff, size: 0.025, transparent: true, opacity: 0.6 }),
  ),
);

let goalMeshes = [];
function rebuildGoalMeshes() {
  for (const mesh of goalMeshes) world.remove(mesh);
  goalMeshes = [];
  state.parsed.goals.forEach((goal, index) => {
    const angle = (index / Math.max(1, state.parsed.goals.length)) * Math.PI * 2 - Math.PI / 2;
    const radius = state.parsed.goals.length > 7 ? 3.5 : 3.15;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 2),
      new THREE.MeshStandardMaterial({
        color: 0x75f3ff,
        emissive: 0x1fb8d2,
        emissiveIntensity: 1.1,
        metalness: 0.35,
        roughness: 0.22,
      }),
    );
    mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * 2.2 + 0.35, 0.2);
    mesh.userData = { goal, angle };
    world.add(mesh);
    goalMeshes.push(mesh);
  });
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function positionGoalButtons() {
  if (innerWidth <= 640) return;
  const rect = canvas.getBoundingClientRect();
  const vector = new THREE.Vector3();
  goalMeshes.forEach((mesh, index) => {
    mesh.getWorldPosition(vector);
    vector.project(camera);
    const button = goalButtons.children[index];
    if (!button) return;
    button.style.insetInlineStart = `${((vector.x + 1) / 2) * rect.width}px`;
    button.style.insetBlockStart = `${((-vector.y + 1) / 2) * rect.height}px`;
  });
}

function animate(time) {
  resize();
  if (!reduceMotion) {
    avatar.position.y = 0.35 + Math.sin(time * 0.0012) * 0.06;
    ring.rotation.z = time * 0.00012;
    goalMeshes.forEach((mesh, index) => {
      const scale = 1 + Math.sin(time * 0.002 + index) * 0.08;
      mesh.scale.setScalar(scale);
      mesh.rotation.y += 0.004;
    });
  }
  renderer.render(scene, camera);
  positionGoalButtons();
  requestAnimationFrame(animate);
}

let dragging = false;
let lastX = 0;
canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastX = event.clientX;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  world.rotation.y += (event.clientX - lastX) * 0.008;
  lastX = event.clientX;
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointercancel", () => { dragging = false; });

function renderGoals() {
  goalButtons.replaceChildren();
  for (const goal of state.parsed.goals) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "goal-button";
    button.textContent = goal.title;
    button.setAttribute("aria-label", `打开目标：${goal.title}`);
    button.addEventListener("click", () => {
      location.href = chrome.runtime.getURL(`goal.html?id=${encodeURIComponent(goal.id)}`);
    });
    goalButtons.append(button);
  }
  emptyBlueprint.hidden = state.parsed.goals.length > 0;
  rebuildGoalMeshes();
}

function addMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.textContent = text;
  conversation.append(item);
  conversation.scrollTop = conversation.scrollHeight;
}

function setRunning(running, status = "") {
  plannerRunning = running;
  plannerInput.disabled = running;
  sendButton.hidden = running;
  stopButton.hidden = !running;
  stopButton.disabled = false;
  plannerStatus.textContent = status;
}

function connectPlanner() {
  if (plannerPort) return plannerPort;
  plannerPort = chrome.runtime.connect({ name: "blueprint-planner" });
  plannerPort.onMessage.addListener((message) => {
    if (message.type === "planner.delta") {
      plannerStatus.textContent = "规划师正在整理蓝图…";
    } else if (message.type === "planner.proposal") {
      pendingProposal = message.proposal;
    } else if (message.type === "planner.completed") {
      setRunning(false, "已生成修改，请确认后应用。");
      if (pendingProposal) openProposal(pendingProposal);
    } else if (message.type === "planner.error") {
      setRunning(false, message.message || "无法生成蓝图。请检查本地 Agent 服务后重试。");
    } else if (message.type === "planner.aborted") {
      setRunning(false, "已停止生成。");
    }
  });
  plannerPort.onDisconnect.addListener(() => {
    plannerPort = null;
    if (plannerRunning) setRunning(false, "本地 Agent 服务连接已中断。请选择重新发送。");
  });
  return plannerPort;
}

function openProposal(proposal) {
  proposalError.textContent = "";
  proposalSummary.textContent = proposal.summary || "规划师建议更新你的目标路径。";
  proposalPreview.textContent = proposal.markdown || "";
  proposalDialog.showModal();
  document.querySelector("#keepBlueprintButton").focus();
}

plannerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = plannerInput.value.trim();
  if (!text || plannerRunning) return;
  addMessage("user", text);
  plannerInput.value = "";
  pendingProposal = null;
  setRunning(true, "正在连接本地 Agent 服务…");
  connectPlanner().postMessage({
    type: "planner.prompt",
    text,
    blueprint: state.markdown,
    blueprintVersion: state.version,
  });
});

stopButton.addEventListener("click", () => {
  plannerPort?.postMessage({ type: "planner.abort" });
  stopButton.disabled = true;
  plannerStatus.textContent = "正在停止生成…";
});

document.querySelector("#settingsButton").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.querySelector("#focusComposerButton").addEventListener("click", () => plannerInput.focus());
document.querySelector("#toggleConversationButton").addEventListener("click", (event) => {
  collapsed = !collapsed;
  conversation.classList.toggle("collapsed", collapsed);
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.textContent = collapsed ? "展开对话" : "收起对话";
});
document.querySelector("#keepBlueprintButton").addEventListener("click", () => {
  proposalDialog.close();
  pendingProposal = null;
  plannerInput.focus();
});
document.querySelector("#applyBlueprintButton").addEventListener("click", async () => {
  proposalError.textContent = "";
  const response = await chrome.runtime.sendMessage({
    action: "applyBlueprintProposal",
    proposal: pendingProposal,
    baseVersion: state.version,
  });
  if (!response?.success) {
    proposalError.textContent = response?.message || "无法应用修改。请重新生成蓝图。";
    return;
  }
  state = domain.normalizeState(response.state);
  document.documentElement.dataset.theme = state.theme;
  renderGoals();
  addMessage("agent", pendingProposal.summary || "蓝图已更新。你可以继续完善目标。");
  pendingProposal = null;
  proposalDialog.close();
  plannerInput.focus();
});

proposalDialog.addEventListener("cancel", () => {
  pendingProposal = null;
  requestAnimationFrame(() => plannerInput.focus());
});

async function init() {
  requestAnimationFrame(animate);
  const localStorage = globalThis.chrome?.storage?.local;
  if (!localStorage) {
    renderGoals();
    plannerStatus.textContent = "静态预览模式：安装为 Chrome 扩展后可保存蓝图并连接规划师。";
    plannerInput.focus();
    return;
  }
  const stored = await localStorage.get([domain.STORAGE_KEY, domain.CONVERSATION_KEY]);
  state = domain.normalizeState(stored[domain.STORAGE_KEY] || {});
  document.documentElement.dataset.theme = state.theme;
  for (const message of stored[domain.CONVERSATION_KEY] || []) {
    if (message?.role && message?.text) addMessage(message.role, message.text);
  }
  renderGoals();
  if (!state.parsed.goals.length) plannerInput.focus();
}

init().catch((error) => {
  plannerStatus.textContent = `无法加载蓝图：${error.message}`;
});
