# Blueprint 产品与设计文档

本目录同时记录当前 `3.0.0` M1 源码和后续产品方向。旧 `2.0.0` 本地原型已经固化到 Git 标签，不再作为当前安装或架构说明。

## 阅读顺序

1. [产品理念](product-vision.md)：产品要解决的问题、用户价值和边界。
2. [多阶段执行路线](execution-roadmap.md)：唯一实时阶段状态、完成门槛、风险和决策记录。
3. [当前系统架构](architecture.md)：M1 Web、扩展、共享领域、Supabase 与权限边界。
4. [当前 UI/UX](ui-ux-design.md)：M1 登录、结构化编辑、提案审阅和扩展连续性。
5. [目标 UI/UX 规划](target-ui-ux-plan.md)：双主题 3D、跨页面设计系统、公开示例和学习/成果体验的目标方案。
6. [Agent Skill 研究](agent-skill-research.md)：M2 目标澄清、路径规划、资源匹配和复盘 Skill 参考。
7. [M1 云端配置](m1-cloud-setup.md)：本地 Supabase、OAuth、Vercel 和托管前验收。
8. [商用品质与多主题设计复审](commercial-design-review.md)：2026-09-06 的代码证据、Q1–Q10 已确认方向、架构推导、质量门槛和后续验证事项。
9. [开放资产研究](open-asset-research.md)：零采购候选来源、具体资源与许可依据、主题适配缺口和接入检查；不是正式资产选型或美术验收结果。

可编辑的目标流程图见 [Web 与扩展 UI/UX 线框图](blueprint-ui-ux-flow.excalidraw)。架构决策见 [ADR](adr/)。

## 一句话定义

Blueprint 是一个 Agent 辅助的个人目标系统：把模糊目标变成可审阅、可执行的路径，并根据真实学习证据持续调整。3D 身份面板是核心表达；YouTube 是当前可选学习资源及其伴随学习场景。

## 当前交付形态

- Next.js Web：账号、结构化蓝图、提案确认和连接管理。
- WXT Chrome 扩展：在 YouTube 中读取同一蓝图、匹配资源并明确开始学习会话。
- Supabase：邀请账号预创建、邮件链接登录、扩展 OAuth、PostgreSQL、原子写入和 RLS。
- 共享包：领域模型、应用用例、语义 Token 和基础组件。

M1 还没有 Agent Skills、正式 3D、字幕工作台、推荐或复盘闭环。这些必须以路线状态为准，不能当作当前能力宣传。

## 更新规则

阶段启动、功能合并、阶段验收或方向变化时，先更新执行路线的日期、状态和证据。若运行边界、数据语义或用户流程发生变化，再同步更新架构、UI/UX、隐私与安全文档。文档中的“已实现”必须能对应当前代码或可复现证据。
