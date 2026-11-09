# 精致武侠 3D 角色实施记录

> 2026-10-17 方向更新：用户已将画质、受限视差与基本动作置于完整三维能力之前。当前主页实现见 [V2 独立分层与待机动作](../wuxia-living-portrait.md)。本文保留既有 3D 支线的状态与证据；其 P1 门槛不作为新路线的前置条件。

更新：2026-10-16。采用已确认的风格化 PBR、真实弹簧骨、桌面局部布料路线，替代旧的硬分界 NPR／排除实时布料方案。

本轮头肩精修已到 **v13**。查看同镜头、同光照的新旧拖动对照。当前仍处于 P1，未将候选作为正式主角签收。

## 当前交付状态

已经开始实现，并产出可运行的物理工作台、脸部候选工作台、Blender 制作脚本和资产校验管线。**尚未完成整份 P0–P7 计划。** 当前人物仍是母体候选，不能当作正式主角或主页成果。

| 阶段 | 已交付 | 尚未满足的放行条件 |
|---|---|---|
| P0 基线与探针 | Git 基线、母体盘点、固定版本依赖、真实 WASM 布料与弹簧骨、30/60/120 FPS 行为检查、集显 Chrome 基线 | 独显浏览器基线尚未取得；技术探针不代表正式人物性能 |
| P1 母体与脸部 | v13：校准女性中性脸坐标、局部曲面调整、平滑表面与眼球、连续头部图集和 PBR 烘焙、同光照新旧切换与固定三视角、五种表情检查 | 人物身份、眼鼻唇细节与整体美术验收未通过；等待用户视觉判断 |
| P2 衣发 | 未开始 | P1 人物方向签收后继续；不在未通过的母体上批量制作 |
| P3 坐姿动画 | 未开始 | 坐姿、握剑、呼吸循环及接触修形 |
| P4 正式物理 | 只有 P0 共用控制器 | 正式宽袖、裙边、头发及饰物的代理、约束、碰撞与调参 |
| P5 渲染优化 | 材质去重、无损 Meshopt、结构保护、解码后官方校验；头肩影棚光照已可比较 | 桌面/手机 LOD、KTX2、完整角色与环境光照、整场景预算 |
| P6 两发两衣 | 未开始 | 四组合兼容、异步换装、共享资产注册表及资源稳定性 |
| P7 主页 | 未开始 | 正式发布资产与 `identityScene` 集成、海报回退、完整主页和实体设备验收 |

没有新增付费 API 请求、Meshy 任务、外包或商业软件依赖。已有舟剑仅作盘点，没有重新生成。没有提交、推送或部署。

## 查看成果

从仓库根目录执行：

```powershell
npm run dev -w @blueprint/web -- --port 3100
```

- 物理工作台：<http://localhost:3100/design/wuxia/physics>。
- 脸部工作台：<http://localhost:3100/design/wuxia/face>。
- 舟剑审查：<http://localhost:3100/design/wuxia>。
- 最新离线视觉对照：v7 / v13 头肩对照。首轮证据仍保留在 10 月 10 日的实施目录。

这些审查页面和资产接口只在开发环境开放。正式主页尚未接入候选人物。

## 运行时实现

`secondary-motion.ts` 隔离弹簧骨和 Rapier 布料，实现 `step`、`reset`、`dispose`。`FixedStepClock` 使用 1/60 秒固定步长，每帧最多补算三步。相机不进入物理计算。装配体变化才影响锚点、碰撞体和发链。

`physics-probe.ts` 创建真实蒙皮发链、325 粒子的布料代理和 4,753 顶点的渲染袖片。预计算的三角形重心映射驱动细网格，输出使用世界坐标，避免再次蒙皮。球形碰撞体跟随装配体更新。此映射当前只支持规则网格；正式衣料的任意网格嵌入将在 P2/P4 扩展。

物理审查页使用 R3F，统一帧调度。暂停保留画面，恢复重置模拟；不可见和减少动态效果时停止持续更新。初始化、WASM、渲染或上下文丢失失败后提供重试。组件离开时释放独占几何、材质、骨架和物理世界。正式换装的共享 `AssetRegistry` 尚未实现，不能把探针的独占资源处理当作共享资产方案。

脸部审查页使用现有安全 GLB 加载器及八权重蒙皮适配，集中驱动身体、眉毛和睫毛的形态键。平静、浅笑、思考之外提供闭眼、张嘴检查。网页表情过渡采用指数插值，完成后停止持续绘制；这尚不是 P3 的自动眨眼或待机动画。

本轮增加相同影棚环境反射、面光源、正交固定镜头及三视角按钮。`本轮精修` 与 `上一版 v7` 使用相同照明及构图；手动拖动后再次点击当前视角也能复位。预览支持无损 Meshopt，并继续限制输入 10MiB、声明解码缓冲区 64MiB，拒绝外部资源。

## Blender 制作与资产构建

母体源：`art/dual-theme/eastern/production/wuxia-base-mpfb-candidate-v1.blend`。

原文件 SHA-256：`7a2e475fd525245a28e301ca64aa23dfc90a771b5a87bff287ae3b7b86146169`。制作后再次核对一致，未覆盖原文件。

制作脚本：`scripts/blender/build_wuxia_face_review.py`。当前参数：`scripts/blender/wuxia-face-profile-v13.json`。每次要求一个全新的输出目录；保留历史迭代。v12 起，每版目录内保存参数与当轮 Blender 脚本副本及 SHA。

```powershell
$wuxiaBlender = 'C:\Users\jiaji\AppData\Local\Programs\BlenderPortable-4.5.5\blender-4.5.5-windows-x64\blender.exe'
& $wuxiaBlender --background --factory-startup --python-exit-code 1 --python art/dual-theme/eastern/production/pbr-face-review-v13/build-scripts/build_wuxia_face_review.py -- art/dual-theme/eastern/production/wuxia-base-mpfb-candidate-v1.blend art/dual-theme/eastern/production/pbr-face-review-v13/profile.json art/dual-theme/eastern/production/pbr-face-review-rebuild-01
node scripts/build-wuxia-runtime-asset.cjs art/dual-theme/eastern/production/pbr-face-review-rebuild-01/wuxia-face-pbr-review.glb art/dual-theme/eastern/production/pbr-face-review-rebuild-01/runtime-review.glb --meshopt-lossless
```

需要本机 Blender 4.5.5 和已经安装的 MPFB；脚本目前按 Windows 的 MPFB 扩展目录查找资源。重新构建结果需人工更新审查资产清单路径和 SHA 后才能加载，防止无检查替换。

已从 v13 归档脚本和参数实际重建：顶点位置、法线、UV、形态键、蒙皮及所有纹理像素一致；一个切线分量相差约 0.0001，抽查渲染图有极少数通道相差 1/255。GLB 与 PNG 文件哈希不同，不宣称字节级一致。详细差异见最新审查目录的 `evidence/rebuild-differences.json`。

制作源保留完整表情和宏观参数；导出副本烘焙宏观体型，只保留 16 个关键表情。修复并打包五张丢失的皮肤、眼睛、眉睫和牙齿贴图。眉睫通过脸部三角形绑定获得表情位移。

导出保留八个骨骼影响。MPFB 的辅助网格不能随 `export_apply=False` 留在 GLB 中：脚本显式应用可见性遮罩，移除 5,778 个辅助顶点，同时保留 UV、蒙皮和形态键。BMesh 必须从烘焙后的 Basis 读取坐标，不能从过期的基础网格坐标读取；脚本对此设有断言。

皮肤、眼球和牙齿显式导出为不透明材质，眉睫采用透明裁切，解决源材质全部导出成 BLEND 导致网页中口腔透过脸部、眼球遮盖眼睑的问题。

v13 为 **头肩审查包**：50,624 三角面、53 骨、16 个唯一表情通道，GLB 约 8.63MiB。完整母体及完整表情仍在 `wuxia-face-pbr-face-v13.blend`；头肩运行副本为 `portrait-runtime.blend`，不能当作完整人物运行包。头部连续 UV、底色 2K、粗糙度与切线法线 1K 已烘焙。该大小仍未达到完整首屏 8MiB 目标。

`build-wuxia-runtime-asset.cjs` 对材质去重，并可选择无损 Meshopt 编码。位置、法线、UV、蒙皮与形态键逐值比较；三角形保持顶点、顺序与绕序，允许编码产生的循环起点旋转。骨骼与绑定变换允许 1e-6 重序列化误差。没有执行量化、几何简化或 LOD。Khronos Validator 校验解码后的等价 glTF，压缩内容再由解码比较与实际浏览器读取验证，不能表述成 Validator 自身理解全部压缩扩展。

候选存在 `NODE_SKINNED_MESH_NON_ROOT` 警告；舟剑存在缺少显式切线的警告。全部警告保留在清单中，不能把“零错误”表述成“无问题”。正式装配需确认骨架与网格父级空间，正式材质需补充并检查切线。

## 实际证据及边界

原始证据位于 `.goal-loop/evidence/wuxia-pbr/`；可归档证据复制在实施调研目录的 `evidence/`。Git 基线不会被构建脚本覆盖。

| 检查 | 当前证据 |
|---|---|
| 30/60/120 显示帧率 | 控制测试真实执行 Rapier WASM 和春骨；固定模拟时间、坐标有限、拉伸范围、运动锚点、碰撞与重置通过 |
| 浏览器 GPU | Chrome 的 `WEBGL_debug_renderer_info` 显示 AMD Radeon 8060S / ANGLE D3D11；不是 RTX 浏览器结果 |
| 60 秒帧间隔 | 3,600 个 RAF 样本；中位 16.7ms，P95 17.6ms。RAF 是浏览器帧间隔，不是 GPU 查询得到的绘制耗时 |
| 物理 CPU | 最近一轮稳定段 P95 约 2.8ms；包含模拟、细网格映射和法线更新，不含整页 GPU 绘制。不同运行记录约 2.6–3.0ms，不能据此宣称正式角色达标 |
| 浏览器交互 | 相机拖动不改变发链；装配体转动产生惯性；暂停、重置、减少动态效果、上下文丢失和重试通过 |
| 手机 | 390px 模拟视口无水平溢出；不是 Android 或 iPhone 实体设备证据 |
| 脸部 | 表情控制与浏览器渲染检查可重复执行；必须继续检查实际图片，不只比较图片哈希 |
| 资产 | 官方格式校验、去重前后结构比较、原母体源文件 SHA 保持一致 |
| 未取得 | 独显 Chrome、十分钟完整角色稳定性、主页预算、实体 Android/iPhone、人物最终审美签收 |

验证命令：

```powershell
npm run typecheck -w @blueprint/web
npx vitest run apps/web/src/lib/scene apps/web/src/app/design/wuxia/route.test.ts
node scripts/verify-wuxia-physics.cjs
node scripts/verify-wuxia-portrait.cjs v13
node scripts/audit-wuxia-assets.cjs --output .goal-loop/evidence/wuxia-p1-2026-10-15/asset-audit.json art/dual-theme/eastern/production/pbr-face-review-v13/runtime-review.glb art/dual-theme/eastern/production/pbr-face-review-v7/runtime-review.glb
npm run build:web
```

浏览器验证需要先启动 3100 端口的开发服务。脚本不调用业务 AI、登录或付费提供商。最新结果见 本轮验证记录；上表物理 60 秒结果属于 10 月 10 日的技术试件基线，没有将它当作本轮人物性能结果。

本机默认 Node 26 的原生 `localStorage` 与 jsdom 测试全局冲突。本轮继续使用已安装的 Node 24.19：全量 **1,281/1,281** 项通过，相关 54 项通过，Python 区域变形 4 项与 Node 索引语义 1 项通过，类型检查及 Web 构建通过。10 月 10 日曾失败的翻译超时测试本轮也通过；本轮未修改该业务，不能将复跑通过描述成已经修复其原因。

## 美术迭代记录与下一步

| 版本 | 结果／结论 |
|---|---|
| v1 | 修复贴图并尝试轻微缩下颌，但仍保留男性宏观参数；未采用 |
| v2 | 女性参数探索中年龄 .3 导致体型过幼、相机不合适；明确拒绝 |
| v3 | 改为成年年龄 .5，女性体型并重新适配骨架、眼睛和眉睫；获得有效离线脸部对照 |
| v4 | 调眼、鼻、下巴参数；与 v3 的视觉差异有限。直接增加参数幅度不足以形成参考人物的身份 |
| v5 | 移除辅助网格，但检查发现 BMesh 读取了过期 Basis 坐标，身体与眼齿不对齐；网页资产拒绝 |
| v6 | 修复 Basis 读取并加入断言；结构对齐，但实际截图仍暴露实体材质 BLEND 透明排序问题；未采用 |
| v7 | 修复不透明／裁切材质并核对浏览器实际画面；美术身份与质感仍待判断，未签收 |
| v8–v10 | 校准女性中性脸后做局部曲面与头肩细分；发现提亮过度、UV 图集碎片化及一次导出失败，未作为最终候选 |
| v11 | 重新展开连续头部 UV，完成 PBR 烘焙与网页平滑表面；仍需收敛虹膜及高光 |
| v12–v13 | 调整虹膜底色和角膜反射、固定共同影棚光照，完成新旧交互对照；当前 v13 未通过最终美术签收 |

本轮已从宏观参数微调转为测量中性脸、局部曲面与独立材质处理。当前仍在 P1，需要继续判断人物身份、眼睑及唇部细节、眉睫自然度。衣发未批量制作，没有恢复已失败的高模自动投射路线。

用户已确认计划中的 **P1 视觉签收** 是进入 P2 的条件。查看候选后需明确脸部身份和比例方向；技术检查通过不会替代此项判断。

## 依赖与许可记录

| 工具／组件 | 固定版本／来源 | 许可与用途 |
|---|---|---|
| Blender | 本机 4.5.5 LTS | GPL；仅作制作工具 |
| MPFB | 本机扩展构建 20260722 | 工具 GPLv3；官方随附资产 CC0；不把工具代码与模型输出视为同一许可 |
| three-vrm-springbone | 3.5.5 | MIT；弹簧骨模块 |
| rapier3d-compat | 0.21.0 | Apache-2.0；直接使用软体 API，不引入旧版 React Rapier 封装 |
| glTF Transform core/functions/extensions | 4.5.1 | MIT；资产处理与结构检查 |
| gltf-validator | 2.0.0-dev.3.10 | Apache-2.0；官方格式校验 |
| meshoptimizer | 1.1.1 | MIT；构建使用无损编码，网页使用 Three.js 随附解码器 |
| R07 参考图 | 既有用户提供参考，见 reference-intake 清单 | 只作本地视觉比较；没有作为网页皮肤贴图或运行时模型来源 |
| 舟剑 | 已有资产及各自来源记录 | 本轮仅复用审查，不新增生成任务；发布前继续按单件来源清单核对 |

没有复制 Ten Minute Physics 或其他项目的布料代码。本轮 Rapier 探针已能初始化、约束锚点并碰撞，暂不需要 XPBD 后备路线。

大体积 GLB、Blend 已受仓库现有 `.gitignore` 约定排除，仅在本地保存。代码与清单本身无法替代这些二进制源文件；后续发布需要单独约定资产存储与交接方式。
