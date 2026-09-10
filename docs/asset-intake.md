# 真实资产接收台账

核验日期：2026-09-10。阶段状态以 [执行路线](execution-roadmap.md) 为准。
本台账证明已获取文件及许可证据，不证明美术、骨架运行或商用品质已验收。

最新补充：A2 Casual 已完成实际人物与源工程导出 GLB 的浏览器检查，Blender 已在外置盘运行，见本文末节。B1 桦树已取得原工程和依赖，完成基础颜色衍生样本的实际 WebGL 观察。四件 Kenney 环境候选已完成双主题组合与实际 WebGL 运行验证，详见[环境构图试验](environment-study.md)。当前候选均未获正式美术认可、未随产品分发；下文取得文件时的“尚未进行 GPU 试装”保留为历史记录，不覆盖后续进展。人物后续入口见[人物候选跟进](avatar-candidate-followup.md)。

## Quaternius / Cyberpunk Game Kit / Character

- 作者：Quaternius；发行页标记 July 2022，无更细的下载版本号。
- [官方发行页](https://quaternius.com/packs/cyberpunkgamekit.html) 明确为 CC0，允许个人及商业使用；列出 FBX、OBJ、Blend、glTF。
- 从官方 Download 入口观察到的 [作者下载目录](https://drive.google.com/drive/folders/1GyKLypoBxrpLN6GERF9U610Wiub48v9y)。通过 ego-browser 的正常下载取得文件，没有购买或调用转录／模型服务。
- [包内 License.txt](https://drive.google.com/file/d/1-hNes9woutDvbaJCpPYOKJlvO_cTMSU8/view) 明确列出 CC0 1.0 Universal 及 [许可地址](https://creativecommons.org/publicdomain/zero/1.0/)。**文件抬头为 Ultimate Platformer Pack，与发行页名称不一致**；可能是作者复用模板，但该原因未经证实。保留原文件，不替作者修正名称。当前仅用于内部候选试装，正式分发前再次核对对应关系。
- CC0 不要求署名；仍保留作者、来源和修改说明。不以项目 MIT 许可覆盖模型许可。
- 文件置于外置盘仓库 `.tools/asset-intake/quaternius-cyberpunk/`（Git 忽略），尚未放入 Web public 或扩展，也不将整个素材包纳入产品。

| 文件 | SHA-256 |
| --- | --- |
| Character.gltf | `bb818f848ab17bce362fdbdbed509a17864f7dee62f761d0d8a7074f69ee52e8` |
| Character.fbx | `811ac6278a32c52343c65e7613b904fb5b5e179d04aaf0577cad2d23b6705430` |
| License.txt | `de990ef6fc68cffd7fd1ae342c4d0c823b541b8848d8f76bca5d3339f4de6f6e` |
| Character.blend | `6a4fa5aae3e457e0d1f51f9193562fccb57b02c0bd13900ce43f63cbf42f95f7` |

glTF 结构检查：1,500,456 字节，4 个 mesh、1 个 skin、22 个动画，包含 `Idle_Neutral`；buffer 内嵌，没有列出外部 image。材质名包含 Blade、Blade_Edge，需实际判断武器部件是否能安全移除。以上是文件结构，不等于骨骼、待机姿态、遮挡与材质效果正确。

2026-09-09 从作者目录的 [Blends 子目录](https://drive.google.com/drive/folders/1Fldjc3mHRLX1drJR91spmB3n7tgd0-5I) 取得 [Character.blend](https://drive.google.com/file/d/1hl71FR9wmUZ5M0l-RNn_JFVPIP-ehbP0/view)。文件头为 Blender 3.00、64-bit little-endian；这是实际作者工程，不是将 FBX 重新保存为 Blend。尚未在 Blender 中打开核验全部制作结构，不能承诺它已满足所有后续改造需求。

## 2026-09-09 实时试装结论

通过本地 `/design/assets` 文件选择器将 Character.gltf 直接载入 Three.js / React Three Fiber，人物、材质与骨骼已实际呈现在 WebGL 画布中。加载器将多材质 primitive 拆分后得到 10 个运行时 Mesh，与文件中的 4 个 mesh 定义不矛盾。识别到独立 `Sword` 节点，可隐藏武器；中性待机可播放／暂停。没有修改下载原文件，没有上传模型或随生产分发。

首次画面暴露静止场景未及时重绘武器隐藏和阴影条纹，已补按需重绘及阴影 normalBias，随后画面中武器消失、条纹消除。人物整体是黄外套的风格化机器人，轮廓和材质可用来验证动画／光照，但**当前不认可它作为正式身份主角**：机器人比例、面部表达与“这是我”的代入感仍有明显差距。不能将这个试装底座称为精修赛博目标世界。

尚未取得平台、东方人物与自然场景，尚未压缩导出、完成双主题构图或正式性能预算。下一步继续人物对比与场景组合；东方主题不能复用此机器人换色代替。工具与验证说明见 [本地 3D 试装](scene-intake-preview.md)。

## 2026-09-10 Kenney / Nature Kit 环境候选

从 [官方 Nature Kit 页面](https://kenney.nl/assets/nature-kit)的「Continue without donating」取得 [原始 ZIP](https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip)，没有捐款、购买合集或注册新服务。原包与选出文件置于外置盘 Git 忽略目录 `.tools/asset-intake/kenney-nature/`，不放入 Web public 或扩展。

页面写 1.0／2020；实际包内 `License.txt` 写 **Nature Kit (2.1)**、创建日期 2020-04-29，并明确 CC0 1.0、允许个人／教育／商业使用，署名可选。保留这一版本口径差异，以具体 ZIP 校验值固定此次取得的内容，不猜测发布日期。项目仍记录作者 Kenney、来源和修改说明，素材许可不被项目 MIT 取代。

| 文件（原包 GLTF format） | 字节 | 三角形 | SHA-256 |
| --- | ---: | ---: | --- |
| rock_largeA.glb | 7,552 | 80 | `6dd15390fd96501dcd1454765a17ba61dbbd8d47705dfe5149c8dd92b353ce25` |
| rock_tallA.glb | 12,072 | 136 | `88250f236a3b75f8b55c1d8afb6af020f8a91b1e81f9fb51f7ef513420d45a2d` |
| tree_pineTallA.glb | 7,200 | 78 | `e0a56eb196d8a64ba86c7304d607136e17e6f9ad748dffcf86bd53b18b91b196` |
| tree_plateau.glb | 16,304 | 215 | `7f19e347ff28703dd9e5fcce89b920156e291fbdb19331a57cb31a95c73e1322` |

原 ZIP SHA-256：`fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`。包内许可 SHA-256：`cb96b75e3560ac78d7a53ce6f083f4cdb5c53faea6141b62d63458dcfe1e4b9d`。下载原文件未修改；只选择性解压四个模型和许可。

四个文件均通过本地 glTF／GLB 校验与真实 Three.js GLTFLoader 解析，运行时分别为 2／3／2／2 个 Mesh（一个文件级 mesh 的多材质 primitive 会拆分），包围盒有有限正高度；没有动画、外部图片或必需解码扩展。三角形数由原文件 primitive/accessor 统计，约 43 KB 合计是未压缩文件大小，不是正式世界网络预算。

这批是路线中 **B2 简洁环境备选**，不是已选定的东方成品；尚未进行 WebGL 画面评审、组合山势／雾层／光照或最终性能测试。原包包含 DAE／FBX／GLTF 等导出格式，但未发现作者 `.blend` 工程，不能宣称拿到了原始制作工程。低多边形外形能否与正式人物、山水材质协调仍需实际试装；不会用“松树＋岩石”直接冒充完整东方美术。B1 Quaternius 自然包与东方主角仍待取得／比较。

## 2026-09-10 B1 / Ultimate Stylized Nature / BirchTree_1

本批固定点 `c6d302d`。从[作者页面](https://quaternius.com/packs/ultimatestylizednature.html)的实际 Download 按钮读取到[公共目录](https://drive.google.com/drive/folders/1IV3bXHzkNvuNWFHPi4KPx-G4ghuxIuT-)，经普通匿名 HTTP 取得一棵桦树及其全部 glTF 依赖、作者 `.blend` 和许可。没有登录、接管浏览器、购买或下载整包；原件保存在外置盘 Git 忽略目录 `.tools/asset-intake/quaternius-nature/`，没有进入产品分发。目录 HTML 此次仅返回首批条目，未取得松树或岩石，不能据此断言整包不含它们。

作者页标记 May 2022、CC0；[包内许可](https://drive.google.com/file/d/1W3YGLar9Ie0Lwfw7QJv1x8oBLKFPuOkW/view)正文为 CC0 1.0，但标题仍为 **Ultimate Platformer Pack**，与自然包名称不符。保留原文，不猜测原因，也不把网页声明与这个错配写成完整许可核对通过；当前只作内部候选，正式分发前需消除对应关系疑点。

| 原文件／作者下载条目 | 字节 | SHA-256 |
| --- | ---: | --- |
| [BirchTree_1.gltf](https://drive.google.com/file/d/1K3kgivCdB10eg57AM0CwSZi6TvCwsvNh/view) | 3,420 | `8dbf9fd8b6402bfffdbe370a8c4337e8dae27fa3da5fbacbfd4fae6482ad50fa` |
| [BirchTree_1.bin](https://drive.google.com/file/d/1CzLliZji_8zxWRI_QQXmTgGaycWGYhLb/view) | 201,976 | `a1b14d1c82ebb8153991de4156b77ceaa1143d64469679147c0ee249c8b90b83` |
| [BirchTree_Bark_Normal.png](https://drive.google.com/file/d/1qg4n9gasJ-c_jQED-IBqx28Qu53CURcR/view) | 22,721,595 | `e30ee9c7561742523340d5657056f8392bc0f944da5145f0af7690cd1d2e6a11` |
| [BirchTree_Bark.jpg](https://drive.google.com/file/d/1puC8NuyemENIPB40TOsKdqzp0EmUJe1g/view) | 1,015,231 | `f796f02e47bc5afddd17dc2385bbef53a352628ceb348deb1188ef04fe5deff9` |
| [BirchTree_Leaves.png](https://drive.google.com/file/d/1RPfkjEuuEwFno9gh3U0zQndzcB8DOr_S/view) | 77,836 | `8b674a02017d987f8ec0448bd2a52ad788d1235f91b7f00499b4ca071f8e69fe` |
| [BirchTree_1.blend](https://drive.google.com/file/d/1hLWPI_e_gue1Kv-kXqekvzbWuB6U6kA8/view) | 1,055,536 | `6b2c2d4e53fff8083a4b84b17cdcf82b309288632bde9b2e548585fc56809a07` |
| License.txt | 374 | `de990ef6fc68cffd7fd1ae342c4d0c823b541b8848d8f76bca5d3339f4de6f6e` |

文件检查：glTF 一个 mesh、两个 primitive，共 **4,596 三角形**；没有 skin 或动画。树皮为不透明材质，叶片为双面 BLEND；树皮颜色和法线均 2048²，叶片 1024²。法线原图为 16-bit RGBA，单独已超过内部 10 MB 文件限制和正式 8 MB 首屏网络预算，不能直接使用。`.blend` 文件头为 Blender 2.79，而 glTF 导出标记为 Blender I/O v4.0.44；没有打开 Blender 或证明源工程与该导出完全一致，不把“取得源文件”当作制作链路已验证。

### 可复现的基础颜色试样

[打包脚本](../scripts/package-birch-study.mjs)是针对固定校验值的离线转换，不是通用上传器。它校验 glTF／bin／基础颜色原文件，删除树皮法线绑定与对应贴图槽位，内嵌 bin 和两张原颜色图；不改几何、UV、透明模式或原图片字节，不覆盖任何原件，也不放宽预览限制。

在仓库根目录执行 `bash scripts/with-m1-runtime.sh node scripts/package-birch-study.mjs`；前提是已取得表中原文件。输出 `BirchTree_1.base-color-study.gltf` 为 **1,729,268 字节**，SHA-256 `8bb157df6f49a8db04294a30f56cc1f56aaacba34ff539de3b09842e8835fb3a`。这不是完整法线材质的压缩验收，也不是最终发布资产。原下载文件复核哈希未变。

### 实际画面与判断

通过既有 `/design/assets` 的真实文件选择器和 GLTFLoader 载入衍生样本。实际 WebGL 绘制、正面／手动转向截图、外链原 glTF 拒绝且保留已加载场景、清除、无外部 HTTP 请求和无应用缓存写入均通过。命令：`bash scripts/with-m1-runtime.sh npx playwright test --config playwright.environment.config.ts --grep Birch --output .goal-loop/evidence/birch`，**1 项通过，8.0 秒**；测试在 [birch.spec.ts](../apps/web/environment-e2e/birch.spec.ts)，需要忽略目录中的实物文件，不加入离线单元测试依赖。

三张截图位于 `.goal-loop/evidence/birch/`，已逐张查看。叶片分离与树皮纹理比 B2 色块模型更细，但当前光照下青白高光偏亮、树冠成团，投影呈整块轮廓；这只是观察结果，没有在本轮诊断为某一个透明或阴影参数的错误。**保留为可加工自然候选，不认可其当前画面为正式东方环境。** 仅在既有赛博色调试装灯光下观察，尚未完成同灯光 A/B、双主题组合、完整法线效果或叶片阴影优化。

渲染器为 ANGLE／Vulkan SwiftShader 软件 GPU，不是 M4 帧率／显存验收；没有未捕获页面错误，已知 Three.Clock 弃用警告仍存在。本轮新增的是资产衍生脚本、浏览器证据和研究文档，没有修改产品页面、数据库、权限或部署。后续优先验证人物单体及实际制作工程，再处理自然材质与主题构图，不能用继续堆叠试装工具替代正式美术。

回归：353 项 Vitest／34 文件、四工作区 TypeScript 通过；新增可选浏览器测试另以显式 `--types node` 的严格 TypeScript 检查通过，衍生脚本语法和重复执行校验值一致。单独测试检查首次漏配 Node 类型而失败，补全命令后通过，未修改产品代码。未重跑生产构建、数据库或托管验收；这些不属于本次仅工具／资产记录改动的新增证据。

源码 `39e165d` 独立复核（两位均未参与本批实现）：**Standards** 0 项确认违反、0 项新增异味建议；**Spec** 0 项确认缺陷或范围扩张。Spec 额外核对八个本地文件哈希、衍生样本几何／UV／变换／透明模式及内嵌数据保持一致；两路审查均没有代替主线程的浏览器与截图验收，未作许可法律审查。69 个相关文档本地链接及五个作者／许可入口 HTTP 200 检查通过。原始模型及截图仍在忽略目录；此提交只固化工具与证据记录，没有 push。

## 2026-09-10 A2 / Casual 人物与制作链路

固定点 `de814e0`。从[人物候选跟进](avatar-candidate-followup.md)已经核实的作者公共入口，匿名取得下列原件；全部保存在外置盘 `.tools/asset-intake/quaternius-women/`，Git 忽略、不上传、不随产品分发。许可正文为 CC0，但标题 **Ultimate Modular Males** 与 Women 包不符，差异仍待解决；未增加付费或账号操作。

| 原文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [Casual.gltf](https://drive.google.com/file/d/18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh/view) | 3,131,788 | `b0fe6e92219cd71808844a20a1a8b960fd1cf640a6546dc6362b5add6604e87c` |
| [Casual.blend](https://drive.google.com/file/d/1nxFlRC0tj4XIbuxGEzEgMV9O4DgeKfS_/view) | 5,321,436 | `204d82f2f481116cbb4433e69075b52e99f49b0df60ac04b44462f5704f3ee9f` |
| [License.txt](https://drive.google.com/file/d/1lIFL16xEpoPbr0j_HUATgmcEnAmYoIK2/view) | 372 | `e8dbf915a2b82229913e301a0787696611241bdefec4832bc084f54161db1efe` |

原 glTF：四个 mesh／九个 primitive，**6,424 三角形、62 骨骼、一套 skin、24 动作**，含 `Idle_Neutral`；单 buffer 内嵌、没有图片依赖、七个基础颜色材质。作者导出器标记为 Blender I/O v1.7.33。它是可直接运行的候选，但文件里的数字不能证明人体比例、所有动作或后续改装质量。

### 外置盘 Blender 与真实源工程检查

从 [Blender 官方 4.5 发布目录](https://download.blender.org/release/Blender4.5/)取得 `blender-4.5.13-macos-arm64.dmg`，311,910,354 字节，与[官方 SHA-256 清单](https://download.blender.org/release/Blender4.5/blender-4.5.13.sha256)匹配：`663ce944257c61ff1d6aa09e15c8f57bbd8d59023adb2fa7edde33a9ed960b53`。实际运行版本 **4.5.13 LTS / daeeeca98fb0**。应用只复制到 `.tools/blender-4.5.13/Blender.app`（约 814 MiB），安装包也留外置盘；未写入系统 Applications、安装扩展或请求管理员权限。指定外置目录挂载首次被拒绝，改用 macOS 正常只读挂载后复制并卸载镜像；没有关闭系统保护。

[只读检查脚本](../scripts/inspect-blender-source.py)通过实际 Blender 数据接口检查源工程，不执行工程内文本、不保存原件。调用始终包含 `--background --factory-startup --disable-autoexec --offline-mode`，脚本也断言自动脚本和联网均关闭；这些选项来自[官方命令行说明](https://docs.blender.org/manual/en/4.5/advanced/command_line/arguments.html)。这不是声称 Blender 进程被 OS 网络沙箱隔离。

实际读取了 Blender 2.79 原工程：`Casual_Head`、`Casual_Body`、`Casual_Legs`、`Casual_Feet` 四个独立网格均绑定 `CharacterArmature`；62 骨骼、24 个 Action／NLA 轨道，`Idle_Neutral` 为 0–50 帧。身体／腿／鞋保留 Mirror 和 Armature 修改器，头保留 Armature；**没有形态键**，现有分组可以作为换装加工起点，但不能声称已经支持捏脸。没有外部链接库或内嵌文本，七个旧材质尚未使用节点。

工程含一张未打包、文件不存在的 `Texture.png` 引用（users=1），不能声称工程完全自包含。当前原 glTF 和下述导出均不含图片、实际画面有基础颜色；这不证明该缺失引用对全部编辑／渲染工作流都无影响。旧 Info 区域兼容警告亦保留。

### 源工程导出与浏览器验证

[受限导出脚本](../scripts/export-casual-source-study.py)先验证原 `.blend` 哈希，应用非骨架修改器，保留骨架并分别导出动作；不会保存 `.blend`，已有同名试样会拒绝覆盖。先前检查确认没有形态键，因此本次应用修改器没有丢弃现存捏脸数据。不下载解码器、不启用 Draco 压缩或付费工具。

仓库根目录的复现命令（前提是已按上文取得运行时和原件）：

```sh
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.blend --python-exit-code 1 --python scripts/inspect-blender-source.py
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-intake/quaternius-women/Casual.blend --python-exit-code 1 --python scripts/export-casual-source-study.py
bash scripts/with-m1-runtime.sh npx playwright test --config playwright.environment.config.ts --grep Casual --output .goal-loop/evidence/casual-source
```

导出 `Casual.source-study.glb`：**1,761,476 字节**，SHA-256 `1d134055076acbc47737c37925c1415198027a1718544d6b2917ce3c6338dfe5`；6,424 三角形、62 骨骼、24 个同名动画，无必需解码扩展或图片。224,403 个浮点 accessor 值逐一检查均有限，原件哈希不变。导出器曾报告两个网格不合法、矩阵运算警告、超过四骨骼影响被截取归一化、约束和帧通道需要烘焙；**没有把输出成功当作这些警告已解决**，也没有证明所有动画逐帧等价。

实际浏览器旅程 **2 项通过，12.5 秒**：分别加载原 glTF 和源工程 GLB，看到 24 动作；静止画面在采样窗口内不变，开启待机后像素变化，减少动态效果后再次稳定，清除后无 Canvas。无未捕获页面错误、外部 HTTP 请求和应用缓存写入；已知 Three.Clock 弃用警告仍在。测试见 [casual.spec.ts](../apps/web/environment-e2e/casual.spec.ts)，依赖本地取得的实物，不加入默认离线单元套件。软件渲染器仍是 SwiftShader，不能替代硬件 FPS 或显存验收。

原文件首轮三张截图和源工程输出三张截图均已查看，位于 `.goal-loop/evidence/casual/` 与 `.goal-loop/evidence/casual-source/`。日常人形比此前机器人更接近身份映射，静态与待机没有观察到明显肢体分离；脸、头发和服装仍有明显折面，缺少赛博／东方身份设计，**不认可它为正式主角**。本批交付的是一条实际跑通但仍有质量警告的制作链路，不是完成双主题角色或捏脸换装系统。

下一步围绕这份真实源工程处理旧网格／权重和材质，制作少量明确的主题造型对照，或在证据表明改造代价过高时更换候选；不以重复获取类似资产代替美术加工。正式分发许可、人体／服装精修、完整动画质量、与场景融合及目标硬件预算仍未过门槛。

本批回归：353 项 Vitest、四工作区 TypeScript、新增可选浏览器测试的独立严格类型检查通过；51 个相关本地文档链接有效。导出脚本重复执行在已有文件处按预期退出 1，输出哈希不变。Blender 检查与导出均已实际执行，没有用语法检查代替运行；上述导出警告仍未解决。无产品运行源码改动，未重跑生产构建、SQL 或托管旅程，不沿用这些层面的旧结果作为本批新证据。

源码 `40cef52` 的两路独立只读复核：**Standards** 0 项确认违反、0 项新增异味建议；**Spec** 0 项确认缺陷或范围扩张。Spec 另外核对四个原件／衍生文件哈希、忽略规则以及两份运行文件的三角形／骨架／动画名和资源依赖；不证明动画逐帧等价。审查者均未参与本批实现，未运行 Blender 或浏览器、未查看截图，运行与画面结论仍来自主线程。本批已固化为本地提交，未 push。
