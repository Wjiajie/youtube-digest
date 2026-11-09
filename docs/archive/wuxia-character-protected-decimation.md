# 女剑客：重要区域原样保留的减面

日期：2026-09-24。用户认可 Ultra 4K 母版质量，并授权安装 meshoptimizer，保留脸部、胸部、发饰等重要部位，主要简化次要区域。本轮仅安装本地制作工具、产生派生资产及评审文档；没有调用 Meshy API，没有安装 Blender，没有修改正式主页。

## 安装结果

已从 npm 官方 registry 单独安装 **meshoptimizer 1.1.1**，WASM Simplifier 可用。项目原本已有可被解析的同版本间接依赖，但此次工具独立固定版本，不依赖产品安装树是否继续包含它。

```text
C:\Users\jiaji\.local\share\wuxia-mesh-tools\node_modules\meshoptimizer
```

安装命令：

```powershell
npm install --prefix C:\Users\jiaji\.local\share\wuxia-mesh-tools --save-exact --ignore-scripts --no-audit --no-fund meshoptimizer@1.1.1
```

独立工具目录的 package.json / package-lock.json 记录版本与 npm 包完整性；项目根 package.json、lockfile 未修改。工具入口是 Node.js 模块，通过本项目资产 CLI 调用，不是 Blender 插件或桌面软件。

## 结果

| 项目 | Ultra 4K 母版 | 区域保护 v1 |
|---|---:|---:|
| 三角形 | 4,506,766 | **1,216,304** |
| 顶点（共享缓冲中的实际数量） | 2,238,233 | 597,009 |
| 文件字节 | 107,799,740 | **28,926,412** |
| 大小 | 102.8 MiB | **27.6 MiB** |

总三角形减少约 **73.0%**。本轮新增 Meshy 消耗 **0**；历史项目累计仍为 55 credits。本文件是新几何候选，不是已完成纹理、绑定和网页性能验收的成品。

当前模型：

```text
C:\Users\jiaji\Documents\github-project\youtube-digest\art\dual-theme\eastern\meshy\character\20260924_080744_wuxia-character-ultra4k-v1_01a0d0bd\wuxia-character-protected-v1.glb
```

输出 SHA-256：`2f93e133a83619c5837737bf9f8c2f3a85d8369a1a2a748f5ab1b3e0004ffdfe`。

原母版 SHA-256 再次验证未变：`80d1d4a50e4791bd8605b5c3caf1ef269edc432724406d116ad941fb9a4f4cb5`。

## 区域与保留方式

| 区域（评审颜色） | 输入三角形 | 输出三角形 | 处理 |
|---|---:|---:|---|
| 头、脸、上部头发和发饰（金色） | 782,698 | 782,698 | 原样保留 |
| 胸颈正面、局部上衣与饰物（珊瑚色） | 207,862 | 207,862 | 原样保留 |
| 双手及部分护腕（青色） | 51,854 | 51,854 | 原样保留 |
| 两圈邻接过渡（绿色） | 25,472 | 25,472 | 原样保留 |
| 其余区域，包括衣裙、下部背发、靴子等（蓝色） | 3,438,880 | 148,418 | 按位置和法线误差简化 |

**1,067,886 个保护三角形没有进入简化算法。** 保留的是原始三角形及其顶点位置、法线，不只是保住面数。重新读取实际输出 GLB，对每个保护组按三角形顺序哈希所有 POSITION 和 NORMAL 值，与母版对应子集完全相同；索引仅因缓冲压紧而重新编号。

原模型没有身体部位标签，因此这是经过视觉核对的保守空间分区，不是自动语义分割：头部 Y ≥ 0.48；胸部 Y ≥ 0.12、abs(X) ≤ 0.24、Z ≥ 0；手部 abs(X) ≥ 0.40、Y ≥ -0.25。坐标只适用于本次母版，不能当作米，也不能直接用于其他人物。任一顶点命中则保留整个三角形，再向外扩展两圈邻接三角形。

区域交界使用 vertex_lock、同位置顶点锁定传播和 LockBorder；简化前后检查的 **7,588 条受保护边界边全部保留**。没有全局焊接、重新算法线、重新塑形或删除独立小饰件。此检查证明指定交界未丢边，不等于证明母版原本无孔洞、自交或动画穿插。

简化部分尝试目标为 150,000 三角形，实际 148,418；使用 simplifyWithAttributes、法线权重 0.5，以及 ErrorAbsolute / Sparse / LockBorder。报告误差约 0.006253 是位置与法线的综合误差，不是测量得到的毫米距离。完整参数见区域配置。

与旧 v8 不同：本轮保护区完全不减面，且输入是用户认可的 Ultra 4K 母版，不是旧 standard 模型。因为保护区本身已超过 100 万面，不将整身强行压到 20 万面。

## 真实浏览器评审



背面对照 · 侧面对照。图像由真实 Three.js 模型渲染导出，未用图像生成替代模型证据。左右模型使用相同的母版包围盒、缩放、镜头、灯光和灰模材质。

已观察脸部、胸颈与发饰近景、全身正面、背面、侧面和彩色保护范围：五官与重要部位保持母版，衣裙主要轮廓仍在；未见明显新增的区域交界裂缝。衣裙和下部背发不承诺与母版逐面相同，原母版的发饰黏连、头发碎片等特征也会被原样保留。

本地查看：

```powershell
node art/dual-theme/eastern/meshy/diagnostics/serve-protected-review.mjs
```

打开 `http://127.0.0.1:43191/`。左侧是原母版，右侧是区域保护 v1；选择“保护区着色”可查看分区。服务器只监听本机、按白名单提供资产，不公开凭据和 Meshy 回执。

## 验证与复现

- meshoptimizer 1.1.1 独立安装成功，WASM 初始化成功，实际完成减面。
- glTF Transform 4.5.0 对输出报告 **0 errors / 0 warnings / 0 infos / 0 hints**。
- 输出重新读取后的四个保护组属性哈希全部匹配；源文件哈希未变；边界边丢失为 0。
- 资产 CLI、评审服务器与页面脚本通过语法检查。无需运行未受影响的产品全量构建。
- 无 UV、纹理、骨骼、动画；模型保留五个共享顶点缓冲的 primitive，方便检查分区。未运行坐姿、握剑、变形或真实帧率验收。

精确复现（在项目根目录执行，输出必须用新文件名）：

```powershell
node art/dual-theme/eastern/meshy/diagnostics/protected-decimate.mjs `
  art/dual-theme/eastern/meshy/character/20260924_080744_wuxia-character-ultra4k-v1_01a0d0bd/wuxia-character-ultra4k-master-v1.glb `
  art/dual-theme/eastern/meshy/character/20260924_080744_wuxia-character-ultra4k-v1_01a0d0bd/NEW-protected.glb `
  art/dual-theme/eastern/meshy/diagnostics/protected-regions-v1.json `
  C:\Users\jiaji\.local\share\wuxia-mesh-tools\node_modules\meshoptimizer\index.js
```

脚本拒绝错误输入哈希、覆盖已有输出、带 UV／蒙皮／动画的输入，避免静默丢数据。详细数字与哈希见机器报告。

## 下一步

先评审这份保留细节的候选，再推进匹配 UV 的纹理、绑定与坐姿。27.6 MiB 和 121.6 万面尚不满足原先网页体积／面数目标；后续可先验证无损传输压缩与真实设备表现，再决定是否需要进一步调整保护范围。不可为了达到旧面数指标而默认简化用户要求保留的部位。

保持原母版及所有历史派生文件，可直接回退。新增 Meshy 任务必须引用最终选择的模型，不能沿用先前 200k 任务 ID 而处理错误几何。
