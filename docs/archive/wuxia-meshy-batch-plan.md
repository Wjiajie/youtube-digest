# 武侠风格化 · 具体执行计划（P0 探针 → 批次 → 装配）

> 状态：**已获用户批准**（2026-10-03）。本文件是 `docs/wuxia-stylized-execution-plan.md` 的可执行细化版，
> 补上三样原方案缺的东西：命令级步骤、经官方单价表校准后的真实预算、每个探针的判据与分支。

## 0. 一句话

先用 **≤89 分**的 P0 探针把「Meshy 该按什么价位买」钉死，再按校准后的单价把 **7,945 月度积分在 17 天内花完**，
产出可被网页装配的模块化资产库；全程 headless 批处理，只在门禁处汇报。

---

## 1. 采购校准（0 分完成，推翻了原预算模型）

一手来源：`https://docs.meshy.ai/llms-full.txt`（992,842 字符，比 JS 渲染的 pricing 页更全）+ `meshy make --dry-run`。
**按 delivery.md 纪律，成本只能来自公布价目表或 CLI planner，真实值以任务的 `consumed_credits` 为准。**

| 3D 生成（分/请求） | meshy-7.1(latest) | meshy-6 | meshy-6-lite | meshy-t2 |
|---|---|---|---|---|
| 仅网格 | 20 | 20 | 5 | 5 |
| 网格 + 2K 贴图 | 30 | 30 | 15 | 15 |
| 网格 + 4K 贴图 | 30 | 30 | — | 15 |
| 网格 + 8K 贴图 | 35 | 35 | — | 20 |
| Ultra 几何附加费（`geometry_resolution:"2k"|"4k"`） | +5 | — | — | — |

- 贴图 Refine / Retexture：2K·4K **10**、8K 15
- 2D：nano-banana **3**、nano-banana-2 6、nano-banana-pro 9、gpt-image-2 9(T2I)/12(I2I)
- 绑定 **5/请求**；Animation 3/动作（≤10 个/请求）；Text to Motion prime 10 / swift 3
- 后处理：Remesh **5**、UV Unwrap **5**、Convert 1、Resize 1
- 3D 打印：Analyze Printability 免费、Multi-Color 10、Repair Printability 10、Auto Split 10
- Creative Lab：Keychain/Fridge Magnet/Figure/Vinyl/Brick/Fidget Pixel 6+30、Keycap 12+50、Lamp 30+6、Collapsible Fidget —+6
- 横幅警告：**meshy-5 于 2026-10-10 退役；`lowpoly` 于 2026-10-30 退役**（官方建议改用 `smart-topology` + `meshy-t2`）

### 三条结论

1. 原方案按 ~33 分/件估算 P1–P7（4,737 分）是贵的路线。改走 **`--model-type smart-topology`（meshy-t2）网格+2K = 15 分**，
   且 API 文档明确它 **"natively separated parts"（原生语义分件）**——正是模块化资产库要的东西。
2. 风格化目标本就**放弃照片级 PBR**，多花的 15 分买的是我们不要的东西。默认线全部降到 t2。
3. **省下的分不是省着，是买更多。** 校准后同样 7,945 分能买约 180 件 3D + 150 张 2D（原计划 90 件 + 90 张），
   且能留 1,400 分做重试择优。月度积分会重置清零，不留。

### CLI 现状（0.3.0）

- `image-to-3d create` **没有 `--ai-model` 旗标**（只有 `--model-type` / `--target-polycount` / `--ultra-mode`），
  要选 `meshy-6-lite` 必须走 `--data '{"ai_model":"meshy-6-lite"}'`
- `text-to-image create` 有 `--ai-model`（`gpt-image-2` 默认 / `nano-banana-pro` / `nano-banana-2` / `nano-banana-2-lite` / `nano-banana`）
- `--should-texture` 默认 **false**；`--texture-resolution` 默认 **4k**；`--enable-pbr` 默认 true
- 所有提交都带 **`--operation-id`（本地幂等：重复同一 id 返回已记录结果，不重复扣分）**——批次脚本的续跑安全就靠它
- 退出码：**8 = 超时（可续，不是失败）**；**9 = 积分不足（立即停止新提交）**

---

## 2. P0 探针 —— 6 项，上限 89 分（余额 1.1%）

输入全部用仓库已有的 9 张参考图，无需额外制作。

| # | 名称 | 输入 | 关键参数 | 分 | 要回答的问题 |
|---|---|---|---|---|---|
| P0-1A | 剑·t2 | `art/dual-theme/eastern/references/r03-sheathed-sword-v2.png` | `model_type=smart-topology`, `ai_model=meshy-t2`, `target_polycount=10000`, `should_texture=true`, `texture_resolution=2k` | 15 | 便宜线能不能用 |
| P0-1B | 剑·6-lite | 同上 | `model_type=standard`, `--data '{"ai_model":"meshy-6-lite"}'`, 2K | 15 | — |
| P0-1C | 剑·7.1（锚） | 同上 | `model_type=standard`, `ai_model=mesh-7.1`, 2K | 30 | 差距有多大 |
| P0-2 | 薄特征最坏情况 | `r06-environment-clean-v1.png` 用 sharp 裁出单株松 | t2 + 2K | 15 | 松针/芦苇会不会糊成一团（决定 P3 走不走 Meshy） |
| P0-3 | 绑定可用性 | Blender 导出的 MPFB **T-pose 未绑定**人形 GLB | `meshy rig` | 5 | Meshy 能否绑自有网格 + 是否含指骨 + 是否附赠 walk/run（决定 G4 走哪条） |
| P0-4 | 2D 风格锁定 | 同一风格前缀 × 3 个不同主体 | `nano-banana` T2I | 9 | 三张风格是否一致（决定 P7 是直接生成还是"母图 + image-to-image"） |

**0 分项**：`meshy balance` 复核；`meshy make --dry-run` 逐路由复核单价；`llms-full.txt` 存到
`.workbuddy/research/meshy-llms-full.txt` 供离线查证；修正台账 `updated_date`（停在 2026-09-25，缺 09-30 的 90 分）。

### 分支（决定后续全部预算）

| 探针结果 | 分支 |
|---|---|
| P0-1A ≈ P0-1C | P1–P6 默认 t2（省 ~2,700 分） |
| P0-1A 崩坏（分件碎/UV 乱） | 退 B（6-lite，15 分）；B 也不行 → 退 C（30 分），批次规模砍半 |
| P0-2 松针糊成块 | P3 环境改「程序化几何 + 2D 贴图」，不买 Meshy 网格 |
| P0-3 成功 | G4 用 Meshy 骨骼 + 免费 walk/run；失败 → G4 用 MPFB 53 骨自建 |
| P0-4 风格漂移 | P7 改「一张母图 + image-to-image 变体」 |

探针结束出**三档并排对比图** + 面数/分件数/贴图尺寸表 + `consumed_credits`，再定分支。
**探针本身不自动续跑批次。**

---

## 3. 工具链交付物（先写代码，再花钱）

全部 Node ESM，复用根 `node_modules` 已有的 `sharp`；GLB 读写可复用
`art/dual-theme/eastern/meshy/diagnostics/mesh-cleanup-lib.mjs`（导出 `load/read/save`）。

| 文件 | 作用 |
|---|---|
| `scripts/meshy/run-batch.mjs` | **批次运行器（主交付）**。读批次清单 → 逐项 `text-to-image create`(3) → `image-to-3d create`(15) → `project init` → `wait` → `download`(GLB + `thumbnail.primary`)。全程 `--async` + `wait`，**不自写轮询循环**；退出码 8 可续、退出码 9 立即停新提交并保产物；每步带稳定 `--operation-id`；支持 `--only <id>` / `--resume`；产物已存在则跳过 |
| `scripts/meshy/build-contact-sheet.mjs` | 用 `sharp` 把 N 张缩略图拼成带标签的对比 PNG + `review-<batch>.html` |
| `scripts/meshy/ledger.mjs` | 读写 `art/dual-theme/manifests/wuxia-meshy-ledger.json`（沿用现有 schema），并生成 G5 用的 `meshy-library.json` |
| `scripts/blender/install_mpfb_assets.py` | G0 装 MPFB 资产包（先读 `AssetService` 真实签名，不照抄记忆里的函数名） |
| `scripts/blender/build_base_human.py` | 增 `--tpose-unrigged` 导出模式（P0-3 的输入） |
| `art/dual-theme/manifests/meshy-batch-p{0..7}.json` | 批次清单，schema `{batch, root, style_prefix, defaults:{concept,mesh}, items:[{id,name,prompt,concept,polycount}]}`；风格前缀只写一次，保证 180 件同一套审美 |

台账 schema（沿用）：

```
schema_version, updated_date, theme, stage, review_status, cli_version, project_directory,
input{path,sha256}, tasks[]{resource, id, operation_id, parent_task_id, status,
consumed_credits, estimated_credits, parameters{}, local_triangles}
```

---

## 4. 批次计划与预算（合计 ≈7,943 / 7,945）

**流水线统一两段：nano-banana 概念图（3 分）→ image-to-3d t2 网格+2K（15 分）= 18 分/件。**
先出概念图是为了风格锁定——参考图只有 9 张，撑不起 180 件。

| 批次 | 内容 | 单位 | 数量 | 小计 |
|---|---|---|---|---|
| P0 | 探针（上表 6 项） | — | 6 | ≤89 |
| P1 | 武侠道具（剑配件/鞘/扇/酒器/灯/卷轴/印/笔/伞/面具/暗器…） | 18 | 32 | 576 |
| P2 | 生活器物（案/几/榻/屏/器皿/茶具/香炉/书架…） | 18 | 22 | 396 |
| P3 | 环境（松/竹/芦苇/莲/石/山石/水岸/舟坞/远景层…） | 18 | 46 | 828 |
| P4 | 舟体细节（船舷/桨/橹/篷/缆/桩/灯/篓/舱板…） | 18 | 16 | 288 |
| P5 | 赛博朋克（霓虹牌/线缆/空调机/雨棚/招牌/广告屏…） | 18 | 20 | 360 |
| P6 | 形状草稿（**仅网格**，供 Blender 二次雕刻） | 3+5=8 | 24 | 192 |
| P7 | 2D 素材（纹样/织物/云水纹/窗棂/纸纹/遮罩） | 3 | 150 | 450 |
| H | 英雄资产升级（主剑/舟体/发饰/腰带扣/靴…7.1 + ultra + 4K/8K 重贴图） | ~38 | 12 | ≈456 |
| P8 | 重试与择优 | ~18 | 80 | ≈1,440 |
| P9 | 缓冲：用不完则转 P1/P3 扩容（积分 17 天后清零，不留） | — | — | ≈2,866 |
| | | | | **≈7,943** |

**产出目录**（沿用 `meshy/<category>/<YYYYMMDD_HHMMSS>_<name>_<taskid8>/` 约定）：
`probe/` P0、`toolkit/` P1、`household/` P2、`environment/` P3、`boat/` P4（已有）、
`cyberpunk/` P5、`drafts/` P6、`patterns/` P7。

---

## 5. 分阶段执行顺序

**G0 收尾（0 分，必须先做）** —— MPFB 资产包尚未安装（`system_assets_installed=false`），G1 的表情单元与服装全依赖它：

1. 从**正确主机**下载资产包（`files.makehumancommunity.org`，不是 `static.`）：
   - `/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip`
   - `/asset_packs/makehuman_system_poses/makehuman_system_poses_cc0.zip`
   - `/functional/faceunits01.zip`（ARKit 风格表情单元）、`/functional/visemes01.zip`、`/functional/visemes02.zip`（口型）、`/functional/haireditor.zip`
2. 先读已装 MPFB 模块里 `AssetService` 的真实签名，再写 `scripts/blender/install_mpfb_assets.py` 装包
3. 验证：headless Blender 打印已装包列表 + faceunits 数量，`system_assets_installed` 转 true
4. 环境变量纪律：所有 Meshy/curl 调用前清空 `HTTP_PROXY/HTTPS_PROXY/http_proxy/https_proxy`
   （残留代理变量是上次"Meshy 不通"的真凶，报的是假鉴权错误）

**P0 探针（≤89 分）** → 三档并排对比图 → **交用户定分支**

**P1–P7 批次** → 每批结束出对比图 + 台账增量；批间不阻塞

**H 英雄资产升级 + P8 重试** → 按 P1–P7 的实际观感挑最差的 12 件升级

**G1–G4（Blender 侧，0 分）** —— 与批次并行：母体与着色 → 头发发片 → 服装与坐姿 → 表情与运动

**G5 资产库 / G6 网页装配** → 全部 3D 件入 `meshy-library.json`，按模块契约（米/+Y 上/面朝 +Z、A-pose bind、
`scalpFit`/`neckSeam`/`handGripL`/`handGripR`/`seatSocket` 挂点）装配

---

## 6. 门禁验收与汇报方式

每个门禁固定四件套（delivery.md 交付纪律）：

1. **模型/图片文件**：纯反引号路径，**不做成可点链接**
2. **预览图**：亲眼看过后贴出（对比表 PNG）
3. **任务轨迹**：task id + resource + 项目目录
4. **成本**：`consumed_credits` 实测值；缺失写 unknown，**绝不写 0**

批次级追加：面数/分件数/贴图尺寸统计表、与上一版差异、剩余积分。
视觉验收按方案 §1 判据——与 `r07-face-hair-v1.png` 并排"是这个角色"且"明显是风格化"。

---

## 7. 风险与回退

| 风险 | 触发信号 | 回退 |
|---|---|---|
| t2 质量不可用 | P0-1A 分件碎/UV 乱 | 退 6-lite（15）→ 再退 7.1（30），批次规模砍半 |
| 环境薄特征糊 | P0-2 松针成块 | P3 改程序化几何 + 2D 贴图，省下 828 分转 P1/P7 |
| 风格漂移 | 批次对比图出现异类 | 回滚该件 `operation-id`，收紧 `style_prefix` 重跑 |
| 积分不够 | CLI 退出码 9 | 立即停新提交，保产物，按"探针 > 英雄资产 > P1/P3"重排 |
| 任务超时 | CLI 退出码 8 | 不是失败——同一 id 续 `wait`，绝不重新生成 |
| 残留代理变量 | 假的鉴权失败/连接超时 | 调用前清空四个代理变量 |
| 子代理误删文件 | — | 每个 subagent 结束后立刻核 `git status`；批次全程由主 agent 直接跑 |

---

## 8. 仓库卫生（顺带修掉审查发现的坑）

- `.gitignore` 增加 `art/**/*.glb`、`art/**/*.blend`、`art/dual-theme/eastern/meshy/`、`.workbuddy/`
  —— 否则 1.9 GB、单个 GLB 最大 177.96 MB（超 GitHub 100 MB 硬限制）会挡死以后的提交；
  参考图/概念图 PNG（约 16 MB）保留可入库
- `docs/README.md` 补登记漏掉的 `wuxia-true3d-execution-2026-09-30.md`
- 台账 `updated_date` 与缺记的 90 分（P0 的 0 分项里一并修）

---

## 9. 不做的事

- ❌ 不发布/部署（需另行授权）
- ❌ 不让 Meshy 做表情或换装分件（方案 §8 非目标）
- ❌ 不用 Meshy 直接做角色脸部（参考图正是官方警告的"风格化"类型）
- ❌ 不覆盖任何已有 GLB——新产物一律 `-v<N>` 递增
- ❌ 不在没有确认的情况下把 3D 接进业务 HTML（G6 前业务页不依赖 3D）
- ❌ 不为了让单件"更好看"而跳过 `--dry-run` 报价
