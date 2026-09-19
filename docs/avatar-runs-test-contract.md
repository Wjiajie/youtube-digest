# AI 化身数据层（P1）冻结验收与测试契约

> 角色：独立 test_designer（只读）。本文件只冻结契约，不含生产代码、迁移或测试实现。
> 冻结范围：**AI 化身（AI avatar）能力的数据层 P1** —— 无供应商调用、无路由、无 UI。
> 契约一旦冻结，实现者与测试作者不得为获得 Green 而修改本文件中的任何期望值；如需变更，必须由原独立角色复核后再改。
>
> 版本：**v2（2026-09-19 修订）**。v2 相对 v1 的改动与理由见文末附录 B. 修订记录。

---

## 0. 冻结边界、命名与交付物

### 0.1 本增量必须新增的产物（路径与命名冻结）

| 产物 | 路径 / 名称 | 说明 |
| --- | --- | --- |
| 迁移 | `supabase/migrations/<14 位时间戳>_avatar_runs.sql` | 文件名后缀必须为 `_avatar_runs.sql`；时间戳必须**大于**现有最新迁移 `20260911032219_explanation_runs.sql`，使迁移按目录名排序时排在最后（排序应用见 `scripts/test-m1-migration.mjs:60`） |
| 表 | `public.avatar_runs` | 公开可读、仅服务端可写 |
| 表 | `private.avatar_quotas` | 按 owner + kind 计次 |
| 表 | `private.avatar_leases` | 每个 run 唯一执行权 |
| 函数 | `private.avatar_expire_runs(uuid)` | 到期清扫（owner 维度） |
| 函数 | `private.avatar_web_actor()` / `private.avatar_request_valid(jsonb)` / `private.avatar_result_valid(public.avatar_runs,jsonb)` | 守卫与校验 |
| 函数 | `private.begin_avatar_run/read_avatar_run/cancel_avatar_run/claim_avatar_run/finish_avatar_run` | private + public 成对 |
| Storage | bucket `avatar-models` + `storage.objects` 策略 `avatar_models_owner_read` | 私有桶、仅 owner 可读、仅服务端可写 |
| pgTAP | `supabase/tests/database/avatar_runs.test.sql`、`supabase/tests/database/avatar_storage.test.sql` | 见第 8 节 |
| PGlite 契约 | `scripts/test-m1-migration.mjs` 增加 `_avatar_runs.sql` 的 capture/verify 钩子 | 见 8.4，这是本增量**唯一允许**修改该文件的改动 |

命名族：错误消息一律 `AVATAR_*`；策略名 `avatar_web_owner_read`（表）与 `avatar_models_owner_read`（storage）；unique 索引 `avatar_one_active_owner`；普通索引 `avatar_owner_recent`。

### 0.2 必须镜像的既有契约（本文件的依据）

| 依据 | 位置 | 镜像内容 |
| --- | --- | --- |
| 资源运行家族（canonical） | `supabase/migrations/20260910095541_resource_runs.sql:3-16`（表与 check）、`:17`（唯一活动索引）、`:18-19`（索引）、`:20-25`（RLS + owner 读策略）、`:26-30`（quotas）、`:31-34`（leases）、`:35-38`（private RLS/ACL）、`:40-46`（web actor）、`:49-66`（到期清扫）、`:68-101`（请求校验器）、`:103-144`（begin）、`:146-154`（read）、`:155-167`（cancel）、`:169-189`（claim）、`:191-244`（结果校验器）、`:246-273`（finish）、`:275-286`（函数 ACL 与 public 包装） | 全部结构与语义 |
| 到期/维护入口 | `supabase/migrations/20260910033457_path_planning_runs.sql:59-90`（owner 锁 + 到期/来源失效清扫）、`:147-148`（锁不到 owner 行即 NOT_FOUND）；`supabase/migrations/20260910204925_resource_maintenance.sql:55-114`（算子收据与 revoke all） | 清扫触发点与 ACL 收口 |
| 行为契约 | `docs/agent-resource-runs.md:19`、`:23`、`:25-27`、`:29`、`:62` | 单后继、分项预留、退款时机、到期语义 |
| PGlite 契约 harness | `scripts/test-m1-migration.mjs:24-39`（只有 auth 桩，**没有 storage schema**）、`:60-84`（按序应用每个迁移 + 可选钩子）、`:459-468`（capture 模板）、`:581-600`（verify 模板与 ACL 断言）、`:628-648`（新表类迁移的 verify 模板） | 迁移必须可在无 storage schema 下达 |
| pgTAP 写法 | `supabase/tests/resource_runs.test.sql:12`、`:17-21`、`:22-27`、`:29-31`、`:44-45`、`:60-64`、`:95-108`、`:111-129`；`supabase/tests/resource_maintenance.test.sql:68-84` | 断言语义与禁止项 |
| 主题真相 | `packages/ui/src/theme.tsx:6-7`（`cyberpunk`/v1、`eastern`/v1）；`supabase/migrations/20260909153706_account_theme_preferences.sql:5-25`（`profiles.theme_id` 格式 check、`theme_version > 0`、列级 UPDATE 授权、`preferences_revision` 触发器） | pinned 主题对与 stale 判定 |
| 客户端边界 | `supabase/migrations/202608260001_m1_cloud_slice.sql:258-274`；`20260909170755_proposal_confirmation_hardening.sql:4-13`（任何带 `client_id` 的 OAuth 会话都算扩展客户端） | 扩展客户端不得读 |
| GLB 与体积 | `apps/web/src/lib/scene/preview-asset.ts:4`（10 MB 上限）、`:6`（glTF 2.0）、`:12`（不得外链）；`docs/scene-intake-preview.md:31`（"8 MB 网络预算"**未实测**，不作为依据） | 桶大小上限与 MIME |
| 合规 | `docs/avatar-ai-generation-feasibility.md:5`（GLB 存入 Supabase Storage 用户资产库）、`:15`（非 Enterprise API 产物仅保留 3 天，必须当次转存）、`:287`（禁止把 PII 放进 Customer Input） | 桶用途与"不得存原图" |
| 命令 | `package.json:25`（`test:db-contract`）、`:27`（`test:agent-runs`）、`:37`（`supabase:test`） | 断言位置 |

---

## 1. 状态机

### 1.1 状态词汇（`public.avatar_runs.status` 的 check 取值，七个，与 `resource_runs.sql:9` 完全一致）

`queued`、`running`、`ready`、`failed`、`cancelled`、`interrupted`、`stale`。

- **终态**：`ready`、`failed`、`cancelled`、`interrupted`、`stale`（终态必须携带 `result`，见 I4）。
- **非终态**：`queued`、`running`（`result` 必须为 NULL）。
- 任何其它取值必须被数据库拒绝（check violation，SQLSTATE `23514`）。

### 1.2 合法转移（每条转移都标明执行函数；除下列转移外**全部禁止**）

| # | From → To | 触发者（函数） | 触发条件 | 附带效果 |
| --- | --- | --- | --- | --- |
| S1 | （无）→ `queued` | `begin_avatar_run`（`private.` 定义者 / `public.` 包装） | 请求合法 + pinned 主题对等于 owner 当前 `profiles` 对 + 无活动 run + 额度扣减成功 | 插入行，`expires_at = created_at + 600s`，额度 −1 |
| S2 | （无）→ 原状态 | `begin_avatar_run` | 同 `runId` 已存在且 pinned 参数完全一致（幂等重放） | 不加行、不扣额度、不退款 |
| S3 | `queued` → `running` | `claim_avatar_run`（service_role） | 状态为 `queued` | 写入 lease 行，`expires_at = 现在 + 1800s` |
| S4 | `queued` → `queued` | `claim_avatar_run` | 状态不是 `queued` | 返回 `{"acquired":false,"run":…}`，不做任何写入 |
| S5 | `queued` → `cancelled` | `cancel_avatar_run`（本人） | 用户取消 | `result={"status":"cancelled"}`，额度 +1（仅这一次） |
| S6 | `queued` → `cancelled` | `avatar_expire_runs`（由任一入口函数在 owner 锁之后调用） | `expires_at <= clock_timestamp()` | `result={"status":"cancelled"}`，额度 +1（仅这一次） |
| S7 | `running` → `cancelled` | `cancel_avatar_run`（本人） | 用户取消 | `result={"status":"cancelled"}`，**不退款** |
| S8 | `running` → `interrupted` | `avatar_expire_runs` | `expires_at <= clock_timestamp()` | `result={"status":"timed_out"}`，**不退款** |
| S9 | `running` → `ready` | `finish_avatar_run`（service_role） | `result.status = 'generated'` 且 pinned 主题对仍等于 owner 当前 `profiles` 对 | 持久化 result，记录 completion digest |
| S10 | `running` → `failed` | `finish_avatar_run` | `result.status` 属于失败状态集（见 1.3） | 持久化 result，记录 digest |
| S11 | `running` → `cancelled` | `finish_avatar_run` | `result.status = 'cancelled'` | 持久化 result，记录 digest |
| S12 | `running` → `stale` | `finish_avatar_run` | 同 S9，但 pinned 主题对已不等于 owner 当前 `profiles` 对 | 持久化 result，记录 digest |
| S13 | `ready` → `stale` | `avatar_expire_runs` | pinned 主题对已不等于 owner 当前 `profiles` 对 | `result` 保留（体现"过期历史，不冒充当前建议"，`docs/agent-resource-runs.md:29`） |
| S14 | 任意终态 → 同状态 | `finish_avatar_run` | 该 run 的 lease 已有 completion digest（精确重放） | 返回原行，不改状态 |
| S15 | `cancelled`/`interrupted` → 同状态 | `finish_avatar_run` | lease 无 digest，迟到的完成回执 | 只写入 digest 与保留状态，**绝不复活为 `ready`/`failed`/`stale`** |
| S16 | 任意终态 → 同状态 | `cancel_avatar_run` | 已是终态再次取消 | 返回原行，不写入、不退款 |

### 1.3 失败结果状态集（`private.avatar_result_valid` 允许的 `status` 字面量，镜像 `resource_runs.sql:196-198`）

`invalid_input`、`not_applicable`、`unavailable`、`rate_limited`、`cancelled`、`timed_out`、`not_found`、`invalid_output`。
成功状态只有 `generated`。**除 `generated` 与上述八个之外的任何 `status` 必须被拒绝**（`AVATAR_INVALID_RESULT`，SQLSTATE `22023`）。

**正例与负例必须成对存在（v2 明确）**：上述八个字面量中任意一个都必须被**接受**，并把 `running` 推进到 `failed`（S10；`cancelled` 例外，见 S11）；未知字面量必须被拒绝。校验器**不得**实现成"只有 `generated` 合法"的白名单——v1 的实现曾因此让 S10/S11 完全不可达、八个失败字面量被全部误拒（见附录 B）。

### 1.4 明确禁止

- 禁止 `queued → ready`、`queued → failed`：未取得执行权不得完成（`claim` 是唯一进入 `running` 的路径）。
- 禁止 `ready/failed/stale → running`：终态不可再取执行权。
- 禁止 `interrupted` 直接回到 `running`：过期即失去执行权，只能由调用者用**新 runId** 重新开始（新 runId 会重新扣额度，见 §3）。
- 禁止任何状态回到 `queued`。
- 禁止由 `public` 侧直接 UPDATE 状态（客户端无表写权限，见 §6）；状态只能由上述五个入口函数迁移。

---

## 2. 不变量（必须在数据库强制，不得只靠应用代码）

| 编号 | 不变量（可检查条件） | 强制手段 |
| --- | --- | --- |
| I1 | `avatar_runs.id` 唯一（同 runId 只有一行） | `primary key` |
| I2 | 每个 owner 的 `queued`/`running` 行**至多一行** | 部分唯一索引 `avatar_one_active_owner on (owner_id) where status in ('queued','running')`（镜像 `resource_runs.sql:17`） |
| I3 | `status` 只能取 §1.1 的七个值 | `check(status in (…))` |
| I4 | `(status in ('queued','running')) = (result is null)`：非终态无 result、终态必有 result | 表级 check（镜像 `resource_runs.sql:13`） |
| I5 | `kind` 只能为 `'generate'` | `check(kind in ('generate'))` |
| I6 | `theme_id` 形如 `^[a-z][a-z0-9_-]{0,63}$` | check（镜像 `20260909153706_account_theme_preferences.sql:15`；**不写成枚举**，理由见 §0.1 与 ADR-0003 的"更多主题后续扩展"） |
| I7 | `theme_version >= 1`（整数） | `check(theme_version > 0)`（镜像 `20260909153706_account_theme_preferences.sql:19`） |
| I8 | `created_at` 默认 `clock_timestamp()`，`expires_at` 非空 | 列定义（镜像 `resource_runs.sql:10`） |
| I9 | **不得**存在 `check(expires_at > created_at)` 之类的约束 | 反向要求：过期用例必须能通过直接改写 `expires_at` 到过去来构造（`supabase/tests/resource_runs.test.sql:95`、`:104`）；此类约束会让唯一可行的过期构造失败 |
| I10 | 删除账号即级联删除 run / quota / lease | 三表对 `auth.users(id)` 的 `on delete cascade`（镜像 `resource_runs.sql:4,27,32`；断言方式见 `resource_runs.test.sql:126-129`） |
| I11 | 额度分项主键为 `(owner_id, kind)`，且 `available_attempts >= 0` | `primary key(owner_id,kind)` + check（镜像 `resource_runs.sql:26-30`） |
| I12 | 一个 run 至多一条租约（执行权唯一） | `private.avatar_leases.run_id primary key`（镜像 `resource_runs.sql:32`） |
| I13 | 三张表均启用 RLS | `enable row level security`（镜像 `resource_runs.sql:20,35-36`） |
| I14 | `public.avatar_runs` 恰有 **1** 条策略，`cmd='r'`，仅授予 `authenticated` | `pg_policy` 计数与形状断言（可检查：`select count(*) from pg_policy where polrelid='public.avatar_runs'::regclass` = 1） |
| I15 | `private.avatar_quotas`、`private.avatar_leases` 有 RLS 且策略数 **0** | `pg_policy` 计数断言（镜像 `resource_maintenance.test.sql:69`） |
| I16 | `private.avatar_leases` 不对任何 API 角色授予任何表权限 | `revoke all`（镜像 `resource_runs.sql:37`）——包括 `service_role`（它只拿配额表的 `select,insert,update`） |
| I17 | `service_role` 对 `private.avatar_quotas` 有 `SELECT,INSERT,UPDATE`，**无** `DELETE`/`TRUNCATE` | 显式 grant（镜像 `resource_runs.sql:38`、`path_planning_runs.test.sql:216-218`） |
| I18 | `service_role` 对 `public.avatar_runs` 无任何表权限（必须经 RPC 写） | `revoke all`（镜像 `resource_runs.sql:21`、`resource_runs.test.sql:124`） |
| I19 | 五个入口函数的 definer/invoker 姿态固定：`private` 侧 `begin/read/cancel/claim/finish` = `SECURITY DEFINER`，`public` 包装 = `SECURITY INVOKER`；`avatar_web_actor`/`avatar_expire_runs` = `SECURITY INVOKER`；两个校验器 = `IMMUTABLE SECURITY INVOKER` | `prosecdef`/`provolatile` 断言（镜像 `test-m1-migration.mjs:694-700`） |
| I20 | 所有新函数 `set search_path = ''`；所有新表在 `public`/`private` 之间归属正确 | 结构断言（人工 + `pg_proc.proconfig`） |
| I21 | `result` 必须是合法 JSON 对象且满足 §5.4 的结果契约 | `private.avatar_result_valid` 在 `finish` 中强制 |
| I22 | `begin` 的 `p_request` 必须是**恰好**四个键 `{runId,kind,themeId,themeVersion}`，无多余键、无缺失键 | `private.avatar_request_valid`（镜像 `resource_runs.sql:78-82`） |
| I23 | 状态迁移只能由五个入口函数执行 | I18 + §6 断言 |

---

## 3. 额度契约

### 3.1 计次模型

- 计数表：`private.avatar_quotas(owner_id uuid, kind text, available_attempts integer not null check(available_attempts>=0), primary key(owner_id,kind))`。
- `kind` 取值冻结为 `'generate'`（唯一分项）。
- **默认零额度**：`begin` 不得隐式创建 quota 行，也不得自带免费次数（镜像 `resource_runs.test.sql:12` "no implicit free calls"）。行不存在等价于 0。
- 行只能由 `service_role` 显式插入（I17），不存在任何 RPC 会发放额度。

### 3.2 扣减时机

**在 `begin_avatar_run` 内、且仅在真正新建 run 时扣减一次。** 具体顺序（镜像 `resource_runs.sql:137-141`）：

1. 校验请求（I22）；
2. 取 owner 行锁：`perform 1 from public.profiles where id = <actor|p_owner_id> for update`，取不到 → `AVATAR_NOT_FOUND`；
3. 执行 `avatar_expire_runs(owner)`；
4. 按 `runId` 查已存在 run：命中则按 §5 判定幂等重放 / `AVATAR_RUN_REUSED`；
5. 主题对比较（不一致 → `AVATAR_VERSION_CONFLICT`，`40001`）；
6. 活动 run 检查（有 → `AVATAR_BUSY`，`P0001`）；
7. **扣减**：`update private.avatar_quotas set available_attempts = available_attempts - 1 where owner_id = <owner> and kind = 'generate' and available_attempts > 0`；若未命中任何行（**包括行缺失**）→ `AVATAR_QUOTA_EXHAUSTED`，`P0001`；
8. 插入 run 行。

第 6 步必须先于第 7 步：并发第二个 begin 被 `AVATAR_BUSY` 拒绝时**不得**产生任何扣减。

### 3.3 例外码与消息（精确冻结）

| 条件 | 消息 | SQLSTATE |
| --- | --- | --- |
| 额度行为空（不存在） | `AVATAR_QUOTA_EXHAUSTED` | `P0001` |
| 额度存在但 `available_attempts = 0` | `AVATAR_QUOTA_EXHAUSTED` | `P0001` |
| 单测断言：**行缺失与耗尽不可区分**（同消息同码） | — | — |

额度不足时**不得**返回 run 行、不得插入 run、不得插入 quota 行、不得改动任何既有行。

### 3.4 退款（何时、最多一次）

| 场景 | 是否退款 | 依据 |
| --- | --- | --- |
| `queued` 被用户取消 | +1 | `resource_runs.sql:162-163`；`resource_runs.test.sql:64` |
| `queued` 到期清扫 | +1 | `resource_runs.sql:54-56`；`resource_runs.test.sql:97-98` |
| `running`（已取得执行权）被取消 | **不退** | `resource_runs.sql:162-163` 只在 `queued` 分支退款 |
| `running` 到期 | **不退** | `resource_runs.sql:54-56`；`resource_runs.test.sql:106-108`（claimed expiry 消费额度） |
| `finish` 任何结果（含失败态） | **不退** | `docs/agent-resource-runs.md:25-26`：取得执行权后即使响应丢失或失败也不退 |
| 幂等重放（begin/claim/finish 重复） | 不扣不退 | 同 3.2 第 4 步与 §5 |
| 终态再次取消 | 不退款 | S16 |

**退款最多一次**由状态迁移本身保证：退款语句只能出现在"该行从 `queued` 迁出"的那一次加锁 UPDATE 的分支里；重复清扫看到的状态已是 `cancelled`，不再进入退款分支（`resource_runs.test.sql:98`、`:64`）。

---

## 4. 单飞与租约契约

### 4.1 单飞（single-flight）

- **数据库层唯一**：I2 的部分唯一索引保证同一 owner 同时最多一个 `queued`/`running`。直接插入第二条活动行必须失败（`23505`）。
- **入口层拒绝**：已存在活动 run 时，`begin_avatar_run` 用**不同 runId** 的请求必须抛 `AVATAR_BUSY`（`P0001`），且**不扣额度**。
- **串行化**：所有五个入口先取 owner 的 `public.profiles` 行锁（`for update`；`resource_runs.sql:109`、path_planning 的 owner 锁 `20260910033457_path_planning_runs.sql:101,147,193,248`），再读/写 run 与额度，避免"先扣费后失败"的漏扣。
- **并发的可观察结果**：
  - 两个并发的同 runId `begin`：一个新建并扣 1 次，另一个返回**同一行**（幂等），额度只减 1；
  - 两个并发的不同 runId `begin`：一个成功，另一个 `AVATAR_BUSY`，额度只减 1；
  - 两个并发 `claim`：第一个 `{"acquired":true}` 且状态 `running`；第二个 `{"acquired":false}`，lease 行仍是第一条（`resource_runs.test.sql:30-31`）。
- **禁止**用应用层"先查询再插入"替代 I2；唯一索引是仲裁者（`begin` 的 `exception when unique_violation` 兜底 → `AVATAR_NOT_FOUND`，`P0002`，镜像 `resource_runs.sql:143`）。

### 4.2 租约（execution right）

- 一个 run 至多一条 lease（I12）。`lease_id` 由 worker 生成，`claim` 时写入；`finish` 必须携带同一 `lease_id`。
- `claim` 仅在 `queued` 时创建 lease 并把状态置 `running`（S3）；否则原样返回 `acquired:false`（S4），**不得改写已存在的 lease**。
- `finish` 的租约校验：lease 行不存在或 `lease_id` 不匹配 → `AVATAR_FORBIDDEN`（`42501`），且**在任何结果校验之前**执行（镜像 `resource_runs.sql:255-257`）。
- `completion_digest`：`finish` 把 `encode(sha256(convert_to(p_result::text,'UTF8')),'hex')` 记为该 lease 的完成指纹（镜像 `resource_runs.sql:258`）。

### 4.3 租约过期（stale lease）的确切含义

"租约过期"= 运行期限 `expires_at` 已过，**不是**删除租约行。冻结语义：

1. 过期不会删除或替换 lease 行（断言：过期后 lease 行仍存在，`lease_id` 不变）；
2. 过期后该 run 不能再取得执行权：`claim` 返回 `acquired:false`（清扫已把它转为 `interrupted`/`cancelled`）；
3. 已过期的 `running` run 上，**带着原 lease_id 的迟到成功回执不得复活状态**：只写入 digest，返回 `interrupted`（镜像 `resource_runs.test.sql:106`）；
4. 带**其它** lease_id 的完成 → `AVATAR_FORBIDDEN`（`42501`）；
5. 过期不退款（§3.4）；需要继续就必须用新 runId 重新 `begin`，并重新消耗额度（`docs/agent-resource-runs.md:19`）。

---

## 5. 幂等契约

### 5.1 幂等键

`runId`（uuid，客户端生成）是唯一幂等键。**幂等的判据是同 runId + 完全一致的 pinned 参数**，pinned 参数集合冻结为：

- `kind = 'generate'`
- `theme_id`
- `theme_version`

（镜像 `resource_runs.sql:114-116` 对 `kind`、`nodeId`、`expectedBlueprintVersion`、`preferences`、`learnerContext` 的逐字段比较。）

### 5.2 三种命中结果（精确冻结）

| 情形 | 结果 |
| --- | --- |
| 同 runId 且 pinned 参数完全一致 | **返回原行**（`to_jsonb(r)`），不加行、不扣额度、不退款、不改写任何字段（S2） |
| 同 runId 但 `kind`/`theme_id`/`theme_version` 任一不同 | `AVATAR_RUN_REUSED`，`22023`（不扣额度、不改行） |
| 同 runId 存在但 `owner_id` 不是调用者（或 `begin` 插入时唯一冲突兜底） | `AVATAR_NOT_FOUND`，`P0002`（不泄露他人 run 的存在性） |

### 5.3 "重复推进不重复扣减"的冻结断言

1. `begin` 重放 2 次 → quota 只减 1（`resource_runs.test.sql:17-18,27`）；
2. `claim` 重放 2 次 → quota 不变，lease 仍为第一条；
3. `finish` 精确重放 2 次 → 返回完全相同的结果，quota 不变；
4. 到期清扫重复执行 → 对同一行只退款一次（`resource_runs.test.sql:97-98`）；
5. 取消重复执行 → 只退款一次（`resource_runs.test.sql:60-64`）。

### 5.4 结果（`finish` 入参）契约

`p_result` 必须是 JSON 对象，`octet_length(p_result::text) <= 4194304`（镜像 `resource_runs.sql:194`），且满足：

**失败态**：恰好一个键 `{"status": <失败状态字面量>}`（多余键 → 拒绝），且该字面量必须被**接受**。写入后终态映射固定为：`generated → ready`、`cancelled → cancelled`、其余七个失败字面量 → `failed`（S9–S11）。P1 不接受 `providerMayHaveRun`/`usage`/`requests` 等供应商键；它们属于 P2（见 §9）。

**成功态**（`status='generated'`）：恰好五个键

| 键 | 精确要求 |
| --- | --- |
| `status` | 字符串 `generated` |
| `objectPath` | 必须等于 `<run.owner_id>/<run.id>/avatar.glb`（与 §7.2 路径约定一致；不等 → 拒绝） |
| `mimeType` | 字符串 `model/gltf-binary` |
| `bytes` | 整数，`1 <= bytes <= 10485760`（上界依据 `preview-asset.ts:4`） |
| `sha256` | 小写 64 位十六进制 `^[0-9a-f]{64}$` |

任何违反 → `AVATAR_INVALID_RESULT`，`22023`，且**不写入** result/status/digest。

### 5.5 完整例外码表

| 条件 | 消息 | SQLSTATE |
| --- | --- | --- |
| 请求结构/参数非法、未知 `kind`、`themeId`/`themeVersion` 形状非法、`claim`/`finish` 空参数 | `AVATAR_INVALID` | `22023` |
| 同 runId 参数不同 | `AVATAR_RUN_REUSED` | `22023` |
| run 不存在 / 不属于调用者 / 唯一冲突兜底 | `AVATAR_NOT_FOUND` | `P0002` |
| pinned 主题对与 owner 当前 `profiles` 对不一致 | `AVATAR_VERSION_CONFLICT` | `40001` |
| 已有活动 run | `AVATAR_BUSY` | `P0001` |
| 额度缺失或耗尽 | `AVATAR_QUOTA_EXHAUSTED` | `P0001` |
| 非 Web actor（无身份 / 匿名 / 扩展 OAuth）；`claim`/`finish` 非 `service_role`；lease 缺失或 `lease_id` 不匹配 | `AVATAR_FORBIDDEN` | `42501` |
| 结果结构非法 | `AVATAR_INVALID_RESULT` | `22023` |
| 同一 lease 用不同结果二次完成 | `AVATAR_COMPLETION_REUSED` | `22023` |
| 状态不允许完成（非 `running`/`cancelled`/`interrupted` 且 lease 无 digest） | `AVATAR_INVALID_STATE` | `22023` |

---

## 6. RLS / ACL 断言清单

以下每一条都必须有自动化断言，且**两侧各覆盖一次**；"覆盖"的含义按断言类型定（v2 明确）：**结构型**（`has_table_privilege`/`has_function_privilege`/`pg_policy`/`prosecdef`）由 PGlite 契约断言，**行为型**（真实 `42501`、行不可见、RPC 拒绝）由 pgTAP 断言。括号内为镜像依据；P 侧必需清单见 §8.4 第 1 点。

### 6.1 表权限

| 断言 | 期望 | 依据 |
| --- | --- | --- |
| `has_table_privilege('authenticated','public.avatar_runs','SELECT')` | true | `resource_runs.sql:22` |
| `… 'public.avatar_runs','INSERT'` / `'UPDATE'` / `'DELETE'` | 全 false | `resource_runs.test.sql:23`；`test-m1-migration.mjs:595` |
| `has_table_privilege('anon','public.avatar_runs','SELECT'` / `'INSERT'` / `'UPDATE'` / `'DELETE')` | 全 false | `resource_runs.sql:21` |
| `has_table_privilege('service_role','public.avatar_runs','SELECT'` / `'UPDATE')` | 全 false | `resource_runs.sql:21`；`resource_runs.test.sql:124` |
| `has_table_privilege('authenticated','private.avatar_quotas','SELECT')` | false | `resource_runs.test.sql:25` |
| `has_table_privilege('authenticated','private.avatar_leases','SELECT')` | false | `resource_runs.test.sql:24` |
| `has_table_privilege('service_role','private.avatar_quotas','SELECT,INSERT,UPDATE')` | true | `resource_runs.sql:38` |
| `has_table_privilege('service_role','private.avatar_quotas','DELETE'` / `'TRUNCATE')` | 全 false | I17 |
| `has_table_privilege('service_role','private.avatar_leases','SELECT'` / `'INSERT'` / `'UPDATE'` / `'DELETE')` | 全 false | `resource_runs.sql:37` |
| `relrowsecurity` = true（`public.avatar_runs`、`private.avatar_quotas`、`private.avatar_leases`） | true ×3 | I13 |

### 6.2 策略形状

| 断言 | 期望 |
| --- | --- |
| `select count(*) from pg_policy where polrelid='public.avatar_runs'::regclass` | `1` |
| 该策略名 = `avatar_web_owner_read`，`polcmd='r'`，`polroles` 仅含 `authenticated` | 命中 |
| 该策略 `qual` 与 `((select auth.uid()) = owner_id and not (select private.is_extension_client()) and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb)` 等价 | 等价（镜像 `resource_runs.sql:23-25`） |
| `select count(*) from pg_policy where polrelid in ('private.avatar_quotas'::regclass,'private.avatar_leases'::regclass)` | `0`（镜像 `resource_maintenance.test.sql:69`） |

### 6.3 函数权限（逐函数断言，两套命名空间都要断言）

| 函数 | `authenticated` | `service_role` | `anon` |
| --- | --- | --- | --- |
| `public.begin_avatar_run(jsonb)` | EXECUTE = **true** | false | false |
| `public.read_avatar_run(uuid)` | **true** | false | false |
| `public.cancel_avatar_run(uuid)` | **true** | false | false |
| `public.claim_avatar_run(uuid,uuid,uuid)` | false | **true** | false |
| `public.finish_avatar_run(uuid,uuid,uuid,jsonb)` | false | **true** | false |
| `private.` 同名五个函数 | 与 public 完全一致 | 与 public 完全一致 | 全 false |
| `private.avatar_web_actor()`、`private.avatar_expire_runs(uuid)`、两个校验器 | 全 false（所有角色） | 全 false | 全 false |

（镜像 `resource_runs.sql:275-286`；PGlite 断言镜像 `test-m1-migration.mjs:592-599`。）

**P 侧（PGlite 契约）必须完整断言本节，不得只抽一条代表**（v2 明确，回答"两套命名空间都要断言"的确切含义）：
1. `private` 与 `public` **两套命名空间**的全部五个入口的 EXECUTE 矩阵——同一条查询里同时取两套，避免只查 `public.*`；
2. `private.*` 的 `prosecdef = true` 与对应 `public.*` 包装的 `prosecdef = false`，**五对全部断言**（不得只查 `begin`）；
3. `private.avatar_web_actor()`、`private.avatar_expire_runs(uuid)` 与两个校验器对所有角色 `EXECUTE = false`；
4. §6.2 的策略形状：策略名、`polcmd='r'`、`polroles` 仅含 `authenticated`、谓词含 `owner_id`/`is_extension_client`/`is_anonymous`。

（`test-m1-migration.mjs` 的 `verifyAvatarUpgrade(before)` 已按此实现，本节即其验收口径。）

### 6.4 "扩展客户端不能读表"

| 断言 | 期望 | 依据 |
| --- | --- | --- |
| jwt 含 `client_id` 时 `select count(*) from public.avatar_runs` | `0` | `resource_runs.test.sql:113-114`（`is_extension_client()` 语义：任何非空 `client_id` 都为 true，`20260909170755_proposal_confirmation_hardening.sql:4-13`） |
| jwt 含 `client_id` 时 `select public.read_avatar_run(<自己的 run>)` | 抛 `AVATAR_FORBIDDEN`（`42501`） | `resource_runs.test.sql:115` |
| jwt `is_anonymous = true` 时 `read_avatar_run` | `AVATAR_FORBIDDEN`（`42501`） | `resource_runs.test.sql:116-117` |
| 无 `sub`（未认证）时 `read_avatar_run` | `AVATAR_FORBIDDEN`（`42501`） | `resource_runs.sql:42` |
| 另一个账号（非扩展、非匿名）`select count(*)` | `0`；`read_avatar_run(<他人 run>)` → `AVATAR_NOT_FOUND`（`P0002`） | `resource_runs.test.sql:111-112` |

---

## 7. Storage 契约

### 7.1 桶

| 属性 | 冻结值 | 依据 |
| --- | --- | --- |
| bucket id / name | `avatar-models` | `docs/avatar-ai-generation-feasibility.md:5`（GLB 存入 Supabase Storage 用户资产库） |
| `public` | `false`（私有） | 本增量冻结范围（private bucket） |
| `file_size_limit` | `10485760`（10 MiB） | `apps/web/src/lib/scene/preview-asset.ts:4`（既有 GLB 试装上限 10 MB）。**不得**改用 `docs/scene-intake-preview.md:31` 的 8 MB：该文档明确写了它**未测量** |
| `allowed_mime_types` | `{model/gltf-binary}`（单一元素） | GLB 的唯一标准 MIME；不得允许 `*/*`、`application/octet-stream`、`model/gltf+json`、`image/*` |
| 创建方式 | 迁移内 `insert into storage.buckets(...) on conflict (id) do update set ...`（可重复执行） | `supabase/config.toml` 中**没有 `[storage]` 段**（全文 1-64 行），故桶必须由 SQL 迁移建立，不能靠 CLI 配置声明 |

### 7.2 路径约定

对象名冻结为三段：`<owner_id>/<run_id>/avatar.glb`

- 第一段必须是 run 的 `owner_id`（小写 uuid 文本），且它是 owner 读判据；
- 第二段必须是 run 的 `id`；
- 第三段固定字面量 `avatar.glb`（每个 run 恰好一个产物，不做多文件）。

`finish_avatar_run` 的成功结果 `objectPath` 必须回显该路径（§5.4），使存储位置与运行记录在数据库层绑定。

### 7.3 读策略

- 策略名 `avatar_models_owner_read`，作用于 `storage.objects`，`for select to authenticated`。
- 谓词必须等价于：`bucket_id = 'avatar-models' and (select auth.uid())::text = split_part(name,'/',1) and not (select private.is_extension_client()) and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb`。
- 不得为 `anon`、`public` 建立任何策略 → 默认拒绝。
- 不得使用 `storage.objects.owner` 列作为唯一判据：服务端 `service_role` 上传时该列可能为 NULL（本契约要求以路径第一段为判据，避免与 Storage API 的 owner 赋值行为耦合）。

### 7.4 写路径

- `storage.objects` 上**不得**存在面向 `anon`/`authenticated`/`public` 的 `INSERT`/`UPDATE`/`DELETE` 策略；且不得为这些角色新增 `INSERT`/`UPDATE`/`DELETE` 的表权限。只有服务端（`service_role`，绕过 RLS）写入；Web 端只读。
- **结构断言的 SQL 形态固定为**（`polroles = array[0::oid]` 即 PUBLIC；`storage.objects` 是平台所有的表，因此**只断言我们这条策略的存在与客户端写策略的缺失，不断言整表策略唯一**）：
  `select count(*) from pg_policy where polrelid='storage.objects'::regclass and polcmd in ('a','w','d') and (polroles = array[0::oid] or polroles && array[(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='anon')]::oid[])` = `0`。
- 同时断言 `storage.objects` 的 `relrowsecurity = true`。
- **行为断言必须按三种 DML 的真实语义分别写（v2 修正）**：RLS 开启且无写策略时三者结果**不同**，不得一律期待 `42501`：
  1. `INSERT` → **抛 `42501`**（`new row violates row-level security policy`），用 `throws_ok(..., '42501', null, …)`；
  2. `UPDATE` → **静默 0 行**（不是错误）：`with changed as (update storage.objects set name = … returning 1) select is((select count(*)::int from changed),0,…)`；
  3. `DELETE` → **静默 0 行**：`with deleted as (delete from storage.objects … returning 1) select is((select count(*)::int from deleted),0,…)`；
  4. 三者之后必须补一条"fixture 对象行数未变"的断言，证明被拒的写没有副作用。
  v1 曾把三者都写成"被拒绝（`42501`）"，该写法对 `UPDATE`/`DELETE` 是错的（verifier 实测，见附录 B）。

### 7.5 合规约束

- 该桶**只放生成的 GLB**。**禁止**把用户原始照片放进该桶（`docs/avatar-ai-generation-feasibility.md:287` 的 PII 禁令）；上传桶与去身份化不属于本增量（§9）。
- 生成物必须在同一次运行内转存成功：`docs/avatar-ai-generation-feasibility.md:15`（非 Enterprise 的 API 产物只保留 3 天）。P1 只负责承载与权限，不实现下载转移。

### 7.6 在 PGlite 没有 storage schema 时如何验证（强制方案）

`scripts/test-m1-migration.mjs:24-39` 只桩 `anon`/`authenticated`/`service_role`、`auth.uid()`/`auth.jwt()`；它按目录名顺序执行**每一个**迁移（`:60-84`），且没有 `storage` schema。因此：

1. **迁移必须对 storage 环境自适应**：所有 `storage.*` DDL 必须包在 `to_regclass('storage.objects') is not null` 的守卫内（或等价的、在缺 schema 时根本不执行的写法）。验收要求是行为级的：在 PGlite（无 storage schema）下应用该迁移**必须成功且不产生任何 storage 对象**，同时 `public`/`private` 的表与函数照常创建。**不得**用修改 harness 来规避。
2. **storage 行为只在真实本地栈的 pgTAP 中验证**：新增 `supabase/tests/database/avatar_storage.test.sql`，由 `npm run supabase:test`（`package.json:37`，本地 Supabase 栈，storage schema 存在）执行。该文件必须：
   - 先断言前置条件（失败必须显式报错，不得静默跳过）：
     - `to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null`；
     - `select relrowsecurity from pg_class where oid='storage.objects'::regclass` = true；
     - `has_table_privilege('authenticated','storage.objects','SELECT')`（若本地栈未授予该权限，则 RLS 实测探针无法执行；此时 owner-only 读只能退化为策略形状断言，且必须在测试输出中显式报告"环境阻塞"，而不是改写成通过）；
   - 断言桶行：`select public, file_size_limit, allowed_mime_types from storage.buckets where id='avatar-models'` = `(false, 10485760, {model/gltf-binary})`；
   - 断言策略存在与形状（§7.3、§7.4）；
   - 以 `set local role authenticated` + `set_config('request.jwt.claims', …)` 实测：owner 能 `select` 自己路径下的对象；另一个 uid 的行数为 0；带 `client_id` 的会话行数为 0；匿名会话行数为 0；写路径按 §7.4 的三种真实语义**分别**断言（`INSERT` → `42501`；`UPDATE`/`DELETE` → 静默 0 行），并补 fixture 未变断言；"无写策略"的 `pg_policy` 断言必须覆盖 PUBLIC 与 `anon`/`authenticated` 重叠两种角色形态。
   - 生命周期：文件以 `begin; … rollback;` 包裹（与 `supabase/tests/resource_runs.test.sql:1,131` 相同），不得在本地栈留下对象行。
3. **PGlite 契约里不要写 storage 断言**。需要在 PGlite 也验证 storage 时，最小的 harness 改动（**本契约不自行实施，需协调者授权**）是在 `scripts/test-m1-migration.mjs` 的初始 `db.exec()`（`:24-39`）内追加：
   `create schema storage;`
   `create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);`
   `create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id), name text not null, owner uuid);`
   `alter table storage.objects enable row level security;`
   `grant usage on schema storage to anon, authenticated, service_role;`
   除此之外**不允许**改动该文件的既有断言；并且必须承认：PGlite 无法模拟 Storage API，所以即使加了 stub，也只能验证策略形状与 RLS，**不能**验证桶可见性、MIME 与大小上限的真实拒绝（那属于 Storage API 行为，见 §9）。

---

## 8. 测试矩阵

位置标记（v2 定义，取代 v1 的模糊说法）：
- **P** = PGlite 契约（`scripts/test-m1-migration.mjs`，`npm run test:db-contract`）：负责迁移可应用性、既有数据保全、§6 的**结构型**断言，以及 §8.4 第 1 点冻结的**生命周期行为清单**。
- **T** = pgTAP（`npm run supabase:test`，`supabase/tests/database/avatar_runs.test.sql`）：负责**行为型**断言（真实 `42501`、RLS 过滤、RPC 拒绝）与 §6 的行为型断言；**所有行的最终判据在 T**。
- **S** = 同一 T 命令下的 `supabase/tests/database/avatar_storage.test.sql`（唯一能访问 storage schema 的位置）。
- 标记为「P、T」的行 = **两侧都必须有断言**：P 侧按 §8.4 第 1 点的 P 侧形式，T 侧按行为型。标为单边（P / T / S）的行只需在该侧断言。
- 类别：正常 / 边界 / 错误 / 恢复 / 回归 / 非目标。

| 编号 | 类别 | 前置 | 操作 | 期望可观察结果 | 断言位置 |
| --- | --- | --- | --- | --- | --- |
| T01 | 正常 | 新账号（`auth.users` 触发 profile+blueprint），`private.avatar_quotas(owner,'generate',1)` | `public.begin_avatar_run({runId:A,kind:'generate',themeId:'cyberpunk',themeVersion:1})` | 返回行 `status='queued'`、`result is null`、`kind='generate'`、`theme_id`/`theme_version` 已固化、`expires_at-created_at = 600s`；quota 变 `0` | P、T |
| T02 | 正常 | T01 之后 | 再次 `begin` 同参数 | 返回**与 T01 逐字段相等**的行；quota 仍为 `0`（不重复扣减） | P、T |
| T03 | 正常 | T02，`set role service_role` | `public.claim_avatar_run(owner,A,lease=L1)` | `{"acquired":true}`；`status='running'`；`expires_at-now ≈ 1800s`；`private.avatar_leases` 有且仅有 `(A,L1)` | T |
| T04 | 错误 | T03 | 再用 `L2` 调 `claim` | `{"acquired":false}`；状态仍 `running`；lease 仍是 `L1`（租约不可改写）；quota 不变 | T |
| T05 | 正常 | T03 | `finish(owner,A,L1,{status:'generated',objectPath:'<owner>/<A>/avatar.glb',mimeType:'model/gltf-binary',bytes:1048576,sha256:<64hex>})` | `status='ready'`；`result` 保存；lease 的 `completion_digest` 非空 | T |
| T06 | 正常 | T05 | 同 lease 同 result 再 `finish` | 返回与 T05 完全相同的行（幂等）；quota 不变 | T |
| T07 | 正常 | T05 后为新 runId B 发放 1 次额度 | `begin(runId:B,…)` → `cancel_avatar_run(B)` → 再次 `cancel_avatar_run(B)` | 第一次 `status='cancelled'`、`result={"status":"cancelled"}`、quota +1；第二次返回同一行且**不再退款** | T |
| T08 | 正常 | T05（owner 已无活动 run） | `begin(runId:C,…)` | `status='queued'`（终态不阻塞新 run，单飞只约束 `queued`/`running`） | T |
| T09 | 边界 | 账号无 quota 行 | `begin(runId:D,…)` | `AVATAR_QUOTA_EXHAUSTED`（`P0001`）；`private.avatar_quotas` 中**不产生**新行；`public.avatar_runs` 不产生行 | P、T |
| T10 | 正常 | T05 | `delete from auth.users where id=owner` | `avatar_runs`/`avatar_quotas`/`avatar_leases` 中该 owner 的行数全为 0 | T |
| T11 | 边界 | quota = 1 | 连续两次 `begin`（不同 runId） | 第二次必为 `AVATAR_QUOTA_EXHAUSTED` 或 `AVATAR_BUSY`（取决于第一次是否仍活动），且**不得**出现负额度（`available_attempts >= 0`） | T |
| T12 | 边界 | 一条 `ready` 行 | 直接 `update public.avatar_runs set expires_at=clock_timestamp()-interval '1 second'` 后 `read` | 仍返回 `ready`（`expires_at` 只约束 `queued`/`running`；`docs/agent-resource-runs.md:62`） | T |
| T13 | 边界 | `running` 行 | `bytes = 10485760` 的合法结果 → 成功；`bytes = 10485761` → 拒绝 | 前者 `ready`；后者 `AVATAR_INVALID_RESULT`（`22023`） | T |
| T14 | 边界 | `running` 行 | `p_result::text` 超过 4194304 octet | `AVATAR_INVALID_RESULT`（`22023`） | T |
| T15 | 错误 | 超级用户会话 | 直接 `insert`/`update` `status='unknown'` | check 约束失败（SQLSTATE `23514`） | P、T |
| T16 | 错误 | 已发放额度 | `begin` 传 `kind:'mesh'`；`themeId:'Neon'`（违反 I6 形状）；`themeVersion:0`；多余键 `{"extra":1}`；缺 `themeVersion` | 全部 `AVATAR_INVALID`（`22023`），且不插入行、不扣额度 | P、T |
| T17 | 错误 | 格式合法但 `themeId`/`themeVersion` ≠ owner 当前 `profiles` 对（例如 `themeId:'neon'`、或 `themeVersion:2`） | `begin` | `AVATAR_VERSION_CONFLICT`（`40001`），不插入、不扣额度 | T |
| T18 | 错误 | `set local role authenticated` | `update public.avatar_runs set result='{}'`；`insert`；`delete` | 全部 `42501`（权限不足）；行不变 | P、T |
| T19 | 错误 | 另一个账号（非扩展、非匿名） | `select count(*) from public.avatar_runs`；`read_avatar_run(<owner 的 run>)` | 计数 `0`；`AVATAR_NOT_FOUND`（`P0002`） | T |
| T20 | 错误 | jwt 带 `client_id`（扩展客户端） | `select count(*) from public.avatar_runs`；`read_avatar_run(<自己的 run>)` | 计数 `0`；`AVATAR_FORBIDDEN`（`42501`） | T |
| T21 | 错误 | jwt `is_anonymous=true` / 无 `sub` | `read_avatar_run` | `AVATAR_FORBIDDEN`（`42501`） | T |
| T22 | 错误 | 已有一条活动 run | 用新 runId `begin` | `AVATAR_BUSY`（`P0001`）；quota **不变**（扣减必须发生在 BUSY 判定之后） | P、T |
| T23 | 错误 | 已有活动 run | 直接 `insert` 第二条同 owner 的活动行（超级用户） | 违反 `avatar_one_active_owner` 唯一索引（`23505`）——数据库层单飞证明 | P、T |
| T24 | 错误 | 已有活动 run | 同 runId 改 `themeVersion` 再 `begin` | `AVATAR_RUN_REUSED`（`22023`）；行未被改写；quota 不变 | T |
| T25 | 错误 | — | `begin` 使用已被他人占用的 runId | `AVATAR_NOT_FOUND`（`P0002`） | T |
| T26 | 错误 | `running` 行、lease L1 | `finish(...,L2,合法结果)`；`finish` 给错误 owner；`finish` 传 `null` 参数 | 分别 `AVATAR_FORBIDDEN`（`42501`）、`AVATAR_NOT_FOUND`（`P0002`）、`AVATAR_INVALID`（`22023`） | T |
| T27 | 错误 | `running` 行 | `finish` 传缺 `objectPath` / `mimeType` 错 / `sha256` 非 64 位小写 hex / 失败态结果夹带额外键 / `bytes=0` | 全部 `AVATAR_INVALID_RESULT`（`22023`），且 run 的 `result`/`status`/digest 均未被写入 | T |
| T28 | 错误 | T06（已有 digest） | 同 lease 换一个不同但合法的结果再 `finish` | `AVATAR_COMPLETION_REUSED`（`22023`）；run 未被覆盖 | T |
| T29 | 错误 | 终态 run（`ready`/`cancelled`） | `claim` | `{"acquired":false}`，状态不变，lease 不变 | T |
| T30 | 错误 | `set local role authenticated`（未被授予 EXECUTE） | `select public.claim_avatar_run(...)` / `finish_avatar_run(...)` | `42501`（权限不足）；函数内 `current_setting('role') <> 'service_role'` 的兜底也必须存在（镜像 `resource_runs.sql:172,249`） | T |
| T31 | 恢复 | `queued` 行 | 直接改 `expires_at` 到过去 → `read_avatar_run` → 再次 `read` | 首次 `status='cancelled'`、`result={"status":"cancelled"}`、quota +1；第二次结果相同且 **quota 不再增加** | T |
| T32 | 恢复 | `running` 行（已扣额度） | 直接改 `expires_at` 到过去 → `read` | `status='interrupted'`、`result={"status":"timed_out"}`、quota **不退回** | T |
| T33 | 恢复 | T32 之后 | `finish(正确 lease, 成功结果)` → 再次同结果 `finish` → 换结果 `finish` | 三次返回的状态都保持 `interrupted`（迟到成功不复活）；第二次幂等；第三次 `AVATAR_COMPLETION_REUSED` | T |
| T34 | 恢复 | `interrupted` 行（额度已耗尽） | 用**新** runId `begin` | `AVATAR_QUOTA_EXHAUSTED`（`P0001`）——明确不存在"免费重试"路径 | T |
| T35 | 恢复 | 构造：`running` 行 + lease，且用超级用户把该 run 置为 `stale`（或 `ready` 且清空 `completion_digest`） | `finish(正确 lease, 合法结果)` | `AVATAR_INVALID_STATE`（`22023`）——防御分支，不得被静默忽略 | T |
| T36 | 恢复 | 租约过期的 run | 断言 lease 行仍存在且 `lease_id` 未变；`claim` 返回 `acquired:false` | 满足 §4.3 的 1/2 两条 | T |
| T37 | 回归 | 迁移已应用 | `select count(*) from pg_policy where polrelid='public.avatar_runs'::regclass`；私有两表策略数 | 分别 `1` 与 `0` | P、T |
| T38 | 回归 | 迁移已应用（在既有账号与既有业务数据之后） | PGlite harness 的 `_avatar_runs.sql` 钩子：迁移前抓取所有 `public`/`private` 表，迁移后比对 | 既有表逐行 byte-identical；`public.avatar_runs`/`private.avatar_quotas`/`private.avatar_leases` 均为 0 行（不伪造历史、不发放额度） | P |
| T39 | 回归 | 迁移已应用 | 在 PGlite 契约里断言 §6.1/§6.3 的 ACL 矩阵 | 全部命中（含 `anon` 不能 begin、`authenticated` 不能 claim、`service_role` 不能直写 `public.avatar_runs`、quota 无 DELETE） | P |
| T40 | 回归 | 本地栈 | 运行既有全部 pgTAP 套件（含 `resource_runs`、`path_planning_runs`、`resource_maintenance`、`translation_runs`、`explanation_runs`） | 0 失败；既有表的策略数与 ACL 未被放宽 | T |
| T41 | 回归 | 本地栈 storage 可用 | **必需证据**（T41 是 §7.1"可重复执行"的全部证据）：按迁移原样重放 `insert into storage.buckets(...) on conflict (id) do update …` 与策略守卫（`if not exists (select 1 from pg_policy …) then create policy …`） | 桶行仍恰 1 条且 `public`/`file_size_limit`/`allowed_mime_types` 不变；策略 `avatar_models_owner_read` 仍恰 1 条；重放不报错 | S |
| T42 | 回归 | 本地栈 storage 可用 | 桶属性与策略形状断言（§7.3/§7.4） | `public=false`、`file_size_limit=10485760`、`allowed_mime_types={model/gltf-binary}`；owner 读策略存在；`anon`/`authenticated` 无写策略；`storage.objects` RLS 开启 | S |
| T43 | 回归 | 本地栈 storage 可用 | 以 `authenticated` + owner jwt 读自己的对象 / 读他人对象 / 扩展客户端读 / 匿名读 | 分别：成功 / 0 行 / 0 行 / 0 行 | S |
| T44 | 正常（**正例**） | `running` 行 + lease L1（v2 新增，BLOCKER 回归行） | `finish(owner,A,L1,{"status":"unavailable"})` → 再精确重放一次 | 首次 `status='failed'`、`result` 逐字持久化为 `{"status":"unavailable"}`、lease 的 `completion_digest` 非空；重放返回同一行且不改写。**§1.3 的全部八个失败字面量必须在 T 侧各被接受至少一次**（可用循环 + 每次重置额度实现），P 侧至少覆盖 `unavailable` 与 `rate_limited` | P、T |
| T45 | 错误 | `running` 行 + lease（v2 新增） | `finish` 传 `{"status":"bogus"}`，随后用合法字面量完成 | 首个抛 `AVATAR_INVALID_RESULT`（`22023`），且 run **仍为 `running`**、lease 仍无 digest（被拒结果不留痕、不夺执行权）；随后合法字面量仍能完成 | P、T |
| T46 | 边界 | `running` 行 + lease（v2 新增） | `finish` 传 `bytes=0` 与 `bytes=10485761`（上界见 §5.4） | 两者都抛 `AVATAR_INVALID_RESULT`（`22023`），run 状态与 digest 不变 | P、T |
| T47 | 恢复 | 一条 `ready` 行 + owner 的 `profiles` 主题对已改变（v2 新增，覆盖 S13/S12） | 改 `profiles.theme_id`（或 `theme_version`）后 `read_avatar_run`；再对一条 `running` 行做同样改动后 `finish` | 前者 `ready → stale` 且 `result` 保留；后者 `finish` 得 `stale`（S12）；两者都不可再被 `claim`（`acquired:false`） | T |
| N01 | 非目标 | — | 检查本增量的 diff | 不新增任何 HTTP 客户端、供应商适配器、模型 SDK 调用（无 Meshy/无网络） | 人工审查（无自动断言） |
| N02 | 非目标 | — | 检查本增量的 diff 路径 | 不新增 `apps/web/src/app/**` 路由、不新增 `supabase/functions/**` | 人工审查 |
| N03 | 非目标 | — | 检查本增量 | 不建立上传桶、不接收用户照片、不在 `avatar-models` 存原图 | 人工审查 + §7.5 |
| N04 | 非目标 | — | 检查本增量 | 不实现保留期/对象删除/cron 调度（`supabase/migrations` 中无 pg_cron 用法） | 人工审查 |
| N05 | 非目标 | — | 检查本增量 | 数据库不解析 GLB 字节（自包含、glTF 2.0、外链拒绝仍由 `preview-asset.ts:6,12` 的客户端校验负责） | 人工审查 |
| N06 | 非目标 | — | 检查本增量 | 不提供额度发放 RPC；不自动插入 quota 行 | 人工审查（T09 已覆盖行为） |
| N07 | 非目标 | — | 检查本增量的 diff | 不修改任何既有表/函数/策略/ACL 定义 | T38 + T40 |

### 8.4 断言位置的能力边界（含最小补充改动）

1. **PGlite 契约（`npm run test:db-contract`）**：单进程、单连接、单事务；只桩了 `anon`/`authenticated`/`service_role` 与 `auth.uid()`/`auth.jwt()`（`scripts/test-m1-migration.mjs:24-39`）。因此它**不能**验证：storage（无 schema）、真实并发（无第二个连接）、PostgREST/Auth 层语义。
   - **契约要求新增的钩子**（本增量对该文件的唯一允许改动，镜像 `:65`/`:77` 与 `:628-648` 的写法）：在迁移循环里加一行 `const avatarUpgrade = file.endsWith("_avatar_runs.sql") ? await captureResourceUpgrade() : null;`（复用 `:459-468` 的 capture），迁移后加 `if (avatarUpgrade) await verifyAvatarUpgrade(avatarUpgrade);`；并新增 `verifyAvatarUpgrade(before)`（数据保全 + 形状/ACL）与 `verifyAvatarLifecycle()`（生命周期行为）。**另需一条 fail-closed 断言**：本增量必须在迁移扫描中真实出现过（迁移文件被删除/改名时直接失败，而不是静默通过）。不得改动既有断言。
   - **P 侧必需清单（v2 冻结；"现状"仅为追踪快照，不改变要求）**：

     | 行 | P 侧必须断言的形式 | v2 时现状 |
     | --- | --- | --- |
     | T01 / T02 | `begin` → `queued`；精确重放返回逐字段相同的行；额度恰扣 1 | 已实现 |
     | T03 / T04 | 首次 `claim` → `acquired:true` 且状态 `running`；第二次 `claim` → `acquired:false` 且 lease 不被改写 | 已实现（可选保留） |
     | T05 / T06 | 成功回执 → `ready`、`result` 保存、digest 非空；精确重放逐字段相等 | 已实现（可选保留） |
     | T07 | `cancel` ×2 → 终态稳定且**只退款一次** | 已实现（可选保留） |
     | T09 | 无 quota 行 → `AVATAR_QUOTA_EXHAUSTED`；run 与 quota 均不产生新行 | 已实现 |
     | T10 | 删除账号 → run/quota/lease 全部级联为 0 | 已实现（可选保留） |
     | T15 | 超级用户 `insert`/`update` `status='unknown'` → check 约束 `23514` | **待补** |
     | T16 | 五种非法请求（`kind='mesh'`、`themeId='Neon'`、`themeVersion=0`、多余键、缺键）各 → `AVATAR_INVALID`（`22023`），且行数与额度不变 | **待补** |
     | T18 | §6.1 的 `has_table_privilege` 结构断言（行为型 `42501` 归 T） | 已实现 |
     | T19 | 另一账号 `count(*) = 0`（跨账号隔离） | 已实现（可选保留） |
     | T22 | 第二个活动 run → `AVATAR_BUSY` 且**额度不变** | 已实现 |
     | T23 | 部分唯一索引存在（`indisunique and indpred is not null` = 1）**且** 直接插入第二条活动行 → `23505` | 索引断言已实现；`23505` **待补** |
     | T31 / T32 | 过期清扫：`queued→cancelled` 退款一次；`running→interrupted` 不退款 | **待补** |
     | T33 | 迟到成功回执不复活 `interrupted`（保持终态、digest 记录） | **待补** |
     | T37 | `pg_policy` 计数 = `1`（public）/ `0`（private） | 已实现 |
     | T38 / T39 | 既有表逐行不变、三张新表为空；§6.1 + §6.3 矩阵 + §6.2 形状 | 已实现 |
     | T44 | 合法失败回执 → `failed`、`result` 逐字保存、digest 非空；精确重放幂等 | 已实现（`unavailable`；`rate_limited` 待补） |
     | T45 | 未知字面量 → `AVATAR_INVALID_RESULT`，run 仍 `running`、lease 无 digest | 已实现 |
     | T46 | `bytes=0` 与 `bytes=10485761` 各 → `AVATAR_INVALID_RESULT` | 下界已覆盖；上界 **待补** |
     | §6.3 / §6.2 | 两套命名空间五个函数的 EXECUTE 矩阵 + 五对 `prosecdef` + 守卫/校验器全 false + 策略形状 | 已实现 |
     | 其它行（T08、T11–T14、T17、T20、T21、T24–T30、T34–T36、T47） | 不要求 P 侧复刻；最终判据在 T | 见 §8 位置标记 |
   - 若还想在 PGlite 做 storage 断言，最小改动是 §7.6 第 3 点的 storage stub（需授权）。
2. **pgTAP（`npm run supabase:test`）**：单会话单事务，能访问真实 ACL/RLS 与 storage schema；**不能**验证两个真实连接的交错并发。
   - 真并发的最小补充（不在本契约的必测清单内，除非协调者要求）：新增 `scripts/test-avatar-local.mjs`，镜像 `scripts/test-blueprint-snapshot-local.mjs:1-15` 的做法（`docker exec supabase_db_blueprint-local psql` 开两个连接 + gate 观测），对同一 owner 并发调用 `public.begin_avatar_run` 与 `public.claim_avatar_run`，断言"至多一个活动 run、额度恰好扣 1、至多一个 lease"。
   - 备选（同样需授权）：新增 `apps/web/agent-integration/avatar-runs.spec.ts`，用两个 Supabase client + `Promise.all` 直接调 RPC（写法镜像 `apps/web/agent-integration/resource-runs.spec.ts:639-646` 与 `planning-runs.spec.ts:210`），由 `npm run test:agent-runs` 执行。
3. **本契约的并发验收口径**：P1 的 REQUIRED 证据是数据库层与入口层证据（T22、T23、T04，以及 T22 的"不扣额度"）；真并发属于**显式记录的缺口**，在 P2（worker/路由批次）补齐。

---

## 9. 明确的非目标（本增量禁止做）

1. 任何供应商调用与网络请求：不接入 Meshy 或其它 3D/图像服务，不实现下载转移、不做 webhook/轮询/重试。
2. 不实现用户照片上传、去身份化、多视图风格化、绑定、动画、贴图等流水线步骤（`docs/avatar-ai-generation-feasibility.md` 的第 3/4 步）。
3. 不新增上传桶、不把用户照片放进 `avatar-models`（PII 禁令，`:287`）。
4. 不新增 `/api` 路由、页面、组件、Three.js 展示、worker、Edge Function、开关或凭据。
5. 不实现保留期、`cleared_at`/`clear_reason`、对象删除、cron/调度与算子收据（resource 家族里对应 `20260910113909`、`20260910200329`、`20260910204925` 的能力）。
6. 不解析或校验 GLB 字节（自包含性、glTF 2.0 版本、外部 URI 拒绝仍归客户端校验器）。
7. 不提供额度发放/充值 RPC；不自动插入 quota 行；不把免费次数写进迁移。
8. 不实现真并发测试基础设施（第二个连接、dblink、pg_cron）。
9. 不修改任何既有表、策略、函数、ACL、文档或脚本（`scripts/test-m1-migration.mjs` 仅允许 §8.4 第 1 点列出的钩子）。
10. 不在 `supabase/config.toml` 增加 `[storage]` 段或任何桶声明；桶只由迁移 SQL 建立。
11. 文档与路线图更新（如 `docs/avatar-runs.md`、`docs/README.md` 索引）不属于本契约的测试验收对象，可由实现批次按仓库规则单独补齐。

---

## 10. 未决项

**无（empty）。** 说明：本增量的全部设计决定均已在上文冻结——对象与函数命名（§0.1）、状态与转移（§1）、不变量（§2）、额度时机与退款（§3）、单飞与租约（§4）、幂等判据（§5）、ACL 与 RLS（§6）、桶属性/路径/MIME/大小上限（§7.1-7.4，10 MiB 有仓库依据 `preview-asset.ts:4`）、过期与保留语义（§1.2、§8 T12）、断言位置（§8.4）。

仅存的两项是**环境事实**而非设计选择，因此由测试在运行时以"前置断言 + 显式失败"处理，不构成未决设计问题：

1. 本地 Supabase 栈是否给 `authenticated` 授予 `storage.objects` 的 `SELECT`（§7.6 第 2 点第一项前置断言）。若未授予，owner-only 读的实测探针退化为策略形状断言，且必须在测试输出中显式报告环境阻塞。
2. PGlite 的 `gen_random_uuid()` 与 plpgsql 内 DDL（守卫块）在当前版本的实际行为（§7.6）。若 PGlite 侧的 storage stub 方案被授权，先以一次冒烟运行确认，再决定是否纳入契约断言范围。

---

## 附录 A. 冻结常量速查

| 常量 | 值 |
| --- | --- |
| 状态集 | `queued, running, ready, failed, cancelled, interrupted, stale` |
| 失败结果状态 | `invalid_input, not_applicable, unavailable, rate_limited, cancelled, timed_out, not_found, invalid_output` |
| 成功结果状态 | `generated` |
| `kind` | `generate` |
| 请求键（恰好） | `runId, kind, themeId, themeVersion` |
| 请求体积上限 | `32768` octet（镜像 `resource_runs.sql:71`） |
| 结果体积上限 | `4194304` octet（镜像 `resource_runs.sql:194`） |
| queued 期限 | `600` 秒 |
| running 期限 | `1800` 秒 |
| 桶 | `avatar-models`（private） |
| 桶大小上限 | `10485760` byte |
| 桶 MIME | `{model/gltf-binary}` |
| 对象路径 | `<owner_id>/<run_id>/avatar.glb` |
| 表策略名 | `avatar_web_owner_read` |
| 存储策略名 | `avatar_models_owner_read` |
| 唯一索引 | `avatar_one_active_owner` |
| 最近列表索引 | `avatar_owner_recent on (owner_id, created_at desc, id desc)` |
| 命令 | `npm run test:db-contract`、`npm run supabase:test`、`npm run test:agent-runs` |

---

## 附录 B. 修订记录

### B.1 v2（2026-09-19）

| 项 | 内容 |
| --- | --- |
| 触发 | 独立复核（verifier）在 v1 契约上发现 1 个 BLOCKER + 若干测试矩阵覆盖缺口；其中 BLOCKER 是**实现**缺陷，缺口是**契约**缺陷 |
| 修订者 | 独立 test_designer（本文件作者，v1 冻结者） |
| 修订范围 | 仅本文件；未修改迁移、测试或脚本 |
| 实现侧状态 | 实现缺陷已由实现者修复并经验证器用真实迁移复现证明：`private.avatar_result_valid` 原先对任何非 `generated` 结果返回 false，导致 S10/S11 不可达、§1.3 八个字面量全被误拒（`finish({"status":"unavailable"})` 抛 `22023`）；现改为"非 `generated` 时要求恰好一个键且 `status` ∈ §1.3 集合" |

**BLOCKER 的契约根因**：v1 只把失败状态写进了"允许集/拒绝规则"（§1.3 的负例、T27 的负例），**没有写任何一行"合法失败回执必须被接受并推进到 `failed`" 的正例**。于是过度拒绝的实现能让全部负例"通过"，没有任何 gate 会失败。v2 在 §1.3/§5.4 写明正例义务，并用 T44/T45/T46 把正例、未知字面量与体积边界都变成必需证据。

### B.2 v2 改动清单

| 位置 | 改动 | 理由 |
| --- | --- | --- |
| §1.3 | 新增"正例与负例必须成对存在"：八个失败字面量必须被接受并驱动 `running→failed`；禁止"只白名单 `generated`" | 消除 BLOCKER 的契约盲区 |
| §5.4 | 失败态补充终态映射（`generated→ready`、`cancelled→cancelled`、其余→`failed`） | 让"接受后发生什么"可判定 |
| §6 前言 | 明确"两侧各覆盖一次"的含义：结构型归 P、行为型归 T | 消除 §6 与 §8.4 的措辞冲突 |
| §6.3 | 新增 P 侧四条硬要求：两套命名空间完整 EXECUTE 矩阵、五对 `prosecdef`、守卫/校验器全 false、§6.2 策略形状 | 回答"两套命名空间都要断言"的确切范围；原钩子只断言 `public.*` 且 definer 只查 `begin` |
| §7.4 | 重写写路径断言：结构断言的 SQL 形态固定（含 PUBLIC 角色与 `anon`/`authenticated` 重叠）；行为断言按真实语义分开——`INSERT` → `42501`，`UPDATE`/`DELETE` → **静默 0 行** + fixture 未变；并声明不断言整表策略唯一 | v1 把三种 DML 一律写成"被拒绝（42501）"，对 `UPDATE`/`DELETE` 是错的（verifier 实测） |
| §7.6 | 同步 §7.4 的三种真实语义与角色覆盖要求 | 保持两处一致 |
| §8 前言 | 重写 P/T/S 位置标记定义；"P、T"= 两侧都必须断言 | 消除"§8.4 钩子过窄"与"§8 位置标记"的矛盾——**选择加强 P 侧**，而非放宽前言 |
| §8.4 第 1 点 | 新增 **P 侧必需清单**（逐行给出 P 侧断言形式 + v2 现状），并补"迁移必须真实出现"的 fail-closed 断言 | 让 P 侧验收范围无歧义 |
| §8 矩阵 | 新增 T44（失败回执正例，八字面量各至少一次）、T45（未知字面量被拒且不夺执行权）、T46（`bytes` 上下界）、T47（主题变更触发 S12/S13 的 `stale`） | 补上"没有任何一行断言合法失败回执"这一 BLOCKER 直接成因，以及 v1 漏掉的 stale 覆盖 |
| §8 矩阵 T41 | 明确 T41 为**必需证据**，并把形式写死为"按迁移原样重放桶 upsert + 策略守卫，断言各恰一条且属性不变"（`supabase db reset` 后再应用为等价替代） | v1 只说"重新应用"，没有可执行形式，等于没有 gate |

### B.3 v2 时**尚未实现**的必需证据行（按优先级，供实现/测试批次收口）

1. **T44 八字面量全覆盖**（T 侧）：目前只有 `unavailable`（P 与 T 各一条）；其余七个失败字面量需各被接受一次。
2. **T47 stale**（T 侧）：S12/S13 已在迁移中实现，但两个新测试文件与 harness 对 `stale` 零断言。
3. **T45 的"执行权不丢"断言**（两侧）：需断言被拒后 run 仍 `running` 且 lease 无 digest（harness 已有等价断言，pgTAP 侧需补 lease 未变）。
4. **T46 上界 `bytes=10485761`**（两侧）：目前只有下界 `bytes=0`。
5. **P 侧 T15（未知状态 `23514`）与 T16（五种非法请求）**：见 §8.4 第 1 点清单。
6. **P 侧 T23 的 `23505` 直接插入**：目前只断言了部分唯一索引存在。
7. **P 侧 T31/T32/T33（过期与迟到完成）**：pgTAP 已覆盖，P 侧未复刻（按 §8.4 清单，这三行属 P 必需）。
8. **T 侧尚无断言的既有行**：T08、T11、T12、T13（上界）、T14（结果体积上限）、T15、T25、T29、T30（函数内角色兜底）、T34（无免费重试）、T35（`AVATAR_INVALID_STATE` 防御分支）、T36（过期后 `claim` 的 `acquired:false`）。
9. **T40/T41 之外的回归证据**：T40（既有 pgTAP 套件 0 失败）需要在本地栈实跑一次并留证；T41 需按 §8 的新形式补断言。
10. **真并发**（P2）：按 §8.4 第 3 点的口径，仍是显式缺口。

### B.4 本次修订未改动的部分

v1 的其余冻结值经实现核对**无偏差**，v2 不再改动：`runId` + 三参数（`kind`/`theme_id`/`theme_version`）幂等判据与顺序（重放判定先于主题冲突判定）；lease 校验先于结果校验；`completion_digest` 精确重放；`expires_at` 无 `> created_at` 约束（保证过期可构造）；storage 守卫 `to_regclass('storage.objects') is null … return`；桶 `avatar-models` / 10 MiB / 单一 MIME / 路径第一段 owner 判据；`queued` 600s 与 `running` 1800s；五对 definer/invoker 姿态与两套命名空间的 ACL。
