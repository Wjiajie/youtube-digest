"use client";

import { useId, useState } from "react";
import { Button } from "@blueprint/ui";
import { ThemeSurface, type ThemeId } from "@blueprint/ui/theme";
import { ThemePicker } from "@blueprint/ui/theme-picker";
import "./public-preview.css";

const exampleNodes = [
  { kind: "学习", title: "拆解一段短演讲", minutes: 30, action: "选择一段你认可的五分钟演讲，观察它如何开场、展开与收束。",
    criteria: "写出开场、三个要点和结尾的作用，并用一句话概括主题。", outcome: "我发现开场的问题与结尾的行动呼应，删掉背景信息后，主题更容易记住。" },
  { kind: "实践", title: "录下自己的第一版", minutes: 35, action: "围绕一个熟悉的话题，写出提纲并录制一次完整表达。",
    criteria: "保留一段约五分钟的录音，包含一个核心观点、三个支撑要点和明确结尾。", outcome: "第一版用了六分钟。我保留了三个例子，标记了可以删减的一段铺垫。" },
  { kind: "检查点", title: "让听众复述你的重点", minutes: 20, action: "邀请一位愿意帮忙的听众聆听，先不解释，询问对方记住了什么。",
    criteria: "记录听众复述的核心观点、一个记住的例子，以及一处不清晰的地方。", outcome: "听众能说出主题，却混淆了第二个例子。我记录了原话，准备调整顺序。" },
  { kind: "复盘", title: "把反馈变成下一次修改", minutes: 15, action: "比较自己的预期与听众反馈，挑选一个优先改进点，再录一次开场。",
    criteria: "写下一项保留、一项调整和下一次验证方法，并留下修改后的开场录音。", outcome: "保留问题式开场；先讲结论再举例。下次请另一位听众复述，比较是否更清楚。" },
] as const;

export function PublicPreview() {
  const [theme, setTheme] = useState<ThemeId>("cyberpunk");
  const [expanded, setExpanded] = useState(false);
  const pathId = useId();
  return <ThemeSurface theme={theme}>
    <div className="public-preview">
      <header className="preview-header"><div className="preview-wordmark">BLUEPRINT<span>把方向变成路径</span></div>
        <div className="preview-header-actions"><ThemePicker value={theme} onChange={setTheme} /><a href="/login">跳过示例，登录</a></div>
      </header>
      <main className="preview-main">
        <section className="preview-intro" aria-label="Blueprint 产品介绍"><div className="preview-intro-copy"><span className="brand">A direction of your own</span>
          <h1>不只想变得更好。<br /><span>看见下一步怎么走。</span></h1>
          <p>把想实现的改变，拆成可以审阅的路径。知道此刻做什么、怎样判断做到了，再用真实的收获决定下一步。</p>
          <div className="preview-intro-actions"><a className="bp-button primary" href="/login?next=%2Fgoals%2Fnew">建立我的目标</a><span>也可以先向下看看，不必登录。</span></div>
          <p className="preview-invitation">当前仅面向受邀账号，暂不开放自助注册。</p>
        </div><figure className="preview-identity" aria-label="示例身份静态回退">
          <div className="preview-identity-label"><span>示例身份</span><span aria-hidden="true">YOUR OWN HORIZON</span></div>
          <svg viewBox="0 0 400 410" className="preview-identity-art" aria-hidden="true" focusable="false">
            <g fill="none" className="preview-art-landscape"><path d="M12 310 78 239 122 263 185 182 233 238 284 206 388 303M28 339l78-43 77 23 48-20 127 40" /><ellipse cx="201" cy="359" rx="103" ry="20" /><circle cx="201" cy="163" r="115" /><path className="preview-art-grid" d="M52 74h296M52 109h296M52 144h296M82 52v219M320 52v219" /></g>
            <g className="preview-art-person"><path d="M183 99q18-14 36 0l6 29-12 25h-24l-12-25z" /><path d="m179 165-32 17-28 84 18 7 29-61-6 72-20 71h31l30-68 25 68h30l-18-78-4-65 28 54 19-8-32-77-31-16-20 14z" /></g>
            <g fill="none" className="preview-art-detail"><path d="m179 165 22 41 17-41M201 206v69M169 241l32 12 30-12M184 117h34" /><circle cx="201" cy="219" r="6" /><path d="M113 351h176" /></g>
          </svg>
          <figcaption><span className="preview-identity-mark" aria-hidden="true">行</span><div><strong>同一个你，不同的风景。</strong><p>原创静态轮廓 · 二维回退，正式 3D 未完成。</p></div></figcaption>
        </figure>
        </section>
        <p className="preview-theme-note">两种主题，同一条路径。这里只切换本页表现，不会改变账号主题，也不会跨登录保存选择。</p>
        <section className="preview-example" aria-label="虚构示例目标与路径">
          <div className="preview-example-heading"><span className="preview-example-badge">虚构示例</span><p>准备清晰的五分钟公开表达</p></div>
          <div className="preview-example-brief"><span className="brand">One goal, four kinds of steps</span><h2>不是收藏更多，<br />而是完成一次表达。</h2>
            <p>这个预先编写的目标展示路径的结构：先观察，再练习，用反馈检查，最后调整。不是保证有效的完整课程，也不是已运行的 Agent 输出。</p>
            <ol className="preview-path-summary" aria-label="示例路径顺序">{exampleNodes.map((node, index) => <li key={node.kind}><span aria-hidden="true">0{index + 1}</span><strong>{node.kind}</strong><small>{node.title}</small></li>)}</ol>
            <Button className="preview-path-toggle" aria-expanded={expanded} aria-controls={pathId} onClick={() => setExpanded(value => !value)}>{expanded ? "收起示例路径" : "展开完整示例路径"}</Button>
          </div>
          <div id={pathId} hidden={!expanded} className="preview-expanded-path" aria-label="完整示例路径">
            <ol>{exampleNodes.map((node, index) => <li key={node.kind}><article>
              <div className="preview-node-heading"><span className="preview-node-number" aria-hidden="true">0{index + 1}</span><div><span className="preview-node-kind">示例 · {node.kind}</span><h3>{node.title}</h3></div><span className="preview-node-time">预计 {node.minutes} 分钟</span></div>
              <p className="preview-node-action">{node.action}</p>
              <div className="preview-node-detail"><div><h4>完成依据</h4><p>{node.criteria}</p></div><div className="preview-node-outcome"><h4>示例成果 · 虚构文字</h4><p>{node.outcome}</p></div></div>
            </article></li>)}</ol>
          </div>
        </section>
        <section className="preview-capabilities" aria-label="产品能力边界">
          <div className="preview-available" aria-label="当前可用能力"><span className="brand">Available now</span><h2>当前可用</h2>
            <ul><li><strong>定义目标</strong><span>说清期望、起点、可用时间与成功标准。</span></li><li><strong>审阅路径</strong><span>核对阶段、节点、投入与完成依据；正式修改由你确认。</span></li><li><strong>记录成果</strong><span>留存私人收获，按依据明确自评，不把记录当作能力认证。</span></li></ul>
          </div>
          <div className="preview-future" aria-label="后续愿景"><span className="brand">Still ahead</span><h2>后续愿景</h2><p className="preview-future-state">以下能力尚未接通</p>
            <p>Agent Skills、自动推荐、字幕工作台与正式 3D 身份体验，仍在后续计划中。这一页不演示它们已经工作，也不自动请求 Agent。</p>
            <p>现在，先让目标、行动和真实记录连在一起。</p>
          </div>
        </section>
        <footer className="preview-footer"><strong>示例留在示例里。你的蓝图，从你的选择开始。</strong><p>本页的目标、成果与身份图形均为预先编写的虚构示例，不会保存、导入或计入个人账号。示例中的资源选择也不代表已检索或验证任何视频。</p></footer>
      </main>
    </div>
  </ThemeSurface>;
}
