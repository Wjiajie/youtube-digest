# 蓝图一致性读取

更新：2026-09-10；源码固定点 `db27ece`。一致性读取已在后续 `c53111f` 发布批次应用托管迁移并上线；真实托管登录旅程仍待验收。这是 P4 领域扩展的可靠性前置，不代表节点投入与完成标准已经交付。

后续本地[节点规划信息](node-planning.md)已引入格式 2 的独立一致性读取，沿用本页的单语句／权限边界；该增量尚未部署，旧读取保留为历史格式只读投影。下文记录原格式 1 批次的实现与验证。

## 问题与行为

旧 `getMainBlueprint` 先读取版本，再分次请求目标、阶段、节点、依赖和资源。并发提案确认落在两次请求之间时，可能产生旧版本号与新层级的组合。实际 SDK 配合外部 PostgREST 夹具已重现：版本 0 的空蓝图带回版本 1 才新增的目标。

现在同一个 Store 接口调用 `read_blueprint_snapshot`，从结构化实体一次组装完整快照；Web 页面、提案用例、成果工作区和扩展蓝图 API 共用实现。SQL `STABLE` 函数在调用语句的快照中读取根版本与全部子项。并发时允许返回完整旧版本或完整新版本，不能混合；后续写入仍需原有版本条件，读取成功不表示锁住未来的蓝图。依据：[PostgreSQL 函数稳定性与快照](https://www.postgresql.org/docs/current/xfunc-volatility.html)。

目标、阶段、节点及资源按位置／ID 排序，依赖按 ID 排序；空层级为数组，未提供的描述省略，已归档层级和资源不进入当前路径。不改 Snapshot 格式、修订、正式实体或成果历史；错误不伪装为空，也不退回旧的分次读取。

## 权限与发布

- 新 RPC 为 `SECURITY INVOKER`、空 search_path，保留表 RLS；传入 owner 必须等于认证身份。撤销 PUBLIC／anon 执行权，只向 authenticated 开放，未添加写权限。
- 复用既有 `private.can_access_progress_evidence()` 的精确身份判定：Web 可读，OAuth 只有匹配配置扩展 ID 才可读，未知／缺配置不返回蓝图。该函数沿用成果切片命名，但判定不读取成果内容；不增加另一个特权函数或更改原授权规则。
- 无记录或无权访问返回 null；数据库／格式错误由现有调用方处理为受控错误，不缓存个人快照。参见 [Supabase 数据库函数及权限](https://supabase.com/docs/guides/database/functions)。
- [迁移](../supabase/migrations/20260909205257_coherent_blueprint_reads.sql)由本地 DDL、Advisor 与 `db pull --local` 生成；去掉生成结果中无关的 `pg_net` 删除及 `check_function_bodies=off`，补回显式权限。没有重置账号或改旧迁移。
- **必须先应用迁移，再部署依赖它的 Web。** 缺少 RPC 时明确不可用，不使用旧读取作降级。此顺序已在后续 `c53111f` 发布中执行：本地 `20260909205257` 对应托管 `20260909220319`，保存的 SQL 与仓库文件一致；主域名为 `dpl_3P1TjdDz3WtaHEokBWxZaR8rvpYM`。角色／权限、数据保留、匿名 HTTP 与早期日志证据见[合并发布记录](goal-briefs.md#托管发布2026-09-10源码-c53111f)。回滚 Web 不要求删函数或回滚数据。

## 源码批次验证证据（托管发布前）

- [Store 测试](../apps/web/src/lib/supabase/store.test.ts)：真实 SDK、仅外部提供方夹具，原串版本场景 red→green；另覆盖无记录、服务故障、缺少 RPC、畸形快照。既有 Auth／HTTP／成果 Action 夹具同步新传输，产品接口未改。
- [PostgreSQL 检查](../supabase/tests/blueprint_snapshot.test.sql)：15 项覆盖新账号、四类节点、描述、依赖／资源、归档、双 owner、配置扩展、未知／缺配置 OAuth、匿名及禁止直写。全部本地 pgTAP 六文件 130 项通过。
- [真实并发脚本](../scripts/test-blueprint-snapshot-local.mjs)：独立 PostgreSQL 会话与可观测 advisory-lock 等待；读语句建立快照后，另一会话通过提案 RPC 确认修改。旧读保持版本 1／旧目标，新读得到版本 2／新目标。只使用本地 `supabase_db_blueprint-local`；当次随机账号及级联记录已清理，原蓝图 ID／版本摘要不变。这是数据库并发检查，不是 OAuth 或浏览器验收。
- 重跑：`bash scripts/with-m1-runtime.sh node scripts/test-blueprint-snapshot-local.mjs`；不发邮件、不用托管凭据，只取消自己命名的测试读会话，等待设限。
- 完整 `check:m1`：204 项测试、TypeScript、既有账号迁移升级契约、九阶段向导、Next 与云配置 WXT 构建／安全检查通过（扩展 560.56 kB）。升级契约实际执行新迁移，验证整份快照及匿名 ACL。
- 本地 Advisor 无 Security／Performance WARN／ERROR；本地文件与迁移历史六条一致，不覆盖仍有两项既知 WARN 的托管环境。
- 真实本地 Auth→生产 Next→Action→数据库成长档案流程 1 项通过（11.6 秒），包含保存、离线恢复、双主题和多标签接手；本次临时账号已清理，没有发送邮件或操作用户浏览器。

常规生产模式 E2E 20 项通过（7.5 秒），覆盖登录恢复、匿名私密接口和内部设计页门禁。源码提交 `2bb6073`；固定点 `db27ece` → `2bb6073` 的独立 Standards 复核为 0 项确认违反／0 项判断性坏味道，Spec 为 0 项确认发现，均无阻断。两路只读审阅，实际运行证据由主任务执行。

UI／3D 在该源码批次未改；目标定义工作台随后已实现并发布，见上方合并发布记录。正式双主题 3D 品质、真实托管旅程、节点规划信息和其余 P1–P9 保持待办，不能把本项可靠性修复算作这些能力的完成证据。
