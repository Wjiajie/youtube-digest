# 双主题人物与场景制作对照

固定点 `04a5f0d`，2026-09-10，P2 实际资产加工切片。两套内部制作件已生成并通过导出／WebGL 检查，**正式美术未通过**。目的：验证现有真实人物能否通过造型、服装与环境加工形成两种身份表达；不新建通用编辑器，不把样片当作正式首页。

## 制作约定

- 从已核验的 Casual 修复源出发，保留完整骨架与源权重；新增服饰绑定原骨架。每主题独立制作文件与 GLB，不覆盖原件，不新增采购或外部服务。
- 赛博主题：短款结构外套、护肩／设备细节、深石墨与小面积冷光、偏暖侧光；人物处于安静的工作舱，而非素材展台。
- 东方主题：交领、分片长外袍、腰封和发饰；临水石阶、偏置树冠、近石远景与留白。区别必须进入轮廓和构图，不只材质颜色。
- 用已取得的实际自然资产，并记录原许可对应问题；衍生件仍留在忽略目录。现代基础脸／发型、服装穿插、全动作、艺术质量和硬件预算不能仅靠脚本成功认定通过。
- 不添加战斗叙事、虚构成果、等级／装备数值或用户数据。此批不改正式页面、账号、数据库、扩展或托管发布。

## 交付与检查

交付两套可编辑 Blender 制作件、自含 GLB，以及真实 WebGL 构图截图。默认中性待机姿态；主题源使用相同身份基础，不要求同一服装网格。实际姿态、材质明度、面部可读性、人物／背景关系由截图判断，失败时回到模型或光照，不伪装成验收通过。

已授权测试 seam：脚本输入哈希／不覆盖输出、实际导出 GLB 内容与资源边界、真实 Three 加载／WebGL 画面。两项导出缺陷以失败检查复现再修复；造型采用实际样片迭代，不声称审美有自动化单测。不使用截图 mock，也不以命名标记证明审美质量。正式美术门槛仍以路线文档为准。

## 已制作内容与当前判断

[制作脚本](../scripts/build-dual-theme-study.py)从真实 Casual 修复源出发，在内存中应用 Mirror，沿源手臂截面制作长袖并混合上臂／前臂权重。赛博新增护肩、胸前设备、偏置衣襟和耳侧接收器；东方新增交领、腰封、发簪与四片带腿部混合权重的长袍。不是同一网格只换色。

环境同样分开制作：赛博采用纵向框架、格栅、控制台与种植槽；东方采用水面、踏石、临水平台、真实岩石与树木和短木屏。两套均保留 62 骨骼、24 个导出动作，从相同人物身份基础出发；当前只实测中性待机，不认可全动作服装安全性。

| 项目 | 赛博 v4 | 东方 v4 |
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
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.weight-repaired-study.blend --python-exit-code 1 --python scripts/build-dual-theme-study.py -- cyberpunk 4
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.weight-repaired-study.blend --python-exit-code 1 --python scripts/build-dual-theme-study.py -- eastern 4
bash scripts/with-m1-runtime.sh node scripts/render-dual-theme-study.mjs 4
```

制作命令只在输出不存在时运行，修改制作内容需换新的 1–99 修订号。渲染可重复运行，会更新同修订号的本地截图和报告。`.tools/asset-studies/dual-theme-v4/` 保存四件输出；`.goal-loop/evidence/dual-theme-v4/` 保存每主题远景、近景、稍后待机图和报告。均被 Git 忽略；提交包含配方与文档，不向产品包或公开仓库分发素材。

| 输出 | 字节数 | SHA-256 |
| --- | --- | --- |
| cyberpunk.blend | 7,813,798 | `5b697d35312f0bf132a534a62463ebe34fe57167987143947a0d7c6c9b9701e8` |
| cyberpunk.glb | 2,978,932 | `dc6023993495a026da23bfed17cc3bef60dbd8d12b922030cb533750e1374c1f` |
| eastern.blend | 7,880,194 | `8f25fcd29fda7f6bca42aa44bab3ce3f87aa9e3c95d5448d067e57335a496dfa` |
| eastern.glb | 2,911,852 | `16763a9055272e2abc9438305bda66fdc6ae1b380492be497a673d4ff051a9f7` |

实际重新打开两套 `.blend`：当前网格材质使用的树皮 2048²、树叶 1024² 图像已打包，无外链 Library 或 Text 脚本。仍残留源文件 `Texture.png` 旧数据块，但不被当前网格材质节点使用，未宣称所有旧数据均清理。GLB 两个图像和单一 buffer 均内嵌。原 Casual 源 SHA `204d82f2…` 与修复源 `216fc727…` 未变；完整来源见[素材台账](asset-intake.md)与[完整影响验证](eight-influence-preview.md)。

许可边界没有变化：人物包内 CC0 标题为 Modular Males，与 Women 来源不一致；树木包许可标题也与来源不一致。Kenney Nature 的 CC0 已核验。前两项需要确认准确对应关系后才能正式分发，不能因导出成功认定法律门槛通过。

## 运行证据与已修复问题

[渲染检查](../scripts/render-dual-theme-study.mjs)使用已有公开加载接口、真实 GLB、Three WebGL 与隔离 Playwright，不接管 ego-browser 空间 8，不启动产品开发服务器。GPU 为 ANGLE Vulkan SwiftShader；不是 M4 帧率、移动设备或正式 DOM HUD 验收。

- v1 过曝：默认物理灯光换算使 SUN 强度放大约 683 倍。强度检查先失败，再采用显式 COMPAT 导出；最终两套各两盏方向光保持作者设定值。
- v3 调色丢失：旧 `ShaderNodeMixRGB` 未导出 `baseColorFactor`。GLB 检查先失败，再改为 Blender 4.5 导出器识别的现代 RGBA Mix 节点；v4 保留 `[0.36, 0.62, 0.72, 1]` 乘数。修复导出一致性不代表黄叶已达到美术目标。
- v4 两主题均真实绘制，待机 0.15s 与 0.8s 画面变化，无着色器／页面错误或外部 HTTP 请求。239,149／222,963 个浮点 accessor 值均有限，完整骨架和两组影响通过现有加载器。报告中渲染计数包含阴影重复绘制，不能当作唯一资产三角形数或性能通过证据。
- 已有输出拒绝检查实际退出 1，前后哈希一致。367 项 Vitest／35 文件、四工作区 TypeScript 通过。本批只新增制作脚本和文档，不修改应用源码；没有声称本批运行生产构建、Auth 或数据库验收。

导出仍出现树木多图像 sampler、NumPy 矩阵、约束／关键帧烘焙警告；有限值和中性待机证据不能关闭全动作风险。没有付费、push、托管发布、数据库或认证操作。
