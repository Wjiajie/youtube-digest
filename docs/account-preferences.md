# 云端账号偏好：P4a 数据与服务端切片

2026-09-09。本文记录当前源码与本地验证，不代表托管版本已上线；阶段状态以[执行路线](execution-roadmap.md)为准。

## 顶层设计

主题选择属于账号表现偏好，不属于 Blueprint Snapshot、Proposal 或 Revision。当前复用每个 Auth 用户已有的 `profiles`，不创建第二套账号，也不重置或迁移历史蓝图。

- 保存主题 ID、主题契约版本，以及独立的偏好修订号。Web 修改；已授权扩展读取同一条记录。
- 修订号由数据库维护，保存时带上读到的版本；旧标签页的更新会返回冲突，不静默覆盖新选择。同一主题的重复保存不增加修订。
- 蓝图版本、节点、学习记录均不因主题变化而修改。展示名称仍可更新，但不增加主题修订。
- 存储可保留未来主题的合法 ID／版本；当前 Web 仅允许保存已打包的注册主题。较旧渲染端可以选择本地回退，但不能在读取时覆盖账号原有选择。
- 不接受主题资源 URL，不让账号偏好成为加载任意远程资源的入口。

## 已实现

增量迁移扩展 `profiles`，复用已有 owner SELECT 与 Web-only UPDATE RLS。进一步收窄列级 UPDATE：客户端只可编辑展示名称和主题，不能伪造修订号、账号归属或时间戳。触发器位于私有 schema，以调用者权限执行，并撤销客户端直接执行权限。

服务端使用 Next.js Server Action 保存主题，通过现有 Supabase 身份验证与同账号条件更新；只读 Route Handler 向 Web／固定 OAuth 扩展提供偏好，并设置 `private, no-store`。错误结果区分未登录、无效选择、版本冲突和服务不可用，不返回数据库详情。没有新增管理员密钥、付费服务、遥测正文或实时订阅。

主要入口：

- `packages/domain/src/account-preferences.ts`：独立于蓝图快照的数据契约。
- `apps/web/src/lib/account-preferences.ts`：读取、受支持主题校验、条件保存与返回值校验。
- `apps/web/src/app/account-preferences-actions.ts`：Web 保存入口。
- `apps/web/src/app/api/v1/account-preferences/route.ts`：已验证身份的只读入口。
- `supabase/migrations/20260909153706_account_theme_preferences.sql`：可审阅增量迁移。

## 验证与限制

真实本地 PostgreSQL 测试覆盖新账号默认值、同账号读写、过期版本拒绝、重复保存、蓝图版本不变、伪造版本／归属拒绝、非法资源 URL／主题版本拒绝、扩展只读、另一账号隔离和匿名拒绝。全部测试事务回滚，不保留测试账号。

嵌入式 PostgreSQL 契约先创建旧账号与基线数据，再按顺序运行后续迁移，验证已有账号升级及原有提案写入仍工作。HTTP／Server Action 测试使用真实 Supabase 客户端和受控外部 HTTP 响应；这不是托管 Auth 的双账号浏览器验收。失败恢复测试保留 SDK 的真实重试行为，用模拟提供方 `Retry-After: 0` 去除测试等待，不改变生产重试策略。

本地 Security Advisor 未发现 warn/error。迁移生成器遗漏了列级授权与函数授权，并带入无关的 `pg_net` 删除差异；提交前已补齐授权、移除无关差异，用实际迁移文件运行升级契约。未修改托管数据库、未部署或 push。

本批 `npm run check:m1` 通过：41 项单元／接口／组件测试、TypeScript、旧账号升级契约、配置向导、Web／扩展生产构建和扩展安全面检查；另有真实 PostgreSQL 32 项 pgTAP 检查通过。上述数量包含已有回归，并非全部为新增测试。

尚未接入正式 Web 主题容器／选择入口、扩展偏好读取与账号隔离缓存、跨标签页重新读取、冲突／离线交互及双主题全旅程。后续接入必须保留未提交草稿、焦点、当前节点与学习会话；云端未保存时不能显示“已同步”。正式 3D 与美术验收也不在本切片内。

## 核对依据

本轮已核对 [Supabase 更新日志](https://supabase.com/changelog)、[RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)与[列级授权](https://supabase.com/docs/guides/database/postgres/column-level-security)。RLS 限制可访问的行，列级授权限制可修改的字段，两者同时使用；没有通过 SECURITY DEFINER 绕过用户权限。
