"use client";

import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import type { AccountPreferences, ApplicationResult } from "@blueprint/domain";
import { Button, Status } from "@blueprint/ui";
import { resolveTheme, themes, ThemeSurface, type ThemeId } from "@blueprint/ui/theme";
import { ThemePicker } from "@blueprint/ui/theme-picker";

type PreferenceResult = ApplicationResult<AccountPreferences>;
type Feedback = "ready" | "preview" | "saving" | "saved" | "unavailable" | "conflict" | "loading" | "session_changed";
const messages: Record<Feedback, string> = {
  ready: "账号外观 · 主题切换不会修改目标或学习记录。",
  preview: "当前为本页预览，尚未保存到账号。",
  saving: "正在保存主题…",
  saved: "主题已保存到账号。扩展将在重新读取时跟随。",
  unavailable: "暂时无法同步账号主题。当前选择和蓝图草稿仍保留，可重试。",
  conflict: "账号主题已在别处更改。请读取账号主题后再选择，蓝图草稿不受影响。",
  loading: "正在读取账号主题…",
  session_changed: "登录状态或账号已变化。请重新加载账号后继续，未提交的蓝图草稿仍保留在原蓝图下。",
};

export function AccountTheme({ initial, readAction, saveAction, children }: PropsWithChildren<{
  initial: PreferenceResult;
  readAction: () => Promise<PreferenceResult>;
  saveAction: (input: { theme: { id: ThemeId; version: number }; expectedRevision: number }) => Promise<PreferenceResult>;
}>) {
  const [state, setState] = useState(() => ({
    saved: initial.ok ? initial.value : null,
    selected: resolveTheme(initial.ok ? initial.value.theme : null).id,
    dirty: false,
    feedback: (initial.ok ? "ready" : "unavailable") as Feedback,
  }));
  const inFlight = useRef(false);
  const busy = state.feedback === "saving" || state.feedback === "loading";
  const sessionChanged = state.feedback === "session_changed";
  const fallback = state.saved && !Object.values(themes).some((theme) =>
    theme.id === state.saved?.theme.id && theme.version === state.saved.theme.version);

  async function save() {
    if (inFlight.current || !state.saved || !state.dirty || state.feedback === "conflict" || sessionChanged) return;
    inFlight.current = true;
    setState((previous) => ({ ...previous, feedback: "saving" }));
    try {
      const result = await saveAction({ theme: { id: state.selected, version: themes[state.selected].version }, expectedRevision: state.saved.revision });
      if (result.ok) setState((previous) => ({ ...previous, saved: result.value, dirty: false, feedback: "saved" }));
      else setState((previous) => ({ ...previous, feedback: failureFeedback(result.code) }));
    } catch {
      setState((previous) => ({ ...previous, feedback: "unavailable" }));
    } finally {
      inFlight.current = false;
    }
  }

  const read = useCallback(async (useAccountChoice = true) => {
    if (inFlight.current || sessionChanged) return;
    inFlight.current = true;
    setState((previous) => ({ ...previous, feedback: "loading" }));
    try {
      const result = await readAction();
      if (result.ok) setState((previous) => {
        if (!useAccountChoice && previous.dirty) {
          return { ...previous, feedback: previous.saved?.revision !== result.value.revision ? "conflict" : "preview" };
        }
        return { saved: result.value, selected: resolveTheme(result.value.theme).id, dirty: false, feedback: "ready" };
      });
      else setState((previous) => ({ ...previous, feedback: failureFeedback(result.code) }));
    } catch {
      setState((previous) => ({ ...previous, feedback: "unavailable" }));
    } finally {
      inFlight.current = false;
    }
  }, [readAction, sessionChanged]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void read(false); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [read]);

  return <ThemeSurface theme={sessionChanged ? "cyberpunk" : state.selected}>
    <div className="account-theme-page">
      <section className="account-theme-controls" aria-label="账号主题">
        <fieldset disabled={busy || sessionChanged}>
          <ThemePicker value={state.selected} onChange={(selected) => setState((previous) => ({
            ...previous, selected, dirty: true, feedback: previous.feedback === "conflict" ? "conflict" : "preview",
          }))} />
          <Button disabled={!state.dirty || !state.saved || state.feedback === "conflict"} onClick={() => void save()}>保存到账号</Button>
          <Button onClick={() => void read()}>读取账号主题</Button>
        </fieldset>
        <Status tone={state.feedback === "saved" ? "success" : state.feedback === "unavailable" || state.feedback === "conflict" ? "warning" : sessionChanged ? "danger" : "neutral"}>{messages[state.feedback]}</Status>
        {fallback && !sessionChanged ? <Status tone="warning">当前版本暂不支持账号保存的主题，暂用本地外观；不会自动改写账号偏好。</Status> : null}
        {sessionChanged ? <a className="bp-button" href="/">重新加载账号</a> : null}
      </section>
      {sessionChanged ? null : children}
    </div>
  </ThemeSurface>;
}

function failureFeedback(code: string): Feedback {
  if (code === "forbidden" || code === "unauthenticated") return "session_changed";
  return code === "version_conflict" ? "conflict" : "unavailable";
}
