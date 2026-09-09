# 私人成果记录：P4 数据与应用切片

更新：2026-09-10，源码提交 `4354d4f`。**源码与本地数据库已实现，尚未部署到托管环境，也没有接入正式界面。** 本文是实现证据，不替代[执行路线](execution-roadmap.md)的阶段状态。

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

作品链接不会被服务器抓取或验证可信度、可达性及外站隐私。应用输入验证 URL 格式；数据库进一步约束 HTTPS、安全字符和无内嵌凭据，但不提供完整浏览器 URL 解析。读取历史值不重新应用当前表单限制或裁剪正文（PostgreSQL 字符计数也不同于 UTF-16）。后续界面必须先验证链接再生成安全锚点，无效链接显示原文，不能令整页记录不可读；外站页面可能公开，不受 Blueprint 私人存储权限保护。

## 代码与迁移

- [共享领域](../packages/domain/src/progress-evidence.ts)：输入与历史记录的数据边界。
- [应用服务](../apps/web/src/lib/progress-evidence.ts)、[Web Action](../apps/web/src/app/progress-evidence-actions.ts)、[HTTP 入口](../apps/web/src/app/api/v1/progress-evidence/route.ts)。
- [增量迁移](../supabase/migrations/20260909190946_private_progress_evidence.sql)。先在本地通过 DDL 迭代，再运行 Advisor 和 CLI `db pull --local`；对生成文件恢复明确 REVOKE／GRANT，并按依赖排序，避免保留 `check_function_bodies=off`。未重置数据库，既有账号升级契约通过。

技术边界依据 [Supabase 数据库函数](https://supabase.com/docs/guides/database/functions)和 [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。已扫描当前变更摘要；本批不升级数据库、Auth 或 SDK，不修改邮件、Realtime 或日志服务配置。

## 验证证据

- 27 项新 HTTP／Action 测试：使用真实身份适配器与 Supabase SDK，只有外部提供方传输采用夹具，覆盖双端读写、账号切换、非法输入、错误分类和历史数据读取；总计 176 项测试与完整 `check:m1` 通过。
- 31 项新真实 PostgreSQL／pgTAP 测试；五个文件共 115 项通过，覆盖四类节点、无视频、归档后重试、幂等、版本冲突、跨账号、未知／缺配置 OAuth、匿名、直接写表和输入限制。
- 本地 Security／Performance Advisor 在修正精确授权判断后无 WARN／ERROR；迁移列表五条与本地应用历史对应。
- [升级契约](../scripts/test-m1-migration.mjs)从已有账号应用全部迁移，验证成果写入、重试及匿名 ACL，不重新创建原账号。
- [本地真实 API 检查](../scripts/test-progress-evidence-local.mjs)通过真实 SDK／PostgREST 同时提交两次，获得同一记录 ID；第二账号读取为空。只创建当次随机 ID 的临时账号，finally 清理两名账号及其测试数据，原本地账号未动。运行方式：`bash scripts/with-m1-runtime.sh node scripts/test-progress-evidence-local.mjs`；CLI 不在 PATH 时通过 `BLUEPRINT_SUPABASE_BIN` 指定已安装二进制。
- 16 项生产模式 E2E 通过（7.4 秒），覆盖现有登录／恢复、偏好匿名读取与内部设计页门禁；不是尚未接入的成果 UI 验收。
- 固定点 `027d70f` → `4354d4f` 的独立复核：Standards 0 项确认发现；Spec 0 项确认发现，无阻断。两路只读审阅源码、测试与文档，实际运行验证由主任务完成。

## 后续门槛

托管迁移和发布、真实账号双端验收、成果表单与近期记录、请求失败保留私人草稿、切账号隔离、冲突后的上下文选择、离线恢复与安全外链交互仍待实现／验证。当前不接入旧扩展 outbox，以免失败记录被丢弃。UI 完成前不把此数据切片表述为用户已经可使用的“成果闭环”。
