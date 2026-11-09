# 管家对话、上下文压缩与本地记忆

更新：2026-10-25。当前实现保留原有 AI SDK、账号和 PGlite 数据层，没有安装 Mem0、Mastra、LangGraph 或 Letta，也没有新增外部记忆服务。

## 现有对话链路

- 文字：浏览器 `CompanionRuntime` → `/api/companion` → Vercel AI SDK `7.0.97` 的 `streamText`／工具循环 → `@ai-sdk/deepseek` 的 `deepseek-flash`。最多五个工具步骤，正式保存仍需用户确认和数据库回执。
- 语音：浏览器 AudioWorklet／Web Audio → 本机 Node WebSocket 网关 → 火山 Seeduplex `1.2.6.1`。这是火山原生实时会话，不经过文字 Agent SDK；工具通过签名桥接复用同一业务服务。
- 规划：独立的规划运行器使用 AI SDK `ToolLoopAgent`，不是首页每一次闲聊都创建规划 Agent。

此前 `recentContext` 只取最近二十条非中断消息和有限字符，没有摘要或长期记忆。全文虽已保存，早期内容会退出模型上下文。

## 本轮实现

### 本地滚动摘要

原始消息继续保留在 `companion_messages`。`companion_memories` 保存会话摘要、重要事实、未解决事项、修订号以及处理到的消息游标；本地模式保存在既有 `.local/companion` PGlite 数据库，而不是浏览器 localStorage 或 Codex 的记忆目录。

后台压缩保留至少最近六条完整问答。可压缩旧记录达到十二条，或序列化大小超过 16,000 UTF-8 bytes 时，使用现有 DeepSeek 生成滚动摘要。每批原文不超过 24,000 bytes，已有摘要不超过 18,000 bytes，模型适配器另检查完整 JSON prompt 不超过 44,000 bytes。超大单条消息分片整理，全部成功后才推进游标。

摘要是有损的参考数据。不得把助手猜测、待审阅提案或历史中的“确认保存”当成用户事实或新的确认；正式目标和进度仍通过业务工具核实。原始档案不会因摘要被删除。

摘要失败时不推进游标、不覆盖旧记忆，普通对话仍使用旧摘要和最近窗口；同会话同进程合并在途任务，数据库以修订号保护并发写入，失败后有一分钟退避，避免连续重复消费。

### 有界上下文与语音续接

文字输入中的近期原文与记忆参考合计最多 32,000 UTF-8 bytes，记忆块最多 6,000 bytes；重要事实优先。工具返回另设大小限制，SDK 工具循环也会裁剪较早历史、保留最新用户输入和成对工具结果。这是保守字节预算，不冒充供应商精确 token 计数。

语音会话累计约 40,000 bytes 的文字／工具上下文后，等待音频真正播放完毕，再保存摘要并续接新会话。新会话仅加载摘要与近期问答，不重放音频、工具或历史确认。用户在整理期间开始新一轮时，续接推迟到新一轮安全边界。既有短期票据续期和连接恢复继续保留。

“持续对话”指同一应用会话可跨多次有限模型上下文继续，不是模型拥有无限上下文，也不保证逐字无损记忆、网络或供应商永不失败。完整档案会随使用增长，存储空间仍有限。

### 查看、删除与配置

主页菜单 → 对话记录 → 对话记忆，可以查看摘要、重要事实和未解决事项。删除对话记录时，摘要随会话级联删除，在途任务不能复活已清空记忆；正式目标和进度保留。

`BLUEPRINT_COMPANION_MEMORY_ENABLED=false` 可停止新的后台摘要。达到阈值后的摘要复用 `DEEPSEEK_API_KEY`，会增加模型调用用量，不新增订阅或 embedding 服务。本轮自动验收使用固定摘要器，没有新增真实供应商请求。

新迁移为 `20261025120000_companion_memory.sql`，只能新增，不能修改已应用迁移。云端部署需要另行应用迁移；当前没有发布 Supabase 或 Vercel。

## 主流组件比较与选择

本次通过 Exa 检索了 15 条候选结果，并阅读下列官方资料；搜索结果数量不代表独立项目数量。

| 组件 | 官方能力 | 与本项目的取舍 |
| --- | --- | --- |
| [Mem0](https://docs.mem0.ai/open-source/overview) | 用户事实抽取与检索，可自托管，LLM、embedding、向量库可配置 | 适合后续跨会话语义记忆；需要另外配置检索和 embedding，单独接入仍不能管理火山的实时会话上下文 |
| [Mastra Observational Memory](https://mastra.ai/docs/memory/observational-memory) | Observer／Reflector 分层整理对话，支持持久化存储 | 与需求最接近的 TypeScript 方案；需要兼容的存储适配器，现有 PGlite 数据契约不能直接当作 Mastra MemoryStorage |
| [LangGraph／LangChain](https://docs.langchain.com/oss/javascript/langchain/short-term-memory) | 数据库 checkpoint、消息裁剪、摘要中间件 | 适合进一步引入持久工作流；当前已有运行器、审批和存储，新增第二套 Agent 状态机的收益不足 |
| [Letta](https://docs.letta.com/guides/agents/memory/) | 可编辑记忆块、持久消息、上下文压缩和历史检索 | 适合以 stateful agent 为整体运行时；对当前文字／原生语音双链路改造较大 |

[Mastra 的 withMastra](https://mastra.ai/reference/ai-sdk/with-mastra) 能包装 AI SDK 模型，不一定要替换完整 Agent；仍需验证模型接口版本和存储适配，且不直接覆盖原生语音会话。本轮先复用现有 SDK 和数据库，实现共享压缩层，保留未来接入专用语义检索组件的可能性。

下一阶段优先评估真实多轮中的摘要遗漏、事实纠正和召回质量。跨会话用户档案、语义向量检索、记忆逐条编辑和自动遗忘尚未实现，不应把当前会话摘要称作完整的通用记忆平台。

## 验证边界

本地测试覆盖真实 PGlite 迁移、账号隔离、同时间戳游标、并发修订、删除竞态、磁盘重启，以及固定摘要器的千条记录数据流。它们不证明真实摘要模型质量或物理麦克风体验。实际本轮检查结果以交付记录为准。

相关实现：`apps/web/src/lib/companion/memory.ts`、`memory-model.ts`、`context-budget.ts`，HTTP 路由及 `apps/voice-gateway/src/server.ts`。
