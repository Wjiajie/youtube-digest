"use client";

import { useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import { ThemeSurface, type ThemeId } from "@blueprint/ui/theme";
import { ThemePicker } from "@blueprint/ui/theme-picker";
import "./specimen.css";

export function ThemeSpecimen() {
  const [theme, setTheme] = useState<ThemeId>("cyberpunk");
  const [confirmed, setConfirmed] = useState(false);
  return <ThemeSurface theme={theme}>
    <main className="specimen-shell">
      <header className="specimen-header">
        <div><p className="brand">BLUEPRINT / DESIGN LAB · 01</p><h1>让每一步，有迹可循。</h1>
          <p className="subtle">内部控件样本 · 非个人蓝图 · 不调用 Agent、不写入云端。</p>
          <a href="/design/assets" style={{ color: "var(--bp-accent)" }}>打开真实人物试装 →</a></div>
        <ThemePicker value={theme} onChange={setTheme} />
      </header>
      <div className="specimen-grid">
        <section aria-label="路径与记录样本">
          <Panel className="specimen-card">
            <p className="brand">方向 / INTENTION</p><h2>用一个能展示的作品，验证新技能</h2>
            <p>不是完成一串视频，而是留下能够解释、能够改进的成果。</p>
            <div className="specimen-facts"><span>示例周期 <strong>12 周</strong></span><span>每周投入 <strong>5 小时</strong></span><span>当前重点 <strong>第 1 阶段</strong></span></div>
            <ol className="specimen-path">
              <li><span className="specimen-step">01</span><div><strong>学习 · 建立基础概念</strong><p className="subtle">视频是可选资源，理解之后再动手。</p></div></li>
              <li><span className="specimen-step">02</span><div><strong>实践 · 做出第一个可验证的作品</strong><p className="subtle">下一步：选择一个足够小的问题，记录解决过程。</p></div></li>
              <li><span className="specimen-step">03</span><div><strong>检查点 · 用成果判断下一步</strong><p className="subtle">观看时长不等于掌握，由用户明确确认。</p></div></li>
            </ol>
          </Panel>
          <Panel className="specimen-card">
            <p className="brand">记录 / EVIDENCE</p><h2>今天，留下了什么？</h2>
            <form onSubmit={(event) => { event.preventDefault(); setConfirmed(true); }}>
              <label className="field"><span>私人记录（切换主题不会清除输入）</span><textarea rows={4} placeholder="写下作品、发现，或仍然卡住的地方……" /></label>
              <label className="field"><span>作品链接（选填）</span><input type="url" placeholder="https://" /></label>
              <div className="specimen-actions"><Button type="submit" className="primary">验证确认状态</Button><Button type="button" onClick={() => setConfirmed(false)}>重置确认状态</Button></div>
              <Status tone={confirmed ? "success" : "neutral"}>{confirmed ? "样本已确认，未保存到任何账号。" : "仅用于验证控件。输入只保留在本页，刷新后清除。"}</Status>
            </form>
          </Panel>
        </section>
        <aside aria-label="紧凑学习侧栏样本">
          <ThemeSurface theme={theme} density="compact">
            <Panel className="specimen-card specimen-companion">
              <p className="brand">伴随学习 / COMPANION</p><h2>回到你的目标</h2><p className="subtle">桌面路径 → 基础理解 → 学习节点</p>
              <hr /><p>为什么学这一节</p><p>理解关键概念，为下一次独立实践做准备。</p>
              <Button type="button" disabled>继续学习（样本不可播放）</Button>
              <p className="specimen-caption">以下状态并列展示仅用于设计核验，非同时发生。</p>
              <Status tone="progress">正在准备字幕，请稍候。</Status>
              <Status tone="pending">离线 · 1 条私人记录等待同步。</Status>
              <Status tone="warning">资源暂不可用，可以替换。</Status>
              <Status tone="danger">保存被拒绝，草稿仍保留。</Status>
              <Status tone="success">记录已同步（示例状态）。</Status>
            </Panel>
          </ThemeSurface>
          <p className="specimen-caption">本页不含人物或 3D 资产，不作为正式双主题美术验收。账号偏好与扩展同步在后续批次接入。</p>
        </aside>
      </div>
    </main>
  </ThemeSurface>;
}
