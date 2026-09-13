# M1 云端纵向切片设置

本文档只描述本地开发和个人托管自测需要完成的外部配置。不要把真实密钥、登录链接、用户邮箱或生产数据提交到仓库。

推荐直接运行九阶段交互式向导。它会在每个远端写入前暂停确认，敏感输入不会显示，Personal Access Token 和数据库密码不会落盘：

```bash
npm run setup:m1-cloud
```

向导可中途退出并重新运行；已经写入 `.env.local` 的配置会被复用。下面各节同时作为人工核对参考。

## 1. 本地环境

要求 Node.js 22、Docker Desktop 和 Supabase CLI `2.115.0`。仓库脚本通过 `npx` 固定 CLI 版本。

```bash
npm ci
npm run check:m1-wizard
npm run supabase:start
npm run supabase:reset
npm run supabase:test
```

复制两个应用各自的 `.env.example` 为 `.env.local`，把 `supabase start` 输出的 URL 和 Publishable Key 写入本地文件。管理员密钥只存在于 Supabase 托管的 Edge Function 环境，不进入 Web 或扩展环境文件。

规划入口默认关闭。未来受控开启时，`DEEPSEEK_API_KEY` 仅配置在 Web 服务端；另生成至少 32 字符的随机 `BLUEPRINT_PLANNING_WORKER_SECRET`，仅在 Web 服务端与 `planning-worker` Edge 环境共享，不能使用 Supabase API 管理员密钥代替。Edge 的管理员密钥由 Supabase 环境提供，只允许领取／保存当前用户运行，不开放通用数据库写接口。该函数在处理器内自行验证用户 JWT 与独立凭据，`verify_jwt=false` 不表示公开访问。函数已按下方 F1 记录部署，凭据配置与真实执行仍待验收；本地测试不会替你开启。

`npm run test:planning-generation` 自动启动本地 Edge 运行时及生产 Web 构建，用真实本地 Auth／数据库与仅测试进程的外部模型响应验证；`scripts/planning-worker.fixture.env` 是公开的本地夹具，绝不能部署到托管环境。测试结束只关闭该次启动的进程，删除该次生成的测试账号，不重置数据库。

已有本地数据时不要重复执行 `supabase:reset`，该命令仅用于可丢弃的新开发数据库。配置变更需重新启动时使用 CLI 默认备份的 `supabase stop` 再 `supabase start`，不要使用 `--no-backup`。增量迁移按迁移文件应用并验证。

本地邀请登录还需在单独终端提供 Edge Function：

```bash
bash scripts/with-m1-runtime.sh npx --yes supabase@2.115.0 functions serve --no-verify-jwt
```

该公开函数仅接受白名单邀请准备，不返回账号数据。`supabase/config.toml` 的全局 `[auth] enable_signup = false` 是公开注册门；`[auth.email] enable_signup = true` 保持邮箱 provider 可用，让预创建的受邀账号能收到 Magic Link，不能把后者也关闭。2026-09-10 已用真实本地 Auth 验证：受邀登录成功，直接公开 signup 仍返回 `signup_disabled`。本地邮件在 Mailpit 查看，按 `supabase start` 提供的地址打开最新链接；无需真实邮箱或邮件额度。以上不表示托管项目配置已更新。

## 2. 受邀邮箱

公开注册必须保持关闭。个人自测前，在 Supabase SQL Editor 或本地数据库中添加允许的邮箱：

```sql
insert into private.invite_allowlist (email)
values ('your-email@example.com')
on conflict (email) do update set status = 'active', expires_at = null;
```

Web 先调用 `prepare-invited-login` Edge Function，仅为白名单邮箱预创建 Auth 用户；函数与 Web 对未受邀邮箱始终返回同样的成功外观。创建用户会由数据库触发器自动消耗邀请。外部邀请开始前必须配置自有 SMTP；Supabase 默认邮件服务只用于个人自测。

登录端点的正常响应只表示“请求受理”，不能据此声称邮件已经送达。邮件限流返回 429，邀请准备服务的传输失败及其他邮件服务故障返回 503；界面保留邮箱且不自动重发。限流后的 60 秒是界面最小冷却，不代表供应商额度必然恢复。真实发送验收需要 Auth 日志中的 `mail.send`，登录验收还需要用户在同一浏览器打开最新链接完成回调。

## 3. 扩展 OAuth

1. 在 Supabase Authentication 中启用 [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)。仓库的本地配置已经启用同一能力并关闭动态客户端注册。
2. 把 Site URL 设为 Web 部署域名，把 Authorization Path 设为 `/oauth/consent`。
3. 进入 **Authentication → OAuth Apps → Add a new client**，注册 Public Client，名称使用 `Blueprint YouTube Companion`。
4. Redirect URI 固定为：

   `https://kipaapemlimhdkpcenelpjeccmnkninf.chromiumapp.org/oauth2`

5. 把生成的 Client ID 写入 Web 和扩展各自环境变量。
6. 在数据库中登记同一 Client ID，使 RLS 能限制扩展写权限：

```sql
insert into private.app_config (key, value)
values ('extension_oauth_client_id', 'the-client-id')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

本地与托管环境应分别注册 Public Client，不复用 Client ID。扩展只申请 `email` scope，并使用 Authorization Code + PKCE；M1 不申请 `openid`，因此不要求项目为了签发 ID Token 提前切换到非对称 JWT 签名。

OAuth Server 当前为 Supabase Public Beta。认证细节被限制在 Web Consent 页面和扩展 Auth Adapter 内；不得在领域模块中依赖 OAuth 响应形状。

## 4. 托管自测

- 创建一个 Supabase 免费项目，执行 `supabase/migrations`，并以公开调用模式部署 `prepare-invited-login` Edge Function；该函数不返回邀请状态或业务数据。
- 在 Vercel 的 **Project Settings → Build and Deployment → Root Directory** 中选择 `apps/web`，确认 **Include source files outside of the Root Directory in the Build Step** 已启用，使构建可以读取 `packages/domain` 和 `packages/ui`，再填入 Web 环境变量。
- 用最终 Vercel HTTPS Origin 和 Supabase HTTPS Origin 构建扩展，使 Manifest 只申请 Web、Supabase 和 YouTube 三类主机权限。
- 从 `apps/extension/.output/chrome-mv3` 加载未打包扩展。
- 按 `docs/execution-roadmap.md` 的 M1 完成门槛执行登录、提案、扩展授权、学习会话、离线恢复和双账号隔离验收。

Supabase 默认邮件服务只适合项目成员个人自测，并有严格限额。开始邀请外部邮箱前，必须在 **Authentication → Emails → SMTP Settings** 配置自有 SMTP；这不是个人自测的前置条件。

## 5. 预构建发布（已有项目）

2026-09-11 起，本地预构建发布需先准备输出，避免 Vercel 构建器额外加入本地环境文件、而上传规则又将它们排除的冲突：

```sh
vercel build --prod
npm run prepare:vercel-output
vercel deploy --prebuilt --prod --skip-domain
```

以上命令使用已登录并已关联的同一项目；本机可通过 `scripts/with-m1-runtime.sh` 使用外置盘运行时。不要为了修复缺失文件而允许上传 `.env.local`。准备步骤只移除生成的 `filePathMap` 中本地 `.env`／`.env.*` 依赖，保留部署环境注入和应用文件；每次重新构建后都要再执行。运行时 Agent Skills 必须上传，仓库根目录旧 `skills/` 才被排除。实际验收以 Vercel `READY` 和 HTTP 结果为准，不能仅依据本地编译通过。

`--skip-domain` 不等于所有别名都保持不动：本次 CLI 仍更新了自动生成的项目别名。因此每次检查主域名的实际 deployment ID，数据库与扩展未准备好前不切换主域名。Snapshot 2 会拒绝旧格式提案写入，切换安排见[节点规划的发布边界](node-planning.md#发布与兼容边界)；不能单独先迁移而让旧页面长期不可编辑。

### 2026-09-11 F1 核查与候选

本节保留后台服务发布前的核查范围；最新 Worker 状态以下方“F1 后台服务发布”为准。

- Supabase 项目健康；实际托管仍为 7 条迁移、本地 26 条，相差 19 条；托管仅 `prepare-invited-login` 一个 Edge Function。规划、澄清、资源、翻译、讲解 Worker 均未部署。
- 已有两个 Auth 用户；指定自测账号存在且邀请已使用。未发送新邮件、读取目标正文或重置数据。
- Vercel 插件列出项目为空，但外置盘现有 CLI 登录配置可以访问原项目；不是项目被删除，不需要新建。生产配置目前仅三个公开 Supabase／OAuth 变量，尚无 Agent 启用和提供方／Worker 配置。
- 主域名仍为 `dpl_3P1TjdDz3WtaHEokBWxZaR8rvpYM`，页面 release 标记 `c53111f85b8b07ff307e3251bcc8f87cee1ffcc4`。旧版 10 项未登录入口检查通过。
- 新候选 [blueprint-m1-lw0blbqqo](https://blueprint-m1-lw0blbqqo-norlymangune65-4981.vercel.app) 为 `dpl_DxNrkuZPCDS9QySgDuSUq3ujcxVi`，状态 `READY`；自动项目别名指向此候选，主域名未切换。10 项实际候选未登录 HTTP 检查通过，覆盖登录页、受保护页面重定向、私有 API 拒绝及设计入口关闭；未验证登录后业务。应用源码固定点 `07bffd8`，打包修复属于本批后续提交。
- 初次候选因缺失 `.env.example` 失败，移除本地环境文件映射后，第二次因误排除运行时 Skill 失败；收窄根目录忽略规则后第三次成功。错误页返回的 HTTP 200 不算应用通过。未修改 Next 运行时配置或放宽环境文件上传。
- 本地完整 `check:m1` 通过 1260 项应用与 108 项 Worker 测试、类型、升级契约及两端构建；新增发布准备回归通过，包含其余文件／注入配置保留与重复执行。Vercel 上传清单实查包含五套运行时 Skill，不含本地环境文件；原“找不到普通 Skill 文件”探针没有识别 `filePathMap`，属于检查方式问题，未据此修改应用。
- 扩展已按正式 Web／Supabase 地址重建并通过安全检查，Manifest SHA-256 为 `7408b80980dc5ff5675eae804846308408688f1b026bf4ae7173333cec5f321b`；没有在用户浏览器中加载或重载。默认本地构建会重新生成 localhost 产物，安装前须核对三项 HTTPS 主机。

未完成：19 条增量迁移的协调发布、Worker／额度／提供方配置、真实账号与扩展升级、完整 F1–F4 连续旅程。托管部分旧迁移与本地同名但时间戳不同，必须核对名称与内容，不直接按版本号重放全部迁移。本批没有迁移、模型调用、付费升级或主域名切换；候选可构建不代表已通过登录后业务验收。

### 2026-09-11 F1 后台服务发布

源码固定点 `f8456b6`。五个现有 Worker 已通过 Supabase 插件部署，重新列举均为 `ACTIVE`、版本 1；原邀请函数仍为版本 1。没有修改应用源码或上传测试夹具、环境文件。

| Worker | Supabase 部署包 SHA-256 |
| --- | --- |
| planning-worker | `c5275a5415678a5bce2189532813e1fbd7bc504d7e374313ed2ff52763ecb191` |
| clarification-worker | `5ceb11a414e827ca9280f0e99956b98d565135e120c9694dad58517da533b168` |
| resource-worker | `b1f0fc1d82fd6db8a3745e1eca2c35d1ac6dff09b331652935adfb9be9c29240` |
| translation-worker | `c5ec6294984f67fed3df76cf14c417157294591dade5da95bb8dcd207bb7f3b7` |
| explanation-worker | `739fb5a5d8a0f4307d520d7fe2006be04a1940a538d3daac1b18c767f4d5e878` |

本批重新通过 108 项 Worker 测试；五个真实托管入口共 15 项 HTTP 检查通过：GET 为 405、非 JSON POST 为 415、无配置的 JSON POST 为 503／对应 `*_WORKER_UNAVAILABLE`；响应均为 `no-store`，无浏览器 CORS 许可。**这些证据只证明部署可启动、当前拒绝执行，不证明已配置身份核验、数据库操作或真实 Agent 流程。** 未发起带真实身份的执行或调用提供方。

`verify_jwt=false` 与现有本地配置一致：处理器自己校验独立 Worker 凭据、签名 JWT 与当前 Auth 用户，再构造管理员客户端；操作和 owner 不能由客户端任意指定。翻译／讲解允许通过核验的 Web 会话；OAuth 会话则仅允许显式配置的扩展 client。凭据未配置时在 Auth／RPC 前返回 503。部署与环境配置分别依据 [Supabase 发布文档](https://supabase.com/docs/guides/functions/deploy)及[环境变量文档](https://supabase.com/docs/guides/functions/secrets)，不能把平台 `ACTIVE` 当作业务启用。

19 条增量 SQL 已完成两段独立静态审查（11 + 8 条），但**尚未应用到托管库**；重新列举仍为 7 条。升级约束：旧 v1 提案写入会被新版本拒绝，必须协调主站切换；保留已有历史，不能重写旧提案；所有资源生命周期迁移落地且配置明确保留策略后才能开启资源流程。新额度表默认无额度，只为自测账号配置有限次数。审查没有发现顶层业务数据删除，但不代替真实升级、权限与数据保留验证。

下一步：配置两端一致的独立 Worker 凭据与必要服务端变量，协调数据库／主站／扩展升级，再跑 F1–F4。Supabase 插件可部署函数但未暴露 secret 设置能力，当前 CLI 未登录，不能据此绕过凭据校验。ego-browser 空间 8 本批只读清点仍为 `agentDelegatedToUser`，已请求用户交回控制权；未自行接管、另建空间或发送邮件。主站别名、数据库、账号额度与原有业务数据本批未修改，未产生模型调用或购买升级。

## 6. 密钥边界

### 2026-09-13 F1 服务端凭据配置

源码固定点 `aaf7888`。空间 8 的实际所有权已恢复为 `agent`，因此复用原空间继续；没有调用强制接管，也没有新建空间。Supabase 后台现有登录有效，通过已登录的 Secrets 表单完成配置，无需新建 Personal Access Token。

- 规划、澄清、资源、翻译、讲解各生成独立的 32 字节随机凭据，以 64 字符十六进制表示；仅在配置进程内生成和传递，没有写入本地文件、提交或输出值。
- Vercel 逐项通过 stdin 写入，重列确认五项均为 `Secret`／`Hidden`，范围只有 `Production`；不覆盖原有三个公开配置，不配置 Preview／Development。
- Supabase 逐项保存相同值，读取界面显示的 SHA-256 摘要，与同次内存生成值的摘要比较，五项全部一致。没有读取管理员密钥，也没有用模型 Key 充当 Worker 凭据。
- Supabase 新增 `BLUEPRINT_EXTENSION_OAUTH_CLIENT_ID`，值来自数据库现有配置；保存摘要核对通过，本地 Vercel 生产配置的公开 client 值也与数据库一致。没有注册新 OAuth 客户端或扩张授权范围。
- 五个真实 Worker 各检查 GET、非 JSON POST、无凭据 JSON POST，共 15 项断言通过：分别为 405、415、403／对应 `*_FORBIDDEN`，均 `no-store` 且无 CORS 许可。与 9 月 11 日的 503 相比，这证明当前 Worker 配置检查已通过、未授权请求被拒绝；**不证明真实用户 JWT、RPC、模型执行或完整双端旅程已通过。**

首次从浏览器任务进程调用 Vercel 时，其 PATH 找不到 Node；该次未写入任何端配置。改用已核实的 Node 绝对路径后成功，没有重复覆盖或为此要求用户操作。原 CLI 登录缺失不再阻塞本次 Secrets 配置。

配置遵循 [Supabase 环境变量](https://supabase.com/docs/guides/functions/secrets)和 [Vercel 敏感环境变量](https://vercel.com/docs/environment-variables/sensitive-environment-variables)的管理边界。**Vercel 环境变量变更仍需新部署接收，既有 Web 候选并未因此自动升级。** 本批未部署新 Web、切换主域名、应用迁移、增加账号额度、发送邮件或调用模型；托管重新列举仍为 7 条迁移。提供方 Key 和启用开关仍待配置，资源保留策略、账号额度、19 条增量迁移与 Web／扩展的协调切换及 F1–F4 实际旅程继续待办。不要再把已解除的浏览器交接状态作为阻塞原因。

### 2026-09-13 F1 数据库与主站协调升级

源码固定点 `bb83b08`。本批没有修改应用或迁移源码，按既有审查顺序发布，并保留账号、历史提案与学习数据。

**迁移基线与执行：**

- 云端原七条中，后六条保存的 SQL 正文 MD5 与本地完全一致。第一条仅缺少后来加入的邀请消耗更新；第二条已补齐，实际 `handle_new_user` 函数也包含该逻辑，因此不重放旧迁移。
- 升级前两个账号、一个已应用的 v1 历史提案、零待确认提案；资源运行／采用表尚不存在，没有需回填期限的旧资源运行。对 13 张原有公共业务表保存行数与内容摘要，不输出私人正文。
- 本地 `npm run test:db-contract` 通过已有账号、数据升级、提案确认、幂等、隔离与 OAuth 限制检查。随后通过插件逐条应用 19 条增量，从 `node_planning_metadata` 到 `explanation_runs`，全部成功。
- 托管总计 26 条；新增版本范围 `20260913150752`—`20260913150822`，顺序和每条 SQL 正文摘要均与本地相符。**远端版本时间戳与本地不同，不能按版本号再次直接 push 全部迁移。**
- 切换主站前，13 张原有表的行数与既有字段摘要逐项一致，包括蓝图版本、正式路径、原资源绑定、历史提案／修订、会话与产品事件；节点比较排除新增的 `estimated_minutes`、`completion_criteria`，另核实旧节点分别保持 `null`／空字符串。账号数仍为 2，没有改写历史提案或自动增加蓝图版本。

**发布与实际页面：**

- 使用生产配置构建，通过 `prepare:vercel-output` 移除 10 个本地环境文件映射，再预构建上传；新候选为 [blueprint-m1-getvzgilx](https://blueprint-m1-getvzgilx-norlymangune65-4981.vercel.app)，部署 ID `dpl_GWtq1CLnn6o82yu13j1qgWuoVvTU`，状态 `READY`，目标 `production`，框架 Next.js。
- 候选 10 项未登录入口检查通过后执行迁移；数据比对通过后执行 promote。再次列举别名，确认 [主域名](https://blueprint-m1.vercel.app) 与自动项目别名均指向新部署；主域名同样 10 项入口检查通过。
- 原浏览器登录会话可读取新版首页与正式目标路径，旧节点未填写的投入／完成依据明确显示“待明确”；没有被伪造为新规划。首页使用现有静态身份回退，不称为正式 3D 已完成。
- 实际已安装扩展重载后恢复原账号，显示新增的学习／理解／记录工作台与同一个原测试节点；仍为固定 ID、3.0.0，未扩张权限。安装前磁盘 Manifest SHA-256 为 `7408b80980dc5ff5675eae804846308408688f1b026bf4ae7173333cec5f321b`，HTTPS hosts 仍仅 YouTube、Web 和同一 Supabase 项目。**此次是独立扩展页面的启动检查，不代替真实 YouTube 页面、原生 Side Panel 生命周期或学习写回验收。**

**权限与观测：**

- 实际查询所有公共表均启用 RLS；12 个 Worker 领取／完成 RPC 均禁止 anon／authenticated，仅授予 service_role。私有写核心和旧写函数不允许客户端执行；有身份与版本核验的 guard 保留 authenticated 调用权。
- Supabase 安全顾问没有 ERROR；20 项 INFO 为私有内部表启用 RLS 但无客户端策略，另有 1 项 WARN 为泄露密码保护未启用，保留告警而不自行升级套餐。不把顾问无 ERROR 当作完整安全证明。
- 对新部署执行 `logs --level error --since 20m --limit 20 --json`，命令成功且无返回日志条目；这只覆盖当次窗口与可查询日志，不证明未来无错。Drains 本批未核实，端到端监控仍有待验收。

下一步：配置提供方与账号有限额度、明确资源保留策略及维护，再通过真实 Agent 和真实 YouTube 学习写回完成 F2–F4；F1 的跨账号隔离／撤销授权仍需新版联合验证。本批未开启模型或资源调用开关、未消费提供方额度、未发送邮件、未新建测试账号或提交学习成果；只完成数据库、主站与扩展版本接通，不能把原测试视频当作推荐质量证明。

### 2026-09-13 F2 真实澄清与路径确认

固定点 `e42cbaa`；本批只配置既有服务、运行合成验收旅程并记录证据，没有修改应用、Skill 或迁移源码。当前优先级仍为 F1–F4，**本节不代表视频链路、完整 F2 或商业质量通过**。

**配置与发布：**

- 使用用户已授权的 DeepSeek Key，官方 `/models` 与 `/user/balance` 均返回 200，配置的 `deepseek-flash` 可用、余额状态可调用；没有充值、购买或升级套餐。Key 仅经进程内存和 CLI 标准输入设置为 Vercel Production Secret，不写入本地配置或客户端。
- 单独开启 `BLUEPRINT_CLARIFICATION_ENABLED` 和 `BLUEPRINT_PLANNING_ENABLED`，也保存为 Production Secret；五组已有 Worker 凭据不变。YouTube、Supadata、资源采用、翻译和讲解仍未启用。
- 精确核对既有自测账号后，一次性插入 3 次澄清、2 次规划额度；已有记录不覆盖、不自动续额，其他账号没有获授这两项额度。不是对所有受邀用户开放模型消费。
- 应用源码与上批构建一致，复用 `bb83b08` 生产预构建产物；再次运行 `prepare:vercel-output` 检查 127 个函数配置，未发现新的本地环境文件映射。没有拉取私密变量到磁盘。
- 新部署 [blueprint-m1-jeat2d0zl](https://blueprint-m1-jeat2d0zl-norlymangune65-4981.vercel.app)，ID `dpl_CSLNAUcA8nKnGcoc7XBYrKJgyAMP`，Next.js、Production、`READY`。预构建部署日志的 Builds 为 0 ms，不是本批重新编译耗时。候选 10 项未登录入口检查通过后 promote，别名查询确认主域名与自动项目别名均指向此版本；主域名同样 10 项检查通过。

**真实产品旅程：**

复用 ego-browser 空间 8、既有 Web 登录账号，通过首页 → 全部目标 → 目标定义 → 对话梳理入口操作，没有重新发送登录邮件、创建账号或绕过正式确认入口。

1. 开启私人澄清草稿；第一轮真实模型提取电子表格练习目标、起点和每周 180 分钟，并追问可检查的成功标准。
2. 第二轮模型把“合成验收、不是已取得成果”解读为不应整理个人目标，多追问了一轮。第三轮明确这是未来练习计划而非完成证据，模型返回 `reviewable`，保留 `【F2 合成自测】`、虚构数据约束、2026-10-11 期限和具体成功标准。没有用人工填写或固定模型响应替代生成结果。
3. 核对摘要并勾选确认后保存：Goal Brief 从 draft r1 变为 confirmed r2。在这之前，模型建议只更新会话摘要，正式目标仍为原来的 1 个。
4. 从规划入口明确发起 1 次真实规划，得到 4 个阶段、17 个节点，包含学习、实践、检查点和复盘；四周分别 140／170／170／180 分钟，均不超每周 180 分钟。新节点暂不绑定视频，未编造视频链接。
5. 先准备提案，查询确认 pending、蓝图仍 v1；再通过“确认并应用”写入 v2。原有目标在修订快照中与规划输入逐项相同；当前共 2 个目标、18 个节点。重新打开正式路径可读 17 个新节点、首节点与最终检查点，显示 0 个自确认检查点。成果和状态确认记录仍为 0，没有把合成旅程伪装成真实学习成果。

追踪位置：Goal Brief `f5e85e13-9266-4a17-a9eb-4245377eb0fd`；澄清会话 `eb12ff27-ad17-4748-861d-24333ad52890`；规划 `cb366c1f-35e2-4810-9f31-b735eafe1cba`；已应用提案 `dac8c407-b6b6-47d3-9b59-26b300b01ea4`；正式合成路径 `5dbcd95c-b0d0-4407-9c22-2693fa3f8850`。这些均是测试目标，不是用户真实经历。

**验证、用量与未通过项：**

- 3 次澄清和 1 次规划均经过真实 Web → 受控 Worker → 数据库 → DeepSeek → 完成回执链，持久结果的 Token 总数分别为 3646、7109、5478、8042，合计 24275（输入 6272、输出 18003）。这不是人民币账单；没有把次数当作费用金额。剩余额度：澄清 0、规划 1，未自动补充。
- 6 个相关运行时、HTTP、澄清与规划测试文件共 83 项通过；候选和主域名各 10 项入口检查通过。对 Git 跟踪文件与所选 Web／扩展客户端产物共检查 746 个文件，未发现该 DeepSeek Key。没有重跑未变更的全量测试、原生 Side Panel 或新版跨账号／撤权旅程。
- 第一次真正提交的澄清 HTTP 请求返回 503，同一时间扩展普通读取也出现 503；数据库没有创建该轮，额度未扣。普通账号读取恢复后，重新加载工作台进行上述受控验证成功。**根因未确认、没有声称修复**；原文在失败页面保留，重新加载后由测试过程重新填入，不能据此声称未发送草稿可跨刷新恢复。最初两次视口外点击未发出请求，不计入模型尝试。
- `logs --level error --since 20m --limit 20 --json` 无 error 级条目，但全级别请求日志确实包含上述 503；不把“无 error 级日志”写成“没有错误”。Drains 未核实。
- 人工检查确认目标相关、四类节点齐全、总投入受限；仍有质量缺口：第二轮对合成目标过度追问；规划要求“至少发现并修正 2 个问题”和“40 分钟内完成最终检查”超出了用户明确标准，按周汇总图表的学习准备也偏薄。该路径用于流程验收，**不评价为高质量规划已通过**。目标定义页还保留“Agent 正在建设中”的过时说明，列为后续小修，不扩大到界面精修。

收口：118 个本地文档链接目标存在，`git diff --check` 通过；非作者 Standards 与 Spec 两轴复核均为 0 项确认问题。复核未独立重复云端操作，不增加前述运行时证据范围。

下一步：接通真实视频检索／采用与必要内容策略、维护，再验证真实 YouTube 上已安装扩展的学习记录写回。已知语义质量与瞬时 503 保留在待办，不用继续美术制作替代 F2–F4 验收。

### 配置边界

- 浏览器可见：Supabase Publishable Key、OAuth Public Client ID、Sentry DSN。
- 仅 Supabase Edge Function：平台自动注入的 Supabase Service Role。
- 仅 Web 构建服务端：Sentry 上传令牌（如启用）。
- 早期 M1 仅使用公开配置；当前 F1–F4 已配置独立 Worker 凭据与仅 Web 服务端使用的 DeepSeek Key，并为自测开启澄清／规划。YouTube Data API、Supadata 和资源／翻译／讲解开关仍未配置或启用。提供方 Key 不得进入 `NEXT_PUBLIC_*`、`WXT_PUBLIC_*` 或客户端包；新增费用仍遵守用户预算与审批边界。
- `.env.m1-cloud.local` 只保存 Project Ref、受邀自测邮箱和最终验收状态；Supabase Personal Access Token 与数据库密码只存在于向导进程内。
