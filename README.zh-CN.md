# Blueprint

Blueprint 是一个 Agent 辅助的个人目标系统。3.0 采用“Next.js Web 主站 + YouTube 扩展”，两端使用同一个 Supabase 身份和同一份结构化蓝图。

[English](README.md)

## 当前 M1 云端纵向切片

当前源码已经实现 M1 基础能力：

- 通用的 `蓝图 → 目标 → 阶段 → 路径节点` 模型，节点支持学习、实践、检查点和复盘；
- 蓝图修改先生成可审阅提案，再按版本条件原子应用；
- 邀请邮箱白名单、一次性邮件链接登录和 Supabase RLS 用户隔离；
- 最小 Web 结构化编辑器，以及扩展的 OAuth 2.1 + PKCE 授权流程；
- 用户明确点击“开始学习”后回写学习会话，并按账号隔离离线待同步队列；
- 不记录目标正文的最小产品事件，以及可选、脱敏的 Sentry 异常观测；
- Web 与扩展共享领域契约、语义 Token 和基础 UI 组件。

旧 Chrome 本地版本与 Windows Native Agent Host 保存在 Git 标签 `v2.0.0` 中，不再进入当前运行链路，也不做历史数据迁移。

## 目录

```text
apps/web          Next.js App Router Web 主站
apps/extension    WXT Manifest V3 扩展
packages/domain   与框架无关的领域和应用契约
packages/ui       共享语义 Token 与小型 UI 基础组件
supabase          数据表、原子函数、RLS 与 pgTAP 测试
docs              产品、架构、UX、ADR 和实时路线
```

## 本地开发

需要 Node.js 22+、npm；运行完整本地 Supabase 还需要 Docker。

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env.local
npm run supabase:start
npm run supabase:reset
npm run dev:web
npm run dev:extension
```

扩展继续使用固定 ID `kipaapemlimhdkpcenelpjeccmnkninf`。测试授权前，需要在 Supabase 注册对应的 Public OAuth Client。完整步骤见 [M1 云端配置](docs/m1-cloud-setup.md)。

从本地 Supabase 到托管验收可以运行可重复执行的交互式向导：

```bash
npm run setup:m1-cloud
```

## 验证

```bash
npm run check:m1
npm run check:m1-wizard
npm run test:e2e
npm run supabase:test
```

`check:m1` 会运行类型检查、领域与扩展测试、嵌入式 PostgreSQL 迁移合约、Web/扩展生产构建和扩展安全边界检查。`supabase:test` 依赖本地 Supabase，是最终 RLS 集成门槛。

## 文档

- [产品理念](docs/product-vision.md)
- [当前架构](docs/architecture.md)
- [当前 UI/UX](docs/ui-ux-design.md)
- [目标 UI/UX 规划](docs/target-ui-ux-plan.md)
- [多阶段执行路线](docs/execution-roadmap.md)
- [M1 云端配置](docs/m1-cloud-setup.md)
- [隐私说明](PRIVACY.md)与[安全边界](SECURITY.md)

M1 暂不包含 Agent Skills、正式 3D 身份面板、字幕学习工作台、视频推荐和复盘闭环；这些能力按路线在 M2–M5 实现。
