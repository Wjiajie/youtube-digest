# 双主题人物与场景制作对照

固定点 `04a5f0d`，2026-09-10，P2 实际资产加工切片。两套内部制作件已生成并通过导出／WebGL 检查，**正式美术未通过**。目的：验证现有真实人物能否通过造型、服装与环境加工形成两种身份表达；不新建通用编辑器，不把样片当作正式首页。

最新制作修订为 **v9**，增量固定点 `276de22`。已处理袖口拓扑贴合、被覆盖皮肤穿插、面部表情与环境主次；具体证据见下方“v9 精修”。v5 表格与命令保留为上一批的历史证据，不代表最新资产。

## 制作约定

- 从已核验的 Casual 修复源出发，保留完整骨架与源权重；新增服饰绑定原骨架。每主题独立制作文件与 GLB，不覆盖原件，不新增采购或外部服务。
- 赛博主题：短款结构外套、护肩／设备细节、深石墨与小面积冷光、偏暖侧光；人物处于安静的工作舱，而非素材展台。
- 东方主题：交领、分片长外袍、腰封和发饰；临水石阶、偏置树冠、近石远景与留白。区别必须进入轮廓和构图，不只材质颜色。
- 用已取得的实际自然资产，并记录原许可对应问题；衍生件仍留在忽略目录。现代基础脸／发型、服装穿插、全动作、艺术质量和硬件预算不能仅靠脚本成功认定通过。
- 不添加战斗叙事、虚构成果、等级／装备数值或用户数据。此批不改正式页面、账号、数据库、扩展或托管发布。

## 交付与检查

交付两套可编辑 Blender 制作件、自含 GLB，以及真实 WebGL 构图截图。默认中性待机姿态；主题源使用相同身份基础，不要求同一服装网格。实际姿态、材质明度、面部可读性、人物／背景关系由截图判断，失败时回到模型或光照，不伪装成验收通过。

已授权测试 seam：脚本输入哈希／不覆盖输出、重新打开制作件的默认姿态、实际导出 GLB 内容与资源边界、真实 Three 加载／WebGL 画面。两项导出缺陷和一项默认姿态问题以失败检查复现再修复；造型采用实际样片迭代，不声称审美有自动化单测。不使用截图 mock，也不以命名标记证明审美质量。正式美术门槛仍以路线文档为准。

## 已制作内容与当前判断

[制作脚本](../scripts/build-dual-theme-study.py)从真实 Casual 修复源出发，在内存中应用 Mirror，沿源手臂截面制作长袖并混合上臂／前臂权重。赛博新增护肩、胸前设备、偏置衣襟和耳侧接收器；东方新增交领、腰封、发簪与四片带腿部混合权重的长袍。不是同一网格只换色。

环境同样分开制作：赛博采用纵向框架、格栅、控制台与种植槽；东方采用水面、踏石、临水平台、真实岩石与树木和短木屏。两套均保留 62 骨骼、24 个导出动作，从相同人物身份基础出发；当前只实测中性待机，不认可全动作服装安全性。

| 项目 | 赛博 v5 | 东方 v5 |
| --- | --- | --- |
| GLB 字节数 | 2,978,932 | 2,911,852 |
| 网格几何三角形合计 | 14,006 | 13,130 |
| 实际 Three Mesh／SkinnedMesh | 41／19 | 37／20 |
| 第二组骨骼影响图元 | 7 | 7 |
| 当前轮廓 | 短外套、肩部结构、贴身长裤 | 交领、宽袖、开衩长袍 |
| 未通过的视觉点 | 肩甲悬离、面部简陋、工作舱框架过于通用 | 接肩不连续、袍片僵硬、主岩块过大 |

主线程检查实际远景与近景：服装轮廓和构图可区分，但树冠仍偏黄且抢眼，面部缺少嘴部与精修细节，裤装及环境大平面仍有低模积木感。**不接入正式首页、不把 P2 置为完成**。后续优先修正服装接缝、人物面部和主次比例，不继续堆叠同类候选或通用预览工具。

## 可复现制作与依赖

运行时为外置盘内 Blender 4.5.13 LTS；仅处理已核验的本地来源。使用工厂启动、禁用源脚本和离线模式。修复源、树木衍生件、岩石输入均有哈希检查；已有输出直接拒绝，不覆盖旧样片。

```bash
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.weight-repaired-study.blend --python-exit-code 1 --python scripts/build-dual-theme-study.py -- cyberpunk 5
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.weight-repaired-study.blend --python-exit-code 1 --python scripts/build-dual-theme-study.py -- eastern 5
bash scripts/with-m1-runtime.sh node scripts/render-dual-theme-study.mjs 5
```

制作命令只在输出不存在时运行，修改制作内容需换新的 1–99 修订号。渲染可重复运行，会更新同修订号的本地截图和报告。`.tools/asset-studies/dual-theme-v5/` 保存上一批四件输出；`.goal-loop/evidence/dual-theme-v5/` 保存每主题远景、近景、稍后待机图和报告。旧修订均保留。均被 Git 忽略；提交包含配方与文档，不向产品包或公开仓库分发素材。

| 输出 | 字节数 | SHA-256 |
| --- | --- | --- |
| cyberpunk.blend | 7,814,438 | `3e6dd88df178aafd4a52c21081f1bd5eeae5e19a9607262a54125ce56ebc2c59` |
| cyberpunk.glb | 2,978,932 | `f0c3531fd2fac934fcc9181c4c37521072dfe943986a9fad2b5d4070d316e0d1` |
| eastern.blend | 7,880,834 | `4879a3f0f2eb9ad33fb6f7560602fb238a1756de3bb8256cf0579b91fa460f9e` |
| eastern.glb | 2,911,852 | `da39361bb01a114bc5e09e35562a6f5584c40196ded416bb1ea74a788b6c4241` |

实际重新打开两套 `.blend`：当前网格材质使用的树皮 2048²、树叶 1024² 图像已打包，无外链 Library 或 Text 脚本。仍残留源文件 `Texture.png` 旧数据块，但不被当前网格材质节点使用，未宣称所有旧数据均清理。GLB 两个图像和单一 buffer 均内嵌。原 Casual 源 SHA `204d82f2…` 与修复源 `216fc727…` 未变；完整来源见[素材台账](asset-intake.md)与[完整影响验证](eight-influence-preview.md)。

许可边界没有变化：人物包内 CC0 标题为 Modular Males，与 Women 来源不一致；树木包许可标题也与来源不一致。Kenney Nature 的 CC0 已核验。前两项需要确认准确对应关系后才能正式分发，不能因导出成功认定法律门槛通过。

## 运行证据与已修复问题

[渲染检查](../scripts/render-dual-theme-study.mjs)使用已有公开加载接口、真实 GLB、Three WebGL 与隔离 Playwright，不接管 ego-browser 空间 8，不启动产品开发服务器。GPU 为 ANGLE Vulkan SwiftShader；不是 M4 帧率、移动设备或正式 DOM HUD 验收。

- v1 过曝：默认物理灯光换算使 SUN 强度放大约 683 倍。强度检查先失败，再采用显式 COMPAT 导出；最终两套各两盏方向光保持作者设定值。
- v3 调色丢失：旧 `ShaderNodeMixRGB` 未导出 `baseColorFactor`。GLB 检查先失败，再改为 Blender 4.5 导出器识别的现代 RGBA Mix 节点；v4 保留 `[0.36, 0.62, 0.72, 1]` 乘数。修复导出一致性不代表黄叶已达到美术目标。
- v4 两主题均真实绘制，待机 0.15s 与 0.8s 画面变化，无着色器／页面错误或外部 HTTP 请求。239,149／222,963 个浮点 accessor 值均有限，完整骨架和两组影响通过现有加载器。报告中渲染计数包含阴影重复绘制，不能当作唯一资产三角形数或性能通过证据。
- 已有输出拒绝检查实际退出 1，前后哈希一致。367 项 Vitest／35 文件、四工作区 TypeScript 通过。本批只新增制作脚本和文档，不修改应用源码；没有声称本批运行生产构建、Auth 或数据库验收。

导出仍出现树木多图像 sampler、NumPy 矩阵、约束／关键帧烘焙警告；有限值和中性待机证据不能关闭全动作风险。没有付费、push、托管发布、数据库或认证操作。

## 独立审阅与默认姿态修正

源提交 `0f2565e`：Standards 独立审阅 0 项确认违反、0 项有意义异味。Spec 独立审阅发现 1 项 P2：v4 可编辑文件默认仍为 `Idle` 与开启的 NLA 叠加，不等于截图中的 `Idle_Neutral`；东方脚部位置实际相差约 0.18–0.19 米。不能以截图正确掩盖制作件状态错误。

修复先实际重新打开 v4，断言中性动作与 NLA 隔离时失败；随后调整为先导出全部动作，再选择 `Idle_Neutral`、关闭 NLA 叠加、保存新的 v5 制作件。两套 v5 重新打开检查通过，GLB 仍为 24 动作。v5 双主题 WebGL 全部检查再次通过，六张 PNG 与已检查的 v4 逐字节一致；仅关闭制作件启动状态缺陷，不降低美术标准。

最终两路复核：Standards 0 项新增违反／异味；Spec 0 项剩余确认问题。Spec 独立重新打开 v5，两套启动姿态与隔离中性求值矩阵最大差均为 0；62 骨骼和 24 动作名称集保留，扣除构图平移后源四网格位置（容差 `1e-6`）及精确权重映射无遗漏。未以这些检查冒称全动作变形或商用品质通过。相关 72 个本地文档链接有效。

可重复的只读启动检查（将 `cyberpunk` 换成 `eastern` 核对另一套；将 `v5` 换成 `v4` 可重现旧错误）：

```bash
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v5/cyberpunk.blend --python-exit-code 1 --python-expr 'import bpy; a=bpy.data.objects["CharacterArmature"].animation_data; assert a.action.name=="Idle_Neutral" and not a.use_nla, "Editable study must open in the isolated neutral idle"'
```

## v9 精修：接缝、面部与环境主次

固定点 `276de22`，2026-09-10。本批不改应用、数据库或托管边界，仍是 P2 实际制作而非正式发布。

- **袖口**：从原身体的 Skin／cloth 材质边界提取每侧八个真实顶点，保留不共面的 X 坐标和原 Shoulder／UpperArm 权重，再向下生成长袖。旧版用 X=.18 的近似圆环，真实边界位于 X≈.205–.210。新增[实际接缝检查](../scripts/check-study-sleeve-joins.py)在旧 v5 上先失败（首点差 31.744 mm）；v6 与最终 v9 两主题的 16 个根部顶点，在静止和三个中性待机帧中误差均为 0。
- **遮挡皮肤**：真实渲染发现仅对齐根部仍会让被衣服覆盖的上臂皮肤穿出。v9 只在衍生身体中移除中心 X 绝对值处于 `.20–.515` 的 Skin 面；手部、袖口原衣料与原始文件保留。不是把失败画面隐藏或改成透明贴片。该造型只验证了当前长袖与待机，不适用于任意换装／大幅动作。
- **面部与肩饰**：用原 Skin 表面射线采样和重心插值权重制作眼白、虹膜、瞳孔、眼睑与嘴部，替换衍生件中原突出的方块眼睛。赛博肩甲改为沿真实衣料表面与权重制作的薄肩饰，避免悬空。原身体／头部已有顶点的权重不改写；被遮盖皮肤和旧眼睛的衍生面有意删除，不再宣称 v9 与源网格完全相同。
- **主次关系**：赛博树木高度 2.45→1.90，重复格栅改为斜切背板；东方主岩块 1.10→.62、树木 2.70→2.10，给人物与前景路径留出更多空间。没有新增模型下载或购买。

主线程已检查 v9 真实人物近景与两套远景：眼睛／嘴部可读，旧袖根皮肤穿出在当前采样画面中消失，环境压迫感减轻。仍有服装接缝的着色过渡、袍片和裤装僵硬、树冠色彩、环境缺乏细节及构图过于简陋的问题。**当前依然不达到商用首页标准，不以接缝数值通过代替完整视觉验收。** 下一步需要服装材质与空间层次的整体完善，并在真实面板构图中评估；不是继续堆叠小饰件就算完成。

| v9 输出 | 字节数 | SHA-256 |
| --- | --- | --- |
| cyberpunk.blend | 7,908,317 | `30400c23b83f7462f89dc93b291dca6421d5a9caa3d2edc8a9f73b9c713ecb3b` |
| cyberpunk.glb | 2,940,632 | `757000d66fc916b9780546badfa322661933184bc986de4e99373cc88e8e0ef9` |
| eastern.blend | 8,016,486 | `4aa5bff5e2845e22764857c4098cb1bbfcff41a06e0e06a8d16435220b1e399b` |
| eastern.glb | 2,917,332 | `2ad44aa54291a270115b780a4d9d116adf6985758066f5403eebcb9b1bd7b4a0` |

当前资产目录 `.tools/asset-studies/dual-theme-v9/`，截图与报告 `.goal-loop/evidence/dual-theme-v9/`，继续忽略、不打包发布。使用上方制作命令时修订号改为 `9`；已有输出不可覆盖。真实渲染与静态接缝检查：

```bash
bash scripts/with-m1-runtime.sh node scripts/render-dual-theme-study.mjs 9
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v9/cyberpunk.blend --python-exit-code 1 --python scripts/check-study-sleeve-joins.py
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v9/eastern.blend --python-exit-code 1 --python scripts/check-study-sleeve-joins.py
```

最终主线程验证：双主题各 24 动作／62 骨骼，几何三角形 13,303／12,942；228,977／222,705 个浮点值有限，实际待机画面变化，无页面／着色器／外部 HTTP 请求错误。367 项 Vitest、四工作区类型检查通过。旧 v5 仍能复现接缝失败，原件未覆盖。软件 GPU、选定待机帧和这些内部样片，不代表全动作、硬件帧率、许可对应或 P2 商用品质通过。

源提交 `a559c34` 的两路独立审阅：**Standards** 0 项确认违反／有意义异味；**Spec** 0 项确认问题。Spec 重新打开两套制作件并运行接缝检查，核验四个哈希、62 骨骼和 24 个动作名称；源四网格所有存续顶点的位置（容差 `1e-6`）与精确权重匹配。主线程另外核对两个原件哈希、中性启动姿态、当前材质图像打包状态和无外链 Library／Text；48 个相关本地链接有效。审阅者未重跑 GPU，不将截图审阅表述为新的渲染或商业验收。
