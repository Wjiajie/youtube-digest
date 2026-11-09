# P0 探针报告（Meshy 批次计划 · 阶段 P0）

- 日期：2026-10-04
- 预算：上限 89 分 → 实花 **89 分**（批次 84 + 绑定 5）
- 余额：7,945 → **7,856**（月度积分，约 17 天后重置清零）
- 计划来源：[武侠风格化具体执行计划](wuxia-meshy-batch-plan.md) §2
- 结论状态：**六项探针全部完成，等待分支拍板后再进 P1**

## 1. 跑了什么

清单 `art/dual-theme/manifests/meshy-batch-p0.json`，由 `scripts/meshy/run-batch.mjs --resume` 一次跑完，中途无需人工介入。

| 项 | 目的 | 任务 id | 产出 |
|---|---|---|---|
| p0-1a | 廉价线三档对比 · smart-topology/meshy-t2 | `01a10663-d841-779d-853a-4a5d292487b9` | `.../20261004_180931_p0-sword-t2_01a10663/sword-t2.glb` |
| p0-1b | 同上 · standard/meshy-6-lite | `01a10664-b9ba-70ab-bd79-75772e540e59` | `.../20261004_181029_p0-sword-6lite_01a10664/sword-6lite.glb` |
| p0-1c | 同上 · standard/meshy-7.1 | `01a10666-9e4d-708b-b532-f1ac760de560` | `.../20261004_181233_p0-sword-71_01a10666/sword-71.glb` |
| p0-4a/b/c | 2D 风格锁定（青瓷香炉／松树／纸灯笼） | `01a10668-45e9-…` / `…-8699-…` / `…-c325-…` | 各自 `concept/image_0.png` |
| p0-2 | 细特征（松针）· smart-topology/meshy-t2 | `01a10668-fc6e-7367-a921-3cee0ac808f8` | `.../20261004_181508_p0-pine-t2_01a10668/pine-t2.glb` |
| p0-3 | 自动绑定探针（MPFB 人形 → Meshy Rigging） | `01a10664-8d6c-7796-bdb4-de9ba3961f3a` | `.../20261004_181029_p0-3-rig_01a10664/{rigged_character,walking_glb,running_glb}.glb` |

全部路径的公共前缀是 `art/dual-theme/eastern/meshy/probe/`。

## 2. 三档并排对比（同一相机、同一灯光、Cycles CPU 渲染）

**这是 P0 的核心结论，先看图**：
- `art/dual-theme/eastern/meshy/probe/p0-contact-sheet.png`（7 格总览）
- `art/dual-theme/eastern/meshy/probe/p0-render-compare.png`（整体 + baseColor 贴图对照）
- `art/dual-theme/eastern/meshy/probe/p0-guard-compare.png`（**护手近景，判别力最强**）
- `art/dual-theme/eastern/meshy/probe/p0-hilt-compare.png` / `p0-rig-views.png`

| 档 | 分值 | 三角面 | 文件字节 | 贴图 | 近景表现 |
|---|---|---|---|---|---|
| meshy-t2 (smart-topology, target_polycount 10000) | **15** | 9,284 | 5,977,668 | 3 张 2K | 护手是**扁平圆盘**、无浮雕；剑穗是一颗**光滑水滴** |
| meshy-6-lite (standard) | **15** | 30,152 | 8,751,972 | 3 张 2K | 护手有轮廓与鎏金；剑鞘有编织纹；剑穗有股绳与珠 |
| meshy-7.1 (standard) | **30** | 337,764 | 18,491,768 | 3 张 2K | 护手是**云纹花形浮雕**；鎏金锐利；剑穗股绳最细 |
| p0-2 松树 (meshy-t2) | **15** | 8,145 | 7,239,956 | 3 张 2K | 可辨认，但针叶成块状 |

**判读：t2 与 6-lite 同为 15 分，但近景细节差一个档次；7.1 的额外 15 分只换来 11 倍三角面与小幅提升。**

## 3. 发现（按重要性）

1. **价格表与实测完全吻合**：t2 网格+2K = 15、6-lite = 15、7.1 = 30、绑定 = 5、nano-banana 单图 = 3。批次累计 84 分，自主上报的 `consumed_credits` 与实际余额下降一致。
2. **只有 smart-topology 能控面数**：请求 10,000 → 实得 9,284（误差 7%）。standard 无控面能力，7.1 直接吐 337,764 面——对一件兵器是网页端不可用的量级（t2 的 36 倍）。
3. **缩放不一致，必须管线内归一化**：t2 把最长轴归一化到 **1.0**（剑 ±0.5；松树被塞进 1 m 立方体），standard 返回 ~1.9 m（剑 ±0.95）。**不要相信导出尺寸**，G5 入库前统一重算包围盒。
4. **细特征仍会出缺陷**：pine-t2 的法线出现退化（`normalLengthMin: 0`）。松针这类亚毫米结构在 8k 面下无法重建——"细特征会坏"的假设在廉价线上成立。
5. **image-to-3d 默认产出三张图**（baseColor / normal / metallicRoughness），`enable_pbr` 默认 true 时无需额外付费；2K 已足够风格化用途。
6. **smart-topology 的"原生分件"在单体输入上没体现**：剑输出仍是 1 个 primitive。分件能力需要多部件输入才能验证。
7. **绑定探针成功且零几何漂移**：26,756 面进、26,756 面出，14,517 顶点不变；得到 **24 根 Mixamo 命名骨骼**（Hips/Spine/Spine01/Spine02/neck/Head/Left&Right Shoulder-Arm-ForeArm-Hand/UpLeg-Leg-Foot-ToeBase）+ 免费 walk（1.067 s）与 run 循环。
8. **但 Meshy 绑定严格弱于本地 MPFB 绑定**：**0 根手指骨、0 根面骨、0 个 morph target**。本地 `add_builtin_rig` 免费给出 **53 骨含手指**。→ 主角绑定应以本地 MPFB 为准，Meshy 绑定的价值只剩"那两段免费的走/跑循环 + Mixamo 命名便于重定向"。
9. **面骨缺失 = 表情必须留在 Blender**：P0-3 与调研报告一致，Meshy 全链路无表情能力。G4 的 ARKit 52 blendshape 仍然只能由 MPFB faceunits 提供。
10. **绑定任务的返回体不含 `consumed_credits`**（只有三个 URL），台账记分必须靠价目表或余额差。
11. **`rigged_character.glb` 自带的动画是 1 帧（0.0333 s）的绑定姿态残影**，没有使用价值；要动作用 walking/running。
12. **风格锁定可行**：三张 nano-banana 概念图调性统一（浅灰影棚背景、哑光手绘、青白/黛绿），单张 3 分。松树概念图偏青（`#B4C1C9`），比目标黛绿更冷，需要在 prompt 里纠偏。

## 4. 分支建议（请拍板后再进 P1）

**主用线改为 meshy-6-lite（15 分/件）**——与 t2 同价、近景明显更好。`meshy-t2` 收窄到：远景/背景件、需要精确控面或干净拓扑的件；`meshy-7.1` 收窄到镜头会推到近景的 3–5 件英雄资产（主角兵器、舟体主视面）。

**副作用：预算大幅过剩。** 原 P1–P7 按 33 分/件估出 ≈7,943 分；改走 6-lite 后同样件数只要 ≈2,700 分，**约 5,000 分用不掉**，而月度积分 17 天后清零。四个选项：

- (a) **扩量**：把 P1–P7 从 ~180 件提到 ~350 件。仓库与工期压力大。
- (b) **提档**：英雄件走 7.1，其余 6-lite。
- (c) **收缩 + 留缓冲**：只做清单里真正要用的 ~120 件，余量留给 P8 重试。
- (d) **转投 2D**：更多概念图/贴图变体（3 分/张，5,000 分 = 1,600 张）。

推荐 **(c) + (b) 组合**：件数砍到真正要用的量，省下的额度给英雄件提档并把 P8 重试池做大；剩余额度做 2D 变体。理由是 P0 已经证明"贵不等于对"——真正的瓶颈在拓扑与材质工艺，不在生成分辨率。

## 5. 顺带交付的自动化（后续批次直接复用，无人工步骤）

| 文件 | 作用 |
|---|---|
| `scripts/meshy/run-batch.mjs` | 批次运行器：概念图 → 网格 → 下载，带断点索引与退出码 8/9 处理 |
| `scripts/meshy/build-contact-sheet.mjs` | 拼图 + 审查 HTML，支持 `--index` 与 `--list` 两种输入 |
| `scripts/meshy/ledger.mjs` | 台账同步（顺带把停在 2026-09-25 的 `updated_date` 修正为 2026-10-04）与资产库索引 |
| `scripts/blender/render-glb-review.py` | headless Cycles/CPU 定机位渲染，`--bboxfrac` 可做近景裁切（EEVEE/Workbench 无 GPU 上下文，headless 不可用） |
| `scripts/blender/build_probe_human.py` | MPFB 母体导出（含 `--factory-startup` 下必须先 `addon_enable` 的修复） |

台账现状：**12 条任务、累计 149 分**；`art/dual-theme/manifests/meshy-library.json` 收录 **42 个 GLB**（含历史资产），标注 units=meters / up_axis=+Y / facing=+Z。

## 6. 需要你拍板

1. **主用线**：接受"meshy-6-lite 为主线、t2 降为远景线、7.1 只给英雄件"吗？
2. **过剩额度**：选 (a) 扩量 / (b) 提档 / (c) 收缩留缓冲 / (d) 转投 2D？（我推荐 c+b）
3. **是否继续**：P0 到此按计划停下。确认后我按新分支重排 P1–P7 清单再跑。
