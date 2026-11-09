# 模块化角色调研：来源、费用与证据边界

检索与本地检查日期：**2026-09-25**。配套 [主报告](modular-character-production-research.md) 与 [逐图复用表](modular-character-reference-reuse.md)。这是研究证据索引，不是软件采购、资产发布或收费任务授权。

## 1. 证据如何使用

- **当前官方文档**说明公开功能／限制，不证明本项目实际输出质量。
- **本机包源码与帮助**说明已安装版本暴露的入口，不证明账号已连接、远端接受请求或当前会话有对应工具。
- **实际文件解析／图片查看**说明现有资产状态；不替代骨骼变形、动画、浏览器或设备验证。
- **项目建议／估算**是针对当前目标的取舍，包括母体路线、模块契约、面数预算、人日和阶段顺序；不是官方承诺或普遍行业标准。

网页无发布日期时只记录访问日。旧版本官方文档仅支持稳定制作方法，不据此声称已核实最新软件界面。未取得全文的来源不用于关键结论。本次未安装工具、未请求 Meshy 余额／生成、未发送任何资产。

## 2. Meshy：产品层与接口层分开

| 官方来源 | 本次可确认的信息及适用边界 |
|---|---|
| [网页产品入口](https://docs.meshy.ai/en/webapp/getting-started) | 网页区分高细节与 Smart Topology 等模式，并描述比 API 更广的绑定对象；不能将网页选项直接视作 API 或本机 CLI 已支持 |
| [Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d) | 当前页面列 standard 的 Meshy 7.1，以及 `smart-topology` / `meshy-t2` 分件三角网格能力。新原生分件不等于现有高模可无损拆件，也无统一骨架／模块接口保证 |
| [Auto Split API](https://docs.meshy.ai/en/api/auto-split) | 自动、部位名和颜色拆分；受支持历史任务 ID 为输入，输出重建分件、顶点色，原纹理不保留。输入任务种类有限，不能直接推定接受本地 v17 或所有模型族 |
| [网页 Auto Split 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/auto-split) | 面向打印拆件；精确接头等仍需要手工 DCC。它与角色服装／头发按权重和变形关系分层的目标不同 |
| [Remesh API](https://docs.meshy.ai/en/api/remesh) | topology、目标面数与输出格式可调；没有人物眼口、关节和裙片语义布线的质量契约 |
| [Retexture API](https://docs.meshy.ai/en/api/retexture) | 有已有 UV 和 PBR 等选项；不同接口的 `latest` 与模型代号须分别核对，不由 Image to 3D 的版本推断；不视作 skin／morph／顶点无损往返保证 |
| [Rigging API](https://docs.meshy.ai/en/api/rigging) | 面向纹理化、肢体明确的双足类人；纹理 GLB、朝向与面数约束。文中 task 输入和失败说明涉及 300k faces，不能用 URL 输入猜测规避 |
| [Animation API](https://docs.meshy.ai/en/api/animation) | 对已有 rig 应用动作，当前批量 action 接口与本机包装器可能不同；可播放基础动作不说明持剑、交叠坐姿、衣发和面部合格 |
| [Text to Motion API](https://docs.meshy.ai/en/api/text-to-motion) | 独立动作生成接口；得到动作仍需要目标角色重定向和接触修正 |
| [API 价格表](https://docs.meshy.ai/en/api/pricing) | 下表为 credits，不是美元；模型族、分辨率、Ultra 与动作数量改变费用，不拿历史任务价格套所有新请求 |
| [资产商业使用帮助](https://help.meshy.ai/en/articles/9992001-can-i-use-meshy-assets-commercially-license-copyright-explained) · [服务条款](https://www.meshy.ai/terms-of-use) | 区分账号生成资产、上传输入和社区资产；不能仅凭余额推定当前计划或全部资产许可。发布前按具体来源、生成时计划与适用条款留证，本轮未作发行许可认定 |

### 本机接口快照

只读检查的位置：

| 位置／方法 | 观察结果 |
|---|---|
| `C:/Users/jiaji/.codex/tools/meshy/node_modules/meshy-cli/package.json` | CLI **0.3.0** |
| 同包 `dist/index.js` 的 `--help`、`image-to-3d create --help`、`resources --no-update-check` | 有 image-to-3d、remesh、retexture、rigging、animate、text-to-motion 等；Smart Topology 帮助列分件和 100–15000 目标范围；27 项命令资源未见专用 Auto Split；存在原始 API 通道但本轮未测试新端点 |
| `C:/Users/jiaji/.codex/tools/meshy/node_modules/@meshy-ai/meshy-mcp-server` 的 package、generation schema 与 `registerTool` | MCP **0.5.1**，24 个注册工具；含 smart-topology 请求结构、rig、animate，未见 Auto Split／Text to Motion 专用注册 |
| `C:/Users/jiaji/.codex/skills/meshy-3d-generation/SKILL.md` 与 pipelines/setup 参考 | 本地工作流使用纹理化明确类人、清楚 A/T-pose、≤300k 面及本地输入 50 MiB 预检；这是本机流程边界，不能推广成每个远端 API 的统一文件上限 |
| 本会话工具目录 | 没有暴露可调用的 Meshy MCP 工具；包已安装与会话已连接是不同事实 |

本机帮助中的旧模型代号不能覆盖更新后的官方 API 文档。后续若要使用新字段，先查看当前帮助／schema，并准备具体请求供审核；不因为 `--data` 或原始 API 通道存在就直接发付费请求。

## 3. 成熟制作流程与工具依据

| 来源／版本 | 用于本报告的结论 | 不代表什么 |
|---|---|---|
| [Epic：Working with Modular Characters](https://dev.epicgames.com/documentation/unreal-engine/working-with-modular-characters-in-unreal-engine)，访问时文档版本 5.8 | 模块共用或复制骨骼姿态，骨架结构、额外骨骼、物理与 draw calls 存在取舍；支持“先统一接口”的设计 | Unreal Leader Pose／Copy Pose／Merge 不是 Three.js 已实现功能；合并网格也不自动保留所有 morph 行为 |
| [Eva Sophie Cringle：Sardon / CC5 制作案例](https://magazine.reallusion.com/2026/02/12/creating-a-knight-king-sardon-with-character-creator-5/)，2026-02-12 | 已有母体改型，围绕同一角色制作衣发，重拓扑／UV／材质后转权重并用动作修正，覆盖身体区域可隐藏 | 厂商发布的作者案例，不是速度基准，也不保证自动转权重一次成功 |
| [CC 资产制作注意事项](https://wiki.reallusion.com/Content_Dev:CC_Asset_Production_Precautions) | 服装贴合、权重和边界需要作者检查 | 自动适配不能免除坐姿／长袖／裙摆验证 |
| [Houdini Hair Cards](https://www.sidefx.com/docs/houdini/fur/haircards.html)，访问时 H22.0 | guides 到 cards、分组／朝向／UV／图集的可编辑流程，可从导向曲线开始 | 卡片自动生成不代表发型审美、透明排序或网页性能合格 |
| [Maya XGen：Interactive Groom 转多边形](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharEffEnvBuild/files/GUID-33279585-C22F-4E3E-880F-6EFD3D0BFA9A.htm)，2023 文档 | groom 可转多边形条带；需控制密度与形态 | 这是稳定方法参考，并非 Maya 2026 全界面验证；逐根转换可能过密 |
| [Blender 官方 glTF IO](https://github.com/KhronosGroup/glTF-Blender-IO) | 可用的官方 glTF 导入／导出实现，主 DCC 到 GLB 的路径依据 | 不表示任意约束、物理、节点材质都能原样传输 |
| [Marvelous Designer GLB](https://support.marvelousdesigner.com/hc/en-us/articles/55686813557913-glTG-2-0-glTF-GLB-File-ver-2026-0)，2026.0／2026-04-01 | 当前已有 GLB 与动画／metadata 导出选项；旧“只能 OBJ”判断不成立 | 文档不足以证明每项输出编码在本项目的 loader 中支持，更不代表 Three.js 会运行 MD 物理 |
| [Mixamo 官方 FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Adobe ID 免费使用、双足类人自动绑定／动作及商业项目使用范围 | 不是带面部、长裙、发束与剑接触的完整角色生产服务 |

从这些来源归纳的生产顺序是：**同一母体／比例 → 分层建模与重拓扑 → UV／烘焙 → 同骨架适配／权重 → 姿态修形 → 动作与次级运动 → 目标引擎验收**。实际项目可以交错迭代，不应把该顺序理解成所有工作都必须等上一阶段完全结束。

## 4. glTF 与 Three.js 边界

| 官方来源 | 支持的关键判断 |
|---|---|
| [glTF 2.0 规范](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc) | skin、joint、inverse bind、morph 与节点／weights 动画的数据结构；没有通用 DCC 控制器、IK 或布料求解器的自动迁移契约 |
| [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) | 支持的扩展、KTX2／Meshopt／Draco 配置与插件边界；不能把 loader 支持列表视为当前项目已启用 |
| [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html) · [CCDIKSolver](https://threejs.org/docs/pages/CCDIKSolver.html) | Three 提供蒙皮和附加 IK 实现的组成部分；需要作者定义链、目标和求解时序 |
| [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) · [Material](https://threejs.org/docs/pages/Material.html) | 各向异性、透明方式、alpha-to-coverage 的 MSAA 条件；不等于专用发丝渲染器 |
| [LOD](https://threejs.org/docs/pages/LOD.html) | 有 LOD 对象与切换机制；具体资产组织与换装兼容仍需应用实现 |
| [VRMC_springBone](https://vrm.dev/en/vrm1/springbone/) · [three-vrm springbone](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-springbone.html) | 可选弹簧骨骼扩展／实现；不是 glTF 核心或 GLTFLoader 自动附带的完整布料 |

所有模块装配、隐藏身体、姿态修正、风／船／角色分层、预算与回退方案均是**后续设计**。本轮没有建立或运行该角色系统。

<a id="costs"></a>

## 5. 费用与许可快照

价格为访问日公开 USD 档位，不含地区税费、内容包、培训、外包与可能需要的扩展授权。没有读取支付资料或购买产品。

| 工具／服务 | 公开价格或费用 | 适用条件与本次限制 | 来源 |
|---|---|---|---|
| Blender | 软件许可成本 0 | GPL 不把作者输出的艺术资产自动变成 GPL；第三方素材／插件仍看自身许可 | [Blender License](https://www.blender.org/about/license/) |
| CC5 Standard | 页面标价 $299 | 软件、母体与购买内容应分别核对；**网页端互动换装／角色生成用途不能默认由普通授权覆盖**，需要具体适用范围确认 | [CC5](https://www.reallusion.com/character-creator/) · [软件 EULA](https://www.reallusion.com/Content/EULA/AP/EULA_AP.htm) · [内容许可 Q9](https://www.reallusion.com/license/content.html) |
| iClone 8 | 页面标价 $599 | Personal 当前有 30 次、每次 30 秒的 3D 导出额度；不能预算为无限免费生产出口 | [iClone](https://www.reallusion.com/iclone/default.html) · [下载／Personal 条件](https://www.reallusion.com/iclone/download.html) |
| Houdini Indie | $299／一年；$449／两年 | 有收入／融资与席位条件，并限制与商业 Houdini 混用；当前页面列商业收入 $100k 门槛、近 24 月融资 $1m 门槛，具体主体按条款核对 | [Houdini Indie](https://www.sidefx.com/products/houdini-indie/) |
| Maya / Maya Indie | 未取得可靠地区报价 | Indie 有资格条件；本轮不编造价格，也不把某地区资格套用所有地区 | [Maya Indie](https://www.autodesk.com/campaigns/me-indie/maya-indie)（检索到官方入口，动态价未确认） |
| Marvelous Designer Personal | $39／月；$280／一年预付 | 月付自动续费与一年预付不同；个人／自由职业者计划，不自动适用团队 | [官方许可证说明](https://support.marvelousdesigner.com/hc/en-us/articles/47358269350041-What-kind-of-licenses-does-Marvelous-Designer-offer) |
| Substance 3D | 当前计划页 Collection 个人 $59.99／月 | Texturing $24.99／月来自 2025-03-25 调价说明，**当前地区购买档位未确认**；不把历史值作为当前保证 | [当前计划](https://www.adobe.com/products/substance3d/plans.html) · [历史调价](https://helpx.adobe.com/substance-3d/pricing-change.html) |
| Mixamo | 免费，需 Adobe ID | 适用 FAQ 所述用途；动作来源与最后资产交付仍留记录 | [官方 FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) |
| Meshy | 按任务消耗 credits | 账户计划／当前在线余额未刷新；历史授权额度不等于本次授权付费 | [API Pricing](https://docs.meshy.ai/en/api/pricing) |

CC 许可页当前顶部说明新的 Standard 合并旧 Extended 的部分使用范围，但同页历史问答仍出现旧分档措辞。不能继续简单建议“买 Extended 就行”。软件 EULA 对 CC 母体用于角色生成系统另有限制，内容许可 Q9 也指向此类应用的专门授权联系。**制作人员在 DCC 更换服装后发行固定角色**与**产品提供用户互动换装功能**应分别明确用途；本报告没有判断所有可替换网格一律禁止，也没有替供应商确认本项目已获许可。

### Meshy API credits 的具体比较

| 公开任务 | 当前表列 credits | 注意 |
|---|---:|---|
| Meshy T2 Smart Topology 几何 | 5 | 与标准／Ultra 模型价格不同 |
| T2 几何＋纹理 | 合计 15（2K／4K 档） | 含几何费用，不是再加 15；以实际任务选择与最新表为准 |
| Meshy 7.1 standard 几何 | 20 | Ultra 另加 5；不是本轮已消费 |
| Meshy 7.1 纹理 | 10 | 不等于保证所有材质通道均为 4K |
| Remesh | 5 | 本地脚本减面与此付费任务不同 |
| Rigging | 5 | 绑定成功不等于美术或动画通过 |
| Animation | 3／action | 多动作应按实际 action 数计算 |
| Text to Motion | Prime 10／Swift 3 | 与给现有角色自动做好整套动画不同 |
| Auto Split | 10 | 输出和输入限制见上述 API 来源 |

本地台账当前记录累计 **65／600 credits，剩余预算 535**；这是历史台账算术，不是本次余额查询。旧文档中的 55 和在线余额快照不能作为此刻账户余额。此次新增付费任务 **0**、生成任务 **0**。

## 6. 本地可复核证据

### 文件与图片

已逐张看 主图、R01–R08 共 9 张制作参考及 反馈截图。已重新计算 接收清单 的 10 项文件 SHA-256，全部匹配；规范主图与归档副本也均为 `5a67bf0963500ee30a75030533573b2204f71647a2c59a97a7546d9ad6239dc0`。清单中的 `meshySubmitted: false` 是**接收时状态**，不是今天“从未提交过”的证据。已有 Meshy 任务以 台账 和历史模型报告为准。用户最新反馈优先于旧候选“待确认”的宽泛表述。

模型均位于 `art/dual-theme/eastern/meshy/character/20260924_080744_wuxia-character-ultra4k-v1_01a0d0bd/`。本次读取 GLB JSON/accessors，统计三角形、mesh／primitive、skin／animation／morph，计算文件哈希；没有重新执行 glTF validator 或变形测试。

| 阶段 | SHA-256 | 本次解析结果 |
|---|---|---|
| ultra4k-master-v1 | `80d1d4a50e4791bd8605b5c3caf1ef269edc432724406d116ad941fb9a4f4cb5` | 4,506,766 三角形；107,799,740 bytes；1 mesh／1 primitive |
| cleanup-v4 | `957b15cccae758c05123df1985c793ea0c2e8a0235f712bfe55abeb5cb2bd456` | 1,206,365；65,578,440 bytes；1 mesh／1 primitive |
| straight-hair-v14 | `489e682d8e880f7573bae1c7c9ab1a5a98c326e40c5523074dfe33eef4263630` | 882,486；54,805,828 bytes；1 mesh／2 primitives |
| layered-hair-v17 | `521d4f000783c70f3d58d3f61a9ee9a822a0ec8fd698ecdee61cf1ed66688d68` | 855,110；55,660,864 bytes；1 mesh／2 primitives |

四份文件均为 **0 skins、0 animations、0 morph targets**。文件大小和面数来自实际数据；历史报告中的验证器结果、浏览器截图和任务消费只是历史证据，没有在本轮重跑。v17 只有新背发部分约 22k 面，不能把它描述成整个角色已适合网页。

### 当前应用源码

| 实际文件 | 本次读取结果 |
|---|---|
| [apps/web/package.json](../../apps/web/package.json) | Three.js 0.186.0、R3F 9.7.0、Drei 10.7.8 |
| [首页入口](../../apps/web/src/app/page.tsx) | `HomeDashboard` 未传 `identityScene`；独立预览不等于正式首页角色已启用 |
| [load-preview-asset.ts](../../apps/web/src/lib/scene/load-preview-asset.ts) | GLTFLoader parse，注册 eightInfluenceSkin；限制外部资源来源，未配置 KTX2／Meshopt／Draco 解码器 |
| [preview-asset.ts](../../apps/web/src/lib/scene/preview-asset.ts) | 当前预览入口限制 10×1024×1024 bytes 与自包含 GLB |
| [eight-influence-material.ts](../../apps/web/src/lib/scene/eight-influence-material.ts) | 自有材质与深度／距离路径的八权重适配；不能推断所有新材质和正式场景已有测试 |
| 本机 `node_modules/three/examples/jsm/loaders/GLTFLoader.js` | 核对 anisotropy、EXT／KHR meshopt 等实际支持代码；支持存在与项目装配仍分开记录 |

这些源码检查为静态证据，未启动应用或提交产品改动。报告中显存算术为 RGBA8 未压缩估算；性能、设备兼容、发布加载和多次换装释放仍需要 G6 实测。

## 7. 访问失败与未证实项

- Blender Manual 多个官方版本入口返回 402，未拿到完整手册；改用官方 glTF IO 仓库及明确的格式规范支持可移植性结论。不引用未读页面的具体 UI 步骤。
- GDC 2018 的 Horizon 角色制作演讲入口可检索，但 PDF 过大且直接获取返回 403；**未阅读全文，不用它证明关键制作细节或工时**。
- Maya 地区动态报价未可靠取得；Substance Texturing 仅取得历史明确价格，已与当前 Collection 价格区分。
- 未实测 Meshy Smart Topology 语义分件质量、Auto Split、rigging、表情、Text to Motion 重定向，也未实测 MD 2026 GLB 动画编码和当前角色换装许可。
- 本轮不提供真实绑定、自然呼吸、眨眼、坐姿碰撞或网页帧率通过结论；它们分别对应主报告 G1–G6 的后续验收。
