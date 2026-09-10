# 双主题零采购开放资产初查

最新判断（2026-09-10）：B2 四件自然素材已完成[真实双主题环境试装](environment-study.md)，不是最终美术；明显低多边形积木感使它们继续只作轻量对照，下一步优先比较 B1 与真实人物基础。下文“尚未进行 GPU 试装”为此前研究时点。

研究基线日期：2026-09-06。进展截至 2026-09-10：已取得赛博人物并完成内部 WebGL 试装（尚未认可为正式主角）；新增四个 Kenney 环境 GLB 备选并完成真实加载器解析，尚未进行 GPU 试装。来源、许可和实际文件详见 [真实资产接收台账](asset-intake.md)。下文「未下载」描述保留为 9 月 6 日研究时点，不代表最新接收状态；正式视觉与性能门槛仍未通过，阶段状态以 [执行路线](execution-roadmap.md) 为准。

## 研究问题与结论

在暂不购买资产的约束下，如何为赛博朋克与东方山水／武侠两套主题准备人物、环境和材质，同时保持商用品质？

目前可确认四个有公开授权说明、可零采购获取部分或全部资产的来源。它们适合构建候选库，但本次**没有验证出可直接上线的成套双主题人物与场景**。尤其东方人物、服饰和山水意境仍需专门选型与美术改造；“免费”不降低统一构图、材质、动画和界面设计的验收要求。

本文以“开放许可资产”指允许相应使用、修改与分发的资源；“免费获取”只说明价格，不能代替许可检查，也不保证提供原始制作工程。CC0 对商用、修改和分发给予广泛许可，但不消除商标、肖像等其他权利问题，也不构成来源真实性保证。[Creative Commons CC0 说明](https://creativecommons.org/publicdomain/zero/1.0/)

## 已核验的候选来源

下表的适配判断是根据发行方描述作出的设计推断，不是已完成的模型导入或成品画面评测。

| 来源与具体候选 | 官方许可与零采购边界 | 对 Blueprint 的用途与不足 |
| --- | --- | --- |
| **Quaternius**：[Cyberpunk Game Kit](https://quaternius.com/packs/cyberpunkgamekit.html)、[Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) | 两个具体包页面标明 CC0、个人与商业项目可免费使用，列出 FBX、OBJ、glTF、Blend 等格式；后者提供模块化人物及动画。实际包内容仍待下载核验。 | 可筛选赛博环境部件、人物骨架与动画基础；模块化结构有利于未来外观预设。它们并非已经完成的 Blueprint 主角或武侠服饰，需要统一比例、材质、姿态和镜头。 |
| **Kenney**：[City Kit (Industrial)](https://kenney.nl/assets/city-kit-industrial)、[Nature Kit](https://kenney.nl/assets/nature-kit) | 两个资产页分别标明 CC0，并提供无需捐款的免费获取入口；不需要购买站内 All-in-1 合集。 | 工业建筑、树木与岩石可作为场景配件候选。适合控制造型语言和场景复杂度；不把通用城市／自然模块误当作完整赛博朋克或东方美术方案。 |
| **Poly Haven**：[Forest Slope HDRI](https://polyhaven.com/a/forest_slope) | 该 HDRI 标记为免费、CC0；站方说明资产允许商用、修改与分发，不要求署名。资产许可不等于网站全部内容、预览作品及 API 服务均可任意使用。[官方许可](https://polyhaven.com/license) | 可用于自然光照与环境反射试验，帮助山水主题建立柔和层次；不能替代风格化场景建模。页面提供多档分辨率，浏览器版本需另行控制体积和显存。 |
| **ambientCG**：[金属](https://ambientcg.com/list?category=Metal)、[铺地石](https://ambientcg.com/list?category=PavingStones)材质分类 | 官方提供免费 PBR 材质、HDRI 等资产；许可页说明可下载资产采用 CC0，可修改、商用、分发原始文件且无需署名。[官网](https://ambientcg.com/)、[官方许可](https://docs.ambientcg.com/license/) | 可筛选赛博金属、东方石材等表面细节；本次未确定具体材质编号。需要统一色相、粗糙度与细节尺度，避免写实贴图和风格化人物拼接失衡。 |

### 必须单独识别的付费源文件边界

Quaternius 的新版 [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) 可以作为额外的人物候选，但不能直接列为“全部源文件免费”。作者页面及 [发行页](https://quaternius.itch.io/universal-base-characters) 区分零元可获取的 Standard 与付费 Source，部分原始 `.blend` 文件和定制 shader 属于后者。当前只考虑零元版本，不购买 Source，也不将其独有能力计入已具备资源。

## 纳入项目之前的验收清单

- **来源与版本**：保存具体资产名称、作者、原始页面、核验日期和版本；检查压缩包内的许可证，不以聚合站“免费”标签代替发行方说明。
- **修改与分发**：确认许可覆盖修改、商用及随 Web／扩展分发资源；记录署名要求，即使无需署名也保留来源台账。字体、声音、预览图和第三方商标分别检查，不沿用模型许可作笼统推断。
- **可维护性**：确认零元包实际包含的模型、贴图、骨架和动画；优先可继续编辑且能稳定导出 glTF／GLB 的资源。只有引擎专用 shader 或付费工程才能实现的效果，不进入当前承诺。
- **风格适配**：两套主题分别验收主角轮廓、服装、环境、灯光与 DOM 面板的整体效果；少量配色／配饰预设不能破坏材质与姿态一致性。西方奇幻不能未经改造就标为东方武侠。
- **运行质量**：在约定参考设备和网络上核验模型、贴图及压缩后体积、加载时间、帧稳定性与显存；检查骨骼动画、透明材质、灯光和后处理成本，并提供低画质、减少动态效果及二维回退。

下一步先以这些来源做双主题候选清单和风格板，挑出各一个主角基础及少量环境部件，再决定哪些值得下载与试装。缺少合格免费资产时，记录缺口并提出自制／改造或表现调整建议；影响已确认范围或品质的取舍先与用户收敛，不自动触发采购，也不将占位资产视为商用品质交付。

## P2 执行补充：具体候选与零采购边界

复核日期：2026-09-06。本节为发行方页面复核结果，**没有下载资产、验证压缩包、导入 Blender 或完成实际画面评审**。下列“优先”仅表示先做小规模试装，不表示正式选用；采购额保持为零。页面上的总模型数不等于免费包实际模型数，格式列表也不等于免费原始工程交付承诺。

### 首轮试装清单

| 顺序／用途 | 作者与免费候选、下载入口 | 许可、署名与可编辑性 | 需要完成的适配；尚未验证项 |
| --- | --- | --- | --- |
| A1 赛博主角与近景 | Quaternius：[Cyberpunk Game Kit](https://quaternius.com/packs/cyberpunkgamekit.html)，从该页 Download 获取 | 具体包页列出 71 个模型、动画人物、模块平台，以及 FBX／OBJ／glTF／Blend；标明 CC0、免费商用。CC0 无强制署名，项目仍保留作者与来源。旧包页面没有把这些格式列为 Source 专属。 | 只筛一名人物、一组平台和少量灯光／管线配件。重做主角配色、材质层级、待机姿态与镜头，去除武器／敌人等无关游戏语义。**包内 .blend、骨架、纹理完整性与具体下载可达性待核验**，不借网站全局 Patreon 宣传反推该旧包收费。 |
| A2 人物备选与模块参考 | Quaternius：[Ultimate Modular Women Pack](https://quaternius.com/packs/ultimatemodularwomen.html)，该页 Download | 官方描述 10 个人物、24 个动画、人物分四部分、含 Humanoid 版本，列 FBX／OBJ／glTF／Blend，CC0、免费商用。原始工程实际内容仍待包内验证。 | 若 A1 主角比例或身份代入不足，用来比较人物轮廓、动画与少量外观预设。不能把“模块化”直接当作已实现换装系统，也不能把西式服饰重新命名为武侠。 |
| B1 东方场景首选素材基础 | Quaternius：[Ultimate Stylized Nature Pack](https://quaternius.com/packs/ultimatestylizednature.html)，该页 Download | 2022 年具体包页列出 63 个自然模型、贴图／法线及 FBX／OBJ／glTF／Blend，CC0、免费商用；不与新版 MegaKit 的付费分层混淆。 | 先挑岩石、树木各少量；重新安排山势远近、雾层、负空间、材质明度。它不是现成中国山水场景，亭台、竹、服饰等不在本次已确认清单中。免费包实际 Blend 与动画内容待验证。 |
| B2 环境简洁风格备选 | Kenney：[Nature Kit](https://kenney.nl/assets/nature-kit)、[City Kit (Industrial)](https://kenney.nl/assets/city-kit-industrial)，Download → Continue without donating | 具体页分别列 330／40 个文件和 CC0；官方 [Support](https://kenney.nl/support) 明确允许商用且不要求署名，不能使用 Kenney 标志暗示官方合作。页面未承诺免费原始 `.blend` 制作工程。 | 优先比较整体造型是否协调，不同时混入多套不一致模型。可导入的网格格式、原始工程、材质与包内许可待下载核验；“可导入 Blender 再保存”不等于拿到了作者源工程。 |
| C1 东方自然照明试验 | Andreas Mischok／Poly Haven：[Forest Slope](https://polyhaven.com/a/forest_slope)，页面分辨率与 HDR／EXR 下载入口 | HDRI 为 CC0、无需署名。可取得 HDR／EXR，不是可编辑几何场景；官网默认展示的 4K EXR 下载约 30.88 MB，不能直接算进浏览器首屏预算。 | 从低分辨率试验反射和漫射光；自己产出环境画面，不直接复用作者示例渲染。最终是否使用、分辨率和传输体积需实测。 |
| C2 局部材质试验 | ambientCG：[Metal050A](https://ambientcg.com/view?id=Metal050A)、[PavingStones131](https://ambientcg.com/view?id=PavingStones131)，各自 1K／2K 下载入口 | 两项页面均有免费 PBR 贴图包；[官方许可](https://docs.ambientcg.com/license/) 为 CC0、商用及原文件分发无需署名。已有下载格式是贴图，不承诺生成材质的程序化源工程。 | 分别用于赛博金属和石台表面试样，不预先锁定为最终材质。压低纹理细节和写实感、统一粗糙度；按使用贴图裁剪和压缩，不把整包直接发布。 |

### 可以比较，但不能默认使用的新版包

- **Universal Base Characters**：作者 [发行页](https://quaternius.itch.io/universal-base-characters) 当前列 Standard 122 MB、Source 600 MB；Source 需付费。免费 Standard 可用于比较体型和基础骨架，但完整 rigged `.blend`、定制眼睛／肤色 shader 由 [官方介绍](https://quaternius.com/packs/universalbasecharacters.html) 明确归于 Source。免费包具体包含哪几个人物和发型仍需核验，不能把整套六个人物、二十种发型全部预记为现有资产。
- **Stylized Nature MegaKit**：作者 [发行页](https://quaternius.itch.io/stylized-nature-megakit) 当前列 Standard 99 MB 为零元入口，Pro 与 Source 有付费门槛；[官方介绍](https://quaternius.com/packs/stylizednaturemegakit.html) 把完整 `.blend` 和风动／风格化 shader 放入 Source。因此优先试装 B1 旧包；若比较新版免费 Standard，需自行建立 Web 材质与动画，不能承诺复现付费演示效果。
- **Modular Character Outfits — Fantasy**：[具体包页](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) 同样把完整模型和 `.blend` 放入 Source，免费范围是部分模型。其西式奇幻服装不是东方人物解决方案，不因“兼容基础人物”就列入首版武侠角色交付。

### 东方主角仍是明确缺口

目前没有确认一名同时满足“免费可商用、来源可信、可维护源文件、完整绑定动画、东方服饰与脸部气质、适合 Web 实时性能”的成品主角。这个结论是本轮有限检索的结果，不是断言网上不存在此类资源。

一个可继续核验的服饰候选是 Style3D CG 发布的 [Tang Dynasty chest-length printed Hanfu](https://sketchfab.com/3d-models/tang-dynasty-chest-length-printed-hanfu-427e40b1f7134b2b8ca2e79b8651b236)。作者发布页的搜索索引显示：约 136.6k 三角形、CC Attribution、可下载；说明列出 sproj／FBX／OBJ／ABC／USD／glTF／GLB，并要求通过邮件索取所需格式。本轮直接打开页面返回 403，故**未独立确认许可版本、实际零元下载内容、源文件获取条件与下载可达性**。这只是服饰候选，不是已绑定的完整主角，也不是免费服装编辑软件承诺；本轮未发邮件、注册或付费。

若继续选它，必须先拿到具体许可和所需格式，再确认署名方式；例如 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 允许商用和改造，但要求适当署名、许可链接及修改说明，不能在未确认版本时自行假定采用 4.0。随后仍有减面、重拓扑、贴图整理、身体适配、蒙皮和布料穿插修复工作。不能因原页有“实时模拟”宣传，就引入 UE 专用模拟或新付费工具。

当前建议的东方路线是：**开放基础人物用于比例／骨架试装 + 自制或明确授权改造的东方服饰与发型 + B1 自然素材重构场景**。这是待审阅的制作方向，不是已具备美术产能的承诺；若无法达到人物质量，应带着具体画面与缺口向用户说明，而不是用斗笠遮脸、剪影、几何假人或赛博人物换色默认为验收通过。

## P2 美术审批门槛与交付物

这些是项目的执行门槛，不是发行方保证，也不替代 [执行路线](execution-roadmap.md) 的统一状态记录。

1. **获取与授权门槛**：每个实际纳入的文件记录作者、资产名、下载页、下载日期、免费版本、包内许可证、署名要求、修改记录和文件校验值。确认模型、贴图、字体、声音分别获得适用权限。付费专属文件、许可不明和来源不明的角色移出候选，不以平台“免费”标签兜底。
2. **真实资产试装门槛**：每主题一个真实候选人物、一小组环境和统一灯光，保存可再次编辑的制作文件及导出记录；核验骨架、待机、材质、遮挡和穿插。可导入 glTF 与原始作者工程分别记录。禁止把发行方美图、AI 概念图或空白占位模型作为“实时渲染完成”证据。
3. **双主题设计审批包**：分别提交人物正面／三分之四视角、主页代表性画面和短循环动效；同时给出公开样例、目标路径、Agent 确认、学习侧栏、证据记录与设置的关键状态设计。赛博表达精密层级与克制发光，东方表达山水留白、层次和材质差异；共享同一数据语义与主要操作，不能仅换色。以上美术方向为设计建议，需以实际画面确认。
4. **可读性与身份门槛**：真实中文长标题、最多五个焦点目标、空目标与多目标、加载／错误／低画质都能明确识别“我、当前焦点、下一步”；目标名称和操作由可访问 DOM 承载。人物要有持续身份识别和少量外观预设，不强求跨主题同一网格；不能通过装饰伪造用户学习成果。
5. **性能与回退门槛**：在已约定 Mac mini M4 16 GB 参考设备记录画质、视口、网络与采样方式，验证桌面目标 60 FPS、低画质不少于 30 FPS；选中主题首次传输的压缩后 3D 资产目标不超过 8 MB；10 Mbps／100 ms 场景中 DOM 可操作目标不超过 3 秒。它们目前都是待测预算。另验减少动态效果、非 WebGL 回退与扩展不打包场景资产。
6. **用户美术审批**：以仓库可运行的设计预览和上述证据请用户确认两主题的代表性画面。未通过则记录具体差距、改造成本和下一轮样片；不自动购买、砍掉第二主题或降低产品标准。基础云端与共享组件可在审批期间继续独立推进，但不把未审批画面作为正式主页发布。

首轮推荐只比较两个小组合：**A1 主角／平台 + C2 金属试样**；**可维护人物基础与东方服饰试样 + B1 岩石树木 + C1 低分辨率光照试验**。A2／B2 只作对照，避免一次下载全部大包、先堆场景再处理风格。当前可推进的是候选获取与设计试装，尚不能作出“双主题商用美术已经可交付”的结论。
