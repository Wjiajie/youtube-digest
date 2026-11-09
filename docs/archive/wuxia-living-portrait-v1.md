# 云水之间 V1：历史记录

本文件记录已被替代的 V1 实现和当时的验证结果。当前网页使用 [V2 独立分层与待机动作](../wuxia-living-portrait.md)，不能把下面的旧截图、旧指标或原图取色方案当成当前状态。

更新：2026-10-17。当前主页形象采用用户新确认的图片路线：画质优先，保留主体／背景视差和预设衣发动作。既有完整三维角色制作保留为历史支线，不再要求先通过母体 P1 才能推进本场景。

## 打开效果

- 完整交互场景：<http://127.0.0.1:3100/scenes/wuxia>
- 共享主页布局：<http://127.0.0.1:3100/scenes/wuxia?view=home>。该页面使用真实 HomeDashboard 组件及明确的空状态，不读取账号，不虚构目标。
- 离线审查包：实际录屏、桌面／窄屏／主页截图、证据摘要。
- 16 秒实际画布录像。录像展示最大风力及轻微视差，未使用图生视频。
- 源文件、构建身份和验收数据。

完整场景支持鼠标移动、方向键轻移视角、Home／归位、暂停、原图对照、视差开关和风力调节。手机使用纵向构图并保留页面滚动。

正式主页 `app/page.tsx` 已通过既有 identityScene 插槽接入同一组件，认证与业务读取逻辑保持原有职责。实际登录账号后的完整主页没有在本轮访问；公开主页布局只证明共享组件在该布局中的表现。

## 当前实现

人物、服饰、剑与舟来自原始主图，不重新生成脸、纹理或几何。可编辑 SVG 遮罩抽出前景，细分平面通过 GPU 顶点变形制作胸肩呼吸、长发末梢、自由衣摆及剑穗运动。脸、双手、剑与坐姿接触区不参与局部变形。

背景大部分仍采样原图。只有前景遮罩扩张出的补位区域采样既有 R06 干净背景，避免前景移动后出现旧人物残影；可见背景的原始景深和光照得以保留。水面轻微扰动与雾气漂移在背景着色器内完成。

主体和背景响应鼠标的方向相反，舟前部与人物使用不同偏移幅度。它提供受限 2.5D 空间感，不包含完整侧面、自由环绕、任意表情、真实布料或任意组合换装。

| 部分 | 源文件 |
|---|---|
| 原始输入 | `art/dual-theme/eastern/concepts/wuxia-lake-master-v2.png`、`eastern/references/r06-environment-clean-v1.png` |
| 可编辑遮罩 | `art/dual-theme/eastern/production/living-portrait-v1/foreground-mask.svg` |
| 资产构建 | `scripts/build-wuxia-living-assets.cjs` |
| 动作范围与数学检查 | `apps/web/src/lib/scene/living-portrait-motion.ts`、同名测试 |
| 场景渲染与资源生命周期 | `apps/web/src/components/wuxia/living-portrait-canvas.tsx` |
| 延迟加载、控制与回退 | `apps/web/src/components/wuxia/living-portrait.tsx`、同名测试 |
| 独立场景页面 | `apps/web/src/app/scenes/wuxia/` |
| 实际浏览器检查 | `scripts/verify-wuxia-living.cjs`、`scripts/verify-wuxia-living-touch.cjs` |
| 离线交付包构建 | `scripts/build-wuxia-living-review.cjs` |

没有新增 npm 依赖、部署推理服务、创建 Meshy 任务或调用付费生成服务。原图与遮罩共 **4,118,836 字节／3.93 MiB**，另需 JavaScript。两张原图按字节复制，清单保存 SHA-256；补位遮罩由源 SVG 确定性扩张生成。

图片是既有用户提供的素材，遮罩为本项目制作；不从项目代码的 MIT 许可推导图片许可。Three.js／React 等代码沿用现有依赖及其许可。本轮未引入额外模型权重或示例模型。

## 加载、暂停与资源

原图在服务端 HTML 中即可显示。场景进入附近视口、读取系统动效偏好后才加载 Canvas；WebGL 或网络失败时保留原图，可重试。无 JavaScript 时仍显示原图并说明静态模式。

暂停、原图对照、离屏与页面隐藏停止持续渲染。时间增量有上限，恢复不会补算后台停留时间。减少动态效果时卸载 Canvas；退出该偏好后重新显示加载状态，防止尚未就绪便淡出原图。

取消加载会中止 fetch；迟到的纹理也会释放。场景卸载时释放独占纹理、材质和几何。桌面 DPR 上限 1.5，窄屏上限 1。当前画布使用两个几何和四张纹理，按无 mipmap 的 RGBA8 粗估纹理约 24 MiB，不包含渲染缓冲或驱动开销。

公开例外仅限 `/scenes/wuxia` 本身及既有 `/preview`；相似路径仍执行原认证流程。资源是正式发布目录中的固定图片／SVG，不使用读取本地任意文件的开发接口。

## 实际验证

正式构建 ID、最终测试数及机器原始数据以审查包 JSON 为准。本轮最终全量测试、TypeScript 检查和正式 Web 构建均通过；最终测试包含新增的页面隐藏事件约束。

Windows Chrome 使用 AMD Radeon 8060S／ANGLE D3D11，在 1344×757 画布下测量 **60.01 秒**：场景回调 **3601 次，约 60.0 次／秒**；浏览器 RAF 间隔中位数 **16.7ms**、P95 **17.8ms**、最大 **18.6ms**。这些是浏览器回调测量，不是显示器实际呈现帧率，也不代表手机性能。

| 项目 | 证据 |
|---|---|
| 独立视差 | 图像区域匹配：主体向右 11px，背景向左 10px；不是整图一起移动 |
| 基本动作与脸部保护 | 固定视角的脸部区域像素差为 0；头发、衣摆和胸肩区域发生可测变化；同时人工查看截图 |
| 暂停 | 时钟与实际画布截图均保持相同 |
| 原图对照／键盘 | 实际浏览器切换原图、方向键及归位 |
| 失败恢复 | 网络失败保留原图并重试成功；WebGL 上下文丢失后重试成功；禁用 WebGL／JavaScript 时保留原图 |
| 窄屏 | 390px 视口无水平溢出；DPR=3 的触摸模拟中画布宽 362px，触摸拖动页面滚动 68px |
| 资源 | 三次重入均为每个渲染器四纹理、两几何；不等同于全局 GPU 内存泄漏证明 |
| 输入身份 | 实际 HTTP 图片及 SVG 的 SHA-256 均匹配构建清单 |
| 外部请求与错误 | 正常浏览器验收中无外部请求、无控制台错误或未处理异常 |

原始证据：`.goal-loop/evidence/wuxia-living-2026-10-17/production/`。其中 `browser-checks.json`、`touch-checks.json`、录像及截图绑定本次正式构建；`build.log`、`typecheck.log` 和 `vitest-full.json` 保存代码侧结果。

Headless Chrome 未将后台标签页标记为隐藏，因此真实后台标签行为没有平台实测；对应的隐藏／恢复事件与用户暂停优先级已有组件测试，离屏暂停有实际运行证据。实体 Android／iPhone Safari、登录态完整主页、长时间全局显存稳定性和用户最终美术签收仍是独立事项。

### 验证中修正的既有测试夹具

全量回归暴露了翻译查询超时测试的不稳定性。局部复现发现：Node 24 中，mock 创建的临时 Request 派生 signal 若被回收，原始 signal 已取消但 mock Promise 不结束；保留 Request 时结束。复现脚本及结果在上述证据目录的 `abort-probe.cjs`／`.log`。

该测试现在直接监听 fetch 实际收到的 signal，并保留已有超时、503 和返回内容断言，同时处理已经取消的情况。翻译业务实现没有因本任务修改；完整测试文件 38 项及最终全量回归通过，没有跳过或降低有效断言。

## 重建与运行

使用项目已有 Node 环境执行：

```powershell
node scripts/build-wuxia-living-assets.cjs
npm run build:web
npm run start -w @blueprint/web -- --hostname 127.0.0.1 --port 3100
```

浏览器验收及导出（保持上面的正式服务运行）：

```powershell
node scripts/verify-wuxia-living.cjs --production
node scripts/verify-wuxia-living-touch.cjs
npx vitest run --reporter=json --outputFile=.goal-loop/evidence/wuxia-living-2026-10-17/vitest-full.json
node scripts/build-wuxia-living-review.cjs
node scripts/verify-wuxia-living-review.cjs
```

本轮使用 Node 24.19.0 进行 Vitest 和构建。本机默认 Node 26 与部分 JSDOM 全局对象存在差异；可用 `C:/Users/jiaji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe` 调用 `node_modules/vitest/vitest.mjs`，代替上面的 npx 命令。开发时也可沿用 `npm run dev:web -- --hostname 127.0.0.1 --port 3100`。不要让开发服务与正式构建同时修改同一 `.next` 目录，也不要在性能测量中热更新或并发执行构建。
