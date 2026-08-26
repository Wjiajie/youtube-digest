# Blueprint

Blueprint 是一个以 Chrome 扩展加本地 Windows Agent 服务交付的个人目标系统。扩展默认打开可交互的 3D 目标主页，把用户确认后的 Agent 提案转换为稳定的 Markdown 技能树，并复用现有 YouTube 学习侧边栏完成绑定到节点的课程学习。

[English](README.md)

## 最终产品形态

- Chrome 扩展负责蓝图、设置、笔记、字幕和全部用户界面。
- 本地 Blueprint Agent Host 是通过 Chrome Native Messaging 注册的小型 Windows EXE。它运行 Pi Agent，也是唯一调用 DeepSeek 的组件。
- Supadata 字幕请求仍由扩展直接发起，并固定使用 `mode=native`。
- 项目没有开发者运营的账号、云数据库、分析服务或代理后端。

即使未安装 Agent Host，扩展仍可展示已保存的目标。目标规划、视频概览、选文讲解、翻译和笔记润色需要本地服务及你的 DeepSeek Key。

## 让你的编程 Agent 帮你安装

让编程 Agent 构建并打包此仓库，然后把解压后的发行内容放到我选择的永久文件夹。安装完成后不要随意移动扩展或本地宿主路径。

1. 安装 Node.js 22 或更新版本、npm、Git Bash 和当前版本的 Chrome。
2. 在仓库中运行 `npm install` 和 `npm run package:all`。
3. 在 PowerShell 中进入 `dist/blueprint-agent-host-windows-x64`，运行 `./install.ps1`。脚本会把宿主复制到当前用户的本地应用数据目录，并为发布版扩展 ID 注册 `com.blueprint.agent`。
4. 打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”。
5. 选择仓库根目录或解压后的扩展目录。所选目录必须包含 `manifest.json`，不能选择它的上级目录。
6. 如需快速访问，可把 Blueprint 固定到工具栏。点击扩展图标会打开蓝图主页。

卸载本地宿主时，运行宿主包中的 `./uninstall.ps1`。卸载宿主不会删除扩展数据。已解压扩展不会自动更新；替换文件后，需要在 Blueprint 扩展卡片上点击“重新加载”。

## 配置

打开 Blueprint，进入设置，并由你自己填写：

1. 从 [Supadata 注册页](https://dash.supadata.ai/auth/sign-up)获得 Supadata API Key。
2. 从 [DeepSeek API Keys](https://platform.deepseek.com/api_keys)获得 DeepSeek API Key。
3. 选择科幻、赛博朋克、武侠或现代都市主题。

发布版本固定使用 DeepSeek V4 Flash。API Key 保存在 Chrome 本地扩展存储中。AI 会话开始时，扩展通过 Native Messaging 把 DeepSeek Key 发送给本地 Blueprint Agent Host；宿主只在当前会话的内存中使用它，不会持久化。

在设置页点击“检查连接”，确认 Chrome 能连接宿主。如果提示未找到宿主，通常是当前 Windows 用户尚未运行 `install.ps1`，或修改注册后没有重启 Chrome。

## 使用 Blueprint

1. 点击 Blueprint 工具栏图标。主页会显示可旋转、带待机动画的人物，以及每个顶层目标对应的模块。
2. 在页面底部规划师输入框中描述目标或修改要求。
3. 审阅 Agent 返回的 Markdown 提案。只有点击“应用提案”后才会持久化。
4. 点击目标模块进入里程碑路径。主题只改变表现，不改变层级结构。
5. 点击绑定 YouTube watch 链接的节点，打开视频与现有学习侧边栏。
6. 在学习侧边栏中获取字幕、生成概览、翻译字幕、讲解选文并保存带时间戳的笔记。

规划师使用以下结构：

```markdown
# 我的蓝图

## 学习分布式系统
### 基础
- 网络基础 | https://www.youtube.com/watch?v=VIDEO_ID
- 共识算法
### 实践
- 实现复制式键值存储
```

应用提案前，扩展会校验大小、层级、链接来源和蓝图版本。Agent 没有文件、Shell、浏览器或任意网络工具。

## Supadata 字幕行为和额度

Blueprint 会把规范化的 YouTube watch URL 和你的 Supadata Key 发送到 [Supadata get-transcript 文档](https://docs.supadata.ai/get-transcript)说明的字幕 API。它固定使用 `mode=native`，优先选择英语原生字幕，不会在本地转录音频。

Supadata 当前宣传免费套餐每月有 100 credits。一次原生字幕请求消耗 **1 credit**。AI 生成字幕每分钟消耗 **2 credits**，但 Blueprint 固定使用 `mode=native`，不会走生成字幕路径。价格和额度可能变化，使用前请在 Supadata 确认。

DeepSeek 用量由你的 DeepSeek 账号单独计费。Blueprint 不包含也不转售服务商额度。

## 架构

```text
Chrome 扩展
  Blueprint 3D 主页与目标页
  规划师对话与用户确认提案
  YouTube 学习侧边栏
  Chrome 本地存储
       | Native Messaging，JSON 帧协议 v1
       v
Windows 本地 Blueprint Agent Host
  能力路由与校验
  Pi Agent Core
  DeepSeek V4 Flash 传输
```

目标规划、视频分析、选文讲解、字幕批量翻译和笔记润色统一经过 Agent Gateway。浏览器代码不包含 DeepSeek endpoint 或鉴权传输。提示词模板在构建时打包进 Windows 宿主。

## 产品与路线文档

- [产品理念](docs/product-vision.md)
- [系统架构](docs/architecture.md)
- [UI/UX 设计](docs/ui-ux-design.md)
- [目标 UI/UX 规划](docs/target-ui-ux-plan.md)：Web、3D 身份状态面板和 YouTube 学习扩展的未来体验。
- [Agent Skill 研究](docs/agent-skill-research.md)：构建目标澄清、路径规划、资源匹配和复盘工作流的公开资料。
- [多阶段执行路线](docs/execution-roadmap.md)：持续记录当前 `2.0.0` 基线、已确认的目标架构、阶段门槛、风险和关键决策。

产品理念、系统架构和现有 UI/UX 文档描述当前已实现版本；目标规划与执行路线会明确标记尚未上线的能力。

## 开发与打包

```bash
npm install
npm test
npm run build:extension
npm run build:host
npm run check
npm run package:all
```

发行产物位于 `dist/`：

- `blueprint-v2.0.0.zip`：经过白名单检查的 Chrome 扩展文件。
- `blueprint-agent-host-windows-x64/`：独立宿主 EXE、安装脚本、卸载脚本、示例清单和 SHA-256 校验文件。

数据处理见 [PRIVACY.md](PRIVACY.md)，信任边界和漏洞报告方式见 [SECURITY.md](SECURITY.md)。
