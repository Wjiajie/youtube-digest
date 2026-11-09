# VRM P0 Spike：可动化身舞台

> 2026-10-18。范围：用一个已验证的 VRM 1.0 sample，在 Blueprint 的 Next.js 应用里跑通「加载 → 待机 → 眨眼 → 呼吸 → 看镜头 → 口型」，作为后续正式化身的技术验证。不是产品页面，不读取账号数据。

## 入口

- 页面：`/scenes/avatar`
- 本地启动：

```bash
npm run dev --workspace @blueprint/web -- --hostname 127.0.0.1 --port 3100
# 打开 http://127.0.0.1:3100/scenes/avatar
```

## 已实现

| 能力 | 实现 |
| --- | --- |
| VRM 加载 | `@pixiv/three-vrm` 3.5.5 + `VRMLoaderPlugin`，支持 VRM 0.x / 1.0 |
| 自动构图 | 载入后按包围盒计算相机距离，人物居中 |
| 待机姿势 | 运行时把 T-pose 手臂放下；VRM 0.x / 1.0 使用不同旋转方向 |
| 眨眼 | `blink` 表情 0→1→0，约 0.14s；支持「眨一下眼」按钮强制触发 |
| 呼吸 | 胸腔骨骼轻微缩放 + 躯干微摆，约 13 次/分钟 |
| 看镜头 | `vrm.lookAt.target = camera`，由 three-vrm 处理视线 |
| 口型 | Web Audio `AnalyserNode` 取音量 → VRM 的 `aa/ih/ou`；中文 TTS 测试音频 |
| 状态 | 加载 / 已就绪 / 失败；实时 FPS；按钮禁用态 |
| 降级 | WebGL 不可用或加载失败时显示错误文案；页面无账号依赖 |

## 实测

- **浏览器**：headed Chromium（Playwright，禁用后台节流），1600×1000，DPR 1。
- **帧率**：待机 120 fps；说话中 120 fps；结束 114 fps。
- **交互**：点击「说话测试」后按钮变为「正在说话…」，口型可见；音频结束后恢复。
- **控制台**：无应用错误；两条静态资源 404（favicon 类，不影响功能）。
- **headless 说明**：ego-browser 的窗口被遮挡时 Chrome 会把 rAF 节流到 1–2 fps，这是浏览器行为，不是应用性能；headed 实测 120 fps。


## 资产

| 文件 | 说明 |
| --- | --- |
| `apps/web/public/vrm/avatar-sample.vrm` | pixiv 的 `VRM1_Constraint_Twist_Sample`（10.7 MB）。VRM 1.0 license：commercialUsage corporation、allowRedistribution、可修改；仅用于 P0，不是正式角色 |
| `apps/web/public/audio/avatar-p0.wav` | Windows SAPI 中文女声（Huihui）合成的测试语音，约 5 秒；仅用于口型验证 |

sample VRM 已加入 `.gitignore`（`apps/web/public/vrm/*.vrm`），不进入产品构建；换正式角色时替换该文件即可。

## 改动文件

- `apps/web/src/app/scenes/avatar/page.tsx`：公开 spike 路由
- `apps/web/src/components/avatar/avatar-spike.tsx`：Canvas、UI、音频上下文
- `apps/web/src/components/avatar/avatar-spike-loader.tsx`：`ssr: false` 动态加载
- `apps/web/src/components/avatar/vrm-model.tsx`：VRM、姿势、眨眼、呼吸、看镜头、口型
- `apps/web/src/components/avatar/avatar-spike.css`：舞台样式
- `apps/web/src/proxy.ts`：`/scenes/avatar`、`/vrm/*`、`/audio/*` 免 Auth（只含公开 sample）
- `apps/web/src/proxy.test.ts`：新增 3 条公开路由/资产测试
- `apps/web/package.json`：新增 `@pixiv/three-vrm`、`@pixiv/three-vrm-animation`

## 当前限制

- 没有 VRMA 待机动画；姿势是运行时程序化摆放，正式版应换成 VRMA / Mixamo 动作。
- 没有情绪、聊天、真实 TTS 接入；测试音频只验证口型链路。
- sample 是技术验证模型（白 T 恤/短裤），不是正式美术；正式角色需 VRoid 导出或自制。
- 口型 v1 是音量驱动，不是音素级；正式版可换 Audio2Face-3D / viseme 时间戳。
- 未做移动端性能、WebGL 降级海报、减少动态效果细节（已有基础样式，但未验收）。

## 下一批

1. 换正式 VRM（VRoid 导出或自制），保留同一路由做视觉对照。
2. 加 VRMA 待机/倾听/思考动作，替换程序化姿势。
3. 把 `AvatarController` 接进真实聊天/TTS：逐句口型、情绪标签、打断恢复。
4. 性能预算：模型压缩、KTX2/meshopt、移动端 30fps、离屏暂停。
5. 身份配方：把模型、配色、解锁项写入账号数据（与之前的 `AvatarIdentity` 设计对齐）。
