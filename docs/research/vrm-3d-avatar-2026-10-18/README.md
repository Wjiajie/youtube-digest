# VRM 3D 化身：AITuberKit 拆解 · 落地方案 · 2026 技术地图

> 调研日期：2026-10-18。目标：确认 aituberkit.com 的实现是否开源、能否复刻到 Blueprint，并盘点 VRM 3D 路线当前最先进的论文与开源代码。
> 结论先行：**AITuberKit 完全开源，但商用需要授权；它的视觉效果并不神秘，核心是一个全屏透明 WebGL 画布 + VRM + 待机 VRMA + 眨眼/看镜头/音量口型/情绪表情 + CSS 背景 + 聊天 UI。** 你的项目现有 R3F / three / three-vrm-springbone 已经能接住，缺的是 `@pixiv/three-vrm`、一个 VRM 资产和一套行为控制。


---

## 0. 一句话结论

| 问题 | 答案 |
| --- | --- |
| AITuberKit 开源吗？ | 是，完整源码在 [tegnike/aituber-kit](https://github.com/tegnike/aituber-kit)，Next.js + React + three-vrm |
| 能直接拿来商用吗？ | **不能免费商用**。v2.0.0 起为自定义许可：个人/教育/非营利免费；商用需购买 ¥100,000 / ¥300,000 / ¥1,000,000 三档授权（一次性） |
| 演示里的 Nike-chan 模型能用吗？ | **不能**。仓库内 VRM 模型仅限个人/非商用演示，禁止商用、修改、再分发 |
| 复刻成本高吗？ | 不高。核心 viewer + 行为约 500–800 行；难的是 VRM 资产制作，不是代码 |
| 现在该做什么？ | 先在 Blueprint 里做一个 R3F + three-vrm 的 spike（1 周），验证 60fps / 首包 / 表情口型，再决定资产与创作管线 |

补充两点：

- **v1.x 是 MIT**；从 v2.0.0 起才改为自定义许可。评估期内部试用免授权费；一旦对外商用或再分发，需要购买对应档位。
- AITuberKit 是 Next 15 / React 18；Blueprint 是 Next 16 / React 19。直接 fork 会带上它的 store、TTS、UI 体系，迁移成本不低。**建议只借鉴架构，viewer/行为层自己实现**（约 500–800 行）。

---

## 1. AITuberKit 的实现拆解（文件级）

### 1.1 技术栈

| 层 | 选择 |
| --- | --- |
| 框架 | Next.js 15 + React 18 + TypeScript |
| 3D | three 0.167 + @pixiv/three-vrm 3.4.4（AITuberKit 内置了一份 VRMAnimation loader） |
| 状态 | zustand（settings / home / slide / toast 等 store） |
| AI | Vercel AI SDK + 十余家 provider（OpenAI / Anthropic / Google / DeepSeek / Ollama…） |
| TTS | VoiceVox / Style-Bert-VITS2 / ElevenLabs / OpenAI / Azure / Google / AivisSpeech / GSVI / Koeiromap 等 |
| 2D 备选 | PixiJS + Live2D、PNGTuber |
| UI | Tailwind + headlessui + heroicons |

### 1.2 渲染链路（关键文件）

```text
src/pages/index.tsx
  └─ <VrmViewer />                      全屏 <canvas>，透明背景
       └─ src/features/vrmViewer/viewer.ts
            ├─ WebGLRenderer({ alpha: true, antialias: true })
            ├─ PerspectiveCamera(20, w/h, 0.1, 20) at (0, 1.3, 1.5)
            ├─ DirectionalLight + AmbientLight
            ├─ OrbitControls（右键平移 / 左键旋转 / 滚轮缩放）
            ├─ 加载 /idle_loop.vrma 作为待机动作
            └─ 每帧 model.update(delta) + renderer.render()
       └─ src/features/vrmViewer/model.ts
            ├─ GLTFLoader + VRMLoaderPlugin + 自定义 lookAt 平滑插件
            ├─ VRMUtils.rotateVRM0（兼容 VRM 0.x）
            ├─ AnimationMixer（VRMA → AnimationClip）
            ├─ EmoteController（表情 / 眨眼 / 口型 / 视线）
            ├─ PoseManager（思考姿势 / 动作 JSON）
            └─ LipSync（Web Audio AnalyserNode）
```

### 1.3 关键行为是怎么做的

| 效果 | 实现 | 代码位置 |
| --- | --- | --- |
| 待机动作 | 加载 /idle_loop.vrma，vrmAnimation.createAnimationClip(vrm) 后交给 AnimationMixer 循环播放 | viewer.ts + lib/VRMAnimation |
| 眨眼 | AutoBlink 用计时器把 blink 表情在 0/1 之间切换；情绪播放时先暂停自动眨眼，等眼睛睁开再切表情 | emoteController/autoBlink.ts |
| 看镜头 | vrm.lookAt.target = camera 上的一个空 Object3D；眼球平滑由 VRMLookAtSmoother 做 | emoteController/autoLookAt.ts |
| 口型 | Web Audio AnalyserNode.getFloatTimeDomainData 取峰值，sigmoid 归一化后写入 VRM 表情 aa；中性表情权重 0.5、有情绪时 0.25 | lipSync/lipSync.ts + model.ts |
| 情绪 | 预先映射到 VRM 1.0 的 happy / angry / sad / relaxed / surprised；playEmotion 直接 expressionManager.setValue | expressionController.ts |
| 思考姿势 | VRMA / JSON 姿态由 scripts/vrma_to_json.py 转成关键帧，PoseManager 在等待模型回复时叠加 | lib/VRMAnimation/poseManager.ts |
| 语音 | 多 TTS provider → ArrayBuffer / PCM16 stream → LipSync.playFromArrayBuffer 或 playPcm16Stream | features/messages/* |
| 对话 | AI SDK 流式响应 → 切句 → 逐句 TTS + 表情 + 口型；Talk 结构为 { emotion, message, motion?, buffer? } | features/chat/*、features/messages/* |
| 背景 | 设置里的背景图 / 视频 / 摄像头；画布透明，UI 叠在上面；另有 screen-blend lighting 把分享屏幕的颜色投到角色光照 | pages/index.tsx、screenLighting.ts |

### 1.4 它“看起来高级”的原因

不是模型或算法，而是**构图与完成度**：

- 全屏 16:9 舞台，人物居中偏下，镜头接近平视（fov 20，压缩透视）。
- 透明画布 + 柔和渐变/图案背景，人物像“站在页面里”，而不是嵌在框里。
- UI 只保留：左上角菜单、底部气泡/建议问题、底部输入框；没有仪表盘式侧栏。
- 待机动作 + 眨眼 + 看镜头 + 口型，这四个小动作就足以让人物“活”起来。
- 说话时逐句高亮、气泡与口型同步，形成“她在回应我”的错觉。

---

## 2. 复刻到 Blueprint：推荐架构

### 2.1 你现有的家底

apps/web/package.json 已经有：

```text
@react-three/fiber 9.7.0
@react-three/drei 10.7.8
three 0.186.0
@pixiv/three-vrm-springbone 3.5.5
@dimforge/rapier3d-compat 0.21.0
@gltf-transform/*、meshoptimizer
```

需要补的只有：

```bash
npm install @pixiv/three-vrm@3.5.5 @pixiv/three-vrm-animation@3.5.5
```

> @pixiv/three-vrm 3.5.5 是 2026-10 的当前版本（MIT）；three-vrm-springbone 已经在依赖里，但建议统一到同一版本，避免 core 与 springbone 版本错位。

### 2.2 模块划分

```text
components/avatar/
├─ avatar-stage.tsx        <Canvas> + 灯光 + 相机 + 背景 + Suspense/ErrorBoundary
├─ vrm-avatar.tsx          VRM 加载、VRMUtils、每帧 vrm.update
├─ use-vrm-animation.ts    VRMA / AnimationMixer
├─ use-avatar-behavior.ts  眨眼 / 呼吸 / 看镜头 / 情绪
├─ use-lip-sync.ts         AudioContext + AnalyserNode → aa/ih/ou/ee/oh
├─ avatar-controller.ts    对外 API：speak(), setEmotion(), playPose(), stop()
└─ avatar-profile.ts       VRM URL、缩放、相机、表情映射、主题皮肤
```

### 2.3 最小可用代码骨架（原创，非复制 AITuberKit）

```tsx
"use client";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

function Avatar({ url, idleUrl }: { url: string; idleUrl: string }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });
  const vrm = useMemo(() => gltf.userData.vrm as VRM, [gltf]);
  const mixer = useMemo(() => new THREE.AnimationMixer(vrm.scene), [vrm]);
  const blink = useRef({ next: 2, phase: -1 });

  useEffect(() => {
    VRMUtils.rotateVRM0(vrm);          // 兼容 VRM 0.x
    vrm.scene.traverse((o) => (o.frustumCulled = false));
    return () => VRMUtils.deepDispose(vrm.scene);
  }, [vrm]);

  // 可选：待机 VRMA
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    loader.load(idleUrl, (g) => {
      const anim = g.userData.vrmAnimations?.[0];
      if (anim) mixer.clipAction(createVRMAnimationClip(anim, vrm)).play();
    });
  }, [idleUrl, mixer, vrm]);

  useFrame((_, delta) => {
    // 眨眼：0 → 1 → 0，约 0.14s
    const b = blink.current;
    b.next -= delta;
    if (b.next <= 0 && b.phase < 0) { b.phase = 0; b.next = 2 + Math.random() * 3; }
    if (b.phase >= 0) {
      b.phase += delta;
      const t = Math.min(1, b.phase / 0.14);
      vrm.expressionManager?.setValue("blink", t < 0.5 ? t * 2 : (1 - t) * 2);
      if (t >= 1) b.phase = -1;
    }
    // 呼吸：轻微 scale 胸/脊骨（更稳的做法见 three-vrm-utils 的 useVRMBreathing）
    const chest = vrm.humanoid.getNormalizedBoneNode("chest");
    if (chest) {
      const s = 1 + Math.sin(performance.now() / 1000 * 2 * Math.PI / 4.5) * 0.01;
      chest.scale.set(s, s, s);
    }
    mixer.update(delta);
    vrm.update(delta);                  // 表情 / 视线 / SpringBone
  });

  return <primitive object={vrm.scene} />;
}

export function AvatarStage(props: { url: string; idleUrl: string }) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 20, position: [0, 1.3, 1.5] }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[1, 1, 1]} intensity={1.8} />
      <Avatar {...props} />
    </Canvas>
  );
}
```

### 2.4 口型与情绪

- **口型 v1**：音量 → aa，足够让“说话”成立；中文可再加 ih/ou/ee/oh 的启发式映射。
- **口型 v2**：音素/viseme → 5 个元音权重；可用 Web Audio 的频谱粗糙估计，或调用 TTS 返回的音素时间戳。
- **情绪**：让 LLM 按句输出标签（如 [[emotion:happy]]），TTS 前解析；映射到 VRM 的 5 个预设。
- **注意**：情绪表情与眨眼、口型会抢同一批 BlendShape；需要权重仲裁（AITuberKit 的做法是情绪时降低口型权重、暂停自动眨眼）。

### 2.5 场景与 UI

- **背景**：CSS 渐变/图案/图片即可；不需要 3D 环境就能达到 AITuberKit 的效果。
- **画布**：透明、绝对定位铺满视口；UI 用普通 DOM 叠加，保证可访问性和窄屏。
- **UI**：左上菜单、底部建议问题、输入框、语音气泡；建议问题可来自你的目标/路径上下文，这是 Blueprint 的差异化。
- **降级**：WebGL 不可用 / 减少动效 / 低端机 → 静态海报 + DOM 信息，和现有 Living Portrait 的回退策略一致。
- **性能**：模型 5–10 MB、纹理 1K–2K、KTX2 + meshopt；离屏暂停；dpr 上限 2。

### 2.6 资产从哪来

| 方式 | 成本 | 许可 | 适用 |
| --- | --- | --- | --- |
| **VRoid Studio** 手工捏人 + 导出 VRM | 低 | 预设素材非 CC0；做“生成器”需 pixiv 授权；成品可商用 | 快速原型、赛博/动漫风 |
| **Blender + VRM Add-on** 自制基础体 | 高（美术） | 完全自有 | 武侠/水墨等定制风格 |
| **Character Studio**（MIT）Web 搭建器 | 中 | 代码 MIT，资产另核 | 模块化换装/配色 |
| **VTubeMe** 照片→rigged VRM | $7.99/次 | 商业服务 | 快速验证“像用户”的需求 |
| **CharacterGen + UniRig** | 高（研究） | Apache/MIT | 批量生成基础体（P3） |

---

## 2.7 已验证：sample VRM 与 VRoid 导出（2026-10-18）

### 结论

| 问题 | 结论 |
| --- | --- |
| VRoid Studio 免费吗？ | **免费**。官网 2.14.0 提供 Windows / macOS 安装包，Steam 也是 Free to Play；官方写明 “Free to Use … Models you create on VRoid Studio are yours to use freely” |
| 导出 VRM 要付费吗？ | **不要**。导出功能本身免费，没有付费墙；只有素材/服装/第三方模型可能收费 |
| 需要登录吗？ | 导出本地 VRM 不需要 pixiv 登录；上传 VRoid Hub 才需要 |
| 我能代操作导出吗？ | **不能可靠代操作**。VRoid Studio 没有 CLI / 脚本 API / 插件接口；开源的 mcp-vroid 也明确写了这一点，而且它只支持 Linux/Wayland，不支持你现在这台 Windows |
| 加载 sample VRM 有卡点吗？ | **没有**。已下载两个官方 sample 并在 Chrome 里用 three-vrm 3.5.5 成功加载 |

### 实测 1：VRM 1.0 sample（推荐用于 P0）

- 文件：VRM1_Constraint_Twist_Sample.vrm，10,776,032 字节。
- 结构：VRM 1.0；54 个人形骨骼；18 个表情（aa / ih / ou / ee / oh、blink、blinkLeft/Right、happy / angry / sad / relaxed / surprised、look 四向、neutral）；22 个 SpringBone group、13 个 collider、13 个 MToon 材质。
- 校验：gltf-validator **0 errors**、16 个 warning（主要是校验器不认识 VRMC_* 扩展，正常）。
- 浏览器加载：Chrome + three-vrm 3.5.5 成功渲染，height ≈ 1.615m；无控制台错误。


### 实测 2：VRoid sample（AvatarSample_A）

- 文件：AvatarSample_A.vrm，15,096,320 字节。
- 结构：VRM 0.x（UniGLTF-1.28）；54 骨骼；10 个 SpringBone group、10 个 collider；表情含 neutral / a / i / u / e / o / blink / angry / fun / joy / sorrow / surprised。
- 许可（VRoid Hub 页面）：Avatar 使用 Allow、Corporate use Allow、Individual commercial use Allow、Redistribution Allow、Alterations Allow、Attribution Not required。
- 注意：VRM 0.x 需要 three-vrm 的 VRMUtils.rotateVRM0；校验器有 1 个 legacy 扩展名 error 和 192,843 个 warning（绝大多数是 tangent space / 老资产细节），属于 VRM 0.x 常态，不影响 three-vrm 加载。
- 用途边界：VRoid sample 条款允许商用与修改，但**禁止把 sample 数据用于“角色创建服务”**，也禁止付费再分发 VRM 原文件。所以它适合 P0 测试，不适合作为产品化的基础体。

### 官方导出步骤（你手动做一次，约 2–5 分钟）

1. 打开 VRoid Studio → 选择 sample model 或新建角色；
2. 点右上角 Export（相机/导出器面板）；
3. 填写 VRM 元信息（名称、作者、许可）；
4. 选择保存位置，导出 .vrm（官方 dress-up 流程明确只导出 VRM 1.0；普通导出以应用内选项为准）；
5. 把文件放到 apps/web/public/vrm/ 即可。

### 如果一定要自动化

- 现有开源方案 mcp-vroid 用截图 + OCR + 虚拟鼠标驱动 VRoid Studio，但只支持 Linux/Wayland，Windows 不可用。
- 在 Windows 上做同等自动化需要 pywinauto / UI Automation + 截图识别，属于脆弱的一次性工程；为了一个 sample 不值得。
- 更实际的选择：你手动导出一次；或者直接用已验证的 sample；或者用 VTubeMe 之类的商业服务生成。

---

## 3. 2026 技术地图：VRM 路线的最先进论文与开源实现

### 3.1 运行时与规范（已成熟，直接用）

| 项目 | 作用 | 许可 | 状态 |
| --- | --- | --- | --- |
| **[VRM 1.0](https://vrm.dev/en/)** | 人形骨骼、表情、LookAt、SpringBone、MToon | 开放规范 | 稳定 |
| **[VRM Animation (VRMA)](https://vrm.dev/en/vrma/)** | 跨模型的 humanoid + 表情 + 视线动画格式 | 开放规范 | 稳定；three-vrm / UniVRM / Blender 支持 |
| **[three-vrm 3.5.5](https://github.com/pixiv/three-vrm)** | Three.js 的 VRM 加载/渲染 | MIT | 2026-10 仍在更新 |
| **[three-vrm-utils](https://dohaicuong.github.io/three-vrm-utils/)** | useVRMBlink、useVRMBreathing、useVRMExpressionManager、useVRMVowelAnalyser | MIT | 可直接用于 R3F |
| **MToon** | 动漫风材质（描边、明暗分层、发光） | 随 VRM | 稳定 |
| **SpringBone** | 头发/衣摆物理 | 随 VRM | 稳定；three-vrm 自动更新 |

> 结论：**“会动、会眨眼、有物理、能换装”的运行时部分已经不需要研究**，直接用 three-vrm 即可。

### 3.2 口型 / 表情（有成熟方案，分三档）

| 方案 | 输入 | 输出 | 延迟/成本 | 许可 | 适配 VRM |
| --- | --- | --- | --- | --- | --- |
| **音量 → aa**（AITuberKit 做法） | 任意 TTS 音频 | 1 个口型权重 | 实时、零成本 | 自研 | 直接 |
| **[Audio2Face-3D](https://github.com/NVIDIA/Audio2Face-3D-Samples)** | 音频 + 情绪 | ARKit 52 blendshape | 实时；NIM/GPU | 样例 Apache；模型 NVIDIA Open Model License | 需 ARKit→VRM 映射 |
| **[LAM-A2E](https://github.com/aigc3d/LAM_Audio2Expression)** | 音频 | ARKit blendshape（FLAME 拓扑） | 实时 | Apache-2.0 | 与 LAM 头绑定，非 VRM |
| **[SAiD](https://github.com/yunik1004/SAiD)** | 音频 | blendshape 系数（扩散） | 离线/准实时 | Apache-2.0；依赖 VOCASET/FLAME 许可 | 需重定向 |

**判断**：直播/陪伴类产品 90% 的效果来自「音量口型 + 情绪表情 + 眨眼 + 看镜头」，不需要神经口型。等产品需要“说话像真人”时，再上 Audio2Face-3D，并做 ARKit→VRM 的表情映射。

### 3.3 身体动作 / 共语手势（2025–2026 快速进展）

| 项目 | 会议/年份 | 能力 | 代码 | 许可 | 适配 VRM |
| --- | --- | --- | --- | --- | --- |
| **VRMA + Mixamo** | 产品实践 | 手工/动捕动画跨模型播放 | three-vrm / UniVRM | 各自 | 直接 |
| **[Kimodo](https://github.com/nv-tlabs/kimodo)** | 2026 | 文本 + 关键帧约束 → 高质量动作（SMPL-X / SOMA） | 有 | Apache-2.0 | 需 retarget |
| **[ARDY](https://github.com/nv-tlabs/ardy)** | SIGGRAPH 2026 | 自回归扩散，**实时**交互式动作生成（文本 + 路径/关键帧约束） | 有 | Apache-2.0 | 需 retarget |
| **[GestureLSM](https://github.com/andypinxinliu/GestureLSM)** | ICCV 2025 | 语音 + 文本 → 全身共语手势，实时 | 有 | MIT | SMPL-X → retarget |
| **[LiveGesture](https://arxiv.org/abs/2604.10927)** | CVPR 2026 | 零回看、可流式、任意长度共语手势 | **未见公开代码** | 论文 | 研究 |
| **[EchoAvatar](https://github.com/RobinWitch/EchoAvatar)** | SIGGRAPH 2026 | 流式语音/音乐 → 连续全身动作，低延迟 | 有（155 文件） | MIT | 需 retarget |

**判断**：
- **现在产品化**：VRMA 待机/挥手/思考姿势 + 预录动作，成本最低、最稳。
- **2026 可试用**：Kimodo/ARDY 离线生成动作片段，或 ARDY 做实时交互动作（需要 GPU/服务）。
- **仍偏研究**：LiveGesture/EchoAvatar 的“零回看流式手势”，论文指标很好，但工程化、重定向、延迟和内容安全都还要验证。

### 3.4 自动创建 / 自动绑骨（瓶颈所在）

| 项目 | 能力 | 代码 | 许可 | 成熟度 |
| --- | --- | --- | --- | --- |
| **[VTubeMe](https://vtubeme.com/ai-vtuber-model-generator)** | 照片 → 带 blendshape 的 rigged VRM；可换发/衣/配色 | 商业 | $7.99/次 | **产品级（商业）** |
| **[CharacterGen](https://github.com/zjp-shadow/CharacterGen)** | 单张全身动漫图 → 3D 角色 | 有 | Apache-2.0 | 研究级；HF demo 当前报错 |
| **[UniRig](https://github.com/VAST-AI-Research/UniRig) / [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens)** | 任意网格 → 骨架 + 蒙皮 | 有 | MIT | 研究级，可进管线 |
| **[VRoid Studio](https://vroid.com/en/studio)** | 手工捏人 + 导出 VRM | 免费 | 预设非 CC0；生成器需授权 | 产品级（手工） |
| **[Character Studio](https://github.com/M3-org/CharacterStudio)** | Web 端模块化 VRM 搭建 | 有 | MIT（资产另核） | 可用；托管 demo 需本地装资产 |
| **Meshy / Tripo** | 图/文 → 3D + 自动绑骨 | 商业 | 订阅 | 产品级（商业） |

**判断**：**“照片 → 风格化、可调整、可动画的 VRM”在开源里还没有端到端方案。** 近期只能：
1) 手工/半自动创建基础体（VRoid/Blender/CharacterStudio）；
2) 照片只作为脸/配色/发型参考（面部贴图或人工对照）；
3) 用 VTubeMe 做体验基准，验证用户是否真的在意“像我”。

### 3.5 头部 / 写实化身（可作补充，不做主形态）

| 项目 | 会议 | 能力 | 许可 | 说明 |
| --- | --- | --- | --- | --- |
| **[LAM](https://github.com/aigc3d/LAM)** | SIGGRAPH 2025 | 单图 → 可动 3D 高斯头，实时 | Apache-2.0 | 头只有；与 VRM 身体拼接难 |
| **[MeshLAM](https://arxiv.org/abs/2604.22865)** | CVPR 2026 | 单图 → 可动带纹理网格头 | 论文（代码未见） | 比高斯更适合接 VRM，值得跟踪 |
| **[Arc2Avatar](https://arc2avatar.github.io/)** | CVPR 2025 | 单图 → 表情可控 3D 头 | 研究代码 | ID 保持强 |
| **[HQ-Head](https://biggaoga.github.io/HQ-Head-Generation/)** | AAAI 2026 | 任意单图 → 高保真全头，支持风格化 | 研究代码 | 高斯路线 |

---

## 4. 成熟度矩阵（给决策用）

| 能力 | 现在能做吗 | 推荐方案 | 风险 |
| --- | --- | --- | --- |
| VRM 加载 / 待机 / 眨眼 / 呼吸 / 物理 | ✅ 生产可用 | three-vrm + VRMA + SpringBone | 资产质量 |
| 情绪表情 + 看镜头 + 口型 | ✅ 生产可用 | 音量→aa + 预设表情 + 自动眨眼 | 权重仲裁 |
| 聊天 + TTS + 逐句口型 | ✅ 生产可用 | AI SDK + 任意 TTS + SpeakQueue | TTS 延迟/成本 |
| 换装 / 配色 / 主题皮肤 | ✅ 可行 | CharacterStudio 或自建 avatar config | 资产制作 |
| 照片 → 风格化 VRM | ⚠️ 商业可行，开源不可行 | VTubeMe / 手工 + 面部贴图 | 相似度、许可 |
| 文本/语音 → 全身动作 | ⚠️ 2026 前沿 | Kimodo/ARDY 离线或服务化 | GPU、重定向 |
| 实时共语手势 | 🧪 研究 | GestureLSM / LiveGesture / EchoAvatar | 延迟、工程化 |
| 全自动照片→可动 3D 角色 | 🧪 研究 | CharacterGen + UniRig | 质量、面部表情 |

---

## 5. 落地路线（建议）

### P0（已实现，2026-10-18）

1. 在 apps/web 里装了 @pixiv/three-vrm@3.5.5 + @pixiv/three-vrm-animation@3.5.5。
2. 用官方 VRM 1.0 sample 跑通：加载 → 程序化待机姿势 → 眨眼 → 呼吸 → 看镜头；VRMA 待机留到 P1。
3. 用 Windows SAPI 中文语音跑通音量→aa/ih/ou 口型。
4. 量：headed Chromium 1600×1000 实测 120 fps（待机/说话），结束 114 fps。
5. 入口：/scenes/avatar；实现细节、截图与限制见 [P0 spike 记录](p0-spike.md)。

> 当前 sample 是 pixiv 的技术验证模型（白 T/短裤），不是正式美术；正式角色需 VRoid 导出或自制。

### P1（2–3 周，最小可用化身）

- AvatarStage + AvatarController API：speak(text, emotion, motion?)、setEmotion、playPose、stop。
- 聊天 UI：输入框 + 建议问题 + 气泡 + 语音按钮。
- LLM 输出情绪标签；TTS 逐句播放；口型同步；冲突时降口型权重。
- 背景/主题：赛博/武侠两套 CSS 背景；VRM 用 MToon 调色。
- 降级：WebGL 不可用 → 静态海报；减少动效 → 暂停待机/物理。

### P2（4–6 周，资产与完成度）

- 自制 VRM 基础体 + 3 套发型/服装（注意 VRoid 生成器条款）。
- 动作库：待机、倾听、思考、开心、点头、挥手（VRMA/Mixamo）。
- 性能：KTX2/meshopt、LOD、离屏暂停、移动端 30fps。
- 持久化：avatar profile（模型/配色/解锁项）入库，和身份配方打通。

### P3（研究，不阻塞主线）

- 照片→VRM：先做“面部贴图 + 配色/发型建议”，用 VTubeMe 做盲测基准。
- 自动绑骨：UniRig/SkinTokens 批量处理自制网格。
- 实时手势：ARDY/GestureLSM 服务化；先离线生成动作片段，再考虑实时。

---

## 6. 许可与风险清单

| 对象 | 许可/条款 | 对你的影响 |
| --- | --- | --- |
| AITuberKit 代码 | 自定义：个人/教育/非营利免费；商用 ¥100k/300k/1M | 不要直接复制代码；可评估期内部试用；商用要么购买，要么重写 |
| AITuberKit 演示 VRM（Nike-chan） | 仅个人/非商用；禁止修改/再分发 | **不能用于产品**，包括测试宣传 |
| three-vrm / springbone / animation | MIT | 可商用 |
| three-vrm-utils | MIT | 可商用 |
| VRoid Studio 预设 | 非 CC0；做生成/输出 3D 的应用需 pixiv 单独授权 | 用 VRoid 做内部原型可以；上线前确认 |
| VTubeMe / Meshy / Tripo | 商业 | 按合同；注意生成物的商用条款 |
| Audio2Face-3D | 样例 Apache；模型 NVIDIA Open Model License | 可商用但需遵守模型条款 |
| LAM / LAM-A2E | Apache-2.0 | 注意 FLAME/BFM 等依赖的单独许可 |
| CharacterGen | Apache-2.0 | 权重/数据单独核对 |
| UniRig / SkinTokens / Kimodo / ARDY / GestureLSM / EchoAvatar | MIT / Apache-2.0 | 可商用；注意训练数据/依赖 |

**其他风险**：
- **资产成本**：一个可换装的 VRM 基础体 + 服装，是美术工程，不是代码问题。
- **性能**：VRM 10–30 MB、SpringBone 开销、移动端发热；必须做压缩/LOD/降级。
- **表情冲突**：情绪、眨眼、口型共用 BlendShape，需要仲裁；否则会出现“闭眼大笑”“说话时嘴型抽搐”。
- **声音延迟**：TTS 首包延迟决定“像不像在对话”；优先流式 TTS。
- **隐私**：照片、语音都是敏感数据；沿用你现有的 PII 边界（不落盘、不进日志、不随便发第三方）。

---

## 7. 参考与代码索引

### AITuberKit
- 仓库：https://github.com/tegnike/aituber-kit
- 演示：https://aituberkit.com
- 许可：https://github.com/tegnike/aituber-kit/blob/main/docs/license_en.md
- VRM 文档：https://docs.aituberkit.com/en/guide/character/vrm
- 关键源码：
  - src/features/vrmViewer/viewer.ts
  - src/features/vrmViewer/model.ts
  - src/features/lipSync/lipSync.ts
  - src/features/emoteController/expressionController.ts
  - src/lib/VRMAnimation/*
  - src/components/vrmViewer.tsx

### 运行时 / 规范
- VRM：https://vrm.dev/en/
- VRMA：https://vrm.dev/en/vrma/
- three-vrm：https://github.com/pixiv/three-vrm
- three-vrm examples：https://pixiv.github.io/three-vrm/packages/three-vrm/examples/
- three-vrm-utils：https://dohaicuong.github.io/three-vrm-utils/

### 口型 / 表情
- Audio2Face-3D：https://github.com/NVIDIA/Audio2Face-3D-Samples
- LAM-A2E：https://github.com/aigc3d/LAM_Audio2Expression
- SAiD：https://github.com/yunik1004/SAiD

### 动作 / 手势
- Kimodo：https://github.com/nv-tlabs/kimodo
- ARDY：https://github.com/nv-tlabs/ardy
- GestureLSM：https://github.com/andypinxinliu/GestureLSM
- LiveGesture：https://arxiv.org/abs/2604.10927
- EchoAvatar：https://github.com/RobinWitch/EchoAvatar

### 创建 / 绑骨
- VTubeMe：https://vtubeme.com/ai-vtuber-model-generator
- CharacterGen：https://github.com/zjp-shadow/CharacterGen
- UniRig：https://github.com/VAST-AI-Research/UniRig
- SkinTokens：https://github.com/VAST-AI-Research/SkinTokens
- Character Studio：https://github.com/M3-org/CharacterStudio
- VRoid：https://vroid.com/en/studio

### 头部 / 写实
- LAM：https://github.com/aigc3d/LAM
- MeshLAM：https://arxiv.org/abs/2604.22865
- Arc2Avatar：https://arc2avatar.github.io/
- HQ-Head：https://biggaoga.github.io/HQ-Head-Generation/

---

### 附：本次实测观察（2026-10-18）

- AITuberKit 仓库可访问，package.json / 关键源码与上述一致；演示站受 Cloudflare 人机验证，未做自动化绕过。
- AITuberKit 的 Nike-chan VRM 模型许可文档明确禁止商用、修改、再分发。
- CharacterGen HF Space 当前 Runtime error；Character Studio 托管站画布空白，需本地装资产。
- 其余链接均为官方仓库/项目页；代码许可以仓库 LICENSE 为准。
