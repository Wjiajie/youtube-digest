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

规划入口默认关闭。未来受控开启时，`DEEPSEEK_API_KEY` 仅配置在 Web 服务端；另生成至少 32 字符的随机 `BLUEPRINT_PLANNING_WORKER_SECRET`，仅在 Web 服务端与 `planning-worker` Edge 环境共享，不能使用 Supabase API 管理员密钥代替。Edge 的管理员密钥由 Supabase 环境提供，只允许领取／保存当前用户运行，不开放通用数据库写接口。该函数在处理器内自行验证用户 JWT 与独立凭据，`verify_jwt=false` 不表示公开访问。部署函数与启用真实费用仍是后续验收动作，本地测试不会替你开启。

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

- Supabase 项目健康；实际托管仍为 7 条迁移、本地 26 条，相差 19 条；托管仅 `prepare-invited-login` 一个 Edge Function。规划、澄清、资源、翻译、讲解 Worker 均未部署。
- 已有两个 Auth 用户；指定自测账号存在且邀请已使用。未发送新邮件、读取目标正文或重置数据。
- Vercel 插件列出项目为空，但外置盘现有 CLI 登录配置可以访问原项目；不是项目被删除，不需要新建。生产配置目前仅三个公开 Supabase／OAuth 变量，尚无 Agent 启用和提供方／Worker 配置。
- 主域名仍为 `dpl_3P1TjdDz3WtaHEokBWxZaR8rvpYM`，页面 release 标记 `c53111f85b8b07ff307e3251bcc8f87cee1ffcc4`。旧版 10 项未登录入口检查通过。
- 新候选 [blueprint-m1-lw0blbqqo](https://blueprint-m1-lw0blbqqo-norlymangune65-4981.vercel.app) 为 `dpl_DxNrkuZPCDS9QySgDuSUq3ujcxVi`，状态 `READY`；自动项目别名指向此候选，主域名未切换。10 项实际候选未登录 HTTP 检查通过，覆盖登录页、受保护页面重定向、私有 API 拒绝及设计入口关闭；未验证登录后业务。应用源码固定点 `07bffd8`，打包修复属于本批后续提交。
- 初次候选因缺失 `.env.example` 失败，移除本地环境文件映射后，第二次因误排除运行时 Skill 失败；收窄根目录忽略规则后第三次成功。错误页返回的 HTTP 200 不算应用通过。未修改 Next 运行时配置或放宽环境文件上传。
- 本地完整 `check:m1` 通过 1260 项应用与 108 项 Worker 测试、类型、升级契约及两端构建；新增发布准备回归通过，包含其余文件／注入配置保留与重复执行。Vercel 上传清单实查包含五套运行时 Skill，不含本地环境文件；原“找不到普通 Skill 文件”探针没有识别 `filePathMap`，属于检查方式问题，未据此修改应用。
- 扩展已按正式 Web／Supabase 地址重建并通过安全检查，Manifest SHA-256 为 `7408b80980dc5ff5675eae804846308408688f1b026bf4ae7173333cec5f321b`；没有在用户浏览器中加载或重载。默认本地构建会重新生成 localhost 产物，安装前须核对三项 HTTPS 主机。

未完成：19 条增量迁移的协调发布、Worker／额度／提供方配置、真实账号与扩展升级、完整 F1–F4 连续旅程。托管部分旧迁移与本地同名但时间戳不同，必须核对名称与内容，不直接按版本号重放全部迁移。本批没有迁移、模型调用、付费升级或主域名切换；候选可构建不代表已通过登录后业务验收。

## 6. 密钥边界

- 浏览器可见：Supabase Publishable Key、OAuth Public Client ID、Sentry DSN。
- 仅 Supabase Edge Function：平台自动注入的 Supabase Service Role。
- 仅 Web 构建服务端：Sentry 上传令牌（如启用）。
- 早期 M1 仅使用公开配置；当前 F1–F4 将接入服务端 DeepSeek、YouTube Data API、Supadata 及独立 Worker 凭据，但本批尚未配置或启用。提供方 Key 不得进入 `NEXT_PUBLIC_*`、`WXT_PUBLIC_*` 或客户端包；新增费用仍遵守用户预算与审批边界。
- `.env.m1-cloud.local` 只保存 Project Ref、受邀自测邮箱和最终验收状态；Supabase Personal Access Token 与数据库密码只存在于向导进程内。
