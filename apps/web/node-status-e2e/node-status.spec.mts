import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("a real account confirms status, restores an offline request, and retains historical criteria", async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(10_000);
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@node-status.example.test`, password = randomUUID();
  const secondId = randomUUID(), secondPassword = randomUUID();
  const secondClient = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let secondCreated = false;
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) {
      const index = cookies.findIndex(item => item.name === entry.name);
      if (index < 0) cookies.push(entry); else cookies[index] = entry;
    } },
  } });
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(created.error).toBeNull(); expect(created.data.user?.id).toBe(id);
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    async function read() {
      const result = await client.rpc("read_node_status_workspace", { p_owner_id: id });
      expect(result.error).toBeNull(); return result.data;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const probe = await client.rpc("read_node_status_workspace", { p_owner_id: id });
      if (!probe.error) break;
      if (probe.error.code !== "PGRST303" || probe.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Local readiness failed: ${probe.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const first = await read(), nodeId = randomUUID(), parallelNode = randomUUID();
    const blueprint = { ...first.blueprint, goals: [{ id: randomUUID(), title: "准备公开演讲", position: 0,
      stages: [{ id: randomUUID(), title: "第一周练习", position: 0, nodes: [
        { id: nodeId, title: "录制三分钟演讲", type: "practice", position: 0, dependencyIds: [], resources: [],
          estimatedMinutes: 90, completionCriteria: "保存录制，指出三个改进点" },
        { id: parallelNode, title: "检查反馈", type: "checkpoint", position: 1, dependencyIds: [nodeId], resources: [],
          estimatedMinutes: null, completionCriteria: "" },
      ] }] }] };
    async function apply(snapshot: typeof blueprint) {
      const proposalId = randomUUID();
      expect((await client.from("blueprint_proposals").insert({ id: proposalId, owner_id: id, blueprint_id: blueprint.id,
        base_version: snapshot.version, proposed_snapshot: snapshot, client_mutation_id: randomUUID() })).error).toBeNull();
      expect((await client.rpc("apply_blueprint_proposal", { proposal_id: proposalId,
        expected_version: snapshot.version, mutation_id: randomUUID() })).error).toBeNull();
    }
    await apply(blueprint);
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/progress");
    await page.getByRole("link", { name: "确认节点状态", exact: true }).click();
    await page.getByRole("combobox", { name: "路径节点", exact: true }).selectOption(nodeId);
    await expect(page.getByText("保存录制，指出三个改进点", { exact: true }).first()).toBeVisible();
    await page.getByRole("combobox", { name: "我的状态判断", exact: true }).selectOption("completed");
    await expect(page.getByRole("button", { name: "确认节点状态", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: "我已核对完成依据，明确作出自我确认", exact: true }).check();
    await page.getByRole("button", { name: "确认节点状态", exact: true }).click();
    await expect(page.getByText(/状态确认已保存/)).toBeVisible();
    let actual = await read();
    expect(actual.blueprint.version).toBe(1);
    expect(actual.current.find((record: { node_id: string }) => record.node_id === nodeId)).toMatchObject({
      status: "completed", revision: 1, completion_criteria: "保存录制，指出三个改进点", evidence_id: null,
    });
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const otherPage = await context.newPage();
    await otherPage.goto("/progress/status");
    await expect(otherPage.getByText(/另一标签页正在编辑/)).toBeVisible();
    await expect(otherPage.getByRole("combobox", { name: "路径节点", exact: true })).toBeDisabled();
    await page.goto("/progress");
    await otherPage.getByRole("button", { name: "重新尝试编辑", exact: true }).click();
    await expect(otherPage.getByRole("combobox", { name: "路径节点", exact: true })).toBeEnabled();
    await expect(otherPage.getByRole("combobox", { name: "路径节点", exact: true })).toHaveValue(nodeId);
    await otherPage.close();
    await page.goto("/progress/status");
    await page.getByRole("combobox", { name: "我的状态判断", exact: true }).selectOption("in_progress");
    await context.setOffline(true);
    await page.getByRole("button", { name: "确认节点状态", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认原提交结果", exact: true })).toBeEnabled();
    const key = `blueprint-node-status:v1:${id}:${blueprint.id}`;
    const originalAttempt = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).attempt, key);
    expect(originalAttempt.status).toBe("in_progress");
    await context.setOffline(false);
    await page.reload();
    await page.getByRole("button", { name: "确认原提交结果", exact: true }).click();
    await expect(page.getByText(/状态确认已保存/)).toBeVisible();
    actual = await read();
    expect(actual.history).toHaveLength(2);
    expect(actual.current[0]).toBeTruthy();
    expect(actual.current.find((record: { node_id: string }) => record.node_id === nodeId)).toMatchObject({
      status: "in_progress", revision: 2, client_mutation_id: originalAttempt.clientMutationId,
    });
    // Actual concurrent authenticated requests: one receipt for duplicate submission,
    // one winner for different submissions based on the same status revision.
    const command = { p_node_id: parallelNode, p_expected_version: 1, p_expected_status_revision: 0,
      p_status: "completed", p_evidence_id: null, p_client_mutation_id: randomUUID() };
    const duplicate = await Promise.all([client.rpc("confirm_node_status", command), client.rpc("confirm_node_status", command)]);
    expect(duplicate.map(result => result.error)).toEqual([null, null]);
    expect(duplicate[0].data.id).toBe(duplicate[1].data.id);
    const race = await Promise.all(["in_progress", "not_started"].map(status => client.rpc("confirm_node_status", {
      ...command, p_expected_status_revision: 1, p_status: status, p_client_mutation_id: randomUUID(),
    })));
    expect(race.filter(result => result.error === null)).toHaveLength(1);
    expect(race.find(result => result.error)?.error?.code).toBe("40001");
    blueprint.version = 1;
    blueprint.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "新依据：请两位听众给出反馈";
    await apply(blueprint);
    await page.getByRole("button", { name: "读取当前路径与状态", exact: true }).click();
    await expect(page.getByText(/完成依据.*变化|完成依据.*变更|依据.*已变/).first()).toBeVisible();
    actual = await read();
    const original = actual.history.find((record: { node_id: string; revision: number }) => record.node_id === nodeId && record.revision === 1);
    expect(original.completion_criteria).toBe("保存录制，指出三个改进点");
    expect(actual.blueprint.version).toBe(2);
    expect(errors).toEqual([]);
    const another = await admin.auth.admin.createUser({ id: secondId, email: `${secondId}@node-status.example.test`,
      password: secondPassword, email_confirm: true });
    secondCreated = Boolean(another.data.user?.id === secondId);
    expect(another.error).toBeNull(); expect(secondCreated).toBe(true);
    expect((await secondClient.auth.signInWithPassword({ email: `${secondId}@node-status.example.test`, password: secondPassword })).error).toBeNull();
    for (let attempt = 0; attempt < 6; attempt++) {
      const otherRead = await secondClient.rpc("read_node_status_workspace", { p_owner_id: id });
      if (!otherRead.error) { expect(otherRead.data).toBeNull(); break; }
      if (otherRead.error.code !== "PGRST303" || otherRead.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Other-account readiness failed: ${otherRead.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const forbidden = await secondClient.rpc("confirm_node_status", { ...command, p_node_id: nodeId,
      p_expected_version: 0, p_expected_status_revision: 0, p_client_mutation_id: randomUUID() });
    expect(forbidden.error?.code).toBe("P0002");
  } finally {
    await Promise.allSettled([context.setOffline(false), context.clearCookies(), client.auth.signOut(), secondClient.auth.signOut()]);
    if (secondCreated) expect((await admin.auth.admin.deleteUser(secondId)).error).toBeNull();
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.info("Removed only this run's local accounts and cascaded status records; no email sent.");
  }
});
