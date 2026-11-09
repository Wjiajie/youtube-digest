# 参考图 → VRM：可行性评估与后续执行方案

- 日期：2026-10-18
- 状态：研究/规划，**未实现**
- 范围：Blueprint 首页虚拟管家；当前阶段只做 VRM 消费，不做生成
- 相关文档：[airi-home-companion-plan.md](archive/airi-home-companion-plan.md)、[vrm-3d-avatar-2026-10-18/README.md](research/vrm-3d-avatar-2026-10-18/README.md)、[photo-to-vrm-2026-10-18/README.md](research/photo-to-vrm-2026-10-18/README.md)

---

## 1. 结论

**这个方案可行，但可行的是“半自动离线流水线”，不是帖子暗示的一键产品。**

帖子里的链路——参考图 → T-pose 图 → Tripo P2.0 网格/贴图 → SkinTokens 绑骨 → 转 VRM（MToon）→ Warudo 场景跳舞——作为**演示**可以跑通；作为**面向用户的稳定产品**，目前还缺四块关键能力：

1. **脸部表情/口型**：Tripo 和 SkinTokens 都不生成 VRM 所需的 blendshape（眨眼、aa/ih/ou、喜怒哀乐）。
2. **Spring Bone**：头发、裙摆、袖子、饰品的物理骨骼和 collider 不会自动出现。
3. **MToon 与 VRM meta**：PBR 材质不会自动变成二次元 MToon；VRM 的授权、商用、再分发元数据也要单独填。
4. **身份一致性**：单张参考图生成的背面/侧面是模型猜的；T-pose 图也可能改服装、改脸、改配色。

因此建议拆成两条轨道：

| 轨道 | 目标 | 做法 | 现在是否投入 |
| --- | --- | --- | --- |
| **D 线：演示/研发** | 验证“参考图能变成一个能动的 VRM” | 整身生成 + Tripo 绑骨 + Blender 手工补脸/物理/MToon | 小规模，离线 |
| **P 线：产品/管家** | 首页有一个表情完整、口型可用、可长期维护的虚拟管家 | **授权 VRM 底模 + 生成外观**（服装/发型/饰品/贴图），保留底模的表情与 Spring Bone | 推荐，等 Avatar Lab 验证后 |

> 一句话：**整身生成适合做“作品”，底模加外观更适合做“管家”。** 首页管家首先要能眨眼、说话、有表情，其次才是“像参考图”。

当前阶段不变：先把 VRM 消费（加载、表情、口型、语音、对话）做好；生成流程放在离线 Avatar Lab，不阻塞首页。

---

## 2. 帖子链路拆解：哪些是真的，哪些被省略了

### 2.1 帖子里的实际步骤

1. 用图像模型把 OC 参考图改成 T-pose 图。
2. 调 Tripo P2.0，图生 3D，生成网格和贴图（帖子写 8K）。
3. 用 SkinTokens 自动绑骨。
4. 转成 VRM，材质用 MToon。
5. 用 computer use 操作 Warudo，套预定义场景，让角色跳舞。

### 2.2 被省略的关键工作

| 帖子说法 | 实际情况 |
| --- | --- |
| “Tripo 生成 8K 贴图” | 8K 是**独立的纹理放大/生成系统**，不是 P2.0 网格的默认输出；8192 BaseColor + 4096 Normal/ORM，网页首屏完全不需要，2K/4K 更合适。 |
| “SkinTokens 绑骨” | SkinTokens 输出的是**通用骨架 + 蒙皮权重**，不是 VRM 骨架；没有 VRM humanoid 命名、表情、Spring Bone、MToon、meta。 |
| “最后转为 VRM” | 这是整条链路里**最大的人工步骤**。Tripo 的 `spec: vrm` 只是“VRM 1.0 人类骨骼命名约定”，输出仍是 GLB/FBX，不是完整 .vrm。 |
| “Astra 调用 API” | Astra 是 computer-use/编排层，不是 3D 生成器。真正干活的是图像模型、Tripo、SkinTokens、Blender/Warudo。 |
| “Warudo 场景跳舞” | Warudo 是 GUI 应用，computer use 可以演示，但脆弱、慢、难审计；产品里不能依赖它。 |
| “一行 prompt 全搞定” | 演示可以，产品不行。脸部、物理、材质、授权都需要人工验收。 |

### 2.3 Tripo 的 “VRM 1.0” 到底是什么

Tripo 官方 API 文档写得很清楚：

- `POST /v3/animations/rig-check`：检查模型是否可绑骨，返回 `riggable` 和推荐 `rig_type`，**0 credits**。
- `POST /v3/animations/rig`：绑骨。`model: v3.0-20260909` 时支持 `spec: vrm`，即 **VRM 1.0 humanoid bone naming**；输出 `glb` 或 `fbx`。
- `POST /v3/animations/retarget`：套预设动画（idle/walk/dance 等），输出 GLB/FBX。
- 绑骨要求 T-pose 或 A-pose；人体模型上限 100,000 triangles；官方博客写 20 credits/次。

所以正确理解是：

> **Tripo 能给你一副“按 VRM 骨骼命名的人形骨架”，但不能给你一个“带表情、带物理、带 MToon、带授权信息”的 .vrm 文件。**

这句话是整个可行性评估的核心。

---

## 3. 目标流水线

```
[参考图 / 角色 brief]
        │
        ▼
[P0 规范化：正面/侧面/背面 T-pose 四视图]  ← 图像模型 + 人工选图
        │
        ▼
[P1 网格 + 贴图：Tripo P2.0]              ← API，2K/4K，quad
        │
        ▼
[P2 绑骨：Tripo rig spec=vrm]              ← API，输出 GLB/FBX
        │   └─ 失败/效果差 → SkinTokens（实验）
        ▼
[P3 VRM 组装：Blender + VRM Add-on]        ← 脚本 + 人工
        │   人形映射 / 表情 / Spring Bone / MToon / meta
        ▼
[P4 QA：three-vrm + 可选 Warudo]           ← 自动截图 + 人工评分
        │
        ▼
[P5 资产登记：license / metrics / 版本]
        │
        ▼
[P6 发布到 Blueprint（仅审核通过）]
```

### 3.1 数据契约

不要用“文件名 + 口头约定”管理资产。每个 build 一个 manifest：

```json
{
  "buildId": "avatar-2026-10-18-001",
  "brief": {
    "name": "管家草稿 A",
    "style": "anime",
    "palette": ["#1b2a4a", "#c8a96a"],
    "heightMeters": 1.68,
    "polyBudget": 50000,
    "textureBudget": 2048
  },
  "source": {
    "referenceImages": ["ref-front.png", "ref-side.png"],
    "referenceHash": "sha256:...",
    "rights": "user-owned"
  },
  "stages": {
    "sheet": { "status": "approved", "files": ["sheet-front.png"] },
    "mesh": { "status": "done", "taskId": "task_...", "files": ["mesh.glb"] },
    "rig": { "status": "done", "taskId": "task_...", "spec": "vrm", "files": ["rigged.glb"] },
    "vrm": { "status": "review", "files": ["avatar.vrm"], "validatorErrors": 0 },
    "qa": { "status": "pending", "fps": null, "expressionCoverage": null }
  },
  "license": {
    "model": "VRM 1.0",
    "commercialUsage": "corporation",
    "allowRedistribution": true,
    "creditNotation": "unnecessary"
  }
}
```

约定：

- 每个阶段输入 hash 固定；同 hash 不重复烧 credits。
- 阶段产物只追加，不覆盖已审核版本。
- 任何 stage 失败都保留日志、参数、原始响应，方便复现。
- 最终发布只读 `approved` 版本的 VRM；生成工具不能直接写线上资产。

---

## 4. 分阶段技术方案

### P0 参考图 → T-pose / 四视图

**目标**：把一张 OC 图变成可用于 3D 生成的、结构稳定的正交视图。

做法：

1. 先做**角色 brief**：脸型、发型、发色、瞳色、服装层次、配色、身高比例、必须保留的识别点（例如发饰、披风、手套）。
2. 用图像模型生成 front / left / back / right 四张 T-pose；或一张四视图 sheet 再切分。
3. Prompt 约束：
   - orthographic, full body, T-pose, arms 90°, feet shoulder-width, neutral expression；
   - plain light-gray background, no shadow, no props, no text；
   - same costume, same hair, same palette across views；
   - hands visible, fingers separated, no occlusion。
4. 人工选图：优先选**同一角色、同一服装、比例一致**的一组；不要选“最好看但背面换了一套衣服”的。
5. 如果图像模型支持参考图编辑，锁定脸部和服装区域；不要只给一张图让模型自由发挥。

验收：

- 四视图是同一角色；T-pose 标准；手脚完整；背景干净；分辨率 ≥1024。
- 正面和背面服装结构能对上；发饰/纹样位置一致。
- 无法满足时，退回“正面 + 侧面”两视图，减少背面幻觉，但 3D 生成质量会下降。

主要风险：

- 图像模型改脸、改服装、改配色；
- 背面/侧面是编的；
- 手部、鞋、裙摆结构错误；
- 参考图本身是插画，透视和比例不适合正交 T-pose。

### P1 Tripo P2.0：网格 + 贴图

**目标**：得到干净、可绑骨、适合网页的网格和贴图。

建议参数：

- 生成方式：优先 `multiview_to_model`（四视图）；只有一张图时用 `image_to_model`。
- 拓扑：P2.0 的 quad 输出；quad 更利于绑骨和后续 Blender 编辑。
- 面数：按网页预算控制在 3 万–5 万三角面；P2.0 支持 500–50,000 triangles / 500–25,000 quads，别一上来拉满。
- 贴图：**2K 先跑通，4K 作为高质量档；不要 8K**。8K 对首页是显存和加载时间灾难。
- 输出：GLB 用于网页/绑骨；如果需要 quad 编辑，保留 FBX。
- 保存 `task_id`：Tripo 绑骨接口可以直接接 `task_id`，不用重新上传。

验收：

- 网格没有明显破洞、翻转法线、重复面；
- 身体/服装/头发/饰品是合理分离的（P2.0 会自动分件，但要检查）；
- 贴图没有明显拉伸、接缝、 baked lighting；
- 三角面、材质数、贴图尺寸在预算内；
- 手、脚、脸没有明显崩坏。

主要风险：

- P2.0 是游戏-ready 拓扑，不是“二次元手办级”高模；脸部细节可能不够；
- 贴图是 PBR，直接放进 three-vrm 会偏写实，需要 MToon 化；
- 头发/裙摆可能是整片 mesh，Spring Bone 需要重新分件或刷权重；
- 生成结果有随机性，同一参考图要多跑几个 seed/变体。

### P2 绑骨：Tripo 优先，SkinTokens 备选

#### 方案 A：Tripo rig（推荐先跑）

流程：

1. `POST /v3/animations/rig-check`，传 `task_id` / `file_token` / URL；确认 `riggable: true`、`rig_type: biped`。
2. `POST /v3/animations/rig`：

```json
{
  "input": "task_...",
  "model": "v3.0-20260909",
  "rig_type": "biped",
  "spec": "vrm",
  "out_format": "glb"
}
```

3. 拿回 rigged GLB/FBX；可选 `POST /v3/animations/retarget` 套 `preset:idle` 做快速动态检查。

优点：

- 官方 API，无需自建 GPU；
- `spec: vrm` 直接给 VRM 1.0 humanoid 骨骼命名，省掉一轮 retarget；
- `rig-check` 0 credits，先检查再花钱；
- 输出 GLB/FBX，进 Blender 方便。

缺点：

- 只解决骨架和蒙皮，不解决表情、Spring Bone、MToon、meta；
- 对二次元大头、厚刘海、裙摆、飘带的效果需要实测；
- 20 credits/次，失败重跑要算成本；
- 100k triangles 上限，超了要先减面。

#### 方案 B：SkinTokens（实验/备选）

适用场景：

- Tripo 绑骨失败，或二次元角色变形明显；
- 已有骨架，只想生成蒙皮权重（`--use_skeleton`）；
- 愿意维护本地 NVIDIA GPU 环境。

事实：

- 代码 MIT；Hugging Face 模型卡 license 也是 MIT；
- 输入单 mesh（OBJ/FBX/GLB），输出 rigged GLB；
- 需要 NVIDIA GPU ≥14GB、Python ≥3.11、CUDA ≥12.1、PyTorch 2.7.0、flash-attn、bpy ≥4.2；
- 依赖 Blender server 做导入/导出；
- `--use_transfer` 保留贴图和 scale；`--use_skeleton` 只生成蒙皮；`--use_postprocess` 做 voxel 后处理；
- 输入是**单个 mesh**；P2.0 常把身体/服装/配饰分成多个对象，合并后才能跑，但合并会改变衣物独立变形和权重，分件角色优先用 Tripo rig；
- 输出的是通用骨架，**不是 VRM 骨架**；要进 VRM 还得 retarget/重命名/人工修。

结论：**SkinTokens 不是 Tripo 的替代品，而是“绑骨失败时的第二意见”。** 首版不要把它放进主链路。

绑骨验收：

- `riggable` 通过；
- 54 根 VRM humanoid 骨骼能映射；手指可选；
- T-pose 下肩、肘、腕、髋、膝、踝没有明显扭曲；
- 5 个测试姿势（抬手、弯腰、走路、坐下、转头）没有大面积穿插；
- 每顶点影响数 ≤4（glTF/three-vrm 友好）；
- 蒙皮权重没有跨部件“流血”（裙子权重跑到腿、头发权重跑到肩）。

### P3 VRM 组装：Blender + VRM Add-on

这是整条链路最需要人工的一步，也是“能不能成为管家”的分水岭。

工具：

- Blender 4.2+；
- `saturday06/VRM-Addon-for-Blender`：VRM 导入/导出、VRM Humanoid、MToon 配置、Python 自动化 API；MIT/GPL-3.0 双许可；
- 可选：Blender 的 Data Transfer / Join as Shapes / 第三方面部绑定工具，用于表情。

步骤：

1. **导入与清理**
   - 导入 rigged GLB/FBX；
   - 应用 transform；统一单位米；原点放脚底；
   - 合并重复 mesh、清理隐藏面、修正法线、检查材质槽。

2. **Humanoid 映射**
   - 按 VRM 1.0 要求映射 hips/spine/chest/neck/head/shoulders/upperArm/lowerArm/hand/upperLeg/lowerLeg/foot/toes；
   - 检查 rest pose 是 T-pose；
   - 检查骨骼 roll/orientation，避免导出后手臂翻转；
   - 54 根骨骼是“完整人形”的常见数量，但关键不是数量，而是 required bones 全部正确。

3. **表情（最大缺口）**
   - VRM 需要 blend shape / expression：`blink`、`blinkLeft`、`blinkRight`、`aa`、`ih`、`ou`、`ee`、`oh`、`happy`、`angry`、`sad`、`relaxed`、`surprised`、`lookLeft/Right/Up/Down`、`neutral`；
   - Tripo/SkinTokens 生成的 mesh 通常没有这些 shape key；
   - 三个可选策略，见第 6 节；
   - 没有表情的 VRM 可以“站着”，但不能做合格管家。

4. **Spring Bone**
   - 头发、裙摆、袖子、飘带、饰品分别建 SpringBone chain；
   - 加 collider（头、肩、胸、腿）；
   - 调 stiffness/drag/gravity，先保证不穿模、不抖动；
   - 不要把所有东西绑成一条链；按材质/部件分组。

5. **MToon 材质**
   - PBR → MToon：shade color、rim、outline、double-sided、alpha；
   - 贴图压到 2K，合并材质槽；
   - 透明头发/裙摆注意排序和 alpha clip；
   - 不要直接保留 PBR metallic/roughness 当作二次元材质。

6. **VRM meta**
   - title、author、license、commercialUsage、avatarPermission、allowRedistribution、modification、creditNotation、thumbnail；
   - 这些字段不是“填着玩”，它们决定能不能商用、能不能再分发、要不要署名；
   - 生成资产的授权必须和 Tripo/图像模型/参考图的授权一致。

7. **导出与验证**
   - 导出 VRM 1.0；
   - `gltf-validator` 检查 0 errors；
   - three-vrm 加载，检查 humanoid、expressions、springBone、MToon；
   - 截图 front/side/back、表情、口型、动态。

验收：

- VRM 1.0 合法，0 errors；
- 必需表情齐全，口型 5 个元音可用；
- 头发/裙摆有 Spring Bone，5 秒 idle 不穿模；
- MToon 生效，不是 PBR 灰模；
- meta 完整，授权与来源一致；
- 文件 ≤15MB，贴图 ≤2K，draw calls ≤80；
- 1.6m 左右身高，脚底在原点。

### P4 QA：three-vrm 为主，Warudo 只做视觉参考

自动 QA：

- 用 Playwright + Chromium 无头/headed 加载 three-vrm；
- 截取 front/side/back、10 个表情、5 个口型、3 个姿势；
- 记录 FPS、draw calls、triangles、texture memory、load time；
- 用固定相机和灯光，保证可比较。

Warudo：

- 只用于“这个角色在完整场景里好不好看”的人工参考；
- 不把 Warudo 放进 CI，不用 computer use 做产品步骤；
- 如果只是验证跳舞/场景，Tripo 的 `retarget` + three-vrm 已经够做技术验收。

验收指标：

| 维度 | 指标 |
| --- | --- |
| 身份 | 人工 1–5 分；关键识别点是否保留；可选 face embedding 相似度 |
| 绑骨 | riggable；人工骨骼修正次数；5 姿势变形评分 |
| 表情 | 必需 expression 覆盖率；口型 5 元音是否可用 |
| 物理 | 5 秒 idle / 3 秒转头 / 1 次走路，穿模次数 |
| 材质 | MToon 覆盖率；是否残留 PBR |
| Web | FPS、triangles、draw calls、texture MB、load time |
| 流程 | 墙钟时间、credits、人工分钟、重试次数 |

### P5 资产登记与发布

- 每个资产一条记录：来源、作者、license、commercial、modification、redistribution、credit、文件 hash、版本、QA 结果；
- 只有 `approved` 的 VRM 才能进 `apps/web/public/vrm` 或对象存储；
- 线上 `avatarProfile` 只存 URL、缩放、朝向、表情映射；不存生成参数；
- 生成工具与线上运行时隔离：生成工具挂了，首页不受影响。

---

## 5. 可行性矩阵

| 环节 | 技术可行性 | 质量风险 | 自动化程度 | 结论 |
| --- | --- | --- | --- | --- |
| 参考图 → T-pose/四视图 | 高 | 中高（身份漂移） | 中 | 可用，但必须人工选图 |
| Tripo P2.0 网格/贴图 | 高 | 中（二次元脸/手/发） | 高（API） | 可用，2K/4K，别 8K |
| Tripo rig `spec=vrm` | 高（人形骨架） | 中（变形质量） | 高（API） | 首选绑骨 |
| SkinTokens | 中 | 中高（通用骨架） | 中（本地 GPU） | 备选/研发 |
| Blender VRM 组装 | 中 | 高（表情/物理/材质） | 中（脚本 + 人工） | 必须有人工环节 |
| 脸部表情 | **低** | **高** | 低 | 当前最大 blocker |
| Spring Bone | 中 | 中 | 中 | 可模板化，但要调 |
| MToon 转换 | 中 | 中 | 中 | 需材质模板 |
| Warudo 场景 | 高（演示） | 低 | 低（GUI） | 只做参考，不做产品 |
| 一键全自动 | **低** | 高 | 低 | 目前不成立 |

结论：

- **单角色演示**：可行，1–3 天可以出一个能站、能跳、能看的 VRM；
- **稳定产品**：当前不可行，缺表情、物理、材质、授权四道关；
- **首页管家**：先用授权底模，整身生成放离线 Lab。

---

## 6. 脸部/表情策略（决定成败）

### 方案 1：授权 VRM 底模 + 生成外观（推荐）

做法：

- 选一个表情完整、Spring Bone 完整、MToon 完整的 VRM 底模；
- 用参考图生成/改造服装、发型、饰品、贴图；
- 保持底模的头部/脸部骨骼与 blend shape，不换脸；
- 把生成的外观绑到底模，或作为可换装部件。

优点：

- 立刻拥有眨眼、口型、喜怒哀乐；
- 物理、材质、meta 都是已知可用；
- 风险集中在“外观像不像”，而不是“能不能动”。

缺点：

- 身份受底模限制；
- 服装贴合、发型替换需要 Blender 工作；
- 不是“完全从参考图生成”。

对 Blueprint 来说，这是**最符合“虚拟管家”目标**的路线。

### 方案 2：整身生成 + 面部模板/迁移

做法：

- 生成身体和服装；
- 用一个人脸模板（带 blend shape）替换/融合头部；
- 或把模板的 shape key 迁移到生成的头。

难点：

- 头部接缝、比例、UV、材质；
- 表情 shape key 的拓扑必须匹配；
- 身份容易“换头”。

适合研发，不适合首版。

### 方案 3：整身生成 + 自动面部绑定

做法：

- 用 Faceit/ARKit blendshape 工具或研究模型，从 mesh 生成 52 个 ARKit blendshape；
- 再映射到 VRM expressions。

难点：

- 工具授权/成本；
- 生成质量不稳定；
- 仍需人工修；
- VRM 映射不是自动的。

可作为 D 线实验。

### 方案 4：骨骼驱动脸（fallback）

做法：

- 下巴骨做 mouth open；眼睑骨做 blink；
- 不依赖 blend shape。

缺点：

- 生成 mesh 通常没有独立眼睑/嘴唇拓扑；
- 表情粗糙；
- three-vrm 的 expression 体系用不上。

只作为“没有表情时的降级”，不作为管家方案。

---

## 7. 成本、工期、授权

### 7.1 成本

| 项目 | 费用 | 说明 |
| --- | --- | --- |
| Tripo Free | $0 | 200 credits/月；公开模型；**不可商用** |
| Tripo Pro | $20/月（年付） | 3000 credits/月；私有模型；可商用 |
| Tripo Max | $90/月（年付） | 25000 credits；8K 不限；本项目不需要 |
| Tripo rig | 20 credits/次 | 官方博客；`rig-check` 0 credits |
| Tripo retarget | 20 credits/1–10s | 官方博客；多段最多 5 段 |
| SkinTokens | 免费（MIT） | 需要 ≥14GB NVIDIA GPU；云 GPU 另算 |
| Blender + VRM Add-on | 免费 | MIT/GPL 双许可 |
| 图像模型 | 按张计费 | 四视图要多候选，预算要留 |
| Warudo | 另查 | 只做人工参考，不进产品 |

> 价格和 credits 会变；采购前重新核对 Tripo 定价页。API 与 Studio 是分开计费的。

### 7.2 工期（估算）

| 阶段 | 工期 | 产出 |
| --- | --- | --- |
| Avatar Lab 脚手架（目录、manifest、Tripo client、Blender wrapper） | 3 天 | 可重复跑的单角色流水线 |
| 5 个参考角色人工基线 | 3 天 | 成功率/工时/失败模式 |
| 半自动化（API 编排 + QA 截图 + 报告） | 5 天 | 内部工具，不是用户功能 |
| 10 角色 pilot | 5 天 | 决策数据 |
| 产品化（上传、队列、审核、资产库） | 另算 2–3 周 | 仅在 pilot 通过后 |

首版不要承诺“10 分钟一个角色”。更现实的数字是：**流水线稳定后，单角色 30–120 分钟人工 + 20–60 分钟机器**；脸部/物理复杂的角色更久。

### 7.3 授权

| 资产/工具 | 授权要点 |
| --- | --- |
| Tripo 生成物 | Free 计划不可商用；Pro 起可商用；以 Tripo 服务条款为准 |
| SkinTokens | 代码 MIT；HF 模型卡 license MIT；引用论文/项目 |
| VRM Add-on | MIT / GPL-3.0 双许可；分发时注意 GPL 义务 |
| 参考图 | 必须是用户拥有或有权使用；不要拿真实人物照片做未授权克隆 |
| 生成的人脸 | 避免冒充真人；涉及真人形象要书面同意 |
| VRM 底模 | 逐个看 meta：avatarPermission、commercialUsage、allowRedistribution、modification、creditNotation |
| Warudo 场景 | 场景/道具/动作单独授权；不要默认可以商用 |
| 音乐/舞蹈 | MMD 动作、歌曲、编舞都有版权；演示也要注意 |

**红线**：

- 不用 Tripo Free 生成的资产做商业首页；
- 不把没有表情的生成角色直接当管家；
- 不自动发布生成资产；
- 不用 computer use 操作 Warudo 作为生产步骤；
- 不把用户参考图/人脸用于训练或二次分发。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 身份漂移 | 不像参考图 | 四视图 + 人工选图 + 关键识别点清单；必要时局部重绘 |
| 没有表情 | 管家变“雕像” | 底模策略；或 D 线面部绑定实验；不要直接上线 |
| 绑骨失败 | 无法动画 | 先 `rig-check`；Tripo 失败再 SkinTokens；保留人工修骨 |
| Spring Bone 穿模 | 头发/裙子炸 | 模板化 chain + collider；5 秒 idle 自动截图；人工调参 |
| MToon 转换脏 | 二次元变写实 | 材质模板；贴图重绘/烘焙；限制 PBR 输入 |
| 面数/贴图超预算 | 首页卡顿 | 3–5 万三角面；2K 贴图；减面/图集；FPS 门禁 |
| Tripo credits 烧穿 | 成本失控 | 输入 hash 缓存；每 build 上限；先 rig-check；失败不自动重跑 |
| 供应商锁定 | 换工具难 | 保存 GLB/FBX + Blender 脚本 + manifest；VRM 是最终格式 |
| 授权不清 | 不能商用/下架 | 资产登记；只使用有明确许可的底模；Pro 计划；人工审核 |
| 生成质量不稳定 | 用户失望 | 定位为“AI 草稿 + 人工审核”，不承诺一键完美 |

---

## 9. 执行计划（具体到能开工）

### Phase 0：现在（0 天）

- 继续 VRM 消费：P1 首页壳、P2 对话、P3 语音；
- 生成流程只写文档，不写产品代码；
- D5 已定：首版用 `VRM1_Constraint_Twist_Sample` 做免费测试/展示模型（`avatarPermission: everyone`，展示/修改/再分发明确；`commercialUsage: corporation`，正式商用前再核对；技术样品，不是正式角色）。

### Phase 1：Avatar Lab 脚手架（3 天）

新增离线目录（不放 `apps/web`）：

```
tools/avatar-lab/
  README.md
  pyproject.toml
  avatar_lab/
    cli.py
    tripo.py          # rig-check / rig / retarget / 轮询
    blender.py        # 调用 blender -b -P
    manifest.py       # build.json 读写/校验
    qa.py             # three-vrm 截图/FPS（可复用 Playwright）
  scripts/
    assemble_vrm.py   # Blender 内：导入、映射、导出
  builds/             # gitignored
```

先不做 UI；CLI 能跑通一个角色即可。

### Phase 2：5 角色人工基线（3 天）

- 选 5 个不同风格参考图（发型、服装复杂度、性别/体型）；
- 按本文流水线手工跑；
- 记录：每步耗时、credits、失败原因、人工修正点；
- 输出一份 `baseline.md`，不要只写“成功/失败”。

### Phase 3：半自动化（5 天）

- Tripo client：提交、轮询、下载、重试、错误码；
- Blender wrapper：headless 导入/导出；人形映射和材质先做“检查 + 报告”，不强行全自动；
- QA：three-vrm 加载、固定相机截图、FPS/内存；
- 生成 `build-report.md`：每步状态、耗时、credits、失败原因。

### Phase 4：10 角色 pilot（5 天）

门禁（建议）：

- ≥8/10 可绑骨；
- ≥7/10 人工评分 ≥3/5；
- 0 个严重授权问题；
- 单角色人工 ≤60 分钟（不含首次调试）；
- VRM validator 0 errors；
- 目标笔记本 1600×1000 ≥60fps；
- 文件 ≤15MB，贴图 ≤2K。

未通过：不加产品入口，继续 D 线；通过：进入 Phase 5。

### Phase 5：产品化（另算）

- 上传参考图 → 风格/体型选项 → 排队 → 生成 → 人工审核 → 用户确认；
- 明确文案：“AI 草稿，需审核”；
- 资产库、版本、删除、授权记录；
- 功能开关默认关闭；
- 不在首版做“全自动发布”。

---

## 10. 与首页管家的接口

生成流程最终只输出一个 `avatarProfile`：

```ts
type AvatarProfile = {
  id: string
  vrmUrl: string
  scale: number
  rotationY: number
  expressionMap: Partial<Record<
    "neutral" | "happy" | "thinking" | "concerned" | "surprised",
    string
  >>
  license: {
    commercialUsage: string
    allowRedistribution: boolean
    creditNotation: string
  }
}
```

首页只消费这个 profile；不关心它是 Tripo 生成的、Blender 修的，还是用户上传的。这样：

- 生成失败不影响首页；
- 换模型不改组件；
- 授权信息跟着资产走；
- 后续接入用户自己的 VRM 很容易。

---

## 11. 明确不做

- 不做“一行 prompt 全自动生成可上线管家”的承诺；
- 不用 Warudo + computer use 做生产流水线；
- 不用 8K 贴图做网页首屏；
- 不把 SkinTokens 放进首页运行时；
- 不用 Tripo Free 资产做商业产品；
- 不自动发布未经人工审核的 VRM；
- 不用真人照片做未授权人脸克隆；
- 不在当前阶段改首页业务代码。

---

## 12. 参考来源

- SkinTokens GitHub：https://github.com/VAST-AI-Research/SkinTokens
- SkinTokens 模型卡：https://huggingface.co/VAST-AI/SkinTokens
- SkinTokens 项目页：https://zjp-shadow.github.io/works/SkinTokens/
- SkinTokens 论文：https://arxiv.org/abs/2602.04805
- Tripo P2.0 发布：https://www.tripo3d.ai/blog/tripo-p2-0-preview
- Tripo 8K Texture：https://www.tripo3d.ai/blog/tripo-8k-texture
- Tripo 绑骨 API：https://developers.tripo3d.com/en/docs/animations-rig
- Tripo rig-check API：https://developers.tripo3d.com/en/docs/animations-rig-check
- Tripo retarget API：https://developers.tripo3d.com/en/docs/animations-retarget
- Tripo 定价：https://www.tripo3d.ai/pricing
- Tripo 导出格式：https://www.tripo3d.ai/tutorials/tripo-ai-export-formats
- VRM Add-on for Blender：https://github.com/saturday06/VRM-Addon-for-Blender
- VRM 规范：https://vrm.dev/en/
- three-vrm：https://github.com/pixiv/three-vrm
- Warudo：https://warudo.app/

> 说明：本文把“可验证的官方文档”和“社区帖子里的演示”分开写；帖子能证明“有人跑通过”，不能证明“稳定可复制”。价格、 credits、API 版本以采购/接入当天为准。
