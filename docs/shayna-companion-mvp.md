# Shayna 管家首页：本地 MVP 接入

本次实现将正式首页替换为全屏 Shayna 与底部输入框。文字通过现有 DeepSeek 适配器，语音通过独立 Node 网关连接火山 Seeduplex；二者共享会话、目标工具和确认流程。按用户最新要求，当前联调使用本机 PostgreSQL 存储与后端，暂缓 Supabase 和 Vercel 验收。

## 启动与配置

要求使用当前仓库的 Node 与 npm workspace。先安装依赖，再配置私有模型与本地存储：

```powershell
npm install
npm run setup:companion -- "<本机 Shayna_VRM 目录>" --local
```

参数必须指向包含 `Shayna_VRM1.0.vrm` 的实际目录。脚本保留已有配置，在忽略提交的 `apps/web/.env.local` 中写入模型路径、随机网关密钥和本地地址；不会生成供应商凭据。模型不复制到 `public` 或构建产物，按已审计清单与 SHA-256 校验加载。默认待机来自仓库内已附许可的动画。

在 `.env.local` 配置以下项目，密钥不要发送到聊天或写入客户端环境变量：

| 配置                                                               | 用途                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| `BLUEPRINT_COMPANION_STORAGE=local`                              | 明确启用本机存储，仅 development 生效                  |
| `BLUEPRINT_LOCAL_DATA_DIR`                                       | 可选绝对目录；留空默认仓库 `.local/companion`           |
| `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 仅云端模式需要；本地模式不使用                         |
| `BLUEPRINT_COMPANION_ENABLED=true`                                 | 明确开启管家供应商请求                                 |
| `DEEPSEEK_API_KEY`                                                 | 文字回复及现有规划模型                                 |
| `VOLC_SPEECH_API_KEY`                                              | 已开通 Seeduplex 原生全双工的火山 API Key              |
| `COMPANION_GATEWAY_SECRET`                                         | Web 与网关共享的 64 位十六进制随机密钥，由设置脚本生成 |
| `COMPANION_WEB_ORIGIN`                                             | 访问 Web 的准确 origin；默认 `http://127.0.0.1:3000`   |
| `COMPANION_GATEWAY_URL`、`COMPANION_GATEWAY_PORT`                  | 默认 `ws://127.0.0.1:3191`、`3191`                     |
| `SHAYNA_ASSET_DIR`                                                 | 私有 Shayna VRM 目录                                   |
| `SHAYNA_MOTION_DIR`                                                | 可选，默认使用随代码提供的待机动画                     |

`localhost` 与 `127.0.0.1` 是不同 origin，访问地址需要与配置一致。网关仅监听本机回环地址。本轮未设计公开部署拓扑。

`--local` 在保留现有配置的同时写入存储模式；已有云端 URL 和密钥不会被删除。设置脚本也开启 `COMPANION_LOCAL_PREVIEW=true`，便于开发时检查私有模型。运行本地模式必须将 Next 绑定 `127.0.0.1`，使用下面的专用启动命令；请求会核验回环 Host，但 Host 核验不能代替监听地址限制。

本地存储使用 PGlite 的真实 PostgreSQL 引擎，首次启动自动应用现有 SQL 迁移，保留原有 RLS、版本检查、确认事务与幂等机制。它建立一个固定的本机测试身份，不调用远程登录；会话、偏好、目标、计划与进度写入 `.local/companion`。这不是浏览器 localStorage，也不是模拟业务回执。原始录音不落盘。

本地规划复用原有规划编排器、Skill、模型适配器及 claim/finish SQL，通过仅在服务器内部使用的 worker 执行。首次创建本机身份分配 5 次规划测试额度，重启不会补充；实际模型请求仍使用已配置的 DeepSeek 凭据。本地模式不需要云端 worker 密钥，也不会自动同步到云端账号。

分别启动：

```powershell
npm run dev:companion
npm run dev:voice
```

打开 `http://127.0.0.1:3000/` 即可使用本机身份；设置位于 `/settings/companion`。生产构建永远不会开启本地身份。恢复云端模式需将 `BLUEPRINT_COMPANION_STORAGE` 改为 `cloud`，关闭本地预览，并重启服务；本机数据仍保留，不能直接当作云端账号数据使用。

云端模式保留原有 Supabase 账号与数据库接口，迁移通过项目原有流程应用，禁止重置已有数据库。云端规划还需要 `planning-worker`、`BLUEPRINT_PLANNING_ENABLED=true`、独立 `BLUEPRINT_PLANNING_WORKER_SECRET` 及账号规划额度，参见[规划入口配置](agent-planning-entry.md)。这些云端环节不属于当前验收。

## 用户路径

- 默认关闭麦克风。点击开启后连续收听，原生服务识别轮次；浏览器本地 VAD 先清空播放队列，服务端再取消当前回复。关闭后停止采集并释放音轨。
- 文字输入取消当前回复，避免语音与文字各答一次。语音开启时文字回复以指定文本播报，再以问答对注入语音上下文。
- 回复临时显示字幕；菜单提供设置、历史与目标入口。历史按账号保存文字，可分页和清空；系统不保存原始录音。
- 澄清后生成目标卡，确认目标后异步生成计划；计划需要再次采纳。执行反馈形成证据卡，涉及节点完成时明确展示变更。只有数据库成功回执后显示和播报保存成功，再读取当前下一步。
- 保存失败保留待确认卡，版本冲突需刷新后重新整理。重复确认返回已有回执，不重复增加证据或版本。确认中的网络超时可能已经提交，重试同一提案即可查回回执。

## 模块与边界

`components/companion/avatar-controller.ts` 提供 `AvatarController`：`getCapabilities`、`setAppearance`、`setExpression`、`playMotion`、`stopMotion`、`reset`，以及轮次、口型和资源释放接口。UI 与 Agent cue 复用控制器；Agent 仅接收稳定白名单 ID，不接收骨骼编号或可执行脚本。

仅支持本套 Shayna：5 个 VRM 版本，默认 VRM 1.0 完整版；完整版含 6 组服装部件、5 项头发调节、18 个 VRM 预设、53 个可用原包表情及 147 项原始形变。另有 8 项原包片段显示不可用原因。短衣版本只提供其实际具备的部件。原包没有完整身体动作，当前待机、挥手和站立是额外适配能力，不应称为原包预设动作。

眨眼、嘴型、情绪和身体动作各自混合；嘴型读取实际播放分析器，打断后收口。相机保留输入区空间，按角色包围盒与屏幕宽高重新构图。模型失败时保留对话并提供重试。语音音色与音量在设置保存，音色随下一次语音连接生效。

`lib/companion/runtime.ts` 的 `CompanionRuntime` 管理语音启停、文字、打断、确认、字幕、消息和动作事件。浏览器只拿短期加密会话票据；供应商长期密钥留在服务端。网关在 `apps/voice-gateway`，负责火山协议、队列、取消、受签名保护的工具桥接和重连。后端仍核验委托账号身份，不使用管理员密钥，也不扩大现有扩展 Bearer 权限。

`lib/companion/tools.ts` 复用现有目标简报、规划审批、节点状态与证据服务。`read_goals` 返回真实目标与可执行步骤；`draft_goal`、`prepare_progress` 只准备提案。模型没有正式确认工具。文字／语音确认必须同时匹配浏览器当前提案 ID、提案之后最新且明确的真实用户发言，以及数据库中当前最新可确认提案；模型自述、先前历史、过期轮次均不能代替确认。

数据库新增 `companion_conversations`、`companion_messages`、`companion_actions`、`companion_preferences`，使用账号 RLS。提案状态只由确认 RPC 写入；进度证据与完成状态在同一事务中提交。清空会话会删除消息与待确认操作，正式目标及证据继续保留。

## 验证与未完成验收

本轮已运行真实 Chromium/WebGL：桌面与 390×844 窄屏全身构图、全部 5 个版本加载、换装控件、表情清单和挥手抬掌姿态。照片证据在忽略提交的 `.goal-loop/research/companion-integration-2026-10-18/`。开发预览出现未配置账号的提示属于真实降级，不代表已打通账号。

自动验证包括统一 Runtime 和 HTTP 路由的模拟传输测试、网关协议测试、票据与参数边界测试，以及 15 个 PGlite 真 SQL 场景：跨账号／扩展隔离、过期与重复确认、来源时序、单消息单次消费、版本冲突下证据回滚、真实规划采纳和会话清空。模拟传输不证明火山现场行为或麦克风设备质量。

当前全量 Vitest 为 122 个文件、1,471 项通过；包括本地模式开关、回环身份隔离、原始 SQL 确认与重启持久化测试。类型检查、Web 构建、原数据库契约与 15 项 companion SQL 场景通过。构建追踪清单的 66 个文件已检查，不包含本地数据库、环境文件或 VRM 资产。此前已有的 Edge worker 108 项测试、扩展构建及向导检查也通过。本地模式没有重新调用云端服务做数据库验证。

本轮真实浏览器在本地完成：提出目标 → DeepSeek 准备目标卡 → 点击确认 → 真实规划生成 → 审阅并采纳 → 创建实际验收清单 → 准备行动记录 → 火山 ASR 识别“确认保存” → SQL 同时保存证据与节点完成状态 → 读取下一步。目标页与成长档案展示了实际结果。停止并重新启动 Next 后，同一会话的 11 条消息、目标、计划、证据和音量 0.65 均保留。证据位于忽略提交的 `.goal-loop/research/companion-local-2026-10-18/`，其中 `restart-evidence.json` 与 `voice-local-evidence.json` 保存结构化结果。

真实测试暴露并修复了 DeepSeek 不接受工具根节点联合类型的问题；供应商 schema 改为对象根节点，运行时继续按角色指令类型校验。另修复正常 TTS 突发音频触发播放队列上限的问题，超长回复仍有明确暂停反馈。

```powershell
npm run typecheck
# 本机 Node 26 的内建 WebStorage 与已有 jsdom 测试冲突，传给全部 Vitest worker：
$env:NODE_OPTIONS='--no-experimental-webstorage'
npm run test:m1
npm run test:companion-db
npm run test:db-contract
npm run build:web
```

项目总门禁 `check:m1` 的既有 `resource-maintenance-health.test.mjs` 在 Windows 将 `URL.pathname` 当作文件路径，子进程得到 `/C:/...` 并失败；单独检查 `prepare-vercel-output.test.mjs` 时，其实现仅匹配带 `/` 的目录项，Windows 递归读取返回 `\`，因此未找到临时函数配置。本次没有修改无关维护脚本；总门禁不得标注为全部通过。

**真实供应商验证：** DeepSeek 已实际用于文字、工具调用及规划生成。火山已实测真实会话、指定中文播报、问答上下文注入；本轮进一步通过真实网关调用 `read_goals` 读取本地已确认目标，并通过明确语音确认写入进度，收到 1,772,482 字节回复音频。测试输入是在内存中合成、重采样的中文语音，不是真实麦克风／声学回声消除验收。探针不保存输入录音或合成音频，仅保存事件类型、转写和计数。

接入时发现网页示例与官方 Python demo 的细节差异：会话使用明确 UUID，播报事件携带同轮 `speech_id`；主动播报采用已实测成功的 `speech_text_buffer.append/commit`。未将只收到 `session.created` 的超时探针误记为语音通过。

**测试云端迁移：** 经用户授权，已在现有 `blueprint-m1` 应用 `companion` 迁移，云端记录版本为 `20261018135516`（平台执行时间戳，与本地文件名不同；不要按版本号重放）。4 张表的 RLS 均开启，匿名 REST 读取全部返回 401。已把该项目的公开 URL 与 publishable key 写入本地忽略文件。没有重置数据、发布 Web 或修改主域名。

**尚待实测：** 真实麦克风中文多轮、扬声器回声消除、插话、断网恢复与主观试听仍需现场验收。当前没有普通网络多样本 P50/P95 达标结论。Supabase 登录回调、真实云端账号闭环和 Vercel 暂缓，不再作为本机测试的前置条件。此前生产验收服务启动曾被自动审批拒绝，该项未重试；本轮浏览器使用现有本地开发服务完成测试。

Runtime `getMetrics()` 返回本页最近 100 项延迟测量；开发首页会输出仅包含时长的指标。`estimated_utterance_to_audio_ms` 用本地最后一个有声帧估计用户说完时间，`asr_to_audio_ms` 从最终转写到首段播放，`local_interrupt_ms` 测量本地清队列，`tool_ms` 单列工具往返。它们用于后续实测调优，不能用静态协议测试替代用户体验验收。

Shayna 继续按私有本地资源使用。账号鉴权不等于角色资产公开分发许可；发布前仍需处理资源授权。本轮未部署、提交或推送。

## 协议与动画来源

- [火山 Seeduplex 新版协议](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)：本次按 JSON 事件、函数调用、指定文本播报及完整问答上下文注入实现，模型 `1.2.6.1`；已完成真实协议连接验证，设备体验仍待验收。
- [ChatVRM 待机动画](https://github.com/pixiv/ChatVRM/blob/b542aa00e19dccf9fc48ba340cf7eee011d2329a/public/idle_loop.vrma)：固定提交与哈希，MIT 许可和来源随文件保留在 `apps/web/src/lib/companion/animations`。
