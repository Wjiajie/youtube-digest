# P9：Next 响应压缩监听器修复

2026-09-11，固定点 `c011b78`。本地依赖修复；不是托管发布、整体内存／负载验收或 Agent 功能变更。

## 原因与复现

原 70 节点规划旅程功能通过，却打印 Gzip 的 `MaxListenersExceededWarning`。本批打开 Node 警告堆栈后定位到 Next 16.3.3 的 `pipeNodeReadableToNodeResponse` 与内置 compression，而不是业务 Agent 的事件订阅。

最小复现移除 Next 页面、Auth、数据库与模型：回环 HTTP 返回 128 个 16 KiB 块，通过实际安装的 Next 流管道及压缩模块发送。identity 对照无警告；gzip 在第 11 个 `drain` 监听器时报警，完成后仍有 32 个监听器。完整 2 MiB 正文没有丢失，因此不能把响应成功当作监听器正常。

根因：压缩模块重写 `ServerResponse.on('drain')`，把监听器转交 Gzip；Node 的 `once()` 包装器却仍以 ServerResponse 为移除目标。每次背压都加一个包装器，触发后未从实际目标清除。回归测试先对这个实际 HTTP 症状失败，再验证修复。

Next 的[官方压缩说明](https://nextjs.org/docs/app/api-reference/config/next-config-js/compress)说明 `next start` 的默认 gzip 行为。核对了上游 [97757](https://github.com/vercel/next.js/issues/97757) 及关联 [97818](https://github.com/vercel/next.js/pull/97818)：后者针对响应的 `close`，不能直接当作本批 `Gzip/drain` 的已发布修复。本批依据本地源码与复现，不宣称已获上游认可，也没有提交外部 issue／PR。

## 修复边界

[依赖修复脚本](../scripts/patch-next-compression.mjs)只接受 Next **16.3.3** 和已核验 compression 原文件 SHA-256 `8e7c2ec6982978c754c00388e0d1d3ff46d7aae99945d060f6f1052954c24e29`。插入局部 listener-removal 转发：已转交的监听器从压缩流移除；未发送头时从待转交列表移除；压缩前已在原响应上注册的监听器仍从原响应移除。支持 `off`／`removeListener`、一次性包装器和重复注册的末次移除，不修改全局 EventEmitter 原型。

保持 gzip／deflate、正文、缓存策略和背压；不关闭压缩、不提高监听器上限、不吞掉警告、不缩减用户路径。没有新增 npm 依赖或改变 Next 版本。原文件许可证保留，仓库仅存确定性修复脚本，不提交整个第三方源码。

根 `postinstall`、`prebuild:web` 和 `check:m1` 调用该脚本。重复执行验证原字节后不写入；未知版本、被修改的文件或重复插入均失败关闭。`npm install --ignore-scripts` 不会安装补丁，之后必须运行根目录 `npm run build:web` 或 `npm run check:m1`；不要仅直接调用工作区 `next build` 后假定修复已安装。

**维护义务**：升级 Next 时先在干净依赖上运行 HTTP 回归，核查上游根因是否解决，再移除或重新审查补丁及安装入口。不能简单放宽版本／哈希检查。此补丁不承诺修复所有 compression 事件代理行为，亦不代表 Vercel 托管压缩链已经验证。

## 验证

- [实际 HTTP 回归](../scripts/next-compression.test.mjs)：identity／gzip／deflate、重复响应，2 MiB 解压后逐字节一致且无监听器超限；头前／头后的 once/off/removeListener；原传输监听器移除；客户端中断后生产者提前停止。
- [安装保护](../scripts/patch-next-compression.test.mjs)：重复执行不改文件，未知版本／未知字节拒绝且原文件保持。另以恢复到已核验原始哈希的安装文件运行 `postinstall`，确认首次应用成功。
- 初版修复的“压缩前已存在监听器”回归先失败（回调仍执行一次），补充原响应回退后通过；不是只关闭报警。
- 临时诊断脚本保存在 `.goal-loop/`，未进入产品；临时 `--trace-warnings` 已从规划 E2E 配置移除。

```bash
bash scripts/with-m1-runtime.sh npm run test:next-compression
bash scripts/with-m1-runtime.sh npm run check:m1
# 需要已启动的本地 Supabase，外部模型由隔离夹具替代：
bash scripts/with-m1-runtime.sh npm run test:planning-generation
```

当前完整检查：6 项压缩／安装回归、858 项应用测试、79 项 Edge 测试、四工作区类型检查、数据库升级契约、向导、Next／WXT 构建与扩展安全检查通过。没有 schema 变更、托管操作、真实供应商消费或用户浏览器操作；完整 P1–P9 仍继续推进。

最终真实本地 Auth → 生产 Next → Edge → 数据库的空蓝图／70 节点规划生成、审阅、确认两条旅程通过，原 Gzip 警告未再出现；48 项默认生产 Web 回归通过。模型响应仅由隔离测试进程夹具提供，不计为真实推理质量或消费验收。初次诊断构建另出现 Turbopack task-local 缓存警告，构建与旅程仍完成；后续完整构建自动丢弃该失效缓存后成功，不把它与本次 Gzip 根因混为一谈。

## 独立复核

源码 `2247a37`。两位非作者各检查九个变更文件及实际安装的 Next 压缩／流管道：Standards 轴 0 项确认规范或正确性问题、0 项可行动异味；Spec 轴 0 项确认遗漏、范围扩张或错误。各独立通过 6 项 HTTP／安装测试；需求轴另核对恰好一次插入、正确位置及移除补丁后原字节哈希。最终已补丁文件 SHA-256 为 `2c21aa4bf9ffc405eb4061043bf118026b370f9d84c93f4e1e65a6a2c9f36522`。

复核者未重跑完整规划旅程、构建或托管环境，首次应用为主线程验证而非独立复演。主线程另确认本批临时规划账号剩余 0；升级审查义务和完整 P9 验收边界不变。
