import { ThemeSurface } from "@blueprint/ui/theme";
import { LivingPortrait } from "@/components/wuxia/living-portrait";
import { HomeDashboard } from "@/app/home-dashboard";
import "./scene-page.css";

export const metadata = { title: "云水之间 · Blueprint", description: "湖山晨雾，衣袂微动。一幅可以走近的江湖。" };

// Public artwork and an explicitly empty dashboard; this route never reads account data.
export default async function WuxiaScenePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const home = (await searchParams).view === "home";
  return <ThemeSurface theme="eastern"><div className="wuxia-gallery">
    <header className="wuxia-gallery-header"><a href="/preview" className="wuxia-gallery-brand">BLUEPRINT <span>山水 · 行旅</span></a>
      <nav aria-label="场景展示"><a href="/scenes/wuxia" aria-current={!home ? "page" : undefined}>山水全景</a><a href="/scenes/wuxia?view=home" aria-current={home ? "page" : undefined}>主页布局</a></nav>
    </header>
    {home ? <main className="shell wuxia-home-preview"><p className="wuxia-preview-note">主页布局预览 · 此处未连接账号，目标与成果区域展示真实的空状态。</p>
      <HomeDashboard goals={[]} evidence={{ ok: true, value: [] }} identityScene={<LivingPortrait embedded />} />
    </main> : <main className="wuxia-gallery-main">
      <div className="wuxia-gallery-intro"><div><p>江湖，不必远行。</p><h1>停一停，看云水慢下来。</h1></div><span>移动鼠标或使用方向键，轻移视角。<br />触屏可直接向下滚动。</span></div>
      <LivingPortrait />
      <footer className="wuxia-gallery-footer"><p>一叶轻舟，留一点时间给自己。</p><span>可暂停动效，也可对照原始画面。</span></footer>
    </main>}
  </div></ThemeSurface>;
}
