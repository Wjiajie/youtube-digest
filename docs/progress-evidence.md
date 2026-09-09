# 私人成果记录：P4 数据与双端成长档案

更新：2026-09-10。数据切片源码提交 `4354d4f`，Web 界面 `cfe4e59`／恢复修复 `ccc14e9`，扩展 `b9b954a`／错误恢复修复 `c0bcf45`。**成果迁移及 Web/API 已托管发布，数据库角色检查和线上匿名冒烟通过；真实登录后的托管双端成果旅程仍待验收。** 扩展源码通过独立 MV3 浏览器及外部 HTTP 夹具验证，本批未重载用户安装版。本文是实现证据，不替代[执行路线](execution-roadmap.md)的阶段状态。

## 已实现的行为

- 学习、实践、检查点、复盘四类路径节点均可记录成果，不要求视频或学习会话。
- 当前输入为私人文字（最多 8,000 UTF-16 单元）与可选 HTTPS 作品链接（最多 2,048 单元）。不上传附件、不公开发布、不发奖励，也不推断掌握或完成。
- 数据库独立保存成果，不修改 BlueprintSnapshot、蓝图版本或修订。提交时的蓝图版本、目标／阶段／节点 ID、名称和节点类别由服务器固定；后来改名、移动或归档不会重写历史。
- 新记录要求当前蓝图版本及有效节点；与提案确认锁定同一蓝图行，避免读取混合版本。相同账号、相同提交 ID、相同内容重试返回原记录，即使路径后来变化；同 ID 改内容会被拒绝。
- Web 使用绑定当前页面账号的 Server Action；扩展写入 API 只接受已验证的配置 OAuth 客户端。读取入口返回当前账号最新 50 条记录，按创建时间及 ID 倒序；不是完整历史或导出接口。
- 成功和失败 HTTP 响应均禁止缓存。错误只返回受控代码，正文与作品链接不进入 Product Event 或普通错误日志。

## 权限与存储边界

`progress_evidence` 开启 RLS，认证用户只有自己的记录读取权限。客户端没有直接 INSERT／UPDATE／DELETE 授权，不能伪造归属、时间或历史名称。匿名角色没有表读取与函数执行权。

公开 RPC 为 SECURITY INVOKER；必须绕过表直写限制的窄操作位于 `private`，空 search_path，显式验证账号、精确扩展白名单和节点归属。旧 `is_extension_client` 只用于把所有 OAuth 客户端排除在 Web 专属操作之外，**不是**可信扩展白名单；成果记录使用独立的精确授权判断，缺少配置也拒绝 OAuth 读写。授权不依赖 user_metadata。

历史上下文 ID 不作为实时外键；保留提交时含义，不强制跟随最新路径。记录归属于 Auth 用户，完整删除账号时随之删除。本切片尚未提供用户删除／编辑成果的界面或操作，不能据此宣称这些隐私控制已交付。

作品链接不会被服务器抓取或验证可信度、可达性及外站隐私。应用输入验证 URL 格式；数据库进一步约束 HTTPS、安全字符和无内嵌凭据，但不提供完整浏览器 URL 解析。读取历史值不重新应用当前表单限制或裁剪正文（PostgreSQL 字符计数也不同于 UTF-16）。双端共享界面先验证链接再生成带 `noopener noreferrer` 和无 referrer 的锚点，无效链接显示原文，不能令整页记录不可读。外站页面可能公开，不受 Blueprint 私人存储权限保护。

## Web 成长档案

- 首页进入独立 `/progress`，避免把成果和提案编辑混在一起。四类正式节点均可选择，表单与近期记录共用账号主题：赛博网格／切角和东方纸面／圆印表达不同，业务语义一致。
- 草稿按账号与蓝图隔离，使用有版本的本机缓存，仅用于短期恢复，不是云端事实来源、跨设备备份或加密存储。损坏缓存保留原文供复制，用户明确确认后才清除；读取异常时不创建可覆盖原文的空稿，明确重读成功后才恢复编辑；写入失败保留页内文字并提示。
- 保存前必须成功持久化精确提交内容与 ID，失败则明确“尚未发送”并阻止请求。断网或回执不明时禁止改写原提交，通过“确认原提交结果”重试；不因重载创建新记录。确认成功后才清空正文；编辑新文字立即移除旧的成功提示。
- 路径版本冲突保留草稿，重读后由用户明确确认新版本；归档节点保留旧名称供识别，必须选有效节点再提交。账号变化或权限失效隐藏私人内容，不把旧草稿发给新账号。
- 同一草稿使用 Web Locks 独占编辑：其他标签页可查看、复制，原标签关闭后可主动重试接手，不抢占锁。不支持锁的环境降为只读并说明原因；依赖支持 Web Locks 的安全上下文浏览器。参见 [LockManager.request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request)。
- 显示最近 50 条服务器记录与提交时路径；历史加载失败不伪装为空，重读失败不清除已有内容。不按记录数推断目标完成或技能掌握。

## 代码与迁移

- [共享领域](../packages/domain/src/progress-evidence.ts)：输入与历史记录的数据边界。
- [应用服务](../apps/web/src/lib/progress-evidence.ts)、[Web Action](../apps/web/src/app/progress-evidence-actions.ts)、[HTTP 入口](../apps/web/src/app/api/v1/progress-evidence/route.ts)。
- [成长档案页面](../apps/web/src/app/progress/page.tsx)、[共享表单与历史](../packages/ui/src/evidence-journal.tsx)：公开的账号／初始工作区／保存／重读边界；Web 和扩展使用同一份恢复实现。
- [扩展成果面板](../apps/extension/entrypoints/sidepanel/EvidencePanel.tsx)、[扩展传输](../apps/extension/src/evidence.ts)：按需读取、账号绑定与受控错误分类，不将私人正文放入普通事件。
- [增量迁移](../supabase/migrations/20260909190946_private_progress_evidence.sql)。先在本地通过 DDL 迭代，再运行 Advisor 和 CLI `db pull --local`；对生成文件恢复明确 REVOKE／GRANT，并按依赖排序，避免保留 `check_function_bodies=off`。未重置数据库，既有账号升级契约通过。

技术边界依据 [Supabase 数据库函数](https://supabase.com/docs/guides/database/functions)和 [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。已扫描当前变更摘要；本批不升级数据库、Auth 或 SDK，不修改邮件、Realtime 或日志服务配置。

## 验证证据

### 数据切片（前批，`4354d4f`）

- 27 项新 HTTP／Action 测试：使用真实身份适配器与 Supabase SDK，只有外部提供方传输采用夹具，覆盖双端读写、账号切换、非法输入、错误分类和历史数据读取；总计 176 项测试与完整 `check:m1` 通过。
- 31 项新真实 PostgreSQL／pgTAP 测试；五个文件共 115 项通过，覆盖四类节点、无视频、归档后重试、幂等、版本冲突、跨账号、未知／缺配置 OAuth、匿名、直接写表和输入限制。
- 本地 Security／Performance Advisor 在修正精确授权判断后无 WARN／ERROR；迁移列表五条与本地应用历史对应。
- [升级契约](../scripts/test-m1-migration.mjs)从已有账号应用全部迁移，验证成果写入、重试及匿名 ACL，不重新创建原账号。
- [本地真实 API 检查](../scripts/test-progress-evidence-local.mjs)通过真实 SDK／PostgREST 同时提交两次，获得同一记录 ID；第二账号读取为空。只创建当次随机 ID 的临时账号，finally 清理两名账号及其测试数据，原本地账号未动。运行方式：`bash scripts/with-m1-runtime.sh node scripts/test-progress-evidence-local.mjs`；CLI 不在 PATH 时通过 `BLUEPRINT_SUPABASE_BIN` 指定已安装二进制。
- 16 项生产模式 E2E 通过（7.4 秒），覆盖现有登录／恢复、偏好匿名读取与内部设计页门禁；不是尚未接入的成果 UI 验收。
- 固定点 `027d70f` → `4354d4f` 的独立复核：Standards 0 项确认发现；Spec 0 项确认发现，无阻断。两路只读审阅源码、测试与文档，实际运行验证由主任务完成。

### Web 界面（本批，固定点 `d59d7db`）

- 16 项公开 React 行为测试，覆盖草稿／主题／焦点保留、切账号、重复提交、回执丢失、版本及归档冲突、损坏缓存、存储失败、安全外链、历史失败、多标签与 StrictMode 锁释放；包括提交缓存配额失败零发送、瞬时读取异常恢复原稿两项 red→green 回归；另增账号绑定工作区 Action 测试。
- 完整 `check:m1` 通过：193 项测试、类型检查、既有账号迁移升级契约、向导守卫、Next 生产构建与云配置 WXT 构建／密钥检查（473.60 kB）。本批没有改迁移；上批 115 项 pgTAP 为历史证据，未重新运行。
- 20 项常规生产 E2E 通过（6.9 秒），包含成长档案匿名登录回跳及 API 读写拒绝。
- [独立本地完整流程](../apps/web/journal-e2e/journal.spec.mts)通过：真实 Supabase Auth、正式节点、生产 Next 页面、Server Action、数据库保存、整页重载、离线回执恢复、双主题、320px 无横向溢出、多标签接手；无页面未捕获异常。生成两主题桌面与窄屏截图并检查视觉状态。
- 运行方式：指定已安装 CLI 的 `BLUEPRINT_SUPABASE_BIN`，执行 `bash scripts/with-m1-runtime.sh npx --no-install playwright test --config playwright.journal.config.ts`。测试只接受本地 `127.0.0.1:54321`，管理凭据不进入浏览器或 Next 环境；随机临时账号及级联记录已清理，原账号未动。不发邮件，不接管用户浏览器，不部署、不 push、不产生费用。
- 独立审阅以 `d59d7db` 为固定点：Standards 原提交 2 项 P2，Spec 原提交 2 项 P2（两轴分别报告，同为上述存储边界问题）；修复与测试经两路只读复核后，均无剩余确认缺陷。未发现范围扩张或值得整改的判断性坏味道；运行证据由主任务执行。

## 后续门槛

真实账号双端验收、完整历史和编辑／删除控制仍待实现／验证。当前不接入旧扩展 outbox，以免失败记录被丢弃。托管发布不等于已验收的双端成果闭环，也不代表其余 P4 领域增量完成。

## 扩展接入（固定点 `ccc14e9`）

- “记录学习收获”按需打开共享表单与近期历史，不要求先开始学习会话；四类正式节点均可选。用户先核对关联节点，视频改变不会静默移动原稿。收起面板不卸载编辑状态，重新打开不重复初始读取。
- Web Action 与扩展消息是两个真实适配器，共享领域中的成果工作区和 UI 包中的恢复逻辑。样式共享语义 Token，扩展固定单栏、紧凑间距，两主题不改变记录含义。
- `LOAD_EVIDENCE`／`SAVE_EVIDENCE` 必须携带页面账号，后台使用当前扩展 Token 并在响应解析后再次检查会话。请求不携带 Web Cookie，不缓存；只将匹配的应用错误视为确定拒绝，网关错误、超时、错误回执仍视为未知结果。旧账号的延迟响应不返回私人记录。
- 恢复缓存仅保存在扩展自身 origin 的 localStorage，不在 YouTube 页面、后台 service worker 或旧 outbox 中。Web 与扩展的未提交草稿互不共享；已保存记录由云端同步。扩展 Web Storage 跨同源扩展页共享，且与 service worker 的可用 API 不同，见 [Chrome 存储说明](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。不增加 unlimitedStorage 等权限，缓存不承诺永久保留或加密。
- 本批新增 5 项真实后台消息／Auth／HTTP 边界测试和 1 项真实 App 开合测试；保留共享模块 16 项恢复测试。完整 `check:m1` 通过：199 项测试、类型检查、既有账号升级、向导、Web 构建及扩展安全检查，扩展产物 560.56 kB；常规生产页面 E2E 20 项通过（8.8 秒）。
- [MV3 浏览器验证](../apps/extension/e2e/evidence.spec.ts)使用真实构建产物、真实 Chrome 消息／存储／Web Locks；外部 HTTP 为明确夹具且禁止真实网络回退。回执丢失后重载原提交仅形成一条记录，双主题 320px 无横向溢出、原稿保留，切账号隐藏旧数据并能恢复原账号草稿；无未捕获页面异常，截图已检查。最终重跑 1 项通过（2.5 秒），临时浏览器 profile 已清理。执行：`bash scripts/with-m1-runtime.sh npx --no-install playwright test --config playwright.extension.config.ts`，此前需使用目标配置构建扩展。
- 共享模块迁移后重新运行 Web 的真实本地 Supabase 完整流程，1 项通过（11.9 秒），覆盖双主题、保存、离线重试及标签页接手；当次临时账号与级联记录已清理，既有账号未动。
- 上述扩展检查不是实际 OAuth 登录、YouTube 播放器或真实数据库验收。没有修改 Auth／RLS／迁移，没有托管发布、重载用户安装版、接管浏览器、push 或新增费用。
- 源码提交 `b9b954a`；独立 Standards 发现 1 项 P3（共享 UI 职责表冲突），Spec 发现 1 项 P2（网关 401 被当作确定身份失效）。前者已统一文档；后者先以空体 401 重现失败，再修为只接受匹配 `unauthenticated` 的应用 401，HTML／空体／不匹配 JSON 保留 `unavailable`。两路复核均无剩余确认问题；最终完整检查与 MV3 重跑通过。

## 托管发布（2026-09-10，源码 `c0bcf45`）

- 在原 Supabase 项目 `msfmsvschsbqizxhjcjp` 应用已审阅的增量 SQL。源码版本 `20260909190946_private_progress_evidence.sql` 对应托管历史 `20260909202952_private_progress_evidence`；托管迁移由四条增至五条，不改写旧时间戳或重置数据。
- 前后均为 Auth 用户 2、蓝图 2、目标 1、节点 1、学习会话 2、成果 0；用户 ID 摘要及蓝图 ID／版本摘要保持一致，原扩展客户端配置未变。成果表 RLS 开启，authenticated 可读但不能直接写表，anon 不能读取或执行成果 RPC。
- 真实托管数据库事务中使用现有节点调用公共 RPC：原提交重试返回相同 ID、所属账号读到一条、另一账号读不到且不能写原节点、未知 OAuth 客户端和匿名读写被拒绝。整体 ROLLBACK 后成果仍为 0，上述原始计数与摘要再次一致。该检查设置数据库角色与 JWT claims，**不是实际 Auth 签发、OAuth 授权或浏览器双账号验收**。
- 托管 Security Advisor 前后保留同样两项 WARN：原 `apply_blueprint_proposal` 的[认证角色可执行特权函数提示](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)，以及未启用[密码泄露保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。Performance 只有原有 7 项 unused-index INFO，无新增 WARN／ERROR；不能将历史本地 Advisor 无告警替代这份托管结果。
- Vercel 在原 Hobby 项目发布 `c0bcf45`，候选为 `dpl_EWVsJaQCH3EtLBzfktgKkB9R8bBc`（[部署详情](https://vercel.com/norlymangune65-4981/blueprint-m1/EWVsJaQCH3EtLBzfktgKkB9R8bBc)）。使用生产配置、先 `--skip-domain` 构建检查，再 promote；最终 [正式站点](https://blueprint-m1.vercel.app) 查询解析到该部署。远端 Next 构建及 TypeScript 通过；本批未改产品源码，前批 199 项测试等保留为源码证据，未冒称重新执行。
- 候选与正式域名各通过六项 HTTP 检查：`/login` 200；`/progress` 307 且回跳 `/login?next=%2Fprogress`；成果 API GET／POST 均 401、受控 `unauthenticated`、`private, no-store`；`/design` 与 `/design/assets` 均 404。候选检查沿用现有 CLI 授权，未关闭部署保护、创建用户会话或发送邮件。
- 首次部署上传后 `fetch failed`，部署列表确认没有新构建后仅重试一次成功。CLI 的 `curl` 将 `--global-config` 错传给底层 curl；复用现有凭据仅通过子进程环境传递解决，未输出密钥、重新登录或修改产品配置。按新部署筛选、从 `2026-09-09T20:35:00Z` 起查询 error 日志无结果；这只是发布自测窗口，不代表长期监控或完整供应商故障回归完成。
- 未操作用户持有的 ego-browser 空间 8，未重载已安装扩展、公开注册、push、购买服务或增加付费配置。真实双端保存／重读和用户旅程、其余 P4 与全产品门槛继续保留。
