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

## 5. 密钥边界

- 浏览器可见：Supabase Publishable Key、OAuth Public Client ID、Sentry DSN。
- 仅 Supabase Edge Function：平台自动注入的 Supabase Service Role。
- 仅 Web 构建服务端：Sentry 上传令牌（如启用）。
- M1 不配置 DeepSeek、YouTube Data API 或 Supadata Key。
- `.env.m1-cloud.local` 只保存 Project Ref、受邀自测邮箱和最终验收状态；Supabase Personal Access Token 与数据库密码只存在于向导进程内。
