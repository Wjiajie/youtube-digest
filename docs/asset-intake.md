# 真实资产接收台账

核验日期：2026-09-10。阶段状态以 [执行路线](execution-roadmap.md) 为准。
本台账证明已获取文件及许可证据，不证明美术、骨架运行或商用品质已验收。

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
