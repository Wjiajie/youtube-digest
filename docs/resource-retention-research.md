# P7 资源保留、刷新与删除研究

核对日期：2026-09-10。状态：**研究与建议，尚未实现，不构成法律意见或合规认证**。

2026-09-11 实现进展：[明确清除资源证据](resource-evidence-clearing.md)和[可信期限与到期恢复](resource-evidence-expiry.md)已形成本地整链清理切片，保留回执与用户历史，派生副本继承不可延长期限；下文保留研究时基线。未设置真实用户策略，长期维护调度、真实内容权限、刷新／下架、提供方与备份清除仍待完成，不能把该切片当作全部建议完成。

范围：官方公开资料 + 当前仓库只读检查（`5c6c884`）；没有查询线上数据库、调用内容 API、购买额度或删除数据。按照 research 技能追溯一手来源；Supabase 技能用于识别数据库副本与删除边界，本次不修改 schema。

## 结论

P7 不能只增加一个缓存 TTL。当前持久化链条会复制候选元数据与字幕，业务过期不会清除这些副本；必须同时解决**获取与使用权限、全部副本的内容期限、幂等回执和学习历史的分离**。建议保持真实资源执行现有默认关闭状态，先完成权利范围确认和本地生命周期设计，再开放真实字幕/匹配链路。

## 官方规则与不确定性

下面的“规则”是压缩转述；应以链接中的原文、适用地区协议和正式批准为准，不把指南示例当作额外授权。

### YouTube

- **规则**：非用户授权 API 数据只能有限、临时保存，最长 30 日后刷新或删除；公开统计不享有授权统计的长期例外。其他授权数据通常也须 30 日刷新/删除，特定授权统计例外须持续核验权限与删除情况。展示须反映最新数据。用户要求删除或注销，最迟 7 日处理；应用内撤权最迟 7 日，Google 设置页撤权相关条款给出最迟 30 日。禁止取得抓取数据、未经批准缓存影音，以及受限制的新派生数据/指标。[Developer Policies，III.D.2.c、III.E.1/4/6](https://developers.google.com/youtube/terms/developer-policies)
- **解释与边界**：公开不等于免保留期限；Blueprint 登录并非视频上传者授予的 YouTube OAuth 授权。后者的统计例外不能直接套用本项目 API key 检索。这是对当前请求方式和上述分类的应用判断，不是对全部公开视频权利的判断。
- **规则细化**：指南允许简单 API-only 算术和原始指标排序，不宜写成“所有计算都禁止”；对不明确用例，官方建议申请审计。[合规指南，指标章节](https://developers.google.com/youtube/terms/developer-policies-guide)
- **2026 例外**：额外派生指标政策针对获接受的 analytics 用例及相应条款；符合条件的部分统计/派生指标可保留至 36 个月，标题、作者名、描述、评论文本仍遵循 30 日规则。未找到 Blueprint 获批证据，不能自行适用。[Additional policies，Data Storage](https://developers.google.com/youtube/terms/derived-metrics-policy)、[2026 修订记录](https://developers.google.com/youtube/terms/revision-history)
- **字幕不是任意视频的公开下载接口**：官方 `captions.download` 要求 OAuth 授权及编辑视频的权限。因此“用户可以观看”不能推出“平台可用官方接口下载该字幕”。[Captions: download](https://developers.google.com/youtube/v3/docs/captions/download)
- **权利边界**：YouTube 服务条款限制未经服务许可或所需书面许可的复制、下载、修改等使用，也限制自动访问。没有从这些资料得到“摘录小于某字数就可商用/传入模型”的通用许可。[YouTube Terms，Permissions and Restrictions](https://www.youtube.com/static?template=terms)

### Supadata

- **规则**：供应商条款只给予调用 API 的有限许可；数据来自独立第三方的公开来源，原作者保留知识产权，平台条款与合法使用责任由调用者承担；转售、再许可或白标需事先书面同意。付费和可访问性不是内容授权证明。[Supadata Terms，§§3–6、10–12](https://supadata.ai/terms)
- **产品行为，不是版权许可**：`native` 仅取已有字幕，默认 `auto` 可回退 AI 生成；作业完成后结果可读取 1 小时，随后可能 404。这是供应商作业可用期，**不是本应用字幕缓存的许可期限，也不能据此认定视频被删除**。[Transcript，Mode / Polling Guidelines](https://docs.supadata.ai/get-transcript)
- **未知**：本次查到的 Terms、Transcript 文档未给出下游字幕缓存天数、逐视频授权链、向第三方模型传输/生成衍生文本的明确许可，亦未证明供应商取数方式已获 YouTube 批准。其隐私页提供供应商账号删除，但没有足以推导 Blueprint 用户字幕、作业、日志和备份删除 SLA 的说明。[Supadata Terms](https://supadata.ai/terms)、[Privacy Policy](https://supadata.ai/privacy)

**判断**：标题/描述送入模型、字幕匹配、短引文、摘要与“可信度/KOC 综合分”需要分别确认。当前不使用点赞统计做模型评分，并不能自动解除标题/描述与字幕的使用风险。简单标注“非 YouTube 评分”也不能替代许可。此处是发布风险识别，不宣称所有个性化推荐都被禁止，也不宣称取得供应商同意即可覆盖 YouTube 与创作者权利。

## 当前保存副本：只读代码证据

| 位置 | 实际内容与复制路径 | P7 必须覆盖的边界 |
| --- | --- | --- |
| `resource_runs.result` | discover/captions 成功保存候选视频元数据、统计、完整返回字幕片段或 pending job ID；match 保存评价、引文和时间戳 | 不只清理成功记录；失败/取消记录的输入仍可能有正文 |
| `resource_runs.input_discovery` | 每个 captions/match 子运行复制父结果；连续显式 captions 可再复制 | 子运行的创建时间不能重置原数据的许可期限 |
| `resource_runs.input_blueprint`、preferences、learner_context | 保存当时整份正式路径、绑定 ID/URL 与用户目标上下文 | 用户数据删除需覆盖输入，不只是供应商结果 |
| `private.resource_leases` | lease ID、completion digest；与运行绑定 | digest 不等于正文；保留最小幂等账本的期限需单独决定 |
| `resource_adoptions.result` | fresh verification 的视频 ID、标题、频道名、发布日期、时长；`valid_until` 为 10 分钟 | 10 分钟是确认资格，不是内容删除 TTL |
| adoption draft → `blueprint_proposals.proposed_snapshot` / `blueprint_revisions.snapshot` | 整份目标路径；新资源只写稳定 ID、kind、视频 ID、规范 URL，**不写视频标题、统计或字幕** | 所有旧提案、revision、后续规划输入都会携带绑定引用 |
| `resource_bindings`、`learning_sessions` | 正式/已归档绑定与会话 FK；替换采用归档而非物理删除 | 不可通过清理资源运行顺手破坏用户实践记录和历史关联 |
| Web review / 模型请求 | Web 投影不传完整字幕，但传标题/频道/评价/引文；模型取标题、描述和每候选最多 24 段、每段最多 320 字符的字幕样本；当前模型 schema 排除统计 | 短摘录仍是内容副本；模型供应商、浏览器页面内存等不能从数据库清理中漏掉 |
| 扩展与运维副本 | 扩展 `blueprint_cache:<owner>` 保存含绑定的路径；本次所读写入没有内容年龄字段；上游请求 `no-store` | HTTP no-store 不证明数据库/平台日志/备份/模型侧零留存；这些配置未核验 |

代码入口：[resource runs migration](../supabase/migrations/20260910095541_resource_runs.sql)、[adoption migration](../supabase/migrations/20260910113909_resource_adoption.sql)、[当前正式写入器](../supabase/migrations/20260910122339_resource_order.sql)、[基础实体与 FK](../supabase/migrations/202608260001_m1_cloud_slice.sql)、[持久化候选契约](../apps/web/src/lib/resources/evidence.ts)、[模型输入](../apps/web/src/lib/agent/resource-matcher.ts)、[模型输出](../apps/web/src/lib/agent/resource-match-contract.ts)、[Web 投影](../apps/web/src/lib/agent/resource-workspace.ts)、[扩展缓存](../apps/extension/entrypoints/background.ts)。

关键现状：`expire_resource_runs` 的 120 秒只收敛排队/执行状态，蓝图变化只标 stale；未在本次检查的资源链实现中发现按内容年龄删除/刷新已完成正文的流程。数据库有 owner cascade，并不证明注销 UI、跨系统擦除、备份到期和完整级联事务已验收。删除父 run 会级联子 run/adoption/lease，但不会反向自动删除 adoption 所引用的 proposal；revision 还对 proposal 有 RESTRICT，必须明确规划，不能靠盲目 cascade。

## 建议的实现路径（均未执行）

### 1. 先做权利闸门，不用 TTL 代替授权

保留 fixtures 与默认关闭开关。向 Supadata 索取字幕来源与平台批准证据、允许的持久化/引文/模型处理范围、再展示与白标界限、作业和副本删除办法；向 YouTube/合规审查提交真实产品流程，特别说明教育适配推荐与 analytics 用例的区别。取得可追溯结论前，不为真实字幕设一个看似合规的“默认 30 天”。创作者单独授权也需核对获取途径的平台约束。

### 2. 分离可删除内容与最小业务回执

为供应商内容建立统一来源时间、权利状态、刷新时间、最晚删除时间；派生副本继承来源期限，不能靠复制或仅更新 checkedAt 续命。运行回执、单次执行/子节点唯一性和消费额度保持独立；正文清除后返回“依据已到期”，不能变成空白成功结果、不能因删行重用 run ID 再次收费。

当前读取契约要求非 discover 的输入依据，以及 ready/stale 的成功结果；实施时需显式引入到期占位状态并同步读取/展示契约，不能直接把 JSON 清空为 null 后仍声称旧成功回执有效。[当前运行解析](../apps/web/src/lib/agent/resource-run.ts)

建议公开 API 元数据采用更早的内部期限，例如第 25 日到期前刷新/清除，30 日仅为政策上限；该 25 日是工程缓冲建议而非官方要求。刷新要真实读取来源、替换旧副本，不保留未经例外允许的旧统计快照。默认只刷新正在使用的引用，废弃检索结果直接到期清除，避免给全历史无期限刷新。

字幕与包含字幕的模型输出必须采用已确认许可中的期限；在未知状态不启用真实获取。获许可后再决定最短恢复窗口；将原文、引文、摘要、向量（若未来添加）、提示日志与评测样本纳入同一来源清理图。不得为了保存调试历史而长期保留正文。

### 3. 处理下架、未知和用户删除

对确认删除/不可公开访问的视频，停止展示缓存内容及继续采用，失效未确认提案，并清理相关供应商正文；界面保留不含第三方正文的“资源不可用”业务记录。不要把网络故障、配额错误或过期 Supadata job 的 404 自动解释为视频删除；未能刷新到硬期限仍须停止使用/清除过期内容，展示未知而不是沿用旧推荐。

绑定仅有 URL/ID 不意味着当然可以永久保留 API 取得的 ID；应记录来源是用户主动提供还是 API 发现，给活跃引用做可用性核验，历史引用的最小保留范围纳入审查。尽量保留用户自己写的目标/实践记录而不是视频正文；用户注销则另走完整账号删除，不把用户内容永久豁免。

用户删除请求的产品目标设为立即撤销访问、尽快清除、最迟 7 日完成受约束用户数据处理；纳入扩展缓存、服务端、处理商、日志与备份。备份是风险待办，不宣称“等待自然过期”就一定满足要求；验收其最大期限、恢复后的再删除机制及处理商承诺后才发布 SLA。

### 4. 本地验收门槛

- fake clock 验证原始来源到期、连续 captions/match 复制、刷新失败、已下架、作业过期与账户删除；不调用真实付费供应商。
- 清除覆盖所有正文副本，过期 UI 不泄漏标题/字幕/引文；从备份恢复测试不能复活已删除内容。
- 到期与 claim/finish/apply 并发仍不重复调用、退错额度或采用已过期依据；最小回执不能恢复已清除正文。
- 学习会话与历史绑定不因内容清理损坏；账号整体删除、归档和资源下架是三种不同操作。
- 授权边界、期限、处理商删除证据与用户文案有人负责；无正文的运维指标可监控 overdue 数、清理失败数、任务耗时，不能把正文复制进告警。

## 待决策与资料日期

发布前待确认：实际经营主体适用的地区协议；教育匹配是否需要额外审计/批准；Supadata 取数/转授权链；DeepSeek 等模型服务的留存、训练用途与删除条件；API 来源 ID 的历史保留；日志/备份/离线扩展的可验证删除期限。本研究没有核查后两类供应商配置，不能作为其合规证据。

官方页面显示的更新时间：Developer Policies **2026-06-24**；合规指南 **2026-05-04**；派生指标政策 **2026-06-01**；修订历史 **2026-09-03**；`captions.download` **2026-09-04**；[API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service) **2026-04-28**。同时核对了 [APAC 版本入口](https://developers.google.com/youtube/terms/api-services-terms-of-service-apac)，不根据中文用户群自动认定适用法律。Supadata Terms/Privacy/Transcript 所读页面未显示明确修订日期；以本次核对日期标记，不能把页脚年份当版本日期。Supabase changelog 公共读取失败；因未实现 Supabase 功能，不据此推断平台现有备份/删除能力。

本批仅形成此研究文档；不代表任何清理机制已上线，也不授权实施数据删除。

## 文档验收

源码／文档固定点 `5c6c884`，研究提交 `cf436f8`。主线程复核主要官方条款与当前保存路径，175 个本地文档链接有效。两位非作者分别复核七个文件：Standards 轴 0 项确认的规范、事实或安全问题，Spec 轴 0 项确认遗漏、范围扩张或错误。规范复核另核对全部本地链接及官方页面日期，需求复核抽查副本与外键方向。

本批没有应用代码或数据库变更，因此未重跑未变更的运行时测试。以上仅是文档与源码证据验收，不是法律批准、供应商授权证明、托管设置核验或删除执行证据。
