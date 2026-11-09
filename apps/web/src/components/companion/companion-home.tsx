"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  defaultPreferences,
  type CompanionPreferences,
  type Message,
  type PendingAction,
} from "@/lib/companion/contracts";
import {
  CompanionRuntime,
  companionRequest,
  type CompanionState,
} from "@/lib/companion/runtime";
import { AvatarStage } from "./avatar-stage";
import type { AvatarController } from "./avatar-controller";
import type { AvatarCapabilitiesSnapshot } from "@/lib/companion/avatar-capabilities";
import "./companion.css";

function Icon({ name }: { name: "mic" | "send" | "menu" | "stop" }) {
  const paths = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
      </>
    ),
    send: <path d="m5 12 7-7 7 7M12 5v15" />,
    menu: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const phaseText = {
  idle: "把想法说给我听",
  connecting: "正在连接语音…",
  listening: "我在听，随时可以说话",
  thinking: "正在想一想…",
  speaking: "正在回应，你可以直接打断",
  reconnecting: "正在恢复语音连接…",
};

export function ActionCard({
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  action: PendingAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title =
    action.kind === "goal"
      ? "一起确认这个目标"
      : action.kind === "progress"
        ? "记下这一步"
        : action.kind === "plan"
          ? "接下来这样走"
          : "正在整理计划";
  const p = action.payload;
  return (
    <section className="companion-action" aria-label="待确认提案">
      <span className="companion-eyebrow">YOUR NEXT STEP</span>
      <h2>{title}</h2>
      {action.kind === "goal" && (
        <>
          <p>{p.content.outcome}</p>
          <dl>
            <dt>目前起点</dt>
            <dd>{p.content.startingPoint}</dd>
            <dt>每周投入</dt>
            <dd>{p.content.weeklyMinutes} 分钟</dd>
            <dt>完成标准</dt>
            <dd>{p.content.successCriteria}</dd>
            {p.content.targetDate && (
              <>
                <dt>目标日期</dt>
                <dd>{p.content.targetDate}</dd>
              </>
            )}
            {p.content.constraints && (
              <>
                <dt>约束</dt>
                <dd>{p.content.constraints}</dd>
              </>
            )}
          </dl>
        </>
      )}
      {action.kind === "progress" && (
        <>
          <p>{p.nodeTitle}</p>
          <p>{p.text}</p>
          {p.artifactUrl && (
            <a href={p.artifactUrl} target="_blank" rel="noreferrer">
              查看成果链接 ↗
            </a>
          )}
          <small>
            {p.completed
              ? "确认后保存记录，并将此节点标为完成。"
              : "确认后仅保存记录。"}
          </small>
        </>
      )}
      {action.kind === "plan" && (
        <>
          <p>计划已准备好，请检查步骤与完成标准。</p>
          <details>
            <summary>展开完整计划</summary>
            {p.draft?.goals?.map((g: any) => (
              <div key={g.id}>
                <h3>{g.title}</h3>
                {g.stages.map((s: any) => (
                  <div key={s.id}>
                    <h4>{s.title}</h4>
                    <ol>
                      {s.nodes.map((n: any) => (
                        <li key={n.id}>
                          <strong>{n.title}</strong>
                          <p>{n.completionCriteria}</p>
                          <small>{n.estimatedMinutes ?? "待定"} 分钟</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ))}
          </details>
        </>
      )}
      {action.kind === "planning" ? (
        <p>可以继续交谈，完成后我会把计划带回来。</p>
      ) : (
        <footer>
          <button disabled={busy} onClick={onCancel}>
            暂不保存
          </button>
          <button
            className="companion-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "请稍候…" : "确认保存"}
          </button>
          <small>也可以说“确认保存”</small>
        </footer>
      )}
    </section>
  );
}
export function CompanionHome({
  preview = false,
  local = false,
}: {
  preview?: boolean;
  local?: boolean;
}) {
  const avatar = useRef<AvatarController | undefined>(undefined),
    runtime = useRef<CompanionRuntime | undefined>(undefined),
    avatarCapabilities = useRef<AvatarCapabilitiesSnapshot | null>(null),
    prefs = useRef<CompanionPreferences>(defaultPreferences);
  const [value, setValue] = useState(defaultPreferences),
    [state, setState] = useState<CompanionState>(),
    [text, setText] = useState(""),
    [menu, setMenu] = useState(false),
    [history, setHistory] = useState(false),
    [deletePrompt, setDeletePrompt] = useState(false),
    [older, setOlder] = useState<Message[]>([]),
    [historyError, setHistoryError] = useState("");
  useEffect(() => {
    const controller = new CompanionRuntime(
      setState,
      (cue, turn) => avatar.current?.applyAgentControl(cue, turn),
      (level) => avatar.current?.setLipLevel(level),
      (turn) => avatar.current?.setTurn(turn),
      () => prefs.current,
      (metric) => {
        if (process.env.NODE_ENV === "development")
          console.debug("blueprint.voice.metric", metric);
      },
    );
    runtime.current = controller;
    controller.setAvatarCapabilities(avatarCapabilities.current);
    void controller.refresh().then((data) => {
      if (data) {
        prefs.current = data.preferences.value;
        setValue(data.preferences.value);
      }
    });
    return () => {
      controller.dispose();
      runtime.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!state?.actions.some((a) => a.kind === "planning")) return;
    const timer = setInterval(() => {
      void companionRequest({ operation: "poll" })
        .then(() => runtime.current?.refresh())
        .catch(() => runtime.current?.refresh());
    }, 3000);
    return () => clearInterval(timer);
  }, [state?.actions]);
  useEffect(() => {
    if (!history && !menu) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".companion-history");
    if (history) dialog?.querySelector<HTMLElement>("button")?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHistory(false);
        setMenu(false);
      }
      if (e.key === "Tab" && history && dialog) {
        const nodes = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input,textarea,summary,[tabindex='0']",
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [history, menu]);
  const submit = () => {
    const message = text.trim();
    if (message) {
      setText("");
      void runtime.current?.sendText(message);
    }
  };
  const action =
    state?.actions.find((a) => a.kind !== "planning") ?? state?.actions[0];
  return (
    <main className="companion-home" data-testid="companion-home">
      <h1 className="companion-input-label">蓝图 · Shayna 管家</h1>
      <AvatarStage ref={avatar} value={value} onAgentCapabilities={(caps) => {
        avatarCapabilities.current = caps;
        runtime.current?.setAvatarCapabilities(caps);
      }} />
      <div className="companion-aura" aria-hidden="true" />
      <div className="companion-interaction" inert={history ? true : undefined}>
        {preview && (
          <p className="companion-preview-note">
            本地界面预览 · 真实会话需要登录并配置服务
          </p>
        )}
        {action && (
          <ActionCard
            action={action}
            busy={state?.busy ?? false}
            onConfirm={() => void runtime.current?.confirm(action.id)}
            onCancel={() => void runtime.current?.cancel(action.id)}
          />
        )}
        {state?.subtitle && (
          <div className="companion-subtitle" role="log" aria-live="polite">
            {state.subtitle}
          </div>
        )}
        {state?.error && (
          <div className="companion-error" role="alert">
            {state.error}
            <button onClick={() => void runtime.current?.refresh(true)}>
              重新连接
            </button>
          </div>
        )}
        <form
          className={`companion-composer ${state?.voice ? "is-listening" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="companion-input-label" htmlFor="companion-input">
            和 Shayna 对话
          </label>
          <textarea
            id="companion-input"
            rows={1}
            value={text}
            maxLength={8000}
            placeholder={state?.voice ? "也可以在这里输入…" : "说说你想做的事…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="companion-input-tools">
            <div className="companion-menu-wrap">
              <button
                type="button"
                className="companion-icon-button"
                aria-label="打开菜单"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Icon name="menu" />
              </button>
              {menu && (
                <nav className="companion-menu" aria-label="蓝图导航">
                  <Link href="/settings/companion">管家设置</Link>
                  <button
                    type="button"
                    onClick={() => {
                      setHistory(true);
                      setMenu(false);
                    }}
                  >
                    对话记录
                  </button>
                  <Link href="/paths">全部目标</Link>
                  <Link href="/progress">成长档案</Link>
                  {local ? (
                    <small>本机存储 · 不同步云端</small>
                  ) : (
                    <Link href="/settings/connections">扩展连接</Link>
                  )}
                </nav>
              )}
            </div>
            <span className="companion-sr-only" role="status">
              {phaseText[state?.phase ?? "idle"]}
            </span>
            <button
              type="button"
              className={`companion-icon-button companion-mic ${state?.voice ? "active" : ""}`}
              aria-label={
                state?.voice || state?.phase === "connecting"
                  ? "关闭语音"
                  : "开启连续语音"
              }
              aria-pressed={state?.voice ?? false}
              onClick={() =>
                state?.voice || state?.phase === "connecting"
                  ? runtime.current?.stopVoice()
                  : void runtime.current?.startVoice()
              }
            >
              <Icon name="mic" />
            </button>
            {state?.busy || state?.phase === "speaking" ? (
              <button
                type="button"
                className="companion-icon-button companion-send"
                aria-label="打断回复"
                onClick={() => runtime.current?.interrupt()}
              >
                <Icon name="stop" />
              </button>
            ) : (
              <button
                type="submit"
                className="companion-icon-button companion-send"
                aria-label="发送文字"
                disabled={!text.trim()}
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </form>
      </div>
      {history && (
        <div className="companion-modal-backdrop">
          <section
            className="companion-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <header>
              <h2 id="history-title">我们的对话</h2>
              <button
                onClick={() => setHistory(false)}
                aria-label="关闭对话记录"
              >
                关闭
              </button>
            </header>
            <p className="companion-muted">
              保留文字与已确认的行动，不保存原始录音。
            </p>
            <details className="companion-memory">
              <summary>对话记忆{state?.memory?.record ? ` · 第 ${state.memory.record.revision} 次整理` : ""}</summary>
              {state?.memory?.record ? <>
                <p>{state.memory.record.content.summary}</p>
                <ul>{state.memory.record.content.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul>
                {state.memory.record.content.openQuestions.length > 0 && <>
                  <p>还没有解决的事</p>
                  <ul>{state.memory.record.content.openQuestions.map((question, i) => <li key={i}>{question}</li>)}</ul>
                </>}
              </> : <p>{state?.memory?.available ? "积累足够对话后自动整理；最近的原文会保留在当前上下文中。" : "摘要存储暂未就绪，仍可使用最近对话继续交流。"}</p>}
              <p className="companion-muted">摘要可能遗漏细节，完整文字记录仍保留。删除对话记录时也会删除这份记忆。</p>
            </details>
            <button
              onClick={() => {
                const before = (older[0] ?? state?.messages[0])?.created_at;
                if (before)
                  void runtime.current
                    ?.history(before)
                    .then((messages) => setOlder([...messages, ...older]))
                    .catch(() => setHistoryError("较早记录读取失败，请重试。"));
              }}
            >
              加载更早记录
            </button>
            {historyError && <p role="alert">{historyError}</p>}
            <div className="companion-message-list">
              {[...older, ...(state?.messages ?? [])].map((m) => (
                <article key={m.id} className={m.role}>
                  <span>{m.role === "user" ? "你" : "Shayna"}</span>
                  <p>{m.text}</p>
                  {m.interrupted && <small>此回复已中断</small>}
                </article>
              ))}
            </div>
            <footer>
              {deletePrompt ? (
                <>
                  <span>
                    删除全部对话记录和对话记忆？已保存目标与进度会保留。
                  </span>
                  <button
                    onClick={() =>
                      void runtime.current
                        ?.clear()
                        .then(() => {
                          setOlder([]);
                          setDeletePrompt(false);
                        })
                        .catch(() => setHistoryError("删除未完成，请重试。"))
                    }
                  >
                    确认删除
                  </button>
                  <button onClick={() => setDeletePrompt(false)}>取消</button>
                </>
              ) : (
                <button onClick={() => setDeletePrompt(true)}>
                  删除对话记录
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
