import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import type { AccountPreferences, BlueprintSnapshot } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { resolveTheme, ThemeSurface } from "@blueprint/ui/theme";

import type { BoundNodeContext } from "../../src/runtime";
import { EvidencePanel } from "./EvidencePanel";
import { StatusPanel } from "./StatusPanel";
import { NotesPanel } from "./NotesPanel";
import { PositionsPanel } from "./PositionsPanel";
import { LearningWorkspace } from "./LearningWorkspace";
import { TranscriptPanel } from "./TranscriptPanel";

type BoundNodeListItem = {
  goalTitle: string;
  stageTitle: string;
  nodeId: string;
  nodeTitle: string;
  resourceBindingId: string;
  url: string;
};

type ViewState = {
  connected: boolean;
  userId?: string;
  email?: string;
  preferences?: AccountPreferences | null;
  preferencesStatus?: "current" | "cached" | "unavailable";
  snapshot?: BlueprintSnapshot | null;
  contexts?: BoundNodeContext[];
  nodes?: BoundNodeListItem[];
  tabId?: number;
  stale?: boolean;
  pending?: number;
};

export function App() {
  const [state, setState] = useState<ViewState>({ connected: false });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const currentState = useRef(state);
  currentState.current = state;
  const loadRequest = useRef(0);
  const preferenceRequest = useRef(0);
  const authRequest = useRef(0);
  const contextRequest = useRef(0);
  const [choice, setChoice] = useState<{ ownerId?: string; tabId?: number; videoId: string; bindingId: string } | null>(null);
  const contexts = state.contexts ?? [];
  const context = contexts.length === 1 ? contexts[0] : contexts.find(item => choice !== null && choice.ownerId === state.userId
    && choice.tabId === state.tabId && choice.videoId === item.videoId && choice.bindingId === item.resourceBindingId);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    const preference = ++preferenceRequest.current;
    ++contextRequest.current;
    setBusy(true);
    setError("");
    try {
      const next = await browser.runtime.sendMessage({ type: "LOAD_CONTEXT" }) as ViewState & { superseded?: boolean };
      if (request !== loadRequest.current || next.superseded) return;
      setChoice(previous => previous !== null && previous.ownerId === next.userId && previous.tabId === next.tabId
        && next.contexts?.some(item => item.resourceBindingId === previous.bindingId && item.videoId === previous.videoId) ? previous : null);
      setState((previous) => preference !== preferenceRequest.current && previous.userId === next.userId && next.connected
        ? { ...next, preferences: previous.preferences, preferencesStatus: previous.preferencesStatus }
        : next);
      if (!next.connected || currentState.current.userId !== next.userId) setMessage("");
    } catch {
      if (request === loadRequest.current) {
        setState(previous => ({ ...previous, contexts: [] }));
        setMessage("");
        setError("无法连接 Blueprint 后台，请刷新或重新打开侧边栏。");
      }
    } finally {
      if (request === loadRequest.current) setBusy(false);
    }
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (!currentState.current.connected) return;
    const request = ++preferenceRequest.current;
    const ownerId = currentState.current.userId;
    try {
      const next = await browser.runtime.sendMessage({ type: "LOAD_PREFERENCES" }) as ViewState & { superseded?: boolean };
      if (request !== preferenceRequest.current || next.superseded || currentState.current.userId !== ownerId) return;
      if (!next.connected) {
        ++loadRequest.current;
        setState({ connected: false });
        setMessage("");
        setBusy(false);
        return;
      }
      setState((previous) => previous.userId === next.userId
        ? { ...previous, preferences: next.preferences, preferencesStatus: next.preferencesStatus }
        : previous);
    } catch {
      if (request === preferenceRequest.current && currentState.current.userId === ownerId) {
        setState((previous) => ({ ...previous, preferencesStatus: previous.preferences ? "cached" : "unavailable" }));
      }
    }
  }, []);

  useEffect(() => {
    const onFocus = () => void refreshPreferences();
    const onVisible = () => { if (document.visibilityState === "visible") void refreshPreferences(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshPreferences]);

  useEffect(() => {
    void load();
    const refreshContext = () => {
      ++contextRequest.current;
      setChoice(null); setMessage("");
      setState(previous => ({ ...previous, contexts: [] }));
      void load();
    };
    const listener = (tabId: number, change: { url?: string }) => {
      if (change.url && (currentState.current.tabId === undefined || currentState.current.tabId === tabId)) refreshContext();
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.onActivated.addListener(refreshContext);
    return () => {
      ++loadRequest.current;
      ++preferenceRequest.current;
      ++authRequest.current;
      ++contextRequest.current;
      browser.tabs.onUpdated.removeListener(listener);
      browser.tabs.onActivated.removeListener(refreshContext);
    };
  }, [load]);

  useEffect(() => {
    const onSessionChanged = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => {
      const session = changes.blueprint_cloud_session_v1;
      if (area !== "local" || !session) return;
      const owner = (value: unknown) => typeof value === "object" && value !== null && "userId" in value ? value.userId : undefined;
      if (owner(session.oldValue) === owner(session.newValue)) return;
      // The storage event owns loading a newly connected account, including
      // connections made from another panel. Older auth completions must not
      // replace that account or clear its loading state.
      if (owner(session.newValue)) ++authRequest.current;
      ++loadRequest.current;
      ++preferenceRequest.current;
      currentState.current = { connected: false };
      ++contextRequest.current;
      setChoice(null);
      setState({ connected: false });
      setMessage("");
      setError("");
      void load();
    };
    browser.storage.onChanged.addListener(onSessionChanged);
    return () => browser.storage.onChanged.removeListener(onSessionChanged);
  }, [load]);

  async function connect() {
    const request = ++authRequest.current;
    ++loadRequest.current;
    ++preferenceRequest.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await browser.runtime.sendMessage({ type: "AUTH_CONNECT" });
      if (request !== authRequest.current) return;
      await load();
    } catch (caught) {
      if (request !== authRequest.current) return;
      setError(caught instanceof Error && caught.message === "AUTH_CANCELLED" ? "你取消了授权，Blueprint 没有获得访问权限。" : "授权未完成，请确认 Web 已登录后重试。");
      setBusy(false);
    }
  }

  async function disconnect() {
    const request = ++authRequest.current;
    ++loadRequest.current;
    ++preferenceRequest.current;
    setBusy(true);
    setError("");
    try {
      await browser.runtime.sendMessage({ type: "AUTH_DISCONNECT" });
      if (request !== authRequest.current) return;
      setState({ connected: false });
      setMessage("扩展会话已退出。你可以在 Web 设置中撤销完整授权。");
    } catch {
      if (request !== authRequest.current) return;
      setError("暂时无法退出扩展会话，请稍后重试。");
    } finally {
      if (request === authRequest.current) setBusy(false);
    }
  }

  async function startLearning() {
    if (!context) return;
    const ownerId = state.userId;
    const request = contextRequest.current;
    setBusy(true);
    setError("");
    try {
      const result = await browser.runtime.sendMessage({ type: "START_SESSION", ownerId, tabId: state.tabId,
        context: { nodeId: context.nodeId, resourceBindingId: context.resourceBindingId } }) as { ok: boolean; queued?: boolean };
      if (request !== contextRequest.current || !currentState.current.connected || currentState.current.userId !== ownerId) return;
      if (!result.ok) {
        setError("学习会话被拒绝。请重新授权，或回到 Web 检查该节点是否仍然存在。");
        setBusy(false);
        return;
      }
      setMessage(result.queued ? "网络不可用，学习会话已进入待同步队列。" : "学习会话已写入你的蓝图。");
      await load();
    } catch {
      if (request !== contextRequest.current || !currentState.current.connected || currentState.current.userId !== ownerId) return;
      setError("无法保存学习会话，请重新打开侧边栏后重试。");
      setBusy(false);
    }
  }

  async function retry() {
    const ownerId = state.userId;
    setBusy(true);
    setError("");
    try {
      const result = await browser.runtime.sendMessage({ type: "RETRY_OUTBOX" }) as { recovered: number; pending: number; rejected: number };
      if (!currentState.current.connected || currentState.current.userId !== ownerId) return;
      if (result.rejected) setError(`${result.rejected} 条记录已失效，请回到 Web 检查节点或重新授权。`);
      else setMessage(result.recovered ? `已恢复 ${result.recovered} 条学习会话。` : result.pending ? "仍无法同步，记录会继续保留。" : "没有待同步记录。");
      await load();
    } catch {
      if (!currentState.current.connected || currentState.current.userId !== ownerId) return;
      setError("暂时无法重试，待同步记录仍保存在本机。");
      setBusy(false);
    }
  }

  async function openNode(item: BoundNodeListItem) {
    const ownerId = state.userId;
    setError("");
    try { await browser.runtime.sendMessage({ type: "OPEN_NODE", tabId: state.tabId, url: item.url }); }
    catch { if (currentState.current.userId === ownerId) setError("无法打开视频，请刷新后重试。"); }
  }

  async function openPath() {
    if (!context) return;
    const ownerId = state.userId;
    const request = contextRequest.current;
    setError("");
    try {
      const result = await browser.runtime.sendMessage({ type: "OPEN_PATH", ownerId, tabId: state.tabId,
        context: { nodeId: context.nodeId, resourceBindingId: context.resourceBindingId } }) as { ok: boolean };
      if (request === contextRequest.current && currentState.current.userId === ownerId && !result.ok) setError("当前视频或路径已变化，请刷新后返回路径。");
    } catch {
      if (request === contextRequest.current && currentState.current.userId === ownerId) setError("暂时无法打开路径，请刷新后重试。");
    }
  }

  const theme = resolveTheme(state.connected ? state.preferences?.theme : null);

  return (
    <ThemeSurface theme={theme.id} density="compact">
    <main className="extension-shell">
      <header>
        <div className="brand">Blueprint / YouTube</div>
        <h1>学习伴侣</h1>
        <p className="muted">扩展只承接蓝图中的 YouTube 学习场景。</p>
      </header>
      {message ? <Status tone="success">{message}</Status> : null}
      {error ? <Status tone="danger">{error}</Status> : null}
      {!state.connected ? (
        <Panel className="connect-card">
          <h2>连接你的蓝图</h2>
          <p className="muted">通过 Web 确认授权后，扩展会获得自己的安全会话。</p>
          <Button className="primary" disabled={busy} onClick={() => void connect()}>{busy ? "正在检查…" : "连接 Blueprint"}</Button>
        </Panel>
      ) : (
        <>
          <Panel className="account-card">
            <div><span className="label">已连接</span><strong>{state.email ?? "Blueprint 用户"}</strong></div>
            <Button disabled={busy} onClick={() => void disconnect()}>退出</Button>
          </Panel>
          <p className="muted theme-status">主题：{theme.label} · 在 Web 修改</p>
          {state.preferencesStatus === "cached" ? <Status tone="warning">账号主题暂未更新，当前使用此账号的缓存主题。</Status> : null}
          {state.preferencesStatus === "unavailable" ? <Status tone="warning">暂时无法读取账号主题，当前使用默认表现。</Status> : null}
          {state.preferences && (state.preferences.theme.id !== theme.id || state.preferences.theme.version !== theme.version)
            ? <Status tone="warning">当前扩展暂不支持账号主题，已使用默认表现。</Status> : null}
          {state.stale ? <Status tone="warning">当前显示缓存蓝图，网络恢复后可刷新。</Status> : null}
          {state.pending ? <Panel className="sync-card"><span>{state.pending} 条学习会话待同步</span><Button disabled={busy} onClick={() => void retry()}>重试</Button></Panel> : null}
          {contexts.length > 1 ? <div className="context-choice">
            <label htmlFor="learning-node-choice">同一视频关联了多个节点，请选择本次学习目标</label>
            <select id="learning-node-choice" aria-label="本次学习节点" disabled={busy} value={context?.resourceBindingId ?? ""} onChange={event => {
              ++contextRequest.current; setMessage(""); setError("");
              const selected = contexts.find(item => item.resourceBindingId === event.target.value);
              setChoice(selected ? { ownerId: state.userId, tabId: state.tabId, videoId: selected.videoId, bindingId: selected.resourceBindingId } : null);
            }}><option value="">请选择节点</option>{contexts.map(item => <option key={item.resourceBindingId} value={item.resourceBindingId}>{item.goalTitle} / {item.nodeTitle}</option>)}</select>
          </div> : null}
          {context ? (
            <Panel className="context-card">
              <div className="label">当前视频对应</div>
              <p className="breadcrumb">{context.goalTitle} / {context.stageTitle}</p>
              <h2>{context.nodeTitle}</h2>
              <Button className="web-link" disabled={busy} onClick={() => void openPath()}>返回此节点路径</Button>
            </Panel>
          ) : (
            <Panel className="context-card">
              <div className="label">当前页面</div>
              <h2>{busy ? "正在核对当前视频…" : contexts.length ? "选择本次学习目标" : "没有匹配的蓝图节点"}</h2>
              <p className="muted">{contexts.length ? "选择后会展示完成依据，开始学习会话将关联所选节点。已有成果草稿不会自动移动。" : "从下面选择一个已绑定节点，或回到 Web 选择路径。成果草稿不会随视频移动。"}</p>
            </Panel>
          )}
          <LearningWorkspace key={state.userId} learn={<>
          {state.userId ? <PositionsPanel ownerId={state.userId} /> : null}
          {context ? <div className="learning-brief">
            <div className="learning-purpose"><h3>为什么学习</h3><p>{context.description || "路径尚未填写学习说明。请结合目标与完成依据，判断本次学习的用途。"}</p></div>
            <dl className="learning-facts">
              <div><dt>完成依据</dt><dd>{context.completionCriteria || "尚未明确。可回到路径补充，不以观看时长判断掌握。"}</dd></div>
              <div><dt>节点预计投入</dt><dd>{context.estimatedMinutes == null ? "尚未明确" : `${context.estimatedMinutes} 分钟`}</dd></div>
            </dl>
            <Button className="primary" disabled={busy} onClick={() => void startLearning()}>开始学习</Button>
            <p className="muted learning-note">开始仅记录学习活动，不会将节点标记为完成。</p>
          </div> : null}
          <section className="node-list" aria-label="已绑定的 YouTube 节点">
            <div className="section-heading"><h2>可学习节点</h2><Button disabled={busy} onClick={() => void load()}>刷新</Button></div>
            {state.nodes?.length ? state.nodes.map((item) => (
              <button className="node-link" disabled={busy} key={item.resourceBindingId} onClick={() => void openNode(item)}>
                <span className="node-context">{item.goalTitle} / {item.stageTitle}</span>
                <strong>{item.nodeTitle}</strong>
              </button>
            )) : <p className="empty">蓝图中还没有 YouTube 资源绑定。</p>}
          </section>
          </>} understand={state.userId ? <TranscriptPanel ownerId={state.userId} expectedTabId={state.tabId} context={context} /> : null} record={<>
            <div className="record-introduction"><h2>把经历留作证据</h2><p className="muted">记录实际收获，再核对完成依据。观看不等于掌握，草稿也不会随当前视频改选节点。</p></div>
            {state.userId ? <EvidencePanel ownerId={state.userId} /> : null}
            {state.userId ? <NotesPanel ownerId={state.userId} /> : null}
            {state.userId ? <StatusPanel ownerId={state.userId} /> : null}
          </>} />
          <Button className="web-link" onClick={() => void browser.runtime.sendMessage({ type: "OPEN_WEB" })}>打开 Web 蓝图</Button>
        </>
      )}
    </main>
    </ThemeSurface>
  );
}
