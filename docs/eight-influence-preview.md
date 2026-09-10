# 完整骨骼影响的内部试装适配

固定点 `2db5294`，P2 制作链路切片，2026-09-10 已实现内部适配；不代表正式角色、双主题世界或硬件性能已通过。

源工程最多七个骨骼影响，现有四权重导出会损失数据。[glTF 规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skinned-mesh-attributes)允许追加 JOINTS_n／WEIGHTS_n；当前 Three.js 加载和蒙皮仅直接处理第零组，并会将第零组单独归一化。适配不能只加显示标记或只修改颜色着色器。

## 模块与验收约定

- `loadPreviewAsset(data)` 返回真实 GLTF；继承内嵌文件／10 MB／无外部请求规则。四影响与无蒙皮资产保持现有行为；最多两组八影响，超过支持范围或缺少配对属性时明确拒绝，不静默裁剪。
- 在加载器归一化前保留原权重。完整权重用于实际 GPU 位置／法线、阴影和 CPU 顶点变换；包围盒与射线检测不得继续假设只有四项。
- 资源仍由既有 `disposeAsset` 统一释放，包括新增阴影材质；失败不能替换旧场景或泄漏已创建资源。仅既有开发试装页使用，生产页面和扩展不交付模型。
- 已授权的测试 seam 是公开加载／释放接口、Three 的公开顶点变换，以及真实文件输入和 GPU 输出。先用五骨骼三角形的已知数学结果复现，再测试真实源工程完整导出；不使用 Canvas／加载器 mock 代替。
- 验证至少包含四权重回归、第五项真实贡献、拒绝超范围输入、资源释放、GPU 画面和阴影、完整人物待机／减少动态效果及生产路由隔离。软件 GPU 结果不计作 M4 帧率或商用品质通过。

## 实现与证据

[加载接口](../apps/web/src/lib/scene/load-preview-asset.ts)封装输入检查、原权重保留及 CPU／GPU 适配。只改资产拥有的材质，不改 Three 全局着色器；当前八影响支持 Standard／Physical／Basic 材质。深度和距离材质一同释放，适配阶段失败释放已加载资产。仍仅用于可信来源候选，不是任意恶意文件的资源沙箱。

[真实 GLB 夹具](../apps/web/src/lib/scene/skin-fixture.ts)顶点初始 X=1，四个单位骨骼各占 0.125，第五骨骼平移 +2、权重 0.5，最终 X 应为 2。适配前得到 1；适配后顶点、包围盒、射线命中通过。另覆盖四影响回归、第三组拒绝、四种缺配对、非法／非有限／错误总和权重和越界骨骼索引；阴影材质释放先红后绿。

[GPU 对照脚本](../scripts/test-eight-skin-gpu.mjs)通过公开加载器，对比独立普通网格的已知变换，显式 smooth shading 检查旋转法线。第五项平移、旋转光照、方向光阴影、点光阴影四例，适配前分别有 3,940／3,180／8,243／10,806 个像素超差，适配后逐像素一致；控制组各有数千像素差异，排除空白画面假通过。没有页面／着色器错误或外部请求。

原 glTF、旧源导出、四权重修复导出、新完整导出四条真实页面旅程通过（20.1 秒）：静止、待机、减少动态效果暂停、清除及非法文件拒绝后的原场景保留。首次保留测试仅圆角顶部 27 个像素变化：错误提示使画布下移 24px、尺寸不变，内部人物／阴影一致；测试改为避开 CSS 圆角的精确截图，不放宽画面差异阈值。

最终完整 `check:m1` 通过：367 项 Vitest／35 文件、四工作区 TypeScript、数据库升级契约、向导、Next 与 WXT 构建／扩展安全检查；扩展 566.14 kB。34 项生产 E2E 通过（8.4 秒），内部设计页仍为 404。软件 GPU 证据存于 `.goal-loop/evidence/eight-skin-red/`、`eight-skin/`、`casual-eight-reviewed/`；不是 M4 性能或 Blender 全动作逐帧等价证明。未操作 ego-browser 空间 8、托管服务、数据库或 push。

## 完整导出

[导出器](../scripts/export-casual-source-study.py)新增显式 `-- --all-influences`，仅接受已核验修复源、使用独立输出名并拒绝覆盖。源顶点最多七项，但实际应用 Mirror 后 Body 有三个顶点达到八项；导出拆分后有十二个八项顶点。镜像检查仅在内存进行，没有保存源文件。

`Casual.full-influence-study.glb`：2,003,284 字节，SHA-256 `7892fef0124addd693b11a5181743c718b61ef979f86e53800e7d26d39984d96`；4 网格／9 图元／62 骨骼／24 动作。7 图元有第二组，826 个导出顶点超过四项，最大总和误差 `1.02e-7`，271,947 个浮点 accessor 值均有限。[文件检查](../scripts/check-casual-full-influences.mjs)可重复核验。导出顶点包括镜像／法线／材质拆分，不能与此前 121 个源顶点直接相加。

```bash
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.weight-repaired-study.blend --python-exit-code 1 --python scripts/export-casual-source-study.py -- --all-influences
bash scripts/with-m1-runtime.sh node scripts/check-casual-full-influences.mjs
bash scripts/with-m1-runtime.sh node scripts/test-eight-skin-gpu.mjs
bash scripts/with-m1-runtime.sh npx playwright test --config playwright.environment.config.ts casual.spec.ts --output .goal-loop/evidence/casual-eight-final
```

导出命令仅在输出不存在时运行。无效权重和截四项警告已消失，NumPy 矩阵及约束／关键帧烘焙警告仍存在；有限值检查不能自动关闭这些风险。旧四权重检查保留失败，八项适配不证明旧管线无损。正式造型、双主题融合、许可对应、全动作保真、硬件性能继续待办，不将 P2 标记完成。

## 独立审阅

源码 `c7fad44`：**Standards** 0 项确认违反、0 项有意义异味；**Spec** 发现 1 项 P2，随后修复并独立复核为 0 项剩余问题。两位审阅者均未参与该批实现或 GPU 测试脚本编写。

Spec 用公开加载接口复现：第五权重 `.499`、网格平移 X=100 时，允许的近单位总和会使 CPU 提前丢弃齐次 w，逆绑定后 X=-98.003，而 GPU 公式应为 -97.903。新增失败测试后，改为先在 Vector4 上完成逆绑定，再返回 xyz／xyzw；不修改输入容忍度或权重。独立复核的 12 组总和／绑定矩阵／位置与方向组合最大误差约 `4.44e-16`，不把矩阵计算冒称 GPU 截图验证。

修复后主线程重新运行四条真实人物旅程（20.1 秒）、367 项测试、完整构建、34 项生产 E2E 和四例真实 GPU 图像对照，全部通过；两路复核均无剩余阻断。89 个相关本地链接有效，原件与修复源哈希未变。当前只关闭这项渲染适配切片，不关闭正式美术、硬件性能或完整产品路线。
