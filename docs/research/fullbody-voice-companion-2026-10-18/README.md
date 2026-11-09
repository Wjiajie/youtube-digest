# 全身 VRM、语音优先管家与 AIRI / AITuberKit 复用评估

日期：2026-10-18。状态：调研、离线资产检查与独立渲染验证完成；正式首页、真实语音服务和目标操作尚未接入。

本轮使用 Exa 检索 30 条结果，按免费角色、动作和代码复用三个方向筛选；进一步固定两个项目的源码版本，阅读 44 份源码、包声明和说明文件。检索结果包含重复入口，不等于 30 个独立合格来源。出处清单见 [sources.json](sources.json)。

## 1. 用户确认的产品方向

Blueprint 辅助用户制定并实现目标。主界面存在一个按照用户意图映射的虚拟管家，提供沉浸式体验，让用户更愿意提出、执行和记录目标。

- **全身形象、全身动作优先验证**，不以半身构图作为默认方案。
- **语音是主要交互，文字是平等可用的补充入口**。不能把语音留到 MVP 完成后再补。
- “我的化身”与“管家”统一为一个角色：外观承载用户的身份与风格意图，行为承担目标助手职责。无需同时展示两个角色，也不要求复制用户照片。
- 角色生成属于离线制作线；首页仅接收验收过的角色及动作资产。
- MVP 聚焦“提出目标 → 澄清与确认 → 采取下一步 → 记录进展 → 得到反馈”。数据、路径、资源和页面为此服务。

这次确认覆盖旧方案中“固定三栏、半身角色、先做完整文字功能再加语音、角色仅为身份装饰”的默认假设。账号隔离、真实事实、用户确认与故障恢复仍是核心能力的必要支撑。

## 2. 结论与选型建议

**推荐以 AIRI 作为主要的可复用模块来源，继续使用现有 React / R3F / three-vrm 承载全身舞台。** 优先提取框架无关的语音、播放和口型逻辑；Vue 舞台通过 React 适配或按其设计实现。AITuberKit 是更贴近 React 的实现参照；若未来采用其当前版本代码，需要先明确相应许可。

这不是对完整 AIRI 应用的直接集成承诺。当前两个 AIRI 包均为 `private: true` 的 monorepo 包，含 `workspace:` / `catalog:` 依赖；不能当作已验证的普通 npm 依赖安装。

### 比较依据

| 维度 | AITuberKit | AIRI | 对 Blueprint 的影响 |
| --- | --- | --- | --- |
| UI 技术栈 | Next 15、React 18、Zustand | Vue、Pinia、TresJS | AITuberKit 组件语法更接近；两者均需适配现有状态与生命周期 |
| 全身 VRM 与动作 | `Model` / `Viewer`、AnimationMixer、VRMA、PoseManager | VRMModel、VRMA、根节点重定位、表情与眨眼仲裁 | 均具备基础；动作资产、意图映射和视觉检查还需产品完成 |
| 语音输出 | SpeakQueue、PCM16 流播放、按会话停止、逐句分段 | 独立音频 pipeline、播放组、取消、分段、输入捕获与观察 | AIRI 的独立核心更适合按职责提取；不能据此断言其真实中文效果更好 |
| 组件耦合 | `VrmViewer` / `Model` 依赖 homeStore、settingsStore、错误组件、PoseManager 等 | Vue 舞台依赖多个内部包；音频与口型核心有独立边界 | 都不是零修改插入首页；应从核心模块开始 |
| 当前代码许可 | 自定义许可；非商用 / 内部评估可免费，商用按作者条款 | 根仓库 MIT | AIRI 更符合长期可维护、可再分发的复用方向 |
| 目标制定、执行、记录 | 不提供 Blueprint 领域流程 | 不提供 Blueprint 领域流程 | 必须接入已有澄清、路径、状态和成果用例 |

源码基点：

- [AITuberKit `91890921`](https://github.com/tegnike/aituber-kit/tree/91890921e8624001ce1d04a0f59759e1ab5ee334)。技术栈来自 [package.json](https://github.com/tegnike/aituber-kit/blob/91890921e8624001ce1d04a0f59759e1ab5ee334/package.json)，复用限制来自 [许可证](https://github.com/tegnike/aituber-kit/blob/91890921e8624001ce1d04a0f59759e1ab5ee334/docs/license_en.md) 和 [FAQ](https://github.com/tegnike/aituber-kit/blob/91890921e8624001ce1d04a0f59759e1ab5ee334/docs/license-faq_en.md)。v1.x 的 MIT 不覆盖 v2 新增代码；选择旧版或追溯上游来源需要按具体文件核查。
- [AIRI `59db7905`](https://github.com/moeru-ai/airi/tree/59db7905a4ffb61755890ba3ea9f09c4888c9d47)，[MIT 许可证](https://github.com/moeru-ai/airi/blob/59db7905a4ffb61755890ba3ea9f09c4888c9d47/LICENSE)。角色、动作和其他第三方资产仍各有来源条件，代码许可不替代资产许可。

### 优先复用清单

| 模块 | 已核对源码 | 复用方式与验证状态 |
| --- | --- | --- |
| 五元音权重驱动 | AIRI `model-driver-lipsync/src/shared/wlipsync/vowel-driver.ts` | **可直接提取纯函数与状态**。已在 Node 中运行原始 TS 源码，3 项小样检查通过，不依赖 Vue |
| wLipSync 音频节点 | AIRI `model-driver-lipsync/src/runtime/wlipsync/index.ts` | 实际转导出 `wlipsync` 的节点创建器；接原库、profile 与 React 生命周期即可评估，尚未实测音频节点 |
| 音频编排 | AIRI `pipelines-audio/src/speech-pipeline.ts` | 优先提取意图队列、取消、TTS 并发与按序播放；需要连同 stream-kit、eventa 等依赖梳理，不是单文件复制 |
| 录音与打断 | AIRI AudioInput / capture / playback 的接口；stage-layouts 的 interruption composable | 核心调度与 UI 生命周期分开。Vue / Pinia 的会话停止逻辑需适配 Blueprint，不直接接其账号体系 |
| 全身舞台 | AIRI `stage-ui-three` 的动画、表情、VRMModel | 复用 VRMA、表情所有权、加载竞争保护的设计；继续沿用现有 R3F，而非另起账号和场景应用 |
| React viewer 与说话队列 | AITuberKit `VrmViewer`、`Model`、`SpeakQueue`、SpeechSegmenter | 适合比较交互和架构；当前许可下不直接并入产品代码 |

主要代码入口：[AIRI 音频核心](https://github.com/moeru-ai/airi/tree/59db7905a4ffb61755890ba3ea9f09c4888c9d47/packages/pipelines-audio)、[口型核心](https://github.com/moeru-ai/airi/tree/59db7905a4ffb61755890ba3ea9f09c4888c9d47/packages/model-driver-lipsync)、[3D 舞台](https://github.com/moeru-ai/airi/tree/59db7905a4ffb61755890ba3ea9f09c4888c9d47/packages/stage-ui-three)、[AITuberKit Model](https://github.com/tegnike/aituber-kit/blob/91890921e8624001ce1d04a0f59759e1ab5ee334/src/features/vrmViewer/model.ts)、[SpeakQueue](https://github.com/tegnike/aituber-kit/blob/91890921e8624001ce1d04a0f59759e1ab5ee334/src/features/messages/speakQueue.ts)。

**特别需要避免的误判**：AIRI 的 `stage-ui/src/libs/speech/streaming-pipeline.ts` 使用其 `getAuthToken`、`SERVER_URL` 和 `/api/v1/audio/speech/ws` 协议。它虽然是 TS 文件，也不能原样接到 Blueprint 后端。应复用编排与协议思想，再提供本项目的服务端适配。

如果希望最大限度原样使用 AIRI 的 Vue 组件，可以另做“预编译 Vue 岛”的接入小样；需要解决 Pinia / TresJS 初始化、样式、Three 实例、卸载与构建体积。当前没有做该集成验证，因此不把它列为最低成本默认路线。

## 3. 已取得的免费角色

三份角色均已完成下载完整性检查、SHA-256、内嵌许可、骨骼与非空表情绑定检查，并实际用当前安装的 three-vrm 加载。详见 [assets.json](assets.json) 和 [browser-evidence.json](browser-evidence.json)。

本轮三份下载模型均为 VRM 0.x；它们用于补充现有 VRM 1.0 P0 样例的兼容与表现对照，本轮未重跑该旧样例的性能记录。

| 角色 | 文件大小，十进制 MB | 人形骨骼 | 网格三角形 | 表情与物理 | 用途 |
| --- | ---: | ---: | ---: | --- | --- |
| AvatarSample A | 15.10 | 54 | 24,890 | 五元音、眨眼、左右眼、喜怒哀乐；10 组 Spring Bone | 推荐首先观察正常人体比例、服装、脸部与全身动作 |
| Juanita | 6.10 | 30 | 13,504 | 五元音、眨眼、左右眼、喜怒哀乐；1 组 Spring Bone | CC0 大头卡通对照；手指骨数量较少 |
| Eugenia | 8.12 | 52 | 10,200 | 五元音、眨眼、左右眼、喜怒哀乐；1 组 Spring Bone | CC0 另一种体型、眼镜和服装对照 |

这里的 Spring Bone 组数只说明资产结构存在，不代表头发、裙摆或碰撞已通过视觉验收。网格三角形数也不同于开启描边后实际渲染的三角形数与 draw call。

来源与使用条件：

- **AvatarSample A**：VRoid Project 原作，从 AITuberKit 固定版本中的 `public/vrm/AvatarSample_A.vrm` 取得。它是独立的 pixiv 样例资产，**不是 AITuberKit 自有角色或其代码许可下的模型**。[官方条件](https://vroid.pixiv.help/hc/en-us/articles/4402394424089) 允许各种角色使用与修改，但有角色创建服务等限制。本轮仅用于既有 VRM 展示测试，不作为角色生成服务底模。
- **Juanita / Eugenia**：Polygonal Mind 的 100Avatars Round 3，文件内许可为 CC0。[创作者发行说明](https://github.com/PolygonalMind/100Avatars/releases)、[角色文件索引](https://github.com/ToxSam/open-source-avatars/blob/main/data/avatars/100avatars-r3.json)。下载地址和哈希已随资产记录保留。
- **AvatarSample B** 另作候选；本次 GitHub 下载超时，只取得部分字节，已标记 `.partial`，没有加入可用模型或测试通过清单。

## 4. 动作需要与角色分别准备

上述三个 `.vrm` 的 glTF `animations` 都为空。**这不意味着不能动**：模型含人形骨骼与表情，动作通过独立 VRMA 文件重定向。VRMA 也可以描述表情与视线，详见 [格式官方说明](https://vrm.dev/en/vrma/)。

本轮取得并测试：

- `idle_loop.vrma`：从原始 [pixiv/ChatVRM `b542aa00`](https://github.com/pixiv/ChatVRM/blob/b542aa00e19dccf9fc48ba340cf7eee011d2329a/public/idle_loop.vrma) 取得；其仓库 [MIT 许可](https://github.com/pixiv/ChatVRM/blob/b542aa00e19dccf9fc48ba340cf7eee011d2329a/LICENSE) 已记录。约 10.375 秒、源动画 28 通道；转换到本轮三个模型各得到 22 条运行时轨道，均能采样到骨盆、双臂和双腿变化。
- `test.vrma`：来自 [three-vrm 官方动画示例](https://github.com/pixiv/three-vrm/blob/68c7d6b1f73b79568f81139be62831968bff7876/packages/three-vrm-animation/examples/models/test.vrma)，3 秒、3 通道。已做文件检查并提供播放入口；它是骨骼能力样例，不是自然待机或完整动作库。与前述 idle 的浏览器三模型结果分开记录。
- 另提供原创的程序化挥手测试，方便检查肩肘变形；不把这个测试说成下载的成品动作。

**进一步测试用的免费动作包**：[VRoid 官方七种 VRMA](https://booth.pm/en/items/5512385)，包括展示全身、问候、V 手势、射击、转身、模特姿态和深蹲。[官方发布说明](https://vroid.com/en/news/6HozzBIV0KkcKf9dc1fZGW) 确认免费。包级条件允许测试与署名后的商用，但禁止未经许可将动作以可提取形式二次分发，所以不能直接视为可放进公开 Web `public/` 的资产。本次下载返回登录 HTML，未取得 ZIP，也没有将七种动作列为已运行通过。

## 5. 本地可看的效果

- 静态效果与表情对照：三个角色的真实 WebGL Canvas 导出截图，已于 2026-11-09 作为调研中间产物移出仓库。
- 交互对照页：`http://127.0.0.1:3190`，支持换角色、表情、真实 VRMA 待机、骨骼样例、程序化挥手、本地测试音频与音量口型。
- 运行文件与下载资产：`.goal-loop/research/voice-first-companion-2026-10-18/`。该目录已被仓库既有规则忽略，未把测试模型加入产品构建。
- 重启命令：`node .goal-loop/research/voice-first-companion-2026-10-18/serve.mjs`。使用仓库现有的 three / three-vrm 依赖，没有新增 npm 依赖。

实际完成的检查：

1. 三个模型头到脚构图、加载与角色切换。
2. 每个模型 10 项表情/口型权重能设为 1；检查原始绑定非空。AvatarSample A 另导出中性、开心、闭眼和 `aa` 近看图，确认眼睑、嘴形确有可见变形。
3. 同一待机 VRMA 在三个模型上创建运行时轨道；0.5 秒与 2 秒采样时骨盆、双臂、双腿四元数均变化；本轮记录的应用错误为 0。
4. AIRI 原始 vowel-driver 在 Node 中直接运行，验证两强元音选择、静音释放、reset 共 3 项。**这只证明纯核心可脱离 Vue 使用，不代表完整 wLipSync 或中文语音链已经接入。**

验证边界：浏览器窗口处于最小化状态，常规截图不可用，动画帧会受后台节流。本轮导出的是实际 WebGL Canvas 像素和确定性动画采样；没有用该状态的 FPS 判断性能，没有做桌面/移动端帧率、连续动作视频、脚部接触、衣物穿插、无障碍或正式美术验收。本地音频按钮可供手动测试；本轮没有完成真实麦克风、ASR、模型回复或服务端 TTS 验收。

## 6. 按本轮愿景收敛 MVP

### 首屏与交互

全身管家作为首屏中心。语音会话入口、字幕、停止/打断、文字输入和当前目标摘要围绕舞台组织。目标详情、编辑和成果历史按意图展开，避免把旧三栏后台布局当作固定前提。必要文字与确认卡仍使用 DOM。

默认视角保留完整身体；面部近看仅用于资产检查，不用它替代全身效果验收。需特别检查全身距离下表情是否仍能看清。

### 最小纵向闭环

```text
用户进入主界面 → 全身角色待机
  → 说出一个目标 → 角色用语音一次澄清一个关键点
  → 显示目标草案 → 用户明确确认
  → 角色说明今天的一个具体行动
  → 用户口述进展 → 显示成果草稿 → 用户明确确认
  → 保存成功后角色回应，并更新当前重点
```

语音和文字必须共用同一意图、事实上下文、草案和确认流程。用户可主动开始语音会话；停止应同时中止识别/生成/合成/播放及角色说话反馈。语音失败可继续文字，用户原话和未保存草稿要保留。

### 实现阶段与门槛

| 阶段 | 目标 | 验收重点 |
| --- | --- | --- |
| S0 全身表现 | 先选择可接受的角色比例与动作质量 | 本轮免费资产已准备；用户检查全身、脸部、动作；还需正常可见窗口与移动端性能验证 |
| S1 语音对话切片 | 说话 → 转写 → 基于真实目标回答 → 播报 → 角色口型与动作 | 中文可懂度、首句延迟、停顿、打断、恢复；文字走同一链路。ASR/TTS 适配器可换，浏览器语音可作回退，不能假定其质量已满足主体验 |
| S2 目标闭环 | 澄清目标、解释下一步、口述记录成果 | 草案可编辑、明确确认、真实保存；反馈以保存结果为准；复用既有领域能力 |
| S3 MVP 收口 | 真实账号旅程、稳定性与基本体验 | 首屏、手机全身取景、无声使用、权限拒绝、断网、跨账号、取消、成本边界与恢复 |

账号和领域数据是上述闭环的支撑；自定义角色生成、换装商城、复杂环境、长期人格记忆和通用聊天暂不扩大 MVP。

这不是新的工期承诺，也没有改变云端已实现阶段的事实状态。下一步应先在独立全身样片上确认观感，再实现一条真实语音纵向切片；正式选型、实际供应商、费用预算与发布分别记录。
