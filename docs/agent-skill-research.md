# Blueprint Agent Skills 公开资料研究

> 研究日期：2026-08-26<br>
> 研究范围：目标澄清、路径规划、学习资源匹配、复盘调整四个服务端 Agent Skills<br>
> 来源原则：优先使用开放规范、官方仓库、官方平台文档、原始论文和政府/研究机构资料；不把营销文章或未经验证的 Skill 市场条目作为设计依据。

## 结论

没有发现一套来自可信官方来源、可以直接用于 Blueprint 的“通用个人目标规划”Agent Skill。现有官方资料更适合作为三类积木：

1. 使用 [Agent Skills 开放规范](https://agentskills.io/specification)组织可版本化的说明、引用资料、脚本和评测材料。
2. 使用目标设定、自我调节学习、刻意练习和复盘研究定义四个 Skill 的行为原则。
3. 使用结构化工作流、Schema 校验、真实工具结果和离线评测保证运行可靠性。

因此，建议自行构建四个 Blueprint 专用 Skill，而不是安装一个第三方“目标规划 Skill”后直接上线。公开 Skill 可以借鉴工作流和目录组织，但其中的提示词、术语、默认假设和许可证都需要单独审核。

这四个 Skill 应当组成受代码控制的阶段管线：

```text
用户意图
  → 目标澄清 Skill
  → 用户确认 Goal Brief
  → 路径规划 Skill
  → 用户确认路径提案
  → 学习资源匹配 Skill（异步、仅处理需要资源的节点）
  → 学习与证据记录
  → 复盘调整 Skill
  → 用户确认调整提案
```

这里的“通用”应解释为：核心数据结构和工作流不绑定编程、语言或考证等单一领域。它不应解释为：未经跨领域评测，就宣称 Agent 对所有人生目标都同样可靠。

## 一、Agent Skill 的公开规范与可借鉴实现

### 1. Agent Skills 开放规范

[Agent Skills Specification](https://agentskills.io/specification)规定，一个 Skill 至少包含 `SKILL.md`，还可以包含 `scripts/`、`references/` 和 `assets/`。规范使用渐进式披露：启动时只暴露名称和描述，触发后才加载正文，需要时再加载引用资料。

可复用内容：

- 用短小、可组合的 Skill 承载一类稳定工作流。
- 将详细理论、领域知识和平台政策放入 `references/`，避免每次调用都消耗上下文。
- 将 Schema 校验、候选过滤、视频状态检查等确定性工作放入服务端代码或 `scripts/`，不要写成仅靠模型遵守的文字要求。
- 为每个 Skill 定义明确的触发条件、前置状态、输出形态、停止条件和异常出口。

不可照搬部分：

- 规范描述的是可移植内容包，不是 Blueprint 的运行时状态机、权限模型或事务系统。
- `allowed-tools` 仍属于实验字段，不能替代服务端真实的工具白名单和权限控制。
- 文件式 Skill 不能单独保证用户确认、版本冲突检查、幂等写入或费用上限。

与 Blueprint 的对应关系：四个 Skill 可以采用相同的包结构，但阶段切换、数据读取和正式写入必须由应用代码控制。

### 2. 官方 Skill 创建与评测资料

[OpenAI 的 `skill-creator`](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md)强调按任务脆弱程度调整约束强度：开放判断使用说明文字，重复且容易出错的任务使用确定性脚本；同时建议通过真实示例识别需要复用的资料、脚本和资产。

[Anthropic 的 `skill-creator`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)强调先澄清边界、输入输出、成功标准和边缘案例，再写 Skill，并为可验证结果准备测试案例。

[Agent Skills 的编写实践](https://agentskills.io/skill-creation/best-practices)和[输出质量评测指南](https://agentskills.io/skill-creation/evaluating-skills)进一步建议：

- 一个 Skill 应是可组合的完整工作单元，不能过窄，也不能成为万能说明书。
- 提供清晰默认路径和必要逃生口，不要给 Agent 一长串等价选项。
- 用真实用户提示、明确预期、可验证断言、执行轨迹和人工复核反复改进 Skill。
- 对同一案例重复运行，并比较“有 Skill”和“无 Skill”的表现；只证明格式合规，不足以证明 Skill 有价值。

可复用内容：用这些官方元 Skill 设计 Blueprint Skill 的目录、触发描述、引用分层、案例和回归评测。

不可照搬部分：这些资料主要面向 Codex、Claude Code 等通用代理。Blueprint 的终端用户不会选择文件或执行脚本，产品必须把内部 Skill 阶段翻译成自然的用户流程。

### 3. 经过筛选的公开领域 Skill

下面这些 Skill 适合阅读和拆解，但没有一个满足 Blueprint 的完整产品边界。对非官方仓库，只应借鉴工作流思想并回到原始研究重新撰写，不能默认复制提示词。

| 公开 Skill | 可复用内容 | 不可照搬部分 | Blueprint 对应 |
| --- | --- | --- | --- |
| Cursor 官方 [`create-learning-path`](https://github.com/cursor/plugins/blob/main/teaching/skills/create-learning-path/SKILL.md) | “评估基线→排序→里程碑→练习→复盘”的极简骨架；强调少量高优先级资源 | 只有几十行，没有澄清完成门槛、证据模型、失败恢复、结构化输出和评测 | 路径规划 Skill 的最小流程参考 |
| [`goal-setting-protocol-designer`](https://github.com/GarethManning/education-agent-skills/blob/main/skills/self-regulated-learning/goal-setting-protocol-designer/SKILL.md) | 过程目标优先、近期目标、适当挑战、监测点、弱/强目标对照 | 面向教师和课堂；部分结论仍需回查论文；不能直接迁移教师脚本 | 目标澄清、成功标准和检查点设计 |
| [`learning-progression-builder`](https://github.com/GarethManning/education-agent-skills/blob/main/skills/curriculum-assessment/learning-progression-builder/SKILL.md) | 前置依赖、可观察阶段、卡点和诊断任务；把学习路径视为可修订假设 | 不能让模型凭空断言某领域的唯一正确顺序或实证发展轨迹 | 路径依赖图、检查点和动态调整 |
| [`implementation-intention-designer`](https://github.com/GarethManning/education-agent-skills/blob/main/skills/wellbeing-motivation-agency/implementation-intention-designer/SKILL.md) | 将近期节点变成明确情境触发的 if–then 行动，包含障碍应对和监测 | 面向学生；不能只关注内部障碍，Blueprint 还要记录时间、资源、网络等外部约束 | 近期行动节点设计 |
| [`deliberate-practice-plan`](https://github.com/mohitagw15856/pm-claude-skills/blob/main/skills/deliberate-practice-plan/SKILL.md) | 子技能拆解、弱项练习、反馈和调整，避免无目标重复 | 不能把任何学习活动都称为刻意练习；很多领域缺少成熟训练法或专家反馈 | 实践节点设计 |
| [`reflective-practice-prompt-generator`](https://github.com/GarethManning/education-agent-skills/blob/main/skills/professional-learning/reflective-practice-prompt-generator/SKILL.md) | 从事实描述进入原因分析、假设检查和下一次行动 | 教师专业发展场景不能原样迁移；不能把复盘变成心理咨询 | 复盘调整 Skill |

GarethManning 的 Education Agent Skills 仓库把研究来源、输入输出、已知限制和自检集中在一份 Skill 中，组织方式值得参考；但仓库采用 [CC BY-SA 4.0](https://github.com/GarethManning/education-agent-skills/blob/main/LICENSE)。直接改编其文字可能带来署名和相同方式共享义务。Blueprint 更稳妥的做法是只把它当作资料线索，回到论文和官方规范，独立编写自己的 Skill。

### 4. 结构化工作流，而非单个自由运行 Agent

[Vercel AI SDK 的 Agent 指南](https://ai-sdk.dev/docs/agents/overview)明确区分了自由 Agent 和结构化工作流：可预测、可重复的任务更适合由代码控制分支、错误处理和步骤；复杂开放问题才需要模型动态选择动作。[AI SDK `Output`](https://ai-sdk.dev/docs/reference/ai-sdk-core/output)支持使用 `Output.object()` 或 `Output.array()`进行 Schema 校验，[工作流模式](https://ai-sdk.dev/docs/agents/workflows)提供顺序、路由和 evaluator-optimizer 等组合方式。

Blueprint 应据此采用：

- 代码决定当前允许运行哪个 Skill、能读取哪些数据、能调用哪些工具。
- Skill 负责在受限阶段内对话、推理并生成结构化提案。
- Schema 只解决结构正确，不证明计划有效；还需要确定性规则和人工质量评测。
- 正式蓝图永远由用户确认动作写入，Skill 没有直接修改正式数据的权限。

## 二、四个 Blueprint Skill 的参考设计

### 1. 目标澄清 Skill

#### 目标

将方向明确但路径模糊的输入，转化为用户确认的 Goal Brief。它不应一上来生成路线图，也不应通过冗长问卷迫使用户一次填完所有字段。

#### 值得采用的公开方法

**动机式访谈的 OARS 对话技巧。** 美国 SAMHSA 的官方指南将 OARS 概括为开放式提问、肯定、反映式倾听和总结。这适合用于让用户陈述真实动机与限制，并通过总结请求确认。[SAMHSA TIP 35，第 3 章](https://store.samhsa.gov/sites/default/files/tip-35-pep19-02-01-003.pdf)

**目标自我一致性。** Sheldon 与 Elliot 的原始研究把目标与个人兴趣、核心价值的一致程度称为 self-concordance；其纵向研究发现，高自我一致性的目标与更持续的投入和更高的达成概率相关。[原始论文与摘要](https://pubmed.ncbi.nlm.nih.gov/10101878/)

**目标设定理论。** Locke 与 Latham 对 35 年研究的总结指出，目标的具体性、挑战性、接受程度、反馈和任务复杂度都会影响表现。[原始论文 DOI](https://doi.org/10.1037/0003-066X.57.9.705)

#### Blueprint 可复用内容

目标澄清 Skill 应通过自然对话逐步确认：

- 用户真正希望改变的结果及其原因。
- 当前起点和已有经验。
- 时间范围、每周可投入时间和现实约束。
- 用户认为成功时可观察到的证据。
- 目标与用户自身意愿、外部压力之间的关系。
- 用户愿意放弃或降低优先级的事项。
- 仍然未知、可能改变计划的关键信息。

Skill 的结束条件不是“字段填满”，而是：关键信息足以规划、未决风险已经显式列出，并且用户确认总结准确。确认前只保存澄清草稿，不创建正式目标路径。

#### 不应照搬

- OARS 来自咨询场景。Blueprint 可以借鉴对话技巧，但不能把自己描述成心理治疗、职业咨询或医疗服务，也不能诊断用户。
- 不能把 SMART 当成唯一质量标准。复杂技能目标往往需要先设“学习目标”，而不是一开始就承诺无法判断的表现结果。
- 不要固定逐题问完相同问卷；已由上下文明确的信息不应重复询问。

### 2. 路径规划 Skill

#### 目标

将已确认的 Goal Brief 转化为可审阅、可执行、能通过学习证据修订的路径提案。核心管线应保持领域无关，领域差异通过检索、引用资料和评测案例扩展。

#### 值得采用的公开方法

**具体且有挑战的目标与及时反馈。** Goal-setting theory 可以用于定义里程碑、成功证据和反馈周期，而不是只生成主题目录。[Locke 与 Latham](https://doi.org/10.1037/0003-066X.57.9.705)

**Implementation intentions。** Gollwitzer 提出的实施意图用“当情境 X 出现时，我执行行动 Y”连接环境线索和目标行为，适合把近期待办变成更容易启动的行动。[原始论文 DOI](https://doi.org/10.1037/0003-066X.54.7.493)

**刻意练习。** Ericsson、Krampe 与 Tesch-Römer 将刻意练习描述为以提升表现为目的、需要投入、包含反馈并反复改进的活动。它说明技能路径不能只有观看内容，还必须包含实践和反馈。[原始论文 DOI](https://doi.org/10.1037/0033-295X.100.3.363)

#### Blueprint 可复用内容

通用路径至少应表达四类节点：

- **学习**：建立完成后续实践所需的知识或示范。
- **实践**：产生作品、练习结果或现实行动。
- **检查点**：使用事先定义的证据判断是否达到阶段标准。
- **复盘**：根据事实决定继续、调整、暂停或终止路径。

每个节点应说明它为什么存在、依赖什么、预期投入、完成证据和下一步。近期待办可以附带实施意图；技能学习节点应优先包含有针对性的练习与反馈，而不是把“看完视频”写成掌握证明。

#### 保持通用性的正确方式

- 核心 Schema 不硬编码“前端开发”“数据分析”等领域名称。
- 核心 Skill 保存通用分解和质量检查规则。
- 需要特殊标准时，通过按需加载的领域参考资料或检索结果补充，而不是不断扩大主提示词。
- 评测集必须跨多个目标类型分层抽样。通用管线仍然需要知道自己在哪些领域表现差，不能用“通用”作为拒绝领域评测的理由。

#### 不应照搬

- 实施意图只适合近期、具体、可触发的行动，不适合给每个远期节点机械生成“如果—那么”。
- 刻意练习是技能获得方法，不适用于所有人生目标；行政办理、社交行动或一次性交付需要其他节点形式。
- 不应由一次模型调用同时完成澄清、路径生成、视频检索、字幕验证和正式写入。

### 3. 学习资源匹配 Skill

2026-09-10 内部实现进度见[受控资源匹配](agent-resource-matching.md)：版本化 Skill、候选与字幕引文限制、完整本地 HTTP 旅程已验证；云端运行、用户采用与真实模型质量仍待完成。

#### 目标

为已经确认且确实需要外部学习材料的节点，返回真实、可访问、与用户偏好匹配的候选资源。它是资源增强环节，不拥有修改路径结构的权限。

#### 可用的一手数据

[YouTube `search.list`](https://developers.google.com/youtube/v3/docs/search/list)支持关键词、语言相关性、字幕、时长、发布日期、可嵌入状态等搜索条件。[YouTube `videos` 资源](https://developers.google.com/youtube/v3/docs/videos)提供标题、描述、发布时间、时长、字幕标记、公开状态、可嵌入状态、观看数、点赞数和评论数等元信息。

[Supadata Transcript API](https://docs.supadata.ai/api-reference/endpoint/transcript/transcript)可以使用 `native` 模式只获取已有字幕，也可以返回字幕语言和时间片段。Blueprint 应先用 YouTube 元信息缩小候选，再对少数候选请求字幕，避免对所有搜索结果产生字幕费用。

#### 推荐的可信策略

1. 代码使用节点主题、用户语言、水平、时长偏好和地区生成受控搜索条件。
2. 先过滤已删除/非公开、不可播放、直播预告、不符合时长或语言要求的候选。
3. 按主题类型应用时效规则：软件版本教程强调新鲜度，数学基础或经典理论不应因发布时间较早自动降级。
4. 对少量候选验证字幕存在，并抽样检查字幕是否与主题一致。
5. Agent 只能在服务端返回的候选 ID 中选择，不能自行输出任意 URL。
6. 返回一个默认推荐和两个备选，并分别说明语言、难度、时长、时效和选择理由。
7. 保存检索时间和校验状态，在用户真正进入节点前按规则重新验证。

#### 关于“点赞、收藏和 KOC 推荐指数”的关键限制

- YouTube API 提供 `likeCount`，但公开的 `dislikeCount` 已受限。
- `favoriteCount` 自 2015 年起已弃用，API 值恒为 `0`，不能作为收藏指标。[YouTube `videos` 资源说明](https://developers.google.com/youtube/v3/docs/videos)
- Blueprint 可以维护自己的“用户收藏数”“用户选择率”或人工 KOC 推荐记录，但必须明确这些是 Blueprint 数据，而不是 YouTube 指标。
- YouTube 的一般开发者政策禁止用 API 数据创建或替代新的衍生指标，并特别举例限制基于点赞、观看数等计算自定义分数。[YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)、[政策解释](https://developers.google.com/youtube/terms/developer-policies-guide)
- YouTube 另有面向分析用例的衍生指标修订条款，但需要接受额外条款并保持来源披露。[Derived Metrics Policy](https://developers.google.com/youtube/terms/derived-metrics-policy) Blueprint 是学习推荐产品，不应默认假设自己符合该分析用例。

因此，首版不应公开展示一个混合“视频质量分”或“KOC 指数”。更稳妥的实现是维护一份可解释的推荐决策记录：原始 YouTube 字段保持原义，Blueprint 自有信号明确标注来源，Agent 给出文字理由。若未来确实需要混合分数，应先完成 YouTube API 合规审计。

#### 不应照搬

- 搜索相关性、观看量和点赞量都不能单独证明教学质量。
- 有字幕标记不等于字幕准确或覆盖完整。
- 发布时间越新不一定越好；时效性必须与节点主题相关。
- Supadata 是供应商能力和成本边界，不能成为唯一事实来源；服务应保留失败、降级和更换供应商的能力。

### 4. 复盘调整 Skill

#### 目标

基于用户确认的学习与行动证据，帮助用户理解偏差并生成最小必要的路径调整提案。它不能根据观看时长自动声称用户已经掌握，也不能为了让数据好看而奖励无意义打卡。

#### 值得采用的公开方法

**自我调节学习循环。** Zimmerman 将自我调节描述为前瞻、执行、自我反思的循环：先做任务分析与规划，执行时进行自我观察，之后进行自我评价并将结果反馈到下一轮。[原始综述 DOI](https://doi.org/10.1207/S15430421TIP4102_2)

**After Action Review。** 美国陆军的 AAR 使用四个核心问题：原计划是什么、实际发生了什么、为什么出现差异、下次如何改进。[U.S. Army 官方 AAR 标准示例](https://home.army.mil/irwin/application/files/1816/9455/6714/FY23_JUNE_2023_NTC_EXSOP_RELEASEABLE.pdf) Tannenbaum 与 Cerasoli 对 46 个样本的元分析发现，结构化 debrief 与表现改善相关，并强调目标、讨论内容与衡量层级之间的对齐。[原始元分析摘要](https://pubmed.ncbi.nlm.nih.gov/23516804/)

#### Blueprint 可复用内容

复盘 Skill 应围绕事实而不是情绪化评判：

- 原计划和成功证据是什么。
- 实际完成了什么，证据属于活动、理解、实践还是检查点。
- 哪些做法有效，哪些约束或假设与现实不符。
- 偏差来自时间估计、前置知识、资源质量、执行环境，还是目标本身不再重要。
- 下一轮应保持、调整、删除、拆小、延后或新增哪些节点。
- 用户愿意承诺的下一项具体行动是什么。

输出必须是对当前路径的可读差异提案，并保留用户选择“不修改”的能力。奖励应优先绑定实践证据、检查点和有内容的复盘，而不是登录次数、视频时长或状态数量。

#### 不应照搬

- AAR 来自军事训练，Blueprint 只能借鉴事实比较和改进结构，不能采用命令式、羞辱式或追责式语言。
- 复盘不是每次学习后的长问卷；简短学习记录与阶段复盘应分开。
- Agent 不能把一次失败归因为用户缺乏自律，也不能擅自降低目标或删除用户在意的方向。

## 三、推荐的 Skill 包边界

以下目录仅表达顶层职责，不是接口协议：

```text
skills/
  clarify-goal/
    SKILL.md
    references/
      conversation-principles.md
      goal-brief-rubric.md
    evals/
  plan-path/
    SKILL.md
    references/
      node-types.md
      planning-quality-rubric.md
      domain-guides/
    evals/
  match-learning-resources/
    SKILL.md
    references/
      youtube-policy.md
      freshness-rules.md
      ranking-rubric.md
    evals/
  review-and-adjust/
    SKILL.md
    references/
      evidence-levels.md
      review-rubric.md
    evals/
```

共同规则应由运行时强制，而不是在四份提示词中重复：

- 只读取当前阶段需要的数据。
- 所有输出通过版本化 Schema 验证。
- 所有外部资源来自工具返回结果。
- 所有正式目标变更需要用户确认。
- 写入时检查蓝图版本，防止旧提案覆盖新数据。
- 每次运行都有步数、超时、工具调用和费用上限。
- 用户原始目标、字幕和笔记默认不进入普通产品分析事件。

## 四、评测方法

### 1. 不用“一个总分”掩盖不同失败

四个 Skill 应分别评测。建议指标如下：

| Skill | 确定性检查 | 人工/模型评分重点 |
| --- | --- | --- |
| 目标澄清 | 必填信息、未决项、用户确认状态、未提前规划 | 问题是否必要、总结是否忠实、是否尊重用户意愿 |
| 路径规划 | Schema、稳定 ID、依赖无环、工作量边界、证据字段 | 相关性、顺序、可执行性、负担可行性、节点类型是否合理 |
| 资源匹配 | 视频真实可用、ID 来自搜索、语言/时长/字幕状态、无编造 URL | 内容相关性、难度匹配、推荐理由、候选差异性 |
| 复盘调整 | 只引用已有证据、生成差异提案、未自动写入 | 归因是否谨慎、调整是否最小必要、是否保留用户控制 |

### 2. 通用管线也需要领域分层

评测数据不应在代码中限制产品领域，但应主动覆盖不同问题结构，例如：

- 技能学习与作品产出。
- 职业转型与求职准备。
- 语言学习与表达练习。
- 健身、创作或个人项目等非纯视频目标。
- 信息不足、期限冲突、投入不足和目标互相冲突的困难案例。

每个案例应保留初始意图、模拟用户回答、期望满足的质量条件、禁止行为和人工评语。发现真实失败后，将脱敏案例补回回归集。

### 3. 组合评测方式

[Anthropic 的 Agent eval 指南](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)建议组合代码、模型和人工 grader，并区分任务、重复 trial、grader 和完整执行轨迹。[Langfuse 的评测概念](https://langfuse.com/docs/evaluation/core-concepts)支持固定数据集、实验运行、代码评估器、LLM judge 与人工评分。

Blueprint 应采用：

- 代码检查所有可以确定判断的结构、资源真实性和权限规则。
- 人工盲评路径是否可信、合理和有帮助。
- LLM judge 扩展主观评分规模，但先用人工样本校准，不能单独作为上线门槛。
- 对同一输入运行多次，记录通过率、失败类型、延迟、工具调用量和成本。
- 比较无 Skill、旧 Skill 和新 Skill，证明增加说明或步骤确实改善结果。
- 读取完整轨迹，区分提示问题、模型问题、工具问题和数据问题。

生产目标正文和学习记录不应默认上传到第三方评测平台。早期评测优先使用合成案例和经过用户授权、脱敏的失败案例；Langfuse 可以先记录模型版本、Skill 版本、耗时、费用、错误类别和评分等元数据。

## 五、对当前方案的具体决策建议

1. **保留四 Skill 拆分。** 目标澄清、路径规划、资源匹配和复盘调整拥有不同输入、风险、工具和质量标准，不应合并成万能规划 Agent。
2. **采用通用核心、领域参考和跨域评测。** 不在 Schema 中限制前端开发等领域，但必须用分层案例明确已验证边界。
3. **把 Skill 当作版本化行为包。** 运行状态、权限、确认、写入和预算仍由服务端代码控制。
4. **先确认路径，再异步匹配资源。** 视频不是所有节点的必需字段，资源失败不能阻止用户确认和使用路径。
5. **将 KOC 信号与 YouTube API 指标分开。** 首版使用可解释理由，不展示混合质量指数；未来需要混合分数时先走 YouTube 合规审计。
6. **先建设评测骨架再大量调提示词。** 每个 Skill 至少要有真实提示、预期结果、确定性断言、人工反馈和重复运行记录。
7. **复盘只依据可追溯证据。** 观看属于活动证据；实践产出、外部反馈和检查点才是更强的进展证据。

## 来源清单

### Agent 与 Skill

- [Agent Skills Specification](https://agentskills.io/specification)
- [Agent Skills authoring best practices](https://agentskills.io/skill-creation/best-practices)
- [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills)
- [OpenAI `skill-creator`](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md)
- [Anthropic `skill-creator`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Cursor `create-learning-path`](https://github.com/cursor/plugins/blob/main/teaching/skills/create-learning-path/SKILL.md)
- [Education Agent Skills](https://github.com/GarethManning/education-agent-skills)
- [`deliberate-practice-plan`](https://github.com/mohitagw15856/pm-claude-skills/blob/main/skills/deliberate-practice-plan/SKILL.md)
- [Vercel AI SDK Agents](https://ai-sdk.dev/docs/agents/overview)
- [Vercel AI SDK Output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output)
- [Anthropic：Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Langfuse Evaluation Core Concepts](https://langfuse.com/docs/evaluation/core-concepts)

### 目标、学习与复盘研究

- [Locke & Latham：Goal-setting theory](https://doi.org/10.1037/0003-066X.57.9.705)
- [Sheldon & Elliot：Self-concordance model](https://pubmed.ncbi.nlm.nih.gov/10101878/)
- [Gollwitzer：Implementation intentions](https://doi.org/10.1037/0003-066X.54.7.493)
- [Ericsson et al.：Deliberate practice](https://doi.org/10.1037/0033-295X.100.3.363)
- [Zimmerman：Becoming a Self-Regulated Learner](https://doi.org/10.1207/S15430421TIP4102_2)
- [Tannenbaum & Cerasoli：Debrief meta-analysis](https://pubmed.ncbi.nlm.nih.gov/23516804/)
- [SAMHSA TIP 35：Motivational Interviewing](https://store.samhsa.gov/sites/default/files/tip-35-pep19-02-01-003.pdf)

### 视频与字幕

- [YouTube `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube `videos` resource](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Derived Metrics Policy](https://developers.google.com/youtube/terms/derived-metrics-policy)
- [Supadata Transcript API](https://docs.supadata.ai/api-reference/endpoint/transcript/transcript)
