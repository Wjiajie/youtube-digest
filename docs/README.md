# Blueprint 产品与设计文档

本目录记录 Blueprint 的产品理念、系统架构和 UI/UX 设计契约。文档以仓库当前的 `2.0.0` 实现为基线，用于产品讨论、工程维护、体验评审和后续迭代。

## 阅读顺序

1. [产品理念](product-vision.md)：解释 Blueprint 要解决什么问题、坚持什么原则，以及当前产品边界。
2. [系统架构](architecture.md)：说明 Chrome 扩展、本地 Agent Host、数据、协议和安全边界如何协作。
3. [UI/UX 设计](ui-ux-design.md)：定义信息架构、关键流程、页面状态、主题、响应式和可访问性约束。

## 一句话定义

Blueprint 是一个以“目标蓝图”为核心的个人目标系统规划器：它把用户的长期意图转化为可审阅、可执行的分层路径，再把其中的学习节点连接到现有 YouTube 学习侧边栏，形成从规划到学习的闭环。

## 当前交付形态

Blueprint 不是独立桌面应用，而是两个本地组件组成的产品：

- Chrome Manifest V3 扩展：提供 3D 蓝图主页、目标路径、设置和 YouTube 学习界面。
- Windows Blueprint Agent Host：通过 Chrome Native Messaging 提供本地 Agent 服务，封装 Pi Agent 和 DeepSeek 调用。

当前实现、安装和打包说明见 [中文 README](../README.zh-CN.md)。隐私边界见 [PRIVACY.md](../PRIVACY.md)，安全边界见 [SECURITY.md](../SECURITY.md)。

## 文档口径

- “已实现”表示可以在当前源码中找到对应入口、数据流或测试。
- “设计原则”表示后续实现也必须保持的产品或体验约束。
- “演进方向”表示尚未承诺或尚未实现的能力，不能当作当前产品功能宣传。
- UI 主题只改变表达，不改变蓝图 Markdown 的结构和语义。

## 更新规则

发生以下变化时，应同步更新本目录：

- 产品入口、目标层级或核心用户流程变化。
- Chrome 扩展与本地 Host 的职责、协议或信任边界变化。
- 蓝图 Markdown 语法、持久化 Schema 或 Agent 能力变化。
- 主题、响应式、可访问性或关键状态设计变化。
