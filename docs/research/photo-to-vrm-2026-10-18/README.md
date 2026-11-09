# 照片 → VRM：VRoid/pixiv 关系、AI Agent 工作流与开源项目对比

> 2026-10-18。回答三个问题：VRoid Hub 和 pixiv 是什么关系；能否用 AI Agent 工作流把输入图片转成 VRM；AITuberKit 及同类开源项目能否达到目的。结论不构成法律意见。

## 0. 一句话结论

- **VRoid 是 pixiv 的 3D 业务**：VRoid Studio、VRoid Hub 都是 pixiv 的产品/服务；**VRM 格式本身不是 pixiv 私有**，而是 VRM Consortium 的开放规范。
- **没有“一键开源 照片 → 可用 VRM”的成熟方案**。商业上 VTubeMe 最接近（照片 → 带 blendshape 的 rigged VRM，$7.99）；Avatar SDK / Avaturn 可做照片 → rigged GLB/FBX，再转 VRM；开源上 CharacterGen + UniRig 只能算研究管线。
- **AITuberKit 不能完成照片 → VRM**：它是 VRM/Live2D 的运行时与聊天应用，不生成模型；它可以作为生成完成后的渲染/对话层。
- **“AI Agent 工作流”可以做编排**：Agent 调 ComfyUI/InstantID、CharacterGen、UniRig、Blender VRM Add-on、gltf-validator 等工具，逐个阶段检查；但 VRM 的人形映射、表情、SpringBone、材质和许可，仍需要人工/美术介入，不能承诺全自动。

---

## 1. VRoid Hub 和 pixiv 是什么关系？

| 对象 | 归属/关系 |
| --- | --- |
| **VRoid 项目** | pixiv 的 3D 业务；官方原话是 “The VRoid project is a 3D business by Pixiv Inc.” |
| **VRoid Studio** | pixiv 提供的免费 3D 角色制作软件（Windows/macOS，Steam 也有 Free to Play） |
| **VRoid Hub** | pixiv 于 2018-12-21 发布的 3D 角色投稿/分享平台；用 **pixiv ID** 登录；上传 VRM、创建角色页、设置使用条件；创作者允许时可下载模型 |
| **VRM 格式** | VRM Consortium 维护的开放规范（基于 glTF 2.0）；pixiv 是推动者/成员之一，不是格式所有者 |
| **VRoid Studio 预设素材** | pixiv 版权，非 CC0；做“生成/输出 3D 模型”的应用需要 pixiv 单独授权 |

要点：

- **VRoid Hub 不是“商店”**：它更接近“VRM 角色的托管/分享/展示平台”。模型能否下载、能否商用、能否改造，由创作者在 VRoid Hub 上设置；VRoid Hub 会把条件写回 VRM 的 license meta。付费模型主要在 BOOTH / Vket 等市场。
- **VRoid Studio 免费，导出 VRM 也免费**；但“用 VRoid 预设做角色创建服务”是另一回事，需要授权。VRoid Hub 上的模型也各有各的许可，不要因为“在 VRoid Hub 上”就默认可以商用。
- **VRM ≠ VRoid**：VRoid 是 pixiv 的工具/平台，VRM 是开放格式；用 Blender、Unity、其他工具也能产出 VRM。

---

## 2. 能不能用 AI Agent 工作流把图片转成 VRM？

### 2.1 先给结论

**可以“编排”，但不能“一键交付”。**

- **有商业捷径**：VTubeMe 已经做到“一张照片 → 带 blendshape 的 rigged VRM”；Avatar SDK / Avaturn 做到“照片 → rigged GLB/FBX”，再转 VRM。
- **开源没有端到端**：CharacterGen 能从单张全身动漫图生成 3D 角色，UniRig/SkinTokens 能自动绑骨，但输出不是 VRM；表情、SpringBone、MToon、许可、拓扑仍要人工处理。
- **Agent 的价值**：把“生成 → 3D → 绑骨 → VRM → QA”串起来，自动跑命令、看截图、比对结果、失败重试；它不能替代美术判断和许可判断。

### 2.2 商业方案（最快）

| 方案 | 输入 | 输出 | 价格 | 备注 |
| --- | --- | --- | --- | --- |
| **[VTubeMe](https://vtubeme.com/ai-vtuber-model-generator)** | 一张正脸照片 | **带 blendshape 的 rigged VRM** | $7.99 下载 | 最接近“照片→VRM”；真实感/风格有限；不是开源 |
| **[Avatar SDK / MetaPerson](https://avatarsdk.com/ai-avatar-generator/)** | 自拍 | rigged GLB/glTF/FBX；真实或卡通风格；Mixamo 兼容 | 首个免费，之后按量 | 输出不是 VRM；可在 Blender 转 VRM；偏写实 |
| **[Avaturn](https://avaturn.me/)** | 自拍 | 3D avatar；标准人形 rig、面部 blendshape/viseme | 商业 API/插件 | 偏写实；可导出后在 Blender 转 VRM |
| **[Tripo](https://www.tripo3d.ai/)** | 图/文 | GLB/FBX/OBJ/USD；自动绑骨 | 订阅/积分 | 通用 3D，不是 VRM；面部表情弱 |
| **Meshy** | 图/文 | GLB/FBX；自动绑骨/动画 | 订阅/积分 | 同上；适合道具/身体，不适合高要求脸 |
| **委托制作（BOOTH/Skeb/X）** | 照片/参考 | 定制角色 + 绑定 + 源文件 | 按复杂度 | 质量最高、周期长；合同写清商用/改造/再分发 |

### 2.3 开源管线（研究/自建）

| 项目 | 能力 | 输出 | 许可 | 关键缺口 |
| --- | --- | --- | --- | --- |
| **[CharacterGen](https://github.com/zjp-shadow/CharacterGen)** | 单张全身动漫图 → 多视图 → 3D 角色 | 3D 网格/纹理（非 VRM） | Apache-2.0 | 输入要全身图，不是自拍；无面部 blendshape；HF demo 当前报错 |
| **[UniRig](https://github.com/VAST-AI-Research/UniRig) / [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens)** | 任意网格 → 骨架 + 蒙皮 | rigged mesh | MIT | 只是绑骨；不生成脸/表情/VRM |
| **[Make-A-Character](https://github.com/Human3DAIGC/Make-A-Character)** | 文本 → 风格化 3D 角色 | 3D 角色 | **无 LICENSE** | 不能直接商用；文本不是照片 |
| **[LAM](https://github.com/aigc3d/LAM) / [MeshLAM](https://arxiv.org/abs/2604.22865)** | 单图 → 可动 3D 头（高斯/网格） | 头 | Apache/论文 | 只有头；没有身体/服装/VRM |
| **[PAniC-3D](https://github.com/ShuhongChen/panic3d-anime-reconstruction)** | 单视图动漫角色 → 3D | 网格 | 无 LICENSE | 老研究；不能直接用 |
| **HumanNOVA / Photo2Avatar** | 单图 → 写实全身/可动全身 | 网格/高斯 | HumanNOVA 无 LICENSE；Photo2Avatar 论文 | 写实、重、非 VRM；许可不清 |
| **CharacterStudio** | Web 端手工搭 VRM | VRM | MIT（资产另核） | 手工，不是照片生成 |

### 2.4 Agent 工作流可以怎么设计

```text
输入照片
  → 预处理：人脸/人体检测、背景移除、PII 边界
  → 风格化：InstantID/PuLID + 风格 LoRA（ComfyUI）
     - 只有头像时，先生成全身/多视图；这一步最容易失真
  → 3D 生成：CharacterGen（动漫全身）或 Tripo/Meshy/Hunyuan3D（通用）
  → 自动绑骨：UniRig/SkinTokens 或商业 auto-rig
  → VRM 制作：Blender + VRM Add-on
     - humanoid 映射、表情、SpringBone、MToon、meta/license
  → QA：gltf-validator、three-vrm 渲染、表情/物理测试、人工审阅
  → 交付：.vrm + .blend/.fbx + 许可记录
```

Agent 能做的：调 API/CLI、保存中间产物、比对截图、跑校验、失败重试、生成报告。
Agent 不能可靠替代的：

- **风格/相似度的判断**：像不像、好不好看，需要人看；
- **面部表情与口型**：从照片/生成图里没有现成的 blendshape，要手工/工具补；
- **SpringBone/服装**：自动绑骨不等于自动物理；
- **许可**：照片、生成模型、训练数据、商店条款，必须人工确认。

### 2.5 我的建议

- **要快速验证“照片→VRM”**：先用 **VTubeMe** 或 **Avatar SDK/MetaPerson**，看用户是否真的在意“像自己”；
- **要自己的美术风格**：走“2.5D 分层”或“自制 VRM 基础体 + 模块化服装”，AI 只做概念/参考/贴图；
- **要做产品级自动化**：先做 **人工在环的 Agent 管线**（每步可检查、可回退），不要承诺全自动；VRM 的表情/物理/许可应作为硬门禁。

---

## 3. AITuberKit 能达到目的吗？

**不能。** [AITuberKit 中文 README](https://github.com/tegnike/aituber-kit/blob/main/docs/README_zh-CN.md) 的定位是“构建 AI 角色的 Web 工具包”：

- 支持 **VRM/Live2D/PNGTuber** 作为输入模型；
- 做 AI 对话、TTS、口型、表情、YouTube 评论、记忆、幻灯片、外部集成；
- **没有“上传照片 → 生成 VRM”的能力**；它加载的是已有的 .vrm。

所以：

- 作为 **生成后的运行时**：很合适；你甚至可以直接参考它的 viewer/口型/表情实现。
- 作为 **照片→VRM 的生成器**：不合适；它没有 3D 生成/绑骨/VRM 创作链路。
- 许可：v2.0.0 起自定义许可，商用需购买（¥100k/300k/1M 三档）；v1.x 是 MIT；演示模型 Nike-chan 不可商用。

---

## 4. 其他类似的开源项目（2026-10 现状）

| 项目 | 技术栈 | 角色 | 优势 | 许可 | 适合 |
| --- | --- | --- | --- | --- | --- |
| **[AITuberKit](https://github.com/tegnike/aituber-kit)** | Next.js/TS | VRM/Live2D/PNG | 功能最全的 Web 工具包；TTS/LLM/YouTube/记忆/模式多 | 自定义（商用付费） | Web 产品参考；不能生成 VRM |
| **[AIRI](https://github.com/moeru-ai/airi)** | TS/Web/Electron | VRM/Live2D | **50k stars，MIT，活跃**；VRM 舞台/动画/记忆/TTS；现代 AI companion | MIT | 最值得读的 MIT 参考；偏应用不是工具箱 |
| **[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)** | Python | **Live2D** | 14k stars，MIT（Live2D 样例例外）；离线语音、打断、桌宠 | MIT | 2D/Live2D 语音伴侣；不支持 VRM |
| **[Amica](https://github.com/semperai/amica)** | TS | VRM | 1.6k stars，MIT；ChatVRM 的现代 fork；导入 VRM、表情、TTS | MIT | 最小可用的 Web VRM 聊天参考 |
| **[ChatdollKit](https://github.com/uezo/ChatdollKit)** | Unity/C# | VRM | 1.2k stars，Apache-2.0；Unity 内 VRM + LLM + 口型/动作 | Apache-2.0 | Unity 应用/游戏 |
| **[ChatVRM](https://github.com/pixiv/ChatVRM)** | TS | VRM | 845 stars，MIT；pixiv 的经典参考实现 | MIT（已归档） | 读代码/原型，不建议直接生产 |
| **[OpenAvatarChat](https://github.com/HumanAIGC-Engineering/OpenAvatarChat)** | Python | LAM/LiteAvatar/MuseTalk | 3.8k stars，Apache-2.0；模块化数字人（ASR/LLM/TTS/Avatar） | Apache-2.0 | 数字人后端/研究；不是 VRM 运行时 |
| **[Utsuwa](https://github.com/JuiceBoxxGames/utsuwa)** | TS/Electron | VRM | 124 stars，AGPL-3.0；VRM companion，桌面/浏览器 | AGPL-3.0 | 小型 VRM 伴侣参考；AGPL 传染 |
| **[local-chat-vrm](https://github.com/pixiv/local-chat-vrm)** | TS | VRM | 24 stars，MIT；pixiv 的本地对话 VRM demo | MIT（归档） | 本地 demo 参考 |

**结论：**

- **没有哪个开源项目能“照片→VRM”**；它们都消费 VRM/Live2D。
- **要 MIT + Web + VRM**：优先读 AIRI；**要最全的 Next.js 工具包**：AITuberKit（但商用许可要买）；**要最小可改**：Amica；**Unity**：ChatdollKit；**Live2D/语音**：Open-LLM-VTuber。
- **Web + VRM + AI 对话**：AITuberKit 功能最全，但许可最贵；**AIRI 是 MIT 下最强、最活跃的参考**；Amica 更轻。
- **Unity**：ChatdollKit。
- **Live2D/语音**：Open-LLM-VTuber。
- **数字人后端**：OpenAvatarChat。

---

## 5. 最终建议

1. **先分清两件事**：VRM 的“生成”与“运行时”是两条链路；AITuberKit/AIRI/Amica 只解决运行时。
2. **照片→VRM 先做商业验证**：VTubeMe（$7.99）或 Avatar SDK（首个免费）跑 5–10 张真实照片，盲测“像不像/能不能接受”；再决定是否自研。
3. **自研只做“人工在环”的 Agent 管线**：CharacterGen + UniRig + Blender VRM Add-on + 校验；每一步都要有人审和回退。
4. **产品化不要用 sample/他人模型做底座**：VRoid 预设做生成器需授权；VRoid Hub/BOOTH 模型各有许可；商用/改造/再分发要单独确认。
5. **如果目标是“目标锚点”而不是“照片复刻”**：优先“身份配方 + 可调 VRM”，照片只作为风格/配色/发型参考；这比追求 100% 相似更可控，也更符合你之前的产品定位。

---

## 6. 参考入口

- VRoid 项目：https://vroid.com/en
- pixiv 发布 VRoid Hub：https://www.pixiv.net/info.php?id=4946&lang=en
- VRoid Hub 是什么：https://vroid.pixiv.help/hc/en-us/articles/360011648414-What-is-VRoid-Hub
- VRoid Hub 许可：https://vroid.pixiv.help/hc/en-us/articles/360016417013-About-VRoid-Hub-s-conditions-of-use-and-VRM-license
- AITuberKit 中文 README：https://github.com/tegnike/aituber-kit/blob/main/docs/README_zh-CN.md
- AITuberKit 许可：https://github.com/tegnike/aituber-kit/blob/main/docs/license_en.md
- AIRI：https://github.com/moeru-ai/airi
- Open-LLM-VTuber：https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- Amica：https://github.com/semperai/amica
- ChatdollKit：https://github.com/uezo/ChatdollKit
- ChatVRM：https://github.com/pixiv/ChatVRM
- OpenAvatarChat：https://github.com/HumanAIGC-Engineering/OpenAvatarChat
- VTubeMe：https://vtubeme.com/ai-vtuber-model-generator
- Avatar SDK / MetaPerson：https://avatarsdk.com/ai-avatar-generator/
- Avaturn：https://avaturn.me/
- CharacterGen：https://github.com/zjp-shadow/CharacterGen
- UniRig：https://github.com/VAST-AI-Research/UniRig
- SkinTokens：https://github.com/VAST-AI-Research/SkinTokens
- LAM：https://github.com/aigc3d/LAM
- MeshLAM：https://arxiv.org/abs/2604.22865
- PAniC-3D：https://github.com/ShuhongChen/panic3d-anime-reconstruction
