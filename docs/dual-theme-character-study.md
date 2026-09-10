# 双主题人物与场景制作对照

固定点 `04a5f0d`，2026-09-10，P2 实际资产加工切片。两套内部制作件已生成并通过导出／WebGL 检查，**正式美术未通过**。目的：验证现有真实人物能否通过造型、服装与环境加工形成两种身份表达；不新建通用编辑器，不把样片当作正式首页。

最新制作修订为 **v15**，增量固定点 `3688ae4`。已实际检查双主题全部 24 个动作，并修复东方袍片在站姿、交互和行走中的明显穿插；仍有 9 个动作的采样帧存在交叉，**完整动作门槛不通过**。旧修订保留为历史证据，正式首页仍未装载这些资产。

## v15 动作检查与袍片变形修复

2026-09-11，固定点 `3688ae4`。本批只修改内部制作配方、真实资产检查和证据记录，不修改首页业务、不把战斗动作加入产品需求，也不分发候选素材。

### 发现与修复

[全动作图集](../scripts/render-study-actions.mjs)通过生产八影响加载器和真实 Three/WebGL，检查两主题各 24 个动作的起点、中点与最终保持帧（不循环回起点）。v14 共 144 张实际帧、8 页图集；所有场景和服装保留。主线程查看全部图集后，发现东方前袍片在站姿、交互、挥手及行走中出现裤腿穿出的深色破口。

[几何交叉检查](../scripts/check-study-robe-clearance.py)在重新打开的真实 Blender 工程上，以袍片边线与裤腿表面的射线交点构成缺陷证据。`Idle_Sword` 第 0 帧复现 18 处交叉；仅改为裤腿表面插值配重剩 4 处，仅增加腰部余量也剩 4 处，两者组合后为 0。穿插已在源工程复现，不是仅由浏览器阴影造成。

配方改为从实际裤腿表面插值完整骨骼权重，并增加向下衰减的腰部余量；保留袍片、褶皱、开衩与裤腿，不用删除裤腿、隐藏动作或放宽断言消除红灯。新衍生件 v15 的 `Idle_Sword` 0、`Walk` 20 帧分别通过同一检查。赛博重新导出的 GLB 与 v14 **逐字节相同**，没有借此宣称赛博美术有新改进。

### 当前动作门槛：仍有明确失败

同一检查遍历 24 个动作全部整数帧及区间端点，共 805 个姿态。v14 的 805 个姿态都有边线交叉；v15 降为 165 个。这个计数只表示该几何见证是否出现，不是感知质量百分比或完整碰撞检测。

| v15 动作范围 | 检查结果 |
| --- | --- |
| Idle_Neutral、Idle、Idle_Gun、Idle_Gun_Pointing、Idle_Gun_Shoot、Idle_Sword、Gun_Shoot、HitRecieve、HitRecieve_2、Interact、Punch_Left、Punch_Right、Sword_Slash、Walk、Wave | 各自所有整数帧未发现袍边／裤腿表面交叉 |
| Death | 12/33 帧仍交叉 |
| Kick_Left、Kick_Right | 各 18/29 帧仍交叉 |
| Roll | 41/41 帧仍交叉，最差单帧 81 处 |
| Run、Run_Back、Run_Left、Run_Right、Run_Shoot | 分别 16/25、11/26、16/25、16/25、17/26 帧仍交叉 |

因此 `--all-actions` 在 v14 和 v15 **都按失败退出**。不能将站姿修复称为全动作服装安全；不把未碰到边线的面内穿插、手／配饰碰撞、亚帧或其他视角算作通过。跑步、踢腿及翻滚仍需进一步版型／配重或独立服装变形处理，不能用统一继续加宽代替制作判断。

### 实际运行与画面

[袖根检查](../scripts/check-study-sleeve-joins.py)新增 `--all-actions`：两主题 v14 以及东方 v15 各 805 个姿态，16 个袖根最大误差为 0，所有蒙皮顶点坐标有限、拓扑数量不变；旧 v5 仍会因 31.744 mm 接缝错位失败。检查先暴露并修复了脚本中的局部变量遮蔽错误，没有把该脚本错误记成人物缺陷。

东方 v15 全部 24 动作重新生成 72 张实际帧和 4 页图集，无页面／着色器错误或外部请求。图集单动作固定镜头，由三帧人物包围盒共同取景；主线程已看全部四页：原站姿和行走破口明显消失，开衩随腿分离；跑步与大幅动作仍有挤压和硬板感。中性近景、双主题真实 HomeDashboard 的 1440／960／390 宽度及二维回退共 12 场景检查通过，但这些内部渲染不替代美术验收。

东方 GLB 保留 62 骨骼、24 动作、完整影响和自含资源，219,937 个浮点 accessor 值有限、16,072 个几何三角形；导出器既有矩阵／烘焙和树木采样器警告仍存在。软件 GPU 为 SwiftShader，不代表用户硬件帧率或显存预算。935 项应用测试、四工作区类型检查和渲染脚本语法检查通过；没有重跑线上构建、数据库、Auth 或托管旅程。

| v15 输出 | 字节 | SHA-256 |
| --- | ---: | --- |
| cyberpunk.blend | 6,391,812 | `73c2f7e7fe25c2028a55fb3ce9b91343f5fc1b9ec95619cfb850f5fe50eae14c` |
| cyberpunk.glb | 1,599,244 | `0a03a23eeef21cf14b8fdd87387beb7fc8b938f383561866831d55652aa7352d` |
| eastern.blend | 8,261,152 | `d6fa555d9f9121c36a1c4bedecd8d89ca2f8659eae97b4d5551d4eeb92e2e72c` |
| eastern.glb | 2,918,424 | `d5eea54fbd24f489c71ce256f3c3e6cecaf4b0daf546896ab0484a95cc3242df` |

新件在 `.tools/asset-studies/dual-theme-v15/`，图集／元数据在 `.goal-loop/evidence/study-actions-v14/`、`study-actions-v15/`，独立中性场景和真实面板分别在 `.goal-loop/evidence/dual-theme-v15/`、`dual-theme-panel-v15/`。旧件与下载原件不覆盖；临时配重对照脚本已移除，方法和结果保留在上文。全部资产和图集仍 Git 忽略，不随源码分发。

```bash
bash scripts/with-m1-runtime.sh node scripts/render-study-actions.mjs 14
bash scripts/with-m1-runtime.sh node scripts/render-study-actions.mjs 15 eastern
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v15/eastern.blend --python-exit-code 1 --python scripts/check-study-robe-clearance.py -- Idle_Sword 0
# 整套动作仍失败，保留此门槛，不改为只检已通过动作：
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v15/eastern.blend --python-exit-code 1 --python scripts/check-study-robe-clearance.py -- --all-actions
```

人物表情、腰封和服装质感、背景细节密度、许可对应、完整动作与硬件性能仍未通过。此批是可复现的局部修复，不是正式美术通过或完整 P2 交付；没有下载、费用、部署、数据库变更或 push。

## v14 空间轮廓与贴合服装

固定点 `a1780aa`，2026-09-11。此批只改本地制作配方及内部检查入口，不改应用业务、账号、数据库或生产发布。

- 赛博移除树木、种植槽和旧立柱，改为偏置工作台、连续切角背墙、局部冷光与暖色边饰；缩小环境对人物的干扰。工作屏和细节采用同一局部坐标一起倾斜，不再绕世界原点分离。
- 东方移除横穿人物的三根栏杆，改为月洞轮廓、近远两层山形、偏置树石和临水踏台；收窄袖体与腰封，暖色衣料和冷色石水分开处理。仍是可编辑实际几何，不是背景图片。
- 衣襟／领口沿原身体表面采样，继承局部插值骨骼权重。v12 暴露了只采样端点时中段穿进胸前的问题，v13 起沿路径每不超过 8 mm 采样；最终 v14 近景中的断裂已消除。东方衣襟末端越过衣服边界的生成检查先失败，收回末端后通过，未放宽表面命中断言。
- 两种主题各自的环境光、半球光颜色和曝光写入 GLB 场景元数据，由[共享光照读取器](../scripts/study-lighting.mjs)供两种检查入口使用。无该字段的历史资产保留原光照，损坏字段直接拒绝；导出检查明确要求新修订携带光照，并验证真实加载结果与导出值一致。

### 已验证与未通过

两套 GLB 各保留 62 骨骼、与 v11 相同名称的 24 个动作及八项影响加载；175,423／218,481 个浮点 accessor 值全部有限。赛博移除树后无纹理图像，东方两张图像内嵌；均无外部 buffer／image 引用。Blender 导出仍打印既有矩阵运算和动画烘焙警告，不能仅凭退出码认定安全；本批另检查实际导出数值、加载和画面，**未证明所有动作形变安全**。

重新打开制作件确认中性启动、关闭 NLA、62 骨骼、24 动作、无 Library／Text，当前场景材质使用的图像已打包。源文件遗留但未使用的 `Texture.png` 不作为当前材质依赖。每主题 16 个袖根在静止及三个待机帧误差为零；重复制作命令拒绝覆盖且输出哈希不变，修复源与 v11 两件 GLB 哈希未变。

真实 Three/WebGL 检查两主题的远景、近景和稍后待机图；画面有实际动作变化，无着色器或页面错误、无外部 HTTP 请求。真实 HomeDashboard 在 1440／960／390 宽度，分别验证 3D 和二维回退共 12 个场景：长标题目标键盘选择、路径链接、截图后选中卡片可见、无模块重叠／页面溢出、一次加载及卸载清理均通过。两入口报告均记录从资产读取的光照。

主线程查看最终人物近景、两主题桌面及窄屏图：衣襟连续、工作屏细节贴合，环境轮廓和明暗主次更清楚。但人物表情／姿态仍僵硬，领口、腰封与袖肩仍偏硬，东方树木的细节密度与低模人物尚未统一，地面／背景仍有模型展台感；右侧长标题也比人物更抢眼。**这不是正式美术通过，不能替代材质精修、全动作检查、许可对应及真实硬件预算。** 不接入正式首页、不宣称已提升留存。

| v14 输出 | 字节数 | SHA-256 |
| --- | --- | --- |
| cyberpunk.blend | 6,391,812 | `6bc82b878bc481788f63158e5af393be6e1b366a76719fcccb79d53b1baa9b68` |
| cyberpunk.glb | 1,599,244 | `0a03a23eeef21cf14b8fdd87387beb7fc8b938f383561866831d55652aa7352d` |
| eastern.blend | 8,257,584 | `adc8ea051988d096964f470d521c4061b3a35c5a02a83c3dd2223102f1ac456c` |
| eastern.glb | 2,909,944 | `7d5797256f65c98c93e56bbea59cb12a8aeddddfe928feced9de332a378aaa92` |

输出保存在忽略目录 `.tools/asset-studies/dual-theme-v14/`；独立场景六张图及报告在 `.goal-loop/evidence/dual-theme-v14/`，首页十二张图及报告在 `.goal-loop/evidence/dual-theme-panel-v14/`。v12／v13 作为加工中间对照保留，不覆盖旧件。仓库仅提交配方与文档，不分发许可未闭合的素材。

```bash
bash scripts/with-m1-runtime.sh node --test scripts/study-lighting.test.mjs
bash scripts/with-m1-runtime.sh node scripts/render-dual-theme-study.mjs 14
bash scripts/with-m1-runtime.sh node scripts/render-theme-panel-study.mjs 14
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v14/eastern.blend --python-exit-code 1 --python scripts/check-study-sleeve-joins.py
```

本批重跑 3 项光照行为测试、858 项应用测试／72 文件、四工作区类型检查及上述实际资产／布局检查，通过。没有重跑生产构建、Edge、数据库或真实账号旅程；没有购买、外部服务消费、托管操作或 push。

### v14 独立复核

源码 `7940b54`。两位非作者分别复核全部七个变更文件：Standards 轴 0 项确认规范／正确性问题、0 项可行动异味；Spec 轴 0 项确认遗漏、范围扩张或错误。两位各独立重跑 3 项光照测试，核对实际资产哈希和场景／面板光照报告；需求轴另检查两份 GLB 的骨骼、动作名称、自含资源及选定近景／面板截图。83 个相关本地文档链接有效。

独立复核没有重跑 Blender、GPU 浏览器、数据库或托管操作；不能当作新增性能或全动作证据。正式美术与完整 P1–P9 仍未完成。

## v11 材质与真实面板构图

固定点 `0a8e5e9`，2026-09-10。此批把同一人物、两套服装和两种空间放入真实首页模块验证，而非另造一个产品页面。**本地构图研究完成不等于正式美术、线上发布或整个 P2 完成。** 下文 v5／v9 为历史记录。

### 已落地的变化

- 源人物的裤装／鞋面沿既有几何使用平滑明暗，衣料与衬里采用更哑光的材质；不改源文件或原有权重。东方四片衣摆改为逐渐展开的褶皱、弧形下摆与同网格织边，消除原先四块平板的观感。
- 赛博背景取消高横梁、降低背板并缩小平台与树冠，让人物头肩有留白；东方降低主岩块、缩小水面和树冠。树叶与树干分别调色。v10 实际画面发现树干误染蓝、叠层织边产生阴影闪点，v11 改为中性树干和同一表面的材质分区；v10 保留作为对照，不覆盖旧件。
- [HomeDashboard](../apps/web/src/app/home-dashboard.tsx) 新增可选 `identityScene` 受信任 React 内容插槽。未传入时原 SVG、二维提示、目标选择和成果记录保持不变；正式调用者未传入样片，没有增加默认 GLB 请求或 Three 导入。身份内容与业务目标彼此独立，切换关注目标或主题不会无故重建身份内部状态。
- [内部面板检查](../scripts/render-theme-panel-study.mjs) 复用真实 HomeDashboard、ThemeSurface、生产样式与完整影响加载器，以明确标注的虚构摄影目标渲染实际 GLB。人物取景按人物而非整个环境包围盒计算，保留 DOM 操作；脚本不提供账号、数据库或正式导航服务。

### 验收边界

在 1440／960／390 宽度分别检查两主题实际场景和默认二维回退；键盘选择长标题目标后，当前重点及路径链接保持一致，主要模块无重叠、页面无横向溢出。窄屏仍以当前行动优先，内部脚本的 3D 只为构图研究，**不是已交付的移动端自适应质量策略**。正式版本仍须完成设备预算、减少动态效果、WebGL 失败回退与受控加载等整体验收。

主线程已检查真实远景、人物近景和面板图：裤装连续、衣摆有褶皱，误染树干与织边闪点在当前采样图中消失；人物在面板中可读，不再是缩小的场景缩略图。但衣领／袖肩的造型和着色过渡、环境的大平面与通用栏杆仍显简陋，尚不能体现用户期望的商业游戏面板质感。下一步应改善统一美术语言与身份表现力，而不是以测试数量关闭该门槛。

| v11 输出 | 字节数 | SHA-256 |
| --- | --- | --- |
| cyberpunk.blend | 7,898,866 | `dd50834ca025d4e95fbe8aa5a6eab5de96e9e4f1b09e6dcc9744a3710396190f` |
| cyberpunk.glb | 2,823,716 | `7f89653dfc51417d1061d4faa408d8bd895a3fc210caf3bd3ee4b8fe5d49d22d` |
| eastern.blend | 8,094,362 | `b227e1f31e2286cef6376257eca78ee6bfed72705e5ed656acdf625b6e39b501` |
| eastern.glb | 2,841,760 | `779206ec815ef7fd93a1276255673dc9ec4cc486ee57d51394a9ee08b0e152c7` |

资产仍在忽略目录 `.tools/asset-studies/dual-theme-v11/`；独立场景证据位于 `.goal-loop/evidence/dual-theme-v11/`，真实面板 12 张图片及报告位于 `.goal-loop/evidence/dual-theme-panel-v11/`。不加入产品包或分发仓库。

```bash
bash scripts/with-m1-runtime.sh node scripts/render-dual-theme-study.mjs 11
bash scripts/with-m1-runtime.sh node scripts/render-theme-panel-study.mjs 11
.tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --offline-mode .tools/asset-studies/dual-theme-v11/eastern.blend --python-exit-code 1 --python scripts/check-study-sleeve-joins.py
```

制作脚本的修订参数只是新输出目录号，**不是历史配方选择器**。复现旧 v5／v9 的制作内容需要对应历史提交；当前配方运行时必须使用未存在的新修订号。上方渲染命令只读取现有资产并更新同目录图片。

机械验证：两主题均保留 62 骨骼、相同的 24 动作名称和最多八项骨骼影响；两张材质图像内嵌，所有 202,505／204,281 个浮点 accessor 值有限。重新打开制作件先确认中性启动姿态、关闭 NLA、当前材质图像打包且无 Library／Text，再检查 16 个袖根在三个中性待机帧均零偏离。已有输出拒绝覆盖（退出 1），前后哈希一致，两个源文件未变。独立场景的实际待机前后画面不同，无页面／着色器／外部 HTTP 请求错误。

回归：502 项 Vitest／51 文件、41 项 Edge handler 测试、四工作区类型检查、PGlite 升级契约、向导检查、Next／WXT 构建及扩展安全检查通过；40 项生产浏览器回归通过。插槽行为测试先因缺失插槽失败，再通过实际 React 状态、目标选择、主题切换和移除后回退验证。未新增迁移或远端调用；这些结果不代表全动作变形、真实硬件帧率、许可对应或正式美术通过。

### 独立审阅与截图证据修正

源提交 `1a48e41`：Standards 独立审阅 0 项确认违反／有意义异味，另跑 7 项 HomeDashboard 测试并核对四件输出哈希。Spec 独立核对 62 骨骼、24 个动作名称、八项影响、内嵌图像与有限值，发现 1 项证据缺口：390px 截图中所选长标题卡被裁切，而截图前的可见性检查通过。

新增截图后断言先失败。记录显示全页截图使横向位置由 318 变成 104，卡片右缘由 368 变成 582，轨道几何未变；等待二十帧后仍在截图时改变。只将全页截图改为普通视口截图后位置保持 318。修复 `9c90935` 显式设置完整页面高度，再布局、滚动和普通截图，报告保留 `captureHeight`，并坚持截图后再次检查可见性。没有用修改产品 CSS、移除断言或隐藏目标卡的方式绕过问题。

最终主线程重跑两主题 12 张场景／二维截图并查看两张 390px 场景图：所选长标题卡完整可读，目标、当前重点与身份展示分离；每主题仅请求自己的一个资产，切换关注目标／尺寸／回退不重复加载，卸载时执行一次清理，无页面／着色器／外部请求错误。**Standards** 修复复核 0 项问题；**Spec** 修复复核 0 项剩余确认问题。93 个相关本地文档链接有效。审阅者未重跑 GPU，不把只读审阅说成新的运行证据。

## 制作约定

- 从已核验的 Casual 修复源出发，保留完整骨架与源权重；新增服饰绑定原骨架。每主题独立制作文件与 GLB，不覆盖原件，不新增采购或外部服务。
- 赛博主题：短款结构外套、护肩／设备细节、深石墨与小面积冷光、偏暖侧光；人物处于安静的工作舱，而非素材展台。
- 东方主题：交领、分片长外袍、腰封和发饰；临水石阶、偏置树冠、近石远景与留白。区别必须进入轮廓和构图，不只材质颜色。
- 用已取得的实际自然资产，并记录原许可对应问题；衍生件仍留在忽略目录。现代基础脸／发型、服装穿插、全动作、艺术质量和硬件预算不能仅靠脚本成功认定通过。
- 不添加战斗叙事、虚构成果、等级／装备数值或用户数据。正式首页默认仍是二维回退；v11 只新增受信任场景插槽，内部构图脚本使用明确标注的虚构目标，不改变账号、数据库、扩展或托管发布。

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
