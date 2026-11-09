# VRM 是标准吗？格式原理、资源购买与同类格式对比

> 2026-10-18。面向 Blueprint 的选型与采购判断，不构成法律意见。所有“标准地位”与“许可”结论都附了官方入口；具体模型仍以文件内许可和商店条款为准。

## 0. 一句话回答

- **VRM 是一个开放规范，也是 VTuber / 日本 metaverse 生态的事实标准**；它基于 glTF 2.0，由 VRM Consortium 维护，2022 年发布 1.0。
- **它还不是 ISO 标准**。2024 年 VRM Consortium 与 Khronos 合作，计划把 VRM 能力作为 glTF 扩展推进国际标准化；截至 2026-10-18，Khronos 的 glTF 扩展目录里仍没有 `VRMC_*`，也没有公开的正式 ratify 公告。glTF 2.0 本身是 ISO/IEC 12113:2022。
- **买 VRM 资源的地方**：BOOTH（最大，约 2.4 万件 VRM 商品）、Vket Avatar Maker Store、VRoid Hub（免费/按创作者许可）、Sketchfab、CGTrader，以及 BOOTH/Skeb 上的委托制作。
- **同类格式各有主场**：glTF 是通用 3D 底座，FBX 是 DCC/游戏管线，USD/USDZ 是影视与 Apple AR，MMD/PMX 是日本免费动画资产，Live2D/Inochi2D 是 2D 木偶，SMPL-X 是研究用人体参数模型，MetaHuman 是 UE 写实数字人。**VRM 的独特价值是“人形语义 + 表情 + 物理 + 许可元数据”打包在一个 glTF 文件里。**

---

## 1. VRM 的标准地位（时间线 + 证据）

| 时间 | 事件 |
| --- | --- |
| 2018 | VRM 首次发布（日本） |
| 2019-04-24 | VRM Consortium 成立 |
| 2022-09 | VRM 1.0 正式发布；VRM 0.x 转为旧版 |
| 2024-01 | VRM Consortium 与 Khronos 签订 liaison 协议 |
| 2024-10-24 | 双方宣布合作，计划把 VRM 功能作为官方 glTF 扩展推进；如果 ratify，将打开 ISO/IEC 标准化路径 |
| 2026-10-18 | 查 Khronos glTF 扩展目录：仍无 VRMC_*；公开信息未见过渡到 ISO 的公告 |

**它是什么级别的标准？**

- **开放规范**：规范、JSON Schema、示例模型在 [vrm-c/vrm-specification](https://github.com/vrm-c/vrm-specification)，任何人都可以实现；官方实现 UniVRM（Unity）开源。
- **事实标准**：官方用例包括 VirtualCast、VRoid Studio、cluster 等；VTuber 工具（VSeeFace、Warudo、VNyan、VMagicMirror）、Web（three-vrm）、Blender（VRM Add-on）都支持。Khronos 新闻直接称其为“日本跨平台 avatar 集成的事实行业标准”。
- **国际标准进程**：glTF 2.0 在 2022 年成为 ISO/IEC 12113:2022；VRM 目前是 glTF 上的扩展，尚未进入 Khronos 扩展目录，更不是 ISO 标准。可以理解为“正在走标准化流程的开放事实标准”。
- **格式登记**：美国国会图书馆的格式描述（FDD 000564）已收录 VRM，标注为 preliminary；这能说明它被视为需要长期保存的格式，但不是 ISO 认证。

> 结论：**对外说“VRM 是开放标准/事实标准”是准确的；说“VRM 是 ISO 国际标准”目前不准确。**

---

## 2. VRM 的原理：一个 glTF 文件上的“人形契约”

### 2.1 文件结构

VRM 文件（.vrm）本质上是 **GLB（binary glTF）**：一个 JSON 场景描述 + 一个二进制 buffer（顶点、索引、动画）+ 内嵌的 PNG/JPEG 纹理；纹理、材质、骨骼、动画、缩略图都在一个文件里。

一个 .vrm 的内部大致是：

- **JSON**：asset、scenes、nodes、meshes、materials、textures、skins、animations，以及 extensions 里的 VRMC_vrm / VRMC_springBone / VRMC_materials_mtoon；
- **BIN**：顶点、索引、蒙皮权重、动画采样、纹理字节；
- **缩略图**：meta.thumbnailImage 指向的图片，用于应用里显示模型图标。

它在 glTF 之上通过扩展增加语义：

| 扩展 | 作用 |
| --- | --- |
| **VRMC_vrm** | 人形骨骼、表情、视线、元数据/许可 |
| **VRMC_springBone** | 头发/衣摆的弹簧骨骼物理 |
| **VRMC_materials_mtoon** | 卡通着色材质（描边、明暗分层、rim、matcap） |
| **VRMC_node_constraint** | roll / aim 约束 |
| **VRMC_vrm_animation（VRMA）** | 跨模型的动画文件（骨骼 + 表情 + 视线） |

### 2.2 VRMC_vrm：人形与许可

- **Humanoid**：用固定名称描述骨骼（hips、spine、chest、neck、head、左右上/下臂、手、左右上/下腿、脚；手指可选）。强制 T-pose、统一缩放（1.0 = 1 米）、统一坐标系（Y-up、-Z 朝向）、骨骼无局部旋转。这样任何支持 VRM 的应用都能把同一个模型放进自己的场景，不需要针对每个模型写适配。**跨应用能成立，靠的就是这些约束**：应用按固定 bone name 取节点、按固定 expression name 设权重、按 SpringBone 更新物理，而不是为每个模型写一套适配。
- **Expressions**：把 Blender/Unity 的 BlendShape 统一成表情语义。预设包括 `happy / angry / sad / relaxed / surprised`、五元音 `aa / ih / ou / ee / oh`、`blink / blinkLeft / blinkRight`、`lookUp / lookDown / lookLeft / lookRight`、`neutral`；也支持自定义表情。绑定对象可以是 morph target、材质颜色或纹理变换；还有 `overrideBlink / overrideLipSync / overrideMouse` 这类覆盖开关。
- **LookAt**：定义眼球/头部看向目标的方式（bone 或 blendShape），以及偏移与范围。
- **Meta**：模型名、作者、版权、联系方式、缩略图，以及**许可设置**（下一节）。

### 2.3 VRMC_springBone：头发与衣摆

用“关节链 + 碰撞体（球/胶囊）+ 刚度、阻尼、重力”模拟次级运动。它不是布料解算，也不是全身物理，只解决“头发/衣摆/挂件跟着动”这类需求；复杂服装仍要靠骨骼动画或自定义物理。

### 2.4 VRMC_materials_mtoon：卡通渲染

在 glTF 材质上增加描边、明暗分层、rim、matcap、阴影色等参数，让模型在不同应用里保持接近的动漫观感。它不是 PBR 的替代，而是“在 glTF 材质上叠一层卡通语义”。

### 2.5 VRMC_vrm_animation（VRMA）

VRMA 把“人形骨骼 + 表情 + 视线”的动画写成 glTF animation；同一个 VRMA 可以套到任意 VRM 上，应用负责把源骨骼旋转转换到目标模型。它解决“动作资产的跨模型复用”，不解决动作生成。

### 2.6 VRM 0.x 与 1.0

| 维度 | VRM 0.x（旧） | VRM 1.0（当前） |
| --- | --- | --- |
| 扩展名 | `VRM` | `VRMC_vrm` + 独立子扩展 |
| 表情命名 | joy / fun / sorrow / a / i / u / e / o | happy / relaxed / sad / aa / ih / ou / ee / oh |
| 许可 | 较简单的 meta | 更完整的 VRM Public License 设置 |
| 物理 | 内嵌在 VRM 扩展 | 独立 `VRMC_springBone` |
| 约束 | 无 | `VRMC_node_constraint` |
| 现状 | 仍在大量 VTuber 资产/旧应用中使用 | 官方正式版；新项目优先 |

three-vrm 同时支持 0.x 和 1.0；加载 0.x 时通常需要 `VRMUtils.rotateVRM0`。买资产时要看版本，不要假设“VRM = 1.0”。

### 2.7 VRM 没有规定什么

- 没有标准布料/柔体物理、IK、全身碰撞；
- 没有完整的 ARKit 52 blendshape 命名（可以用自定义表情承载，但需要自己映射）；
- 没有 DRM、加密或强制许可执行；meta 是许可声明，不是技术保护；
- 没有规定 AI 训练、模型再分发、商业服务的默认权利——这些要靠文件 meta + 商店条款 + 单独合同。

---

## 3. 在哪里买/获取 VRM 资源

### 3.1 免费

| 来源 | 内容 | 注意 |
| --- | --- | --- |
| **VRoid Studio** | 免费创建角色，导出 VRM；自带 sample models | 预设素材非 CC0；做“生成器”需 pixiv 单独授权 |
| **VRoid Hub** | 创作者上传的 VRM；创作者允许时可下载 | 每个模型许可不同；商用/改造/再分发看 meta |
| **vrm-c/vrm-specification samples** | 官方测试模型 | 适合开发验证，不适合正式美术 |
| **three-vrm examples** | VRM 1.0 测试模型 | 同上 |
| **开源/CC0 模型** | OpenGameArt、部分 Sketchfab CC 模型 | 逐件核对许可；VRM 转换后仍受原许可约束 |

### 3.2 付费/交易平台

| 平台 | 内容 | 价格量级（2026-10 观察） | 许可要点 |
| --- | --- | --- | --- |
| **[BOOTH](https://booth.pm/ja/search/VRM)** | 日本最大同人市场；VRM/VRChat 模型、服装、配饰 | 约 ¥500–¥9,000 常见；也有更贵 | 商品页的利用规约优先；商用/改造/再分发常需另购 |
| **[Vket Avatar Maker Store](https://avatarmaker.vket.com/en/store/list?category=avatar)** | Vket 的 avatar/部件商店；支持 VRM / UnityPackage 导出 | 免费到数千日元 | Vket 账号 + 商品条款 |
| **[VRoid Hub](https://hub.vroid.com/en)** | 免费下载（创作者允许时）；也可作为展示 | 免费 | 许可由创作者设置；商用看 meta |
| **[Sketchfab](https://sketchfab.com/search?q=vrm&type=models)** | 免费/付费 3D 模型；有 VRM/GLB | 免费到数百美元 | CC 或自定义许可；下载前看清 |
| **[CGTrader](https://www.cgtrader.com/3d-models/vrm)** | 通用 3D 市场；搜索页约 868 个 VRM 结果 | 数十到数百美元 | 标准/扩展许可；商用条款 |
| **TurboSquid / ArtStation** | 通用 3D；VRM 较少，多为 FBX/OBJ | 按模型 | 需转换；许可逐件核对 |
| **委托制作（BOOTH / Skeb / X）** | 定制角色、服装、绑定 | 按复杂度；通常数万日元起 | 合同里写清商用、改造、再分发、AI 训练 |
| **VTubeMe** | 照片 → rigged VRM（AI） | $7.99/次 | 商业服务；生成物条款 |
| **Meshy / Tripo** | 图/文 → 3D 网格/自动绑骨 | 订阅/积分 | 输出多为 GLB/FBX；需转 VRM 并补表情/物理 |

> BOOTH 的“VRM”搜索结果在 2026-10-18 显示 **24,518 件**；其中大量是 VRChat avatar（Unity 包），不一定直接是 .vrm 文件。买之前先看商品格式。

### 3.3 买之前必须检查的 10 件事

1. **版本**：VRM 1.0 优先；0.x 需要确认目标应用支持。
2. **人形骨骼**：必需骨骼是否齐全；手指是否完整。
3. **表情**：是否有 blink、aa/ih/ou/ee/oh、情绪表情；命名是否标准。
4. **SpringBone**：头发/衣摆是否有物理组与碰撞体；复杂度。
5. **材质/贴图**：MToon 还是普通 PBR；贴图分辨率、面数、显存。
6. **许可 meta**：`avatarPermission`、`commercialUsage`、`allowRedistribution`、`modification`、`creditNotation`、`otherLicenseUrl`。
7. **商店条款**：BOOTH/Vket 商品页的“利用規約”、VN3 License 等；是否允许商用、改造、再分发、VRChat 使用、AI 训练。
8. **源文件**：是否给 .blend/.fbx/.vroid；只有 .vrm 时改造成本高。
9. **更新/支持**：版本更新、修复、退款政策。
10. **产品用途**：是否允许作为“角色创建服务/生成器”的基础资产——绝大多数不允许，必须单独谈。

### 3.4 许可陷阱（比技术更重要）

VRM 1.0 的 meta 默认值很保守（官方 schema）：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| avatarPermission | `onlyAuthor` | 只有作者能当 avatar 用 |
| commercialUsage | `personalNonProfit` | 个人非营利；企业需 `corporation` |
| allowRedistribution | `false` | 不允许再分发 |
| modification | `prohibited` | 不允许修改 |
| creditNotation | `required` | 必须署名 |
| allowExcessivelyViolent/SexualUsage | false | 不允许极端暴力/性内容 |

所以：**“我买了这个 .vrm”不等于“我可以商用、改造、再分发、拿去做产品生成器”。** 具体以文件 meta + 商品条款 + 作者书面许可为准；meta 是声明，不是 DRM，也不能替代合同。

VRM Public License 1.0 是 VRM 的公共许可框架，`licenseUrl` 指向它；实际权利由文件里的 license settings 决定。VRoid Hub 会在“允许第三方使用”时用自己的条件覆盖 meta，这也是为什么同一个模型在不同平台看到的许可可能不同。

### 3.5 其他格式去哪买

| 格式 | 主要渠道 | 说明 |
| --- | --- | --- |
| **glTF / GLB** | [Sketchfab](https://sketchfab.com/)、[Poly Haven](https://polyhaven.com/)、[Kenney](https://kenney.nl/assets)、[Quaternius](https://quaternius.com/)、[Fab](https://www.fab.com/) | 大量 CC0/CC-BY 免费资产；通用 3D，不一定带人形骨架/表情 |
| **FBX** | [TurboSquid](https://www.turbosquid.com/)、[CGTrader](https://www.cgtrader.com/)、[ArtStation](https://www.artstation.com/marketplace)、[Unity Asset Store](https://assetstore.unity.com/)、[Fab](https://www.fab.com/) | 游戏/DCC 资产最全；买来通常要重绑/转 VRM |
| **USD / USDZ** | [Apple AR Quick Look](https://developer.apple.com/augmented-reality/quick-look/)、[Sketchfab](https://sketchfab.com/)、[NVIDIA Omniverse](https://www.nvidia.com/en-us/omniverse/)、[AOUSD](https://aousd.org/) | Apple AR/影视为主；USDZ 可直接在 iPhone/iPad/visionOS Quick Look |
| **MMD / PMX** | [BOOTH MMD](https://booth.pm/ja/search/MMD)、[BowlRoll](https://bowlroll.net/)、[ニコニ立体](https://3d.nicovideo.jp/)、[VPVP wiki](https://w.atwiki.jp/vpvpwiki/) | 日本免费模型/动作生态；多为个人规约，商用要逐件确认 |
| **Live2D** | [nizima](https://nizima.com/)、[BOOTH Live2D](https://booth.pm/ja/search/Live2D)、[Live2D sample](https://www.live2d.com/en/learn/sample/) | 2D VTuber 模型/部件；Cubism 编辑器 FREE/PRO |
| **Inochi2D** | [Inochi2D](https://inochi2d.com/)、[itch.io](https://itch.io/)、[BOOTH](https://booth.pm/ja/search/Inochi2D) | 开源 2D 木偶；素材少但许可更自由 |
| **HAnim / X3D** | [Web3D](https://www.web3d.org/)、[ISO/IEC 19774-1](https://www.iso.org/standard/64788.html)、学术资产 | 工业/学术交换；消费级素材很少 |
| **SMPL-X** | [MPI 官方](https://smpl-x.is.tue.mpg.de/)（研究许可） | 人体参数模型；不是成品 avatar；商用需单独授权 |
| **MetaHuman** | [MetaHuman](https://www.metahuman.com/)、[Fab](https://www.fab.com/) | UE 写实数字人；Epic 生态 |
| **VRChat / Unity avatar** | [BOOTH](https://booth.pm/ja/search/VRChat)、[Gumroad](https://gumroad.com/)、[Jinxxy](https://jinxxy.com/)、[Vket](https://vket.com/en/) | 数量最大；Unity 包/FBX，不是 VRM；转换不改变版权 |

> 通用 3D 市场（TurboSquid/CGTrader/ArtStation）卖的多数是 FBX/OBJ/MAX，不是 VRM。买之前先确认“文件格式”和“是否含骨骼/表情/物理”，否则你买到的是“模型”，不是“可用的 avatar”。

### 3.6 采购决策树

- **只想快速有一个能直播/展示的动漫 avatar** → BOOTH / Vket / VRoid Hub 买或下载现成 VRM；check 商用/改造。
- **想要“像用户/品牌”的定制角色** → 委托制作，合同写清商用、改造、再分发、AI 训练；交付 .vrm + .blend/.fbx。
- **想做产品化的“角色创建服务”** → 自建/委托基础体，或取得明确授权；不要拿现成 sample/VRChat 模型当底座。
- **预算低、能接受转换** → MMD PMX + 转换工具；但许可和清理成本高。
- **2D 动漫方向** → Live2D（成熟）或 Inochi2D（开源）。
- **Apple AR / visionOS** → USDZ；**影视/大规模场景** → USD；**UE 写实** → MetaHuman；**AI 人体重建** → SMPL-X/GLB。

---

## 4. 同类格式对比

### 4.1 总表

| 格式 | 类型/标准 | 人形语义 | 表情 | 物理 | 动画 | Web | 资产生态 | 许可 | 最适合 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **VRM 1.0** | glTF 扩展；VRM Consortium；事实标准 | ✅ 强 | ✅ 标准 | ✅ SpringBone | ✅ VRMA | ✅ three-vrm | 大（日本 VTuber） | 文件内 meta + 公共许可 | Web/VTuber/跨应用 avatar |
| **glTF/GLB** | Khronos；ISO 12113:2022 | ❌ 需自定义 | ❌ 需自定义 | ❌ 需自定义 | ✅ 通用动画 | ✅ 原生 | 极大（通用 3D） | 逐资产 | 通用 3D、Web、商品展示 |
| **FBX** | Autodesk 私有 | ❌ 需约定 | ✅ blendshape | ❌ | ✅ | ❌ 需转换 | 极大（DCC/游戏） | 私有 SDK | 建模、游戏管线、Unity/UE |
| **USD/USDZ** | OpenUSD/AOUSD；USDZ Apple | ❌ 需约定 | ✅（ARKit/USD） | ❌ | ✅ | ⚠️ 有限 | 影视/Apple | 开放实现 + Apple | 影视、visionOS/AR |
| **MMD PMX** | MMD 生态；非 ISO | ⚠️ 日文骨骼约定 | ✅ morph | ✅ 刚体/关节 | ✅ VMD | ❌ 需转换 | 大（日本免费模型） | 逐模型（常混乱） | 日本动画素材、MMD 视频 |
| **Live2D** | 私有 Cubism | ❌ 2D | ✅ 参数 | ✅ 物理 | ✅ | ✅ SDK | 大（2D VTuber） | 私有 SDK/编辑器 | 2D 动漫角色 |
| **Inochi2D** | 开源 2D | ❌ 2D | ✅ | ✅ | ✅ | ⚠️ | 小 | BSD-2 | 开源 2D 木偶 |
| **HAnim/X3D** | ISO/IEC 19774 | ✅ 标准关节 | ⚠️ | ⚠️ | ✅ | ⚠️ | 小（工业/学术） | ISO | 标准人体动画交换 |
| **SMPL-X** | 研究参数模型 | ✅ 身体参数 | ✅ 表情参数 | ❌ | ✅ | ⚠️ | 学术 | 研究许可；商用另谈 | 人体重建、AI 拟合 |
| **MetaHuman** | Epic 私有 | ✅ | ✅ | ✅ | ✅ | ❌ | 大（UE） | 私有 | UE 写实数字人 |
| **Unity/VRChat avatar** | 平台资产（FBX+prefab） | ⚠️ 平台约定 | ✅ | ⚠️ | ✅ | ❌ | 极大（VRChat） | 逐资产/平台条款 | VRChat、社交 VR |

### 4.2 逐个说优劣

**VRM**
- 优势：人形/表情/物理/许可语义标准化；一个文件跨应用；Web（three-vrm）和 Unity（UniVRM）都有成熟实现；VTuber 资产生态大；VRMA 可复用动作。
- 劣势：不是 ISO；0.x/1.0 并存；物理只有 SpringBone；没有 IK/布料；许可靠自觉；部分平台（VRChat）不原生支持；高质量模型仍要手工制作/购买。

**glTF/GLB**
- 优势：开放、ISO、Web 原生、文件小、PBR、工具链广；VRM 就是它的一个 profile。
- 劣势：没有 avatar 语义；没有统一骨骼名/表情/物理/许可；不同应用各自约定，跨应用 avatar 会“能用但动不了/表情不对”。

**FBX**
- 优势：DCC/游戏管线事实标准；骨骼、蒙皮、blendshape、动画完整；Unity/UE/Blender/Maya 都支持；资产最多。
- 劣势：私有格式/SDK；文件大；没有 avatar 语义/许可 meta；Web 需转换；版本兼容性坑多。

**USD/USDZ**
- 优势：场景组合、分层、变体、大规模管线；Apple AR Quick Look/visionOS 原生 USDZ；影视级。
- 劣势：复杂、重；avatar 语义需自定义；Web 支持有限；USDZ 更偏 Apple 生态；学习成本高。

**MMD PMX**
- 优势：日本免费模型/动作生态巨大；物理（刚体/关节）成熟；MMD 视频文化；转换到 VRM 的工具多。
- 劣势：Windows/MMD 中心；格式老；骨骼名/材质/物理不统一；许可非常混乱；跨应用差；需要转换和清理。

**Live2D**
- 优势：2D 表现力最强；VTuber 生态成熟；Cubism SDK 覆盖 Web/Unity/UE/Native；表情/物理/口型成熟。
- 劣势：私有编辑器/SDK；2D 不能转身；资产制作需要分层 PSD；商用/发行有 SDK 许可要求；不适合 3D 场景。

**Inochi2D**
- 优势：开源（BSD-2）；2D 木偶、物理、免费；适合不想被 Live2D 许可绑定的项目。
- 劣势：生态/工具/素材远小于 Live2D；Web 集成需自己接；商业支持弱。

**HAnim/X3D**
- 优势：ISO 标准（19774-1:2019）；关节/段定义严谨；适合工业/学术/长期归档。
- 劣势：消费级 avatar 生态很小；没有 VRM 这种“开箱即用”的表情/物理/许可；工具链少。

**SMPL-X**
- 优势：参数化人体（体型/姿态/表情/手）；AI 人体重建的通用底座；研究生态大。
- 劣势：不是完整 avatar（没有头发/服装/材质/许可 meta）；研究许可，商用要单独谈；不能直接当产品模型。

**MetaHuman**
- 优势：写实度/表情/毛发/服装质量高；UE 管线完整；MetaHuman Animator 动捕。
- 劣势：Epic/UE 生态绑定；重；Web 不现实；许可/导出限制；风格偏写实，不适合动漫。

**VRChat/Unity avatar**
- 优势：VRChat 生态巨大；BOOTH 上大量可买；Unity 工具链成熟；社交场景现成。
- 劣势：平台锁定；不是可移植格式；Unity 包/FBX；转 VRM 需要工具且可能丢表情/物理；平台条款和作者条款叠加。

### 4.3 转换与坑

| 转换 | 工具 | 会丢什么 |
| --- | --- | --- |
| VRM → FBX/Unity | UniVRM、Blender VRM Add-on | VRM meta、部分 SpringBone、MToon 近似 |
| FBX/Unity → VRM | Blender VRM Add-on、NDMF VRM Exporter（VRChat→VRM） | 平台组件、部分材质/表情/物理；需重绑 |
| PMX → VRM | PMX2VRM / VRMify 等 | 刚体物理→SpringBone、日文骨骼名、材质 |
| GLB → VRM | Blender + VRM Add-on | 需补 humanoid/expression/spring bone/meta |
| VRM → USDZ | Blender/USD 导出 | VRM 语义、表情/物理/许可 |

**原则**：转换只改容器，不改版权。买的是 VRChat 模型，转成 VRM 不会自动获得 VRM 商用/再分发权。

---

## 5. 对 Blueprint 的建议

1. **运行时格式选 VRM 1.0**：three-vrm 已经验证；P0 已跑通 120fps。glTF 作为底层通用格式，不直接承载 avatar 语义。
2. **创作管线选 Blender + VRM Add-on**：可控、可定制、许可清晰；VRoid 用于快速原型；FBX 作为 DCC 交换。
3. **采购策略**：优先“可商用 + 可修改 + 可再分发”的 VRM 或委托自制；BOOTH/Vket 上大量模型是个人使用/VRChat 用途，商用要单独谈；不要把 sample/他人模型作为“角色创建服务”的基础。
4. **2D 备选**：如果武侠主题继续走 2.5D，Live2D/Inochi2D 是另一条线；VRM 负责 3D 身份锚点。
5. **Apple/AR 需求**：再考虑 USDZ 导出，不在主链路。
6. **AI 生成**：Meshy/Tripo/CharacterGen 输出 GLB/FBX，需补人形/表情/物理/许可才能变 VRM；短期不要把“自动生成正式 VRM”当承诺。

---

## 6. 参考入口

### 标准与规范
- VRM Consortium：https://vrm-consortium.org/en/
- VRM 文档：https://vrm.dev/en/
- VRM 1.0：https://vrm.dev/en/vrm1/
- VRM 规范仓库：https://github.com/vrm-c/vrm-specification
- VRM meta 字段：https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md
- VRM Public License 1.0：https://vrm.dev/en/licenses/1.0/
- VRMA：https://vrm.dev/en/vrma/
- Khronos × VRM 公告：https://www.khronos.org/news/press/the-khronos-group-and-vrm-consortium-collaborate-to-advance-international-standardization-of-the-vrm-3d-avatar-file-format
- glTF（Khronos，ISO/IEC 12113:2022）：https://www.khronos.org/gltf/
- 美国国会图书馆 VRM 格式描述：https://www.loc.gov/preservation/digital/formats/fdd/fdd000564.shtml

### 购买/获取
- BOOTH VRM 搜索：https://booth.pm/ja/search/VRM
- Vket Avatar Maker Store：https://avatarmaker.vket.com/en/store/list?category=avatar
- VRoid Hub：https://hub.vroid.com/en
- VRoid Hub 许可说明：https://vroid.pixiv.help/hc/en-us/articles/360016417013-About-VRoid-Hub-s-conditions-of-use-and-VRM-license
- Sketchfab：https://sketchfab.com/search?q=vrm&type=models
- CGTrader：https://www.cgtrader.com/3d-models/vrm
- VRoid Studio：https://vroid.com/en/studio

### 同类格式
- glTF：https://www.khronos.org/gltf/
- FBX：https://www.autodesk.com/products/fbx/overview
- OpenUSD：https://openusd.org/ · AOUSD：https://aousd.org/
- Apple USDZ / AR Quick Look：https://developer.apple.com/augmented-reality/quick-look/
- MikuMikuDance：https://sites.google.com/view/vpvp/ · PMX 概要：https://w.atwiki.jp/vpvpwiki/pages/284.html
- Live2D Cubism：https://www.live2d.com/en/cubism/
- Inochi2D：https://inochi2d.com/
- HAnim ISO/IEC 19774-1:2019：https://www.iso.org/standard/64788.html
- SMPL-X：https://smpl-x.is.tue.mpg.de/
- MetaHuman：https://www.metahuman.com/

---

### 一句话总结

**VRM 不是“又一个 3D 文件格式”，而是“glTF 上的一套人形 avatar 契约”**：它把“骨骼怎么对上、表情叫什么、头发怎么晃、许可怎么写”标准化了。买资源时，技术检查看版本/骨骼/表情/SpringBone/材质，法律检查看 meta（尤其是 commercialUsage、allowRedistribution、modification）和商店条款；两者缺一不可。
