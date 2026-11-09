# 武侠人物头发：工业界方案与下一轮优化建议

调研日期：2026-09-25。依据用户对 v14 的反馈、当前模型生成脚本和官方技术资料。**本轮仅调研与记录，没有改模型、安装软件、调用收费接口或生成动作。** 以下区分公开技术事实、本地诊断和项目建议；面数、发束数等试验参数不是行业统一标准。

## 1. v14 为什么从“脏乱”变成“厚壳”

用户希望保留自然细节、减少重建噪声。v14 没有达到这个美术目标，应保留为对照，不作为已批准发型。

本地检查 `art/dual-theme/eastern/meshy/diagnostics/rebuild-back-hair.mjs`：背发来自一组截面插值得到的连续封闭表面，表面叠加周期性浅沟槽和顶点色，底部封口。新背发材质只有基础色、固定粗糙度，没有细发丝贴图、透明覆盖或发流方向数据。这里的“封闭”指表面围成体积，不代表内部填了实体网格。

由此产生三个问题：

- **大轮廓过厚**：截面形成鼓起的整块体积；更高分辨率贴图不能改变侧面厚度。
- **中尺度层次缺失**：缺少宽窄不同、轻微错开的发束；周期性刻槽代替不了发束分层。
- **细节与轮廓边缘缺失**：所有发尾汇成完整圆滑边界；没有稀疏发丝、透空边缘和沿发流变化的高光。

因此不能只给 v14 加强法线或锐化，也不应恢复旧版全部高频起伏。旧版包含生成伪影，需要先区分可信发束与噪声。先前“越平整越接近目标”的处理方向过度了。

## 2. 工业界如何分配头发细节

### 2.1 导向曲线与分层发束：控制方向和秩序

SideFX 的 Groom 工作流先建立可编辑导向曲线，再生成头发；可按区域和曲线长度控制造型。Hair Clump 支持大束内再形成小束，并保留发丝长度差异，另有独立的零散发丝比例与幅度控制。由此可以做“整体顺直、局部有层次”的发型，不必用随机噪声填满整个表面。[SideFX Hair and fur](https://www.sidefx.com/docs/houdini/fur/index.html)、[Hair Clump](https://www.sidefx.com/docs/houdini/nodes/sop/hairclump.html)

项目应用建议：主要发束顺着发根到背部的方向下垂，只允许轻微弯曲、不同结束位置和少量分叉；“顺直”不要求所有束完全平行、同宽、同长。以 R02 背面参考和主概念图确定长度与总体体积，以 R07 辅助核对发根与饰品。

### 2.2 Hair Cards：用带贴图的薄发片表现细发丝

发片是沿发流弯曲的低面数条带，一张可以显示多根头发。SideFX 官方流程把相邻曲线聚成束，生成匹配其方向和宽度的发片，再制作配套纹理；也允许直接由导向曲线生成发片。相比密集曲线，这类实时表达需要的内存和计算更少。[SideFX：Generating hair cards for games](https://www.sidefx.com/docs/houdini/fur/haircards.html)

Epic 的生成器明确区分基础层、中间层、表层和零散发丝，也支持一个发束使用多个发片表现体积。卡片数量、曲率细分和纹理数量需要一起调整。该官方生成器当前文档标为 Experimental，而且输入是 groom，不是任意三角网格。[Epic：Hair Card Generator](https://dev.epicgames.com/documentation/en-us/unreal-engine/hair-card-generator-for-grooms-in-unreal-engine)

项目判断：这是我们最值得借鉴的路线。保留薄的内部遮挡层，外部由扁平发束和少量发片形成真实分层；边缘与发尾用覆盖贴图露出间隙，避免做成一个封口的圆袋。发片应有必要弯曲和多角度覆盖，不能只有几张朝向固定镜头的大平面。

### 2.3 烘焙多通道细节：不让网格承担每根发丝

Ornatrix 官方说明区分了覆盖、颜色、法线、发流方向与遮蔽等通道；这些信息分别控制发片哪里可见、纤维如何受光以及高光沿哪个方向变化。局部图集可以复用，而依赖发片整体摆放位置的遮蔽需要针对组装后的模型另行烘焙。[Ornatrix：Hair Cards](https://ephere.com/ornatrix/app/docs/1/Hair_Cards.html)

建议准备以下资料；具体通道打包和方向约定需在我们的渲染器中校验，不能把不同引擎的贴图直接互换：

| 数据 | 在本项目中的用途 |
|---|---|
| Base Color | 细发丝颜色和轻微根梢变化，避免把强白色高光画死 |
| Coverage / Alpha | 切出丝状边缘与疏密不同的发尾，减轻整片塑料感 |
| Normal | 小尺度纤维起伏；不承担厚度和分束轮廓 |
| Roughness | 控制高光宽度及强弱，避免整块同样反光 |
| Flow / Tangent direction | 让高光方向跟随每束头发 |
| Root–Tip / ID | 可选，用于根梢渐变和有控制的束间差异 |

项目建议：从干净的曲线／发束数据生成一致的贴图组。旧 Meshy 背发法线中已经混入碎裂起伏，不整张投射回新发型。GPT 图像可辅助风格设计，但不能把普通发丝照片直接当作可靠法线或方向场；这些技术贴图需要正确生成与验证。

### 2.4 头发着色：各向异性与专用纤维模型

头发的光照不仅是普通表面反射，还涉及纤维内外的光传播；PBRT 给出了专门的头发散射模型，并展示普通 BRDF 与头发模型的差异。[PBRT：Scattering from Hair](https://pbr-book.org/4ed/Reflection_Models/Scattering_from_Hair)

Three.js 的 `MeshPhysicalMaterial` 支持各向异性强度、旋转及方向贴图，但它是通用物理材质，**不能等同于完整的头发散射模型**。我们的建议是先用它做成本可控的发流高光近似，再决定是否值得开发专用 hair shader；材质改善不能修复厚轮廓。[Three.js：MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

若导出 GLB，可考虑标准 `KHR_materials_anisotropy` 保存强度、旋转和方向纹理；切线基准与 UV 朝向必须一致。引擎专用 Depth、Root–Tip 等通道不会因为放进文件就自动产生效果。[Khronos：KHR_materials_anisotropy](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy)

### 2.5 真发丝渲染：能力强，但不是现有网页的一键升级

Epic 的 strands 管线包含导向模拟、插值、体素化、可见性、光照和合成；需要专门性能预算，并非所有平台都支持，因此可以按平台和 LOD 切换 cards／mesh。[Epic：Groom Scalability and Performance](https://dev.epicgames.com/documentation/en-us/unreal-engine/groom-scalability-and-performance-with-unreal-engine)

AMD TressFX 提供真实发丝渲染与模拟技术，其官方项目面向 DirectX 12 和 Vulkan。它可作为研究资料，不能直接安装为 Three.js WebGL 插件。[AMD：TressFX 官方仓库](https://github.com/GPUOpen-Effects/TressFX)

项目判断：目前是固定构图、轻微视差和待机动作，不建议为此次发型修正引入完整 strands 管线或换引擎。

## 3. Three.js 网页里必须一起考虑的成本

本地核查版本：`three 0.186.0`；`MeshPhysicalMaterial.js` 存在各向异性属性，`GLTFLoader.js` 支持上述 glTF 扩展；`Material.js` 存在 `alphaTest`、`alphaToCoverage`、`alphaHash`。这只是代码能力核查，尚未证明我们的后处理链和设备下的实际效果。

- 优先试验裁切式覆盖：`alphaTest` 会丢弃低于阈值的片元。
- `alphaToCoverage` 依赖 MSAA；加入离屏后处理后，应检查实际绘制发片的渲染目标是否多采样，不能仅凭 renderer 的 antialias 设置断定生效。
- `alphaHash` 可减少排序问题，但引入颗粒；静态首页是否需要 TAA 必须实测，不作为默认答案。

这些透明机制的行为见 [Three.js：Material](https://threejs.org/docs/pages/Material.html)。

项目验收还应记录透明区域重复绘制（overdraw）、draw calls、阴影、纹理显存与细发丝远景闪烁。发片少面不代表一定更快，铺很多大透明矩形可能增加像素开销。建议用紧凑图集，控制相互覆盖的层数，远处先移除零散层；阴影也要识别覆盖贴图，不能投出完整矩形黑影。透明混合、裁切、多采样需要 A/B 验证，而不是一律关闭 depthWrite。

## 4. meshoptimizer 应当放在流程的哪里

官方提供属性感知简化、顶点锁定等能力，用于控制几何和属性误差；它不会识别“哪些起伏是漂亮发束、哪些是 AI 噪声”。因此应该先把发型整理成正确结构，随后保护根部、轮廓、发尾、UV 边界和需要变形的位置，再生成 LOD。[meshoptimizer 官方说明](https://github.com/zeux/meshoptimizer)

本机独立工具目录装的是 **1.1.1**。网页当前分支包含其他较新／实验接口，不能直接把它们视为本机 JS 已可调用。此次不更新依赖。对于低面数发片，直接减少导向曲线采样段和次要卡片，往往比统一折叠所有边更容易控制外观；这是本项目的实现建议。

## 5. 推荐给这个人物的制作方案

推荐 **薄内部遮挡层＋分层扁平发束＋少量边缘发片＋方向一致的细发丝材质**。这是依据上面工业做法、网页约束与当前美术目标提出的组合方案。后续已获用户授权并制作 [v17 候选](wuxia-character-layered-hair.md)，待美术确认；下文保留调研时的路线建议。

| 层次 | 几何职责 | 希望看到的效果 |
|---|---|---|
| 内层 | 更薄、贴近背部的低面遮挡层 | 发片间不露出不该露的内部空洞，外观不由它独占 |
| 主发束 | 宽窄不同的扁平束，独立导向曲线 | 正背面可读的束间分层，侧面有厚薄变化 |
| 次发束 | 少量错位叠层与长短差异 | 光照移动时有层次，避免等距条纹 |
| 边缘／发尾 | 稀疏发片及覆盖纹理 | 轻薄、略有间隙，避免统一圆弧封口 |

首个小样可从 **12–20 条主要导向曲线、40–100 张分层发片**试起，背发几何预算暂以 **1–3 万三角形**探索。这些只是试验范围，按近景、侧面和实际首页尺寸的质量调整，不是性能承诺，也不包括原有发髻、饰品和全身。数量本身不是验收项。

建议执行顺序：

1. **建立可人工复核的区域分组**：背发、前发、发髻、饰品、颈部、衣料分别处理。上一轮空间阈值与亮度不能视作可靠语义分割，不能再以几何检查通过代替美术检查。
2. **先做一小片带完整材质的发束样本**：同时检查扁平体积、细丝覆盖、发流高光和逆光轮廓，避免先做完整头发才发现材质不可用。
3. **单独审查灰模的大中尺度**：减薄侧面体积，保留主发流，发束宽度、长度和末端位置错开。此阶段不靠阴影或 Bloom 隐藏厚度问题。
4. **组装发束和发片**：保留原脸、发髻、主要饰品；新发型成为独立可调资产。v14 只作对照或内部体积参考，不把整层外壳继续当最终外表面。
5. **制作并验证贴图与着色**：新 UV 与根梢方向一致；近景保留细丝、正常镜头合并为干净发束；不烘入旧脏法线。
6. **最后做减面、图集优化与 LOD**：保护边缘细节，降低内部不可见部分；用真实浏览器记录帧时间与资源，而非只比面数。
7. **外观确认后再处理运动**：按主发束分组，使发根跟随头部，长发与背部运动协调。具体骨骼、碰撞和待机幅度仍待讨论，不在本轮调用动作 API。

验收使用相同相机和灯光的三方对照：cleanup-v4、v14、新小样。检查正面、背面、左右侧面及斜后方；灰模看体积，纯基础色看污染，PBR 看高光，深浅背景与逆光看发尾。在主页正常尺寸与脸部近景均检查；小角度转动时不出现发片整片消失、排序跳变、闪烁或衣料破洞。

## 6. 是否需要安装软件

当前不必为了调研安装 Blender。导向曲线、扁平网格、UV、材质和 GLB 组装可以在现有本地代码流程中制作小样；但需要实现与验证专门的作者工具，不能承诺脚本一次达到成熟 DCC 的交互效率。

若后续需要精细交互梳理，Houdini 的官方 cards 工作流、Maya／XGen 或 Ornatrix 类工具值得评估。选择应由制作频率和交互需求决定，而不是先安装整套软件。Epic 的生成器要求可用 groom；**现有 Meshy GLB 是三角网格，不能直接假定可输入该工具完成自动修复。** 本轮没有安装或购买它们。

## 7. 建议阅读顺序

1. 先看 [SideFX 发片工作流](https://www.sidefx.com/docs/houdini/fur/haircards.html)，理解曲线如何变为实时资产。
2. 再看 [Epic 生成器的分组与多发片发束](https://dev.epicgames.com/documentation/en-us/unreal-engine/hair-card-generator-for-grooms-in-unreal-engine)，理解为什么不能只做一张大外壳。
3. 对照 [Ornatrix 图集通道](https://ephere.com/ornatrix/app/docs/1/Hair_Cards.html)，理解细节应放在哪张图里。
4. 实现时查 [Three.js 材质](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) 与 [透明覆盖设置](https://threejs.org/docs/pages/Material.html)。
5. 如需深入光学，再读 [PBRT 头发散射](https://pbr-book.org/4ed/Reflection_Models/Scattering_from_Hair)；暂不需要先实现完整物理散射模型。
