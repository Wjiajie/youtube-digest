# 照片 →「可动的自己」：风格化化身方案调研与选型

> 调研日期：2026-10-18。范围：开源项目、论文、可复用组件、社区/商业 showcase，以及本项目现有技术栈的适配度。
> 结论先行：**目前没有任何一个开源项目能端到端完成「照片 → 风格化 → 可调整 → 会眨眼呼吸有物理」**。可落地的是两条组合路线 + 一条研究下注。下文把每条路线的能力、showcase、许可和工程量摊开，最后给出推荐。

---

## 0. 一句话结论

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| **近期（2–4 周）** | **2.5D 分层立绘**：照片 → InstantID/PuLID 风格化 → see-through 分 23 层 → 你现有的 Living Portrait 动效 | 唯一能在「武侠/水墨」美术方向上做到好看、且你已经有一半工程的路线 |
| **中期（2–3 个月）** | **VRM 3D 化身**：自定义基础体 + 模块化发型/服装 + three-vrm（眨眼、呼吸、看镜头、spring bone、VRMA） | 开源生态里唯一同时满足「可调整 + 生动 + Web 实时」的成熟标准；你的项目已经装了 R3F / three / three-vrm-springbone |
| **研究下注** | **CharacterGen + UniRig/SkinTokens**：全身图 → 3D 动漫角色 → 自动绑骨 → VRM | 唯一接近「全自动从图到 3D」的开源管线，但目前是研究级，不能进主链路 |
| **不推荐** | Meshy/照片→写实 3D 全身；VRoid 预设做「生成器」；LAM 写实高斯头作为主形态 | 前者你已经踩过坑；中者有明确许可限制；后者头身分离、风格不符 |

**如果只能选一个**：武侠主题选 2.5D；赛博主题选 VRM。两者共用一份「身份配方」（见 §8），不需要二选一。

---

## 1. 把需求翻译成 6 个硬约束

| # | 约束 | 权重 | 说明 |
| --- | --- | --- | --- |
| 1 | 风格可控、贴近武侠/赛博 | 25% | 不是「随便一个卡通」，要能吃下你已有的美术方向 |
| 2 | 生动：眨眼、呼吸、表情、物理 | 20% | 至少待机状态不僵 |
| 3 | 可调整：发型、服装、配色、身形 | 20% | 这是「目标锚点」的核心，不是一次性模型 |
| 4 | 照片身份：像用户 / 或至少「代表用户」 | 15% | 可做强度滑杆：像 → 受到启发 |
| 5 | Web 集成与性能 | 10% | Next.js + Three.js / R3F，首包 < 10 MB，桌面 60fps |
| 6 | 许可与工程量 | 10% | 商用、可维护、团队能接住 |

---

## 2. 方案总览与评分

| 方案 | 形态 | 风格 | 生动 | 可调 | 像用户 | Web | 许可 | 综合 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A. 2.5D 分层立绘** | 2D 多层 + 网格/粒子 | 5 | 3 | 4 | 4 | 5 | 4 | **4.2** |
| **B. VRM 3D 化身** | 标准 3D 人形 | 4 | 5 | 5 | 2 | 5 | 3 | **4.1** |
| **C. 照片→3D 动漫（CharacterGen+UniRig）** | 3D 网格 | 3 | 2 | 2 | 3 | 3 | 5 | 2.9 |
| **D. 单图→可动高斯头（LAM）** | 3D 高斯头 | 3 | 5 | 1 | 5 | 4 | 4 | 3.5 |
| **E. 写实照片→3D 全身** | 写实 3D | 1 | 3 | 2 | 5 | 2 | 1 | 2.3 |

> 评分是相对本项目目标的适配度，不是学术质量。每条路线的证据和 showcase 见下。

### 2.1 必看的 6 个 showcase（先看效果，再读方案）

| 看什么 | 打开 | 判断标准 |
| --- | --- | --- |
| 社区用 VRM 能做出什么水平的角色 | [VRoid Hub](https://hub.vroid.com/en) | 这些模型能否达到你「赛博主题」的美术线 |
| 浏览器里 VRM 的眨眼/表情/物理 | [three-vrm Examples](https://pixiv.github.io/three-vrm/packages/three-vrm/examples/) | 交互是否足够「活」，性能是否可接受 |
| 一张插画拆成可换装分层 | [see-through Demo](https://huggingface.co/spaces/24yearsold/see-through-demo) | 分层质量能否支撑你的武侠立绘 |
| 商业化的「照片→rigged VRM」 | [VTubeMe](https://vtubeme.com/ai-vtuber-model-generator) | 相似度和风格是否够；$7.99 的基准 |
| 单图→可动高斯头 | [LAM HF](https://huggingface.co/spaces/3DAIGC/LAM) | 风格保持、表情自然度、头身拼接难度 |
| 照片→3D 动漫 + 自动绑骨 | [CharacterGen 项目页](https://charactergen.github.io/) · [UniRig 项目页](https://zjp-shadow.github.io/works/UniRig/) | 输出质量离「可直接上线」还差多少 |

### 2.2 论文雷达（2024–2026）

| 论文 | 会议/年份 | 一句话贡献 | 代码/权重 |
| --- | --- | --- | --- |
| **see-through** | SIGGRAPH 2026 | 单张动漫插画 → 最多 23 个语义层 + 绘制顺序 | 有（Apache-2.0） |
| **CharacterGen** | SIGGRAPH 2024 | 单张全身图 → 姿态统一多视图 → 3D 角色 | 有（Apache-2.0） |
| **UniRig** | SIGGRAPH 2025 | 任意网格 → 骨架 + 蒙皮权重 | 有（MIT） |
| **SkinTokens** | 2026 | UniRig 后继，统一骨架+蒙皮，精度更高 | 有（MIT） |
| **LAM** | SIGGRAPH 2025 | 单图 → 可动 3D 高斯头，实时跨平台 | 有（Apache-2.0） |
| **Arc2Avatar** | CVPR 2025 | 单图 → 表情可控的 3D 高斯头，ID 保持强 | 研究代码 |
| **Photo2Avatar** | ICVRV 2025 | 单图 → SMPL-X 驱动的可动全身 | 论文 |
| **HQ-Head** | AAAI 2026 | 任意单图 → 高保真全头，支持风格化 | 研究代码 |
| **HumanNOVA** | CVPR 2026 | 单图 → 写实全身，SMPL-X 驱动 | 有代码，**无 LICENSE** |
| **Make-A-Character** | 2024 | 文本 → 风格化 3D 角色，可调属性 | 有代码，**无 LICENSE** |

---

## 3. 方案 A：2.5D 分层立绘（近期首选）

### 3.1 管线

```text
用户照片
  → 风格化肖像（InstantID / PuLID / IP-Adapter + 武侠/赛博 LoRA）
  → see-through 单图分 23 层（头发/脸/眼/嘴/上装/下装/鞋/饰品/道具…）
  → 你的 Living Portrait V2 渲染器（分层、呼吸、惯性链、视差）
  → 叠加眨眼/口型/微表情层（可选 LivePortrait 生成的短循环）
  → 换装/换发型 = 换层 + 调色 + AI 局部重绘
```

### 3.2 关键开源项目

| 项目 | 作用 | 许可 | 入口 |
| --- | --- | --- | --- |
| **see-through**（SIGGRAPH 2026） | 单张动漫插画 → 最多 23 个语义层 + 推断绘制顺序，导出 PSD | Apache-2.0 | [GitHub](https://github.com/shitagaki-lab/see-through) · [HF Demo](https://huggingface.co/spaces/24yearsold/see-through-demo) · [ModelScope](https://modelscope.cn/studios/ljsabc/See-Through) |
| **ComfyUI-See-through** | 把 see-through 包成 ComfyUI 节点，接你的生成流程 | 跟随上游 | [GitHub](https://github.com/jtydhr88/ComfyUI-See-through) |
| **InstantID** | 单张照片零样本身份保持 + 风格化 | Apache-2.0 代码；人脸模型 antelopev2 为 InsightFace 非商用 | [GitHub](https://github.com/InstantID/InstantID) · [HF Demo](https://huggingface.co/spaces/InstantX/InstantID) |
| **PuLID**（NeurIPS 2024） | 身份保持的 SDXL/FLUX 定制，速度/相似度取舍 | Apache-2.0；同样注意人脸模型许可 | [GitHub](https://github.com/ToTheBeginning/PuLID) · [HF Demo](https://huggingface.co/spaces/yanze/PuLID) |
| **LivePortrait** | 单图 + 驱动视频 → 眨眼/表情/头动的短循环 | MIT 代码；InsightFace 模型非商用，商用需替换 | [GitHub](https://github.com/KlingAIResearch/LivePortrait) · [项目页](https://liveportrait.github.io/) |
| **Inochi2D** | 开源实时 2D 木偶（网格、物理、分层），Live2D 的开源替代 | BSD-2-Clause | [官网](https://inochi2d.com/)（Gallery 在站内） |

### 3.3 Showcase

- **see-through 官方代表图**：一张插画拆成完整分层（下图），这就是「可换装、可眨眼」的前提。
- **HF Demo** 可直接上传自己的图试 1–2 次/天；**ModelScope** 免费且分辨率更高。
- **ComfyUI 工作流**已有社区封装，可接 SDXL/FLUX 出图后直接分层。
- **LivePortrait** 的社区 demo 大量存在（真人照片驱动），但注意它是「输出视频」，不是可交互模型。
- **Inochi2D Gallery** 有大量用同一套 2D 网格 + 物理做出来的 VTuber 模型，可直接看效果。


### 3.4 能做到 / 做不到

- **能**：极高的风格控制；照片身份（InstantID/PuLID）；快速换装/换发型；眨眼、口型、呼吸、衣发惯性；你已经有的渲染器直接复用。
- **不能**：真正的 3D 转身、自由镜头、布料/头发 3D 物理；大幅动作受限于分层形变；「像用户」依赖 2D 生成质量。
- **成本**：1 名设计 + 1 名工程，2–4 周做出可看的身份卡；see-through 需 12–16 GB VRAM（或云）。

---

## 4. 方案 B：VRM 3D 化身（中期主力）

> 深入拆解 AITuberKit 的实现、Blueprint 落地代码骨架与 2026 年 VRM 技术地图，见 [VRM 3D 化身深度调研](../vrm-3d-avatar-2026-10-18/README.md)。

### 4.1 为什么是 VRM

VRM 是 VTuber/虚拟角色的事实标准：人形骨骼、表情 BlendShape、LookAt、SpringBone 物理、材质（MToon）、动画（VRMA）。**three-vrm** 是 pixiv 维护的 Three.js 实现（MIT，2026-10 仍在更新），你项目里已经装了 `@pixiv/three-vrm-springbone`、R3F、three 0.186、gltf-transform、meshoptimizer——接入成本比任何自研 3D 方案都低。

### 4.2 关键组件

| 组件 | 作用 | 许可 | 入口 |
| --- | --- | --- | --- |
| **three-vrm** | VRM 加载、人形、表情、LookAt、MToon、SpringBone、VRMA | MIT | [GitHub](https://github.com/pixiv/three-vrm) · [Examples](https://pixiv.github.io/three-vrm/packages/three-vrm/examples/) |
| **three-vrm-utils** | React hooks：useVRMBlink、**useVRMBreathing**、useVRMExpressionManager、useVRMVowelAnalyser | MIT | [Docs](https://dohaicuong.github.io/three-vrm-utils/) |
| **Character Studio** | 开源 Web 端 VRM 角色搭建器：拖拽模块、换色、导出 VRM/GLB、合并网格/图集 | MIT | [GitHub](https://github.com/M3-org/CharacterStudio) · [Docs](https://m3-org.github.io/characterstudio-docs/) |
| **VRoid Studio** | 免费 3D 角色建模，调脸/发/服装/配色，导出 VRM | 免费；预设素材非 CC0；**做生成器需单独授权** | [官网](https://vroid.com/en/studio) · [Hub](https://hub.vroid.com/en) |
| **VRoid Hub** | 社区 VRM 角色 showcase / 授权模型来源 | 每个模型独立许可 | [Hub](https://hub.vroid.com/en) |

### 4.3 照片怎么进入

没有成熟的开源「照片 → VRM」管线。现实做法是三选一：

1. **面部贴图**（推荐）：用 InstantID/PuLID 生成正面+侧面风格化脸，投影到 VRM 头部 UV；发色/瞳色/肤色从照片取色。身份相似度可控，工程量小。
2. **参数化映射**：从照片回归脸型/五官参数，映射到自定义基础体的 BlendShape；需要自己训练/调参，属于研究项。
3. **商业服务打底**：VTubeMe 已经做到「一张照片 → 带 blendshape 的 rigged VRM」，$7.99/次；可先用它验证「用户是否在意像不像」，再决定是否自研。

### 4.4 Showcase

- **VRoid Hub**：社区用 VRoid 做出的各种风格化 VRM（下图），能直接看到「可调整」的边界。
- **three-vrm Examples**：expressions / animations / lookAt / 次级动作 / humanoid animation 全部可交互。
- **VTubeMe**：商业化「照片→带 blendshape 的 VRM」完整流程（下图），可作为体验基准。
- **AITuberKit**（自定义许可）、**Utsuwa**（AGPL-3.0）、**ChatVRM**（MIT，已归档）：都是「浏览器里跑 VRM + 表情/语音」的完整应用。
- **OpenAvatarChat**（Apache-2.0）：模块化数字人，支持 LAM / LiteAvatar / MuseTalk / FlashHead，可看实时对话效果。


### 4.5 许可红线

VRoid 官方 guidelines 原文（2026-10-18 核对）：

> You cannot create an application that can generate or output 3D models, avatars, or items consisting of deformed or combined meshes and textures that were created in VRoid Studio. If you'd like to create an application with these sorts of functions, it is necessary for you to receive a separate license from pixiv.

也就是说：**用 VRoid 预设做「用户生成化身」的产品功能，需要单独授权**。规避方式：
- 自建/委托制作基础体与服装（Blender + VRM Add-on），不依赖 VRoid 预设；
- 或只用 VRoid 做内部原型，不上线；
- 或采购/使用许可明确的 VRM 资产（每个模型单独核对）。


---

## 5. 方案 C：照片 → 3D 动漫角色（研究下注）

### 5.1 管线

```text
全身/半身动漫图（可由照片 + 风格 LoRA 生成）
  → CharacterGen：单图 → 多视图 → 3D 角色网格（A-pose）
  → UniRig / SkinTokens：自动骨架 + 蒙皮
  → Blender VRM Add-on：导出 VRM
  → three-vrm 渲染 + 手工表情/服装
```

### 5.2 项目与证据

| 项目 | 能力 | 许可 | 状态 |
| --- | --- | --- | --- |
| **CharacterGen**（SIGGRAPH 2024） | 单张全身图 → 姿态统一的多视图 → 3D 角色，带纹理 | Apache-2.0 | [GitHub](https://github.com/zjp-shadow/CharacterGen) · [项目页](https://charactergen.github.io/) · [HF Demo](https://huggingface.co/spaces/VAST-AI/CharacterGen)（**2026-10-18 实测 Runtime error**） |
| **UniRig**（SIGGRAPH 2025） | 任意网格 → 骨架 + 蒙皮权重 | MIT | [GitHub](https://github.com/VAST-AI-Research/UniRig) · [项目页](https://zjp-shadow.github.io/works/UniRig/) |
| **SkinTokens**（UniRig 后继） | 自回归统一骨架+蒙皮，精度更高 | MIT | [GitHub](https://github.com/VAST-AI-Research/SkinTokens) |

### 5.3 Showcase

- **CharacterGen 项目页**的 teaser（下图）：单图 → 多视图 → 3D → Auto-Rigging → 动画角色。
- **UniRig 项目页**：鹿/鹰/鱼/VTuber 的自动绑骨结果（下图）。
- **HF CharacterGen Space**：当前实例报模型下载权限错误，需本地跑或等维护；这本身说明「研究 demo ≠ 可用产品」。


### 5.4 判断

- **优点**：唯一接近「全自动、从一张图到可绑骨 3D」的开源路线；许可干净（Apache/MIT）。
- **缺点**：输入要求是「全身动漫角色图」，不是自拍；输出没有面部 BlendShape（眨眼/表情要另做）；风格被训练集限制在动漫；质量不稳定，需人工修。
- **结论**：适合做**批量生产工具**或**研究 spike**，不适合直接放进用户上传照片的主流程。

---

## 6. 方案 D：单图 → 可动 3D 高斯头（LAM）

### 6.1 能力

LAM（SIGGRAPH 2025，阿里通义）用一张图生成**可动画的 3D 高斯头**，单次前向、实时渲染，支持表情/姿态驱动、音频驱动（Audio2Expression）、WebGL 渲染和 OpenAvatarChat 实时对话。官方 teaser 里明确展示了**动漫、蓝色外星人、石膏像**等风格化输入，不只是真人。

| 组件 | 作用 | 许可 | 入口 |
| --- | --- | --- | --- |
| **LAM** | 单图 → 可动高斯头 | Apache-2.0 | [GitHub](https://github.com/aigc3d/LAM) · [项目页](https://aigc3d.github.io/projects/LAM/) · [HF Demo](https://huggingface.co/spaces/3DAIGC/LAM)（实测 Running，ZeroGPU 约 1 分钟/次） |
| **LAM_WebRender** | WebGL 高斯渲染 + 表情 | MIT | [GitHub](https://github.com/aigc3d/LAM_WebRender) · npm `gaussian-splat-renderer-for-lam` |
| **LAM_Audio2Expression** | 音频 → ARKit 表情 | 开源 | [GitHub](https://github.com/aigc3d/LAM_Audio2Expression) |
| **OpenAvatarChat** | 模块化数字人（ASR/LLM/TTS/Avatar） | Apache-2.0 | [GitHub](https://github.com/HumanAIGC-Engineering/OpenAvatarChat) |

### 6.2 Showcase

- **LAM teaser**（下图）：真人、动漫、插画、石膏像 → 同一套表情/姿态驱动。
- **HF Space**：上传正脸图 + 驱动视频即可试。
- **OpenAvatarChat**：LAM / LiteAvatar 两种数字人的实时对话 demo。


### 6.3 为什么不做主形态

- **只有头**：没有身体、头发物理、换装；接身体需要自建/拼接，且高斯头与 VRM 身体渲染管线不同。
- **高斯不是网格**：不能像 VRM 一样换发型/服装、做骨骼动画；风格化靠输入图，不是可控的 3D 材质。
- **许可**：代码 Apache-2.0，但涉及 FLAME/BFM 等基础模型时需单独核对其商用条款。
- **适合**：作为「真实感/高相似度」的彩蛋，或未来「视频对话头像」模块，不是主身份锚点。

---

## 7. 方案 E：写实照片 → 3D 全身（不推荐）

| 项目 | 时间 | 能力 | 许可 |
| --- | --- | --- | --- |
| **HumanNOVA** | CVPR 2026 | 单图 → 写实全身，SMPL-X 驱动 | **仓库无 LICENSE**（默认保留所有权利） |
| **Photo2Avatar** | ICVRV 2025 | 单图 → 可动 3D 全身（SMPL-X） | 论文，未见开源代码 |
| **Arc2Avatar** | CVPR 2025 | 单图 → 可动 3D 头（Gaussian + 3DMM） | 研究代码 |
| **HQ-Head** | AAAI 2026 | 单图 → 高保真全头，支持风格化 | 研究代码 |
| **Avatar SDK / Avaturn** | 商业 | 照片 → 写实 avatar（带 blendshape/Web SDK） | 商业授权 |
| **VTubeMe** | 商业 | 照片 → rigged VRM + blendshape | $7.99/次 |

**不推荐做主打**：写实 3D 与你的武侠/赛博美术方向冲突；单图重建的头发/衣服/侧面质量不可控；许可与成本都高。可作为「真实感预览」或商业方案对比。

---

## 8. 推荐架构：「身份配方」+ 双渲染器

不要试图用一个模型解决所有问题。把「像用户」和「可调整/生动」拆开：

```text
AvatarIdentity（身份配方，存数据库）
├─ face: 风格化正面/侧面图、五官参数（可选 embedding）
├─ palette: 肤色/发色/瞳色（从照片取色）
├─ silhouette: 发型长度、身形参数
├─ style: wuxia | cyberpunk + strength
└─ progress: 已解锁的发型/服装/配饰

AvatarAppearance（外观）
├─ base: 2D 分层 or VRM 基础体
├─ hair / outfit / accessory: 模块资产
└─ expression set: 眨眼、呼吸、微笑、思考、庆祝

AvatarRenderer（渲染器）
├─ LayeredRenderer（2.5D，Living Portrait）
└─ VrmRenderer（three-vrm）
```

- **同一个身份**在两个渲染器里保持一致（配色、发型、气质），但允许「主题化身不同」——这正好符合你文档里的原则「同一身份与成果延续到不同主题的化身，不要求共用模型」。
- **可调整** = 换模块 + 调参数 + 解锁；**生动** = 每个渲染器各自的 idle/表情/物理；**像用户** = 面部贴图/参数 + 风格强度滑杆。
- **目标锚点** = 身份配方 + 进度解锁的外观；用户完成目标后解锁新发型/服装，而不是「换一个模型」。

---

## 9. 分阶段落地

### P0（1 周，只做验证，不写产品代码）

| Spike | 验证什么 | 通过标准 |
| --- | --- | --- |
| S1 风格化 | InstantID/PuLID + 武侠/赛博 LoRA 在 20 张真实照片上的效果 | 盲测 ≥70% 认为是同一人；风格 4/5 |
| S2 分层 | see-through 跑 1 张你的武侠插画 | 23 层可用、无明显光晕、PSD 可编辑 |
| S3 VRM 运行时 | three-vrm + 一个样例 VRM 进 Next.js | 眨眼/呼吸/spring bone 正常，桌面 60fps，首包 <10MB |
| S4 照片→VRM 脸 | 把 S1 的正面/侧面图投到 VRM 头部 UV | 盲测 ≥50% 像；否则只做「受到启发」 |
| S5（可选） | LAM 跑一张风格化头像 | 表情驱动自然、风格保持可接受 |

### P1（3–4 周）：2.5D 身份卡上线

- 首页 Living Portrait 增加「我的身份卡」：照片上传 → 风格化 → 分层 → 待机/倾听/庆祝三态。
- 换发型 ×2、换服装 ×2、调色；数据存身份配方。
- 验收：真实账号上传→生成→刷新→换装→回到学习不丢状态；320px/键盘/减少动效可用。

### P2（8–12 周）：VRM 化身

- 自定义基础体（Blender + VRM Add-on，不用 VRoid 预设），3 套发型 + 3 套服装（武侠/赛博各一版）。
- three-vrm 运行时：眨眼、呼吸、LookAt、SpringBone、VRMA 待机/挥手；MToon 做赛博发光/水墨描边两种材质。
- 身份配方驱动：同一配色/发型在两个渲染器一致。
- 性能：Draco/KTX2/meshopt，首包预算；低端机降级为 2D 海报。

### P3（研究）：CharacterGen + UniRig 批量生产

- 输入 20 张全身图 → 生成 → 自动绑骨 → 人工修 → 入库；评估「每 30 分钟能产出几个可用基础体」。
- 只在质量稳定后接入用户流程，否则只做内部资产生产。

---

## 10. 许可与成本清单（2026-10-18 核对，非法律意见）

| 组件 | 许可 | 商用注意 |
| --- | --- | --- |
| three-vrm / three-vrm-springbone | MIT | 可商用 |
| three-vrm-utils | 开源 | 核对仓库 LICENSE |
| see-through | Apache-2.0 | 可商用，注意模型/数据条款 |
| InstantID | Apache-2.0 代码 | 人脸模型 antelopev2 为 InsightFace 非商用，需替换 |
| PuLID | Apache 系 | 同样注意人脸模型 |
| LivePortrait | MIT 代码 | InsightFace 模型非商用；官方说明需移除/替换后才可商用 |
| LAM / LAM_WebRender | Apache-2.0 / MIT | FLAME/BFM 等基础模型需单独核对 |
| CharacterGen | Apache-2.0 | 权重/训练数据单独核对 |
| UniRig / SkinTokens | MIT | 可商用 |
| VRoid Studio | 免费；预设非 CC0 | **做「生成/输出 3D 模型」的应用需 pixiv 单独授权** |
| Character Studio | MIT 代码 | 资产包单独核对 |
| AITuberKit | 自定义许可 | 商用前读条款 |
| Utsuwa | AGPL-3.0 | 复用代码有传染性 |
| HumanNOVA | 无许可证 | 默认不可商用 |
| VTubeMe / Avatar SDK / Avaturn | 商业 | 按合同 |

**成本量级**：2.5D 身份卡 1 设计 + 1 工程 × 2–4 周；VRM 基础体 1–2 周美术 + 运行时 2–4 周 + 服装/发型 3–6 周；GPU 侧 see-through/InstantID 建议至少 16GB 显存或云推理。

---

## 11. 关键风险

1. **风格 vs 像用户**：身份保持越强，越容易「照片贴脸」；建议默认「受到启发」，提供「像我」滑杆。
2. **VRM 资产成本**：真正可换装需要统一母体、UV、骨骼和绑定规范；这是美术工程，不是算法。
3. **许可**：VRoid 的「生成器」条款、InsightFace 的非商用模型、FLAME/BFM 条款，是最容易在上线前爆的三颗雷。
4. **性能**：VRM 10–30MB、高斯 splat 更重；必须做 LOD/压缩/2D 回退。
5. **隐私**：照片是敏感数据；沿用你 P1 的 PII 边界——原图只在内存、不落盘、不入日志、不发第三方（除非明确授权）。

---

## 12. Showcase 索引（可直接点开看）

| 方案 | Showcase | 链接 |
| --- | --- | --- |
| 2.5D | see-through 在线分层 | https://huggingface.co/spaces/24yearsold/see-through-demo |
| 2.5D | see-through ModelScope（国内免费） | https://modelscope.cn/studios/ljsabc/See-Through |
| 2.5D | Inochi2D（Gallery 在站内） | https://inochi2d.com/ |
| 2.5D | LivePortrait 项目页 | https://liveportrait.github.io/ |
| 2.5D | InstantID 演示 | https://huggingface.co/spaces/InstantX/InstantID |
| VRM | VRoid Hub 社区模型 | https://hub.vroid.com/en |
| VRM | three-vrm 官方 examples | https://pixiv.github.io/three-vrm/packages/three-vrm/examples/ |
| VRM | three-vrm-utils（含呼吸 hook） | https://dohaicuong.github.io/three-vrm-utils/ |
| VRM | Character Studio | https://studio.m3org.com/ （实测空白，建议本地跑） |
| VRM | AITuberKit demo | https://aituberkit.com |
| VRM | Utsuwa（浏览器版） | https://app.utsuwa.ai |
| VRM | VTubeMe 照片→VRM | https://vtubeme.com/ai-vtuber-model-generator |
| 3D 生成 | CharacterGen 项目页 | https://charactergen.github.io/ |
| 3D 生成 | CharacterGen HF（实测报错） | https://huggingface.co/spaces/VAST-AI/CharacterGen |
| 3D 生成 | UniRig 项目页 | https://zjp-shadow.github.io/works/UniRig/ |
| 高斯头 | LAM HF | https://huggingface.co/spaces/3DAIGC/LAM |
| 高斯头 | LAM 项目页 | https://aigc3d.github.io/projects/LAM/ |
| 高斯头 | OpenAvatarChat | https://huggingface.co/spaces/HumanAIGC-Engineering-Team/open-avatar-chat |
| 写实 | HumanNOVA | https://humannova.github.io/ |
| 写实 | Arc2Avatar | https://arc2avatar.github.io/ |

---

## 13. 一句话行动建议

**先做 P0 的 S1–S3 三个 spike，不要先做模型。** 三个 spike 都过了，再决定 P1 是「2.5D 身份卡」还是「VRM 化身」先上线；如果 S1 的身份保持过不了盲测，就把产品语言从「像你」改成「代表你想成为的样子」——这也更贴合「目标锚点」的定位。

---

### 附：本次调研的实测观察（2026-10-18）

- CharacterGen HF Space：Runtime error（模型下载权限），项目页可访问。
- LAM HF Space：Running，约 1 分钟/次（ZeroGPU）。
- see-through HF Space：Running，上传界面正常。
- Character Studio 托管站：页面加载后画布空白，需本地安装资产后使用。
- three-vrm examples：可访问；headless 截图黑屏是浏览器 GPU 限制，不代表页面不可用。
- AITuberKit demo：Cloudflare 人机验证，未做自动化绕过。
