import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";

import type { BlueprintSnapshot } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";

import type { BoundNodeContext } from "../../src/runtime";

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
  email?: string;
  snapshot?: BlueprintSnapshot | null;
  context?: BoundNodeContext | null;
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

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await browser.runtime.sendMessage({ type: "LOAD_CONTEXT" }) as ViewState;
      setState(next);
      if (!next.connected) setMessage("");
    } catch {
      setError("无法连接 Blueprint 后台，请重新打开侧边栏。");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const listener = (_tabId: number, change: { url?: string }) => {
      if (change.url) void load();
    };
    browser.tabs.onUpdated.addListener(listener);
    return () => browser.tabs.onUpdated.removeListener(listener);
  }, [load]);

  async function connect() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await browser.runtime.sendMessage({ type: "AUTH_CONNECT" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error && caught.message === "AUTH_CANCELLED" ? "你取消了授权，Blueprint 没有获得访问权限。" : "授权未完成，请确认 Web 已登录后重试。");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await browser.runtime.sendMessage({ type: "AUTH_DISCONNECT" });
      setState({ connected: false });
      setMessage("扩展会话已退出。你可以在 Web 设置中撤销完整授权。");
    } catch {
      setError("暂时无法退出扩展会话，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function startLearning() {
    if (!state.context) return;
    setBusy(true);
    setError("");
    try {
      const result = await browser.runtime.sendMessage({ type: "START_SESSION", context: state.context }) as { ok: boolean; queued?: boolean };
      if (!result.ok) {
        setError("学习会话被拒绝。请重新授权，或回到 Web 检查该节点是否仍然存在。");
        setBusy(false);
        return;
      }
      setMessage(result.queued ? "网络不可用，学习会话已进入待同步队列。" : "学习会话已写入你的蓝图。");
      await load();
    } catch {
      setError("无法保存学习会话，请重新打开侧边栏后重试。");
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setError("");
    try {
      const result = await browser.runtime.sendMessage({ type: "RETRY_OUTBOX" }) as { recovered: number; pending: number; rejected: number };
      if (result.rejected) setError(`${result.rejected} 条记录已失效，请回到 Web 检查节点或重新授权。`);
      else setMessage(result.recovered ? `已恢复 ${result.recovered} 条学习会话。` : result.pending ? "仍无法同步，记录会继续保留。" : "没有待同步记录。");
      await load();
    } catch {
      setError("暂时无法重试，待同步记录仍保存在本机。");
      setBusy(false);
    }
  }

  async function openNode(item: BoundNodeListItem) {
    await browser.runtime.sendMessage({ type: "OPEN_NODE", tabId: state.tabId, url: item.url });
  }

  return (
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
          {state.stale ? <Status tone="warning">当前显示缓存蓝图，网络恢复后可刷新。</Status> : null}
          {state.pending ? <Panel className="sync-card"><span>{state.pending} 条学习会话待同步</span><Button disabled={busy} onClick={() => void retry()}>重试</Button></Panel> : null}
          {state.context ? (
            <Panel className="context-card">
              <div className="label">当前视频对应</div>
              <p className="breadcrumb">{state.context.goalTitle} / {state.context.stageTitle}</p>
              <h2>{state.context.nodeTitle}</h2>
              <Button className="primary" disabled={busy} onClick={() => void startLearning()}>开始学习</Button>
            </Panel>
          ) : (
            <Panel className="context-card">
              <div className="label">当前页面</div>
              <h2>没有匹配的蓝图节点</h2>
              <p className="muted">从下面选择一个已绑定节点，或回到 Web 修改蓝图。</p>
            </Panel>
          )}
          <section className="node-list" aria-label="已绑定的 YouTube 节点">
            <div className="section-heading"><h2>可学习节点</h2><Button disabled={busy} onClick={() => void load()}>刷新</Button></div>
            {state.nodes?.length ? state.nodes.map((item) => (
              <button className="node-link" key={item.resourceBindingId} onClick={() => void openNode(item)}>
                <span className="node-context">{item.goalTitle} / {item.stageTitle}</span>
                <strong>{item.nodeTitle}</strong>
              </button>
            )) : <p className="empty">蓝图中还没有 YouTube 资源绑定。</p>}
          </section>
          <Button className="web-link" onClick={() => void browser.runtime.sendMessage({ type: "OPEN_WEB" })}>打开 Web 蓝图</Button>
        </>
      )}
    </main>
  );
}
