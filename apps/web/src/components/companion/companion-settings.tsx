"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import catalog from "@/lib/companion/shayna-catalog.json";
import {
  defaultPreferences,
  type CompanionPreferences,
} from "@/lib/companion/contracts";
import { companionRequest, errorText } from "@/lib/companion/runtime";
import { AvatarStage } from "./avatar-stage";
import type { AvatarCapabilities, AvatarController } from "./avatar-controller";
import "./companion.css";

export function CompanionSettings({
  initial = defaultPreferences,
  initialRevision = 0,
  preview = false,
  local = false,
}: {
  initial?: CompanionPreferences;
  initialRevision?: number;
  preview?: boolean;
  local?: boolean;
}) {
  const [value, setValue] = useState(initial),
    [saved, setSaved] = useState(initial),
    [revision, setRevision] = useState(initialRevision),
    [tab, setTab] = useState("形象"),
    [caps, setCaps] = useState<AvatarCapabilities>(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const avatar = useRef<AvatarController | undefined>(undefined);
  const patch = (changes: Partial<CompanionPreferences>) =>
    setValue((v) => ({ ...v, ...changes }));
  const save = async () => {
    setBusy(true);
    try {
      const data = await (
        await companionRequest({ operation: "preferences", value, revision })
      ).json();
      setRevision(data.revision);
      setSaved(data.value);
      setStatus("设置已保存");
    } catch (e) {
      setStatus(errorText((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="companion-settings">
      <section className="companion-settings-preview">
        <AvatarStage
          ref={avatar}
          compact
          value={value}
          onCapabilities={setCaps}
        />
        <Link className="companion-back" href="/">
          ← 返回蓝图
        </Link>
      </section>
      <section className="companion-settings-panel">
        <header>
          <span className="companion-eyebrow">YOUR COMPANION</span>
          <h1>管家设置</h1>
          <p>一位管家，她的每一种神态。</p>
        </header>
        <nav className="companion-tabs" aria-label="管家设置分类">
          {["形象", "表情", "动作", "语音"].map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="companion-settings-content">
          {tab === "形象" && (
            <>
              <label>
                形象版本
                <select
                  value={value.variant}
                  onChange={(e) =>
                    patch({
                      variant: e.target
                        .value as CompanionPreferences["variant"],
                    })
                  }
                >
                  {catalog.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <h2>服装部件</h2>
              <div className="companion-options">
                {catalog.costumes.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      disabled={!caps?.clothing[c.id]?.available}
                      checked={value.clothing[c.id] ?? true}
                      onChange={(e) =>
                        patch({
                          clothing: {
                            ...value.clothing,
                            [c.id]: e.target.checked,
                          },
                        })
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <h2>发型</h2>
              {catalog.hair.map((h) => (
                <label className="companion-slider" key={h.id}>
                  {h.label}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={value.hair[h.id] ?? 0}
                    onChange={(e) =>
                      patch({
                        hair: { ...value.hair, [h.id]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </>
          )}
          {tab === "表情" && (
            <>
              <p className="companion-muted">
                表情仅在这里预览，首页由管家结合语义表达。
              </p>
              <input
                aria-label="搜索表情或形变"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索表情或原始形变"
              />
              {[
                { id: "preset", label: "基础情绪" },
                { id: "visemes", label: "五元音口型" },
                { id: "gaze", label: "眨眼与视线" },
                ...catalog.groups,
              ].map((group) => {
                const entries = caps?.expressions.filter(
                  (c) =>
                    c.group === group.id &&
                    c.available &&
                    c.label.includes(search),
                );
                return entries?.length ? (
                  <section key={group.id}>
                    <h2>{group.label}</h2>
                    <div className="companion-expression-grid">
                      {entries.map((c) => (
                        <button
                          key={c.id}
                          onClick={() =>
                            avatar.current?.setExpression(c.id, 1, 8)
                          }
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
              <details>
                <summary>
                  {caps?.expressions.filter((c) => !c.available).length ?? 0}{" "}
                  项未启用及原因
                </summary>
                {caps?.expressions
                  .filter((c) => !c.available && c.label.includes(search))
                  .map((c) => (
                    <p className="companion-muted" key={c.id}>
                      {c.label}：{c.reason}
                    </p>
                  ))}
              </details>
              <button
                onClick={() => {
                  avatar.current?.reset();
                  setValue((v) => ({ ...v, raw: {} }));
                }}
              >
                恢复中性
              </button>
              <details>
                <summary>高级形变 · {caps?.raw.length ?? 0} 项</summary>
                {caps?.raw
                  .filter((s) => s.name.includes(search))
                  .map((s) => (
                    <label className="companion-slider" key={s.key}>
                      {s.name}
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={value.raw[s.key] ?? 0}
                        onChange={(e) =>
                          patch({
                            raw: {
                              ...value.raw,
                              [s.key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
              </details>
            </>
          )}
          {tab === "动作" && (
            <>
              <div className="companion-expression-grid">
                {[
                  { id: "idle", name: "自然待机" },
                  { id: "wave", name: "挥手" },
                  { id: "stand", name: "站立" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      avatar.current?.playMotion(
                        m.id as "idle" | "wave" | "stand",
                      )
                    }
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <p className="companion-muted">
                这些是额外适配的动作。原包没有内置全身动作；挥手结束后会回到待机。
              </p>
              <button onClick={() => avatar.current?.stopMotion()}>
                停止动作
              </button>
            </>
          )}
          {tab === "语音" && (
            <>
              <label>
                管家音色
                <select
                  value={value.voice}
                  onChange={(e) =>
                    patch({
                      voice: e.target.value as CompanionPreferences["voice"],
                    })
                  }
                >
                  <option value="zh_female_vv_jupiter_bigtts">
                    Vivi · 女声
                  </option>
                  <option value="zh_female_xiaohe_jupiter_bigtts">
                    小何 · 女声
                  </option>
                  <option value="zh_male_yunzhou_jupiter_bigtts">
                    云舟 · 男声
                  </option>
                  <option value="zh_male_xiaotian_jupiter_bigtts">
                    小天 · 男声
                  </option>
                </select>
              </label>
              <label className="companion-slider">
                播放音量
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={value.volume}
                  onChange={(e) => patch({ volume: Number(e.target.value) })}
                />
              </label>
              <p>保存后，重新开启首页语音即可使用新音色。</p>
              <p className="companion-muted">
                点击麦克风开启连续对话，直接说话即可打断回复。浏览器需要麦克风权限。
              </p>
            </>
          )}
        </div>
        <footer>
          <span role="status">
            {preview
              ? "本地预览，不会保存账号设置"
              : status || (local ? "设置仅保存在这台电脑" : "")}
          </span>
          <div>
            <button
              disabled={busy}
              onClick={() => {
                setValue(saved);
                avatar.current?.reset();
              }}
            >
              撤销预览
            </button>
            <button
              disabled={busy}
              onClick={() => setValue(defaultPreferences)}
            >
              恢复默认
            </button>
            <button
              className="companion-primary"
              disabled={busy || preview}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "保存设置"}
            </button>
          </div>
          <small>Shayna ©まつりば · 私有本地展示</small>
        </footer>
      </section>
    </main>
  );
}
