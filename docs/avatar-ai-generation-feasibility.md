# AI 3D 虚拟形象生成流水线技术可行性（Meshy 主源核查）

核查日期：2026-09-19。范围：Meshy API 官方文档（docs.meshy.ai/en）、Meshy 官网条款与定价页、官方 MCP Server 仓库源码。方法：通过本地代理匿名 HTTP GET 抓取官方页面正文与 JSON-LD 结构化数据，仅读取文档页、条款页、定价页与官方 GitHub 源码，**未注册账号、未获取 API Key、未实际调用任何付费接口、未下载任何模型**。因此本文所有“能力”结论来自官方文字描述，**不是实测结果**；凡官方文字未写明者一律进入文末“未核实”清单，不做推测。

被评估的流水线：①用户上传照片 → ②选择风格（武侠／赛博朋克等）→ ③图像服务产出风格化且视角一致的多视图（front/side/back）→ ④Meshy 生成 3D 资产（自动绑定＋动画＋retexture/remesh 后处理）→ ⑤GLB 存入 Supabase Storage 用户资产库 → ⑥首页 three.js 场景展示。

## 0. 结论速览

| 步骤 | 判定 | 最关键约束 |
| --- | --- | --- |
| 1 上传用户照片 | **高风险** | Meshy ToS 2.2 明文禁止把可识别个人身份信息（PII）放入 Customer Input |
| 2 选择风格 | 可行 | API 层没有“风格预设”，只有文本/图片提示；预设只在 Webapp UI |
| 3 多视图风格化 | 有条件可行 | image-to-image 的 generate_multi_view 一次给 3 个视角，但**无身份一致性保证的官方承诺** |
| 4 Meshy 3D＋绑定＋动画 | 有条件可行 | 仅适用于标准人形（biped）；**完全没有面部／blendshape 动画** |
| 5 GLB 存 Supabase | 有条件可行 | 非 Enterprise 的 API 产物**仅保留 3 天**，必须当次任务内下载转存 |
| 6 three.js 展示 | 可行 | GLB 是官方推荐 Web 格式；但待机动画只能是身体动作，且文件体积无官方数据 |

---

## A. Meshy 输入：image-to-3d 与 multi-image-to-3d

来源：[Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d)、[Multi-Image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d)、[Webapp：Image to 3D](https://docs.meshy.ai/en/webapp/image-to-3d)。

### A.1 单图与多图

| 端点 | 图片数量 | 视图顺序 | 备注 |
| --- | --- | --- | --- |
| POST /openapi/v1/image-to-3d | **1 张**（image_url） | 不适用 | 单图完全合法，是最小可用路径；也可传 input_task_id 引用一个已成功的 Text to Image / Image to Image 任务 |
| POST /openapi/v1/multi-image-to-3d | **1–4 张**（image_urls） | meshy-7.1 / latest 下**第一张被当作主视图（front）**，其余顺序无关 | 官方要求“所有图应为同一物体的不同角度”；input_task_id 可引用 Text to Image / Image to Image / **其 multi-view 变体** |

- 两个端点都是 input_task_id 与图片 URL **二选一**；同时提供时 input_task_id 优先。
- 图片可用“公网可访问 URL”或“base64 data URI”两种方式提交。
- **既有“1–4 张”（API）与“2–8 张”（Webapp 决策矩阵）的口径冲突**：[generation-method 对比页](https://docs.meshy.ai/en/webapp/guides/choosing/generation-method) 写 Multi-view 需 “2–8 images”，而 [Multi-Image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d) 明确为 1–4 且 image_urls 超过 4 张会 400。**API 口径为准**。
- Webapp 侧推荐角度组合是 [Front + Side + Back + 3/4 view，并要求同一物体、相近光照](https://docs.meshy.ai/en/webapp/image-to-3d)；这是**对输入的要求，不是 Meshy 的一致性保证**。

### A.2 格式、尺寸、宽高比

- 支持格式：.jpg、.jpeg、.png（[Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d)、[Multi-Image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d)）。
- image-to-3d / multi-image-to-3d **没有 aspect_ratio 参数**：宽高比只出现在图像生成端点（见 B 节）。
- 官方**没有给出输入图的像素下限/上限或文件体积上限**（API 文档未写）。Webapp 指南只给“建议 ≥ 512×512、主体清晰、背景简单”（[Webapp：Image to 3D](https://docs.meshy.ai/en/webapp/image-to-3d)）。
- Webapp 的 **100MB 上传上限**属于“AI Texturing 上传 3D 模型”场景，不是图生 3D 的图片上限（[meshy.ai 定价页 FAQ](https://www.meshy.ai/pricing)：For AI texturing, we support uploading models in .fbx, .obj, .stl, .gltf, and .glb … The size limit for the web app is 100MB）。

### A.3 model_type / ai_model / smart-topology / ultra

| 参数 | 取值 | 语义 |
| --- | --- | --- |
| model_type | standard（默认）／smart-topology／lowpoly（**已废弃**） | 选 smart-topology 时 topology、should_remesh、save_pre_remeshed_model 被忽略 |
| ai_model（standard） | meshy-6-lite、meshy-6、meshy-7.1、latest（= Meshy 7.1）；meshy-7 **已废弃** | — |
| ai_model（smart-topology） | meshy-t2（默认） | “更干净拓扑、原生分件（natively separated parts）、三角面输出、面数可设” |
| geometry_resolution | standard／2k／4k | 2k ＝ Ultra pass 在 2048³ 运行，4k ＝ 4096³；**需要 meshy-7.1 或 latest** |
| ultra_mode | 布尔，**已废弃** | ultra_mode: true **等价于 geometry_resolution: "2k"**；官方要求改用 geometry_resolution |
| target_polycount | 两条独立生效路径 | Remesh 路径（should_remesh: true）：**100–300,000，默认 30,000**；Smart Topology 路径：**100–15,000，默认 4,000**（直接按面数生成，不跑 remesh） |

其余与画质相关的关键参数（同源）：should_texture（默认 true）、enable_pbr（默认 false）、texture_resolution（2k/4k/8k，默认 2k）、texture_prompt（≤800 字符）、pose_mode（a-pose/t-pose）、image_enhancement（默认 true，**会做风格化预处理**，设 false 才保留原图外观）、remove_lighting、moderation、target_formats、auto_size、alpha_thumbnail、multi_view_thumbnails（注：文档写 “Applies only when auto_size = true”，其余场景是否生效未验证）。

- multi-image-to-3d 只支持 geometry_resolution: standard | 2k，**传 4k 会 400**。
- Smart Topology 的 Webapp 口径：Meshy T2＝5 credits／约 2 秒（当前默认），Meshy T1＝20 credits／约 3 分钟（遗留模型）——见 [Webapp：Image to 3D](https://docs.meshy.ai/en/webapp/image-to-3d)；而 [Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d) 只列 meshy-t2，T1 仅出现在官方 MCP README 与 Webapp 文档中。

---

## B. text-to-image 与 image-to-image：风格化能否放在 Meshy 内

**结论：可以，而且这是 Meshy 内部自洽的推荐路径。** 来源：[Text to Image API](https://docs.meshy.ai/en/api/text-to-image)、[Image to Image API](https://docs.meshy.ai/en/api/image-to-image)。

| 端点 | 输入 | 关键能力 | 计费 |
| --- | --- | --- | --- |
| POST /openapi/v1/text-to-image | prompt（必填） | generate_multi_view、pose_mode（a-pose/t-pose）、aspect_ratio、remove_background | nano-banana 3／nano-banana-2 6／nano-banana-pro 9／gpt-image-2 9／gpt-image-2-5-flare 9／gpt-image-2-5-sunburst 9 credits |
| POST /openapi/v1/image-to-image | prompt + **1–5 张 reference_image_urls** 或 input_task_id | 同上（**这就是“把用户照片风格化”的直接能力**） | nano-banana 3／nano-banana-2 6／nano-banana-pro 9／gpt-image-2 12／flare 12／sunburst 12 credits |

- **风格化照片的做法**：把用户照片作为 reference_image_urls[0]，prompt 写“改造成武侠风格／赛博朋克风格”，即可在 Meshy 内完成，无需第三方图像服务。官方示例原文就是 “Transform this into a cyberpunk style artwork”（[Image to Image API](https://docs.meshy.ai/en/api/image-to-image)）。
- **多视图**：两个端点的 generate_multi_view: true 都会“生成展示主体多角度的多视图图像”；任务对象的 image_urls 说明为：**开启多视图时数组包含 3 个不同视角的图片 URL，否则只含 1 个**（[Text to Image API](https://docs.meshy.ai/en/api/text-to-image)、[Image to Image API](https://docs.meshy.ai/en/api/image-to-image)）。
- **限制**：
  - generate_multi_view 与 aspect_ratio **互斥**（同时传会 400）。
  - aspect_ratio 白名单随模型不同：nano-banana 系 1:1/16:9/9:16/4:3/3:4；gpt-image-2 系额外支持 3:2/2:3。
  - 只能用一个提示来源，且多视图与“保留人物身份”之间**没有官方参数**（无 face/identity 条件控制项，只有 prompt 与参考图）。
  - image-to-image 的 input_task_id 必须指向**本账号**已成功且未过期的图像任务（跨账号或过期一律 404）。
- **风格预设是 Webapp 概念，不是 API 参数**：[AI Image Generation 指南](https://docs.meshy.ai/en/webapp/guides/image/ai-image-generation) 提到 Realistic／Anime／Chibi 等预设与 “Send to Image to 3D” 按钮；API 侧**没有** style preset 字段，风格必须自己写进 prompt 或参考图。

---

## C. 自动绑定（Rigging）

来源：[Rigging API](https://docs.meshy.ai/en/api/rigging)、[Webapp：Rigging 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging)。

### C.1 输入要求

| 项 | 官方要求 |
| --- | --- |
| 主体类型 | programmatic rigging currently only works well with standard humanoid (bipedal) assets with clearly defined limbs and body structure；明确不适合：**未贴图网格、非人形资产、肢体结构不清晰的人形资产** |
| 输入形式 | input_task_id（**必须是有贴图的人形模型**）或 model_url（**仅支持已贴图的人形 GLB**） |
| 面数 | 走 input_task_id 时**超过 300,000 面不支持**，需先 Remesh |
| 朝向 | 走 model_url 时**角色面部必须朝 +Z 轴**（glTF 标准前向），否则姿态估计失败 |
| 姿态 | API 无强制字段；Webapp 排障建议“输入模型接近 T-pose 或 A-pose”，并可用 pose_mode 在生成阶段直接产出 T/A pose |
| 其他 | height_meters（默认 1.7，正值）、可选 texture_image_url（**仅 .png**，作为 UV 展开后的基础色贴图） |

- **Webapp 与 API 口径不一致**：[Webapp Rigging 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging) 说支持 “humanoid and quadruped”；[Rigging API](https://docs.meshy.ai/en/api/rigging) 说只对标准双足人形效果好，且 [Animation API](https://docs.meshy.ai/en/api/animation) 明确 motion_task_id 重定向 “requires a biped rig; quadruped rigs are rejected”。**做人物形象请按 biped 设计。**

### C.2 返回内容

成功任务返回（[Rigging API](https://docs.meshy.ai/en/api/rigging)）：

- rigged_character_glb_url、rigged_character_fbx_url
- basic_animations：walking_glb_url／walking_fbx_url／walking_armature_glb_url、running_glb_url／running_fbx_url／running_armature_glb_url
- 即：**绑定即赠送 walk / run 两段基础动画**，另附“只含骨架”的 armature GLB。

### C.3 已知失败模式

- **422 Unprocessable Entity — Pose estimation failed**：“The provided model may not be a valid humanoid character.”（[Rigging API](https://docs.meshy.ai/en/api/rigging)）
- 400 类：缺少 model_url/input_task_id、非 .glb 扩展名、URL 不可达、input_task_id 无效、**面数超 300,000**。
- Webapp 排障表（[Rigging 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging)）：骨骼位置偏移（输入姿态非标准）／权重穿插（拓扑过密或不均，建议先 Remesh）／四肢严重形变（人物比例不接近标准人体）。
- 骨骼命名规范、骨架层级格式：**官方文档未描述**（见“未核实”）。Webapp 只说导出 FBX 可用于 Unity/Unreal 的 **Mixamo 兼容动画库**。

---

## D. 动画（Animation）

来源：[Animation API](https://docs.meshy.ai/en/api/animation)、[Animation Library Reference](https://docs.meshy.ai/en/api/animation-library)、[Text to Motion API](https://docs.meshy.ai/en/api/text-to-motion)、[Webapp：Animate 指南](https://docs.meshy.ai/en/webapp/guides/animate)。

### D.1 预设 vs 自定义

| 方式 | 参数 | 规模 | 计费 |
| --- | --- | --- | --- |
| 单个预设 | action_id | 见下 | 3 credits |
| 多个预设合并 | action_ids（1–10 个，去重） | 最多一次 10 个 | 3 credits × 动作数（上限 30） |
| 自定义动作 | motion_task_id（来自 Text to Motion） | 文本生成动作片段 | prime 10 credits／swift 3 credits |

- **预设动画库规模**：官方 [Animation Library Reference](https://docs.meshy.ai/en/api/animation-library) 的表格按 action_id 逐条列出，实测抓取到的编号范围是 **0–696，共 678 个不重复条目**，主要分类为 WalkAndRun（约 175）／BodyMovements（约 158）／DailyActions（约 154）／Fighting（约 154）／Dancing（约 33）；Webapp 宣传语为“**500+ presets**”（[Animate 指南](https://docs.meshy.ai/en/webapp/guides/animate)）。同一目录也可用 GET /openapi/v1/animations/library 拉取 JSON。
- **自定义动作**：POST /openapi/v1/text-to-motion，prompt ≤400 字符，duration 2–10 秒、步长 0.5，mode ＝ prime（最高质量，**输出 FBX**）或 swift（更快更便宜，**输出 BVH**）。生成的是**独立动作片段，不含角色模型**；必须在**源任务 3 天保留期内**用 motion_task_id 应用到绑定好的角色上，且**要求 biped 骨架**。
- **后处理**：post_process.operation_type ∈ change_fps（fps 24/25/30/60）、fbx2usdz、extract_armature；对 action_ids 而言后处理作用于**合并后的单文件**。

### D.2 动画是否烘焙进可下载文件

**是。** 动画任务的返回对象含 animation_glb_url 与 animation_fbx_url，示例文件名形如 Animation_Reaping_Swing_withSkin.glb / ..._withSkin.fbx（[Animation API](https://docs.meshy.ai/en/api/animation)），withSkin 表示**带蒙皮的角色＋动画数据在同一个可下载文件里**，可直接进 Unity/Unreal/Blender（[Animate 指南](https://docs.meshy.ai/en/webapp/guides/animate)）。多动作时返回**单文件、每动作一个 clip**，clip 顺序＝action_ids 数组顺序，clip 名＝动画库中的名称。

### D.3 面部／表情动画：**不支持**

明确结论，两处官方原文互证：

- [Webapp：Rigging 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging) 的 FAQ：“Can I rig a model for facial expressions or tail physics? **Not directly** — for complex custom skeletons, export the model and rig manually in a DCC tool like Blender or Maya.”；同页 “When NOT to Use”：“You need complex custom skeletons (**facial expressions**, tail physics) → Export and manually rig in DCC tools.”
- [Webapp：Animate 指南](https://docs.meshy.ai/en/webapp/guides/animate) 的 “When NOT to Use”：“You need cinematic-level precise animation with **facial expressions** → Manually create in Maya/Blender.”
- 动画库 678 条条目中**没有任何面部／眨眼／口型／表情类动作**（仅有 Face_Punch_Reaction 这类“被打脸”的身体反应动作）。
- 全站文档中 blendshape／morph target／lip sync **零命中**。

**因此：任何“会眨眼、会说话”的角色需求都必须离开 Meshy 流水线，到 Blender/Maya 手工加形态键，或在引擎侧叠加自定义表情层。**

---

## E. 后处理端点

来源：[Remesh](https://docs.meshy.ai/en/api/remesh)、[Retexture](https://docs.meshy.ai/en/api/retexture)、[UV Unwrap](https://docs.meshy.ai/en/api/uv-unwrap)、[Convert](https://docs.meshy.ai/en/api/convert)、[Resize](https://docs.meshy.ai/en/api/resize)、[后处理选择指南](https://docs.meshy.ai/en/webapp/guides/choosing/post-processing)。

| 端点 | 作用 | 输入 | 关键限制 | 费用 |
| --- | --- | --- | --- | --- |
| /openapi/v1/remesh | 重网格／减面／导出多格式 | input_task_id（Text to 3D Preview/Refine、Image to 3D、Retexture）或 model_url（glb/gltf/obj/fbx/stl） | topology（quad/triangle）、target_polycount 100–300,000、decimation_mode 1–4；旧参数 resize_*／auto_size／convert_format_only 已废弃 | 5 credits |
| /openapi/v1/retexture | 给已有模型重新贴图 | input_task_id 或 model_url | **必须且只能给一种风格来源**：text_style_prompt（≤800）／image_style_url／multiview_image_urls（1–4，**要求 ai_model: "meshy-7"**）；enable_original_uv 决定是否复用原 UV；enable_pbr、texture_resolution 2k/4k/8k | 10 credits（2k/4k）／15 credits（8k） |
| /openapi/v1/uv-unwrap | 生成全新 UV | input_task_id 或 model_url | **只吃 .glb**；**≤ 40,000 面**，超出 400；quad/n-gon 会被三角化；输出是“UV 白模”（2×2 灰色占位材质，无真实贴图）；**该功能正按 Statsig flag 灰度发布，未开通账号调用返回 404** | 5 credits |
| /openapi/v1/convert | 纯格式转换 | input_task_id 或 model_url | target_formats 必填：glb/fbx/obj/usdz/blend/stl/3mf | 1 credit |
| /openapi/v1/resize | 真实世界尺寸 | input_task_id（输出 GLB）或 model_url（保持原格式） | resize_height／resize_longest_side／auto_size **三选一互斥**；origin_at ＝ bottom/center | 1 credit |

- 官方推荐顺序：**Remesh → Unwrap UV → AI Texturing → Rigging → Animate → 导出**（[后处理选择指南](https://docs.meshy.ai/en/webapp/guides/choosing/post-processing)）。
- 对人物形象流水线而言，若第 4 步 image-to-3d 已经开了贴图，**retexture 通常是重复付费**，只在“要换成武侠/赛博朋克材质”时才值得跑。

---

## F. 异步任务模型、Webhook 与限流

来源：[Quickstart](https://docs.meshy.ai/en/api/quick-start)、[Webhooks](https://docs.meshy.ai/en/api/webhooks)、[Rate Limits](https://docs.meshy.ai/en/api/rate-limits)、[Errors](https://docs.meshy.ai/en/api/errors)、[Asset Retention](https://docs.meshy.ai/en/api/asset-retention)。

### F.1 任务生命周期

- **创建**：POST 到各端点，立即返回 { "result": "<task_id>" }，官方描述为 202 语义。
- **轮询**：GET /openapi/v1/{endpoint}/{id}；status ∈ PENDING／IN_PROGRESS／SUCCEEDED／FAILED／CANCELED，progress 0–100。官方 Quickstart 的推荐轮询间隔是 **5 秒**。
- **流式**：GET /openapi/v1/{endpoint}/{id}/stream（Server-Sent Events），未完成时只推 progress/status。
- **列表**：GET /openapi/v1/{endpoint}?page_num=&page_size=（默认 10，上限 100）。注意：**API 创建的任务不会出现在 Webapp 的 My Assets 里**。
- **删除／取消**：DELETE /openapi/v1/{endpoint}/{id}。
  - PENDING 可删且**退还创建时扣的 credits**；
  - IN_PROGRESS **不可删，返回 409**，任务继续跑，credits 不退；
  - 终态（SUCCEEDED/FAILED/CANCELED）可删但**不退 credits**。
- **官方没有文档化的“真取消”REST 端点**（sitemap 中不存在 cancel 页）。官方 MCP Server 的 meshy_cancel_task 工具**其实现就是发 DELETE**（源码：[src/tools/tasks.ts](https://github.com/meshy-dev/meshy-mcp-server/blob/main/src/tools/tasks.ts) 调用 client.delete(...)；[src/services/meshy-client.ts](https://github.com/meshy-dev/meshy-mcp-server/blob/main/src/services/meshy-client.ts) 的 delete() 走 HTTP DELETE），而该工具**描述文字声称可以取消 IN_PROGRESS 任务**——与上面 409 的文档行为矛盾。**实现时不要依赖“取消进行中任务”这一能力。**

### F.2 Webhook

- 配置入口：Webapp → API settings → Webhooks → “Create Webhook”，**每个账号最多 5 个活跃 webhook，且只允许 https URL**（[Webhooks](https://docs.meshy.ai/en/api/webhooks)）。
- **载荷**：任务状态变化时，Meshy 以 JSON POST **完整任务对象**到你的 URL（文档指向各 Task Object 作为字段参照）。文档未给出签名/校验机制。
- **投递语义**：必须返回 **HTTP < 400**；≥400 视为投递失败；“Multiple consecutive failures may: cause progress updates to be delayed or arrive out of order；automatically disable your webhook after repeated attempts (see Auto-Disable Policy)”。
- **重试次数、退避策略、autodisable 的具体阈值：文档未给出**（“Auto-Disable Policy”在本页只是文字提及，页面内没有对应链接或章节）。**因此生产实现必须自带轮询兜底 + 幂等写入。**

### F.3 限流与并发

[Rate Limits](https://docs.meshy.ai/en/api/rate-limits)：限流**按账号维度、跨该账号全部 API Key 共享**，分两个维度——每秒请求数（RPS）与“队列中的并发生成任务数”（Queue Tasks，涵盖 Text to 3D / Image to 3D / Text to Texture / Remesh）。

| 用户层级 | Requests per Second | Queue Tasks | Priority |
| --- | ---: | ---: | --- |
| Pro | 20 | 10 | Default |
| Premium | 20 | 30 | 高于 Pro |
| Ultra | 20 | 100 | 最高 |
| Studio | 20 | 20 | 高于 Pro |
| Enterprise | 100 | 默认 100，可定制 | 最高 |

- 超限得到 **429**：请求维度为 RateLimitExceeded，队列维度为 NoMoreConcurrentTasks。
- **API Key 需要 Pro 及以上套餐**（[官方 MCP README](https://github.com/meshy-dev/meshy-mcp-server)：A Meshy API key (get one here — requires Pro plan or above)；[meshy.ai 定价 FAQ](https://www.meshy.ai/pricing)：Pro gets you 1,000 credits per month, 60% faster generation, API access...）。
- GET /openapi/v1/usage/tasks（任务级计费明细）**仅 Studio/Enterprise team 可用**，其他套餐返回 403（[Usage API](https://docs.meshy.ai/en/api/usage)）。
- 失败任务不扣 credits；官方错误分类为 invalid_input／timeout／service_unavailable／server_error，具名错误码如 image_too_complex（输入过于复杂，官方建议“单图单主体、避免场景级提示”）、model_missing_uv（[Errors](https://docs.meshy.ai/en/api/errors)）。

### F.4 产物保留（直接影响第 5 步）

- **非 Enterprise 账号通过 API 生成的模型只保留 3 天**，之后自动删除；Enterprise 可无限期保留（[Asset Retention](https://docs.meshy.ai/en/api/asset-retention)、[Quickstart](https://docs.meshy.ai/en/api/quick-start)：Files are retained for 3 days on non-Enterprise plans）。
- 条款同款表述：Customer Output generated by Customers using the APIs, other than Enterprise Customers, will be deleted three (3) days after it is generated.（[Terms of Use](https://www.meshy.ai/terms-of-use) §2.5）
- 下载 URL 是**带 Expires 的签名地址**（所有响应示例中的 ?Expires=***），不能长期存库。

---

## G. 输出格式、贴图分辨率与面数

来源：[Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d)、[Multi-Image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d)、[Remesh](https://docs.meshy.ai/en/api/remesh)、[Convert](https://docs.meshy.ai/en/api/convert)、[Export & File Formats](https://docs.meshy.ai/en/webapp/guides/platform/export-formats)、[meshy.ai 定价 FAQ](https://www.meshy.ai/pricing)。

- **可下载格式**：glb、obj、fbx、stl、usdz、3mf（由 target_formats 指定；省略时除 3mf 外全部生成）。Remesh / Convert 额外支持 blend。官方文件格式指南另称支持 6 大格式（GLB/FBX/OBJ/STL/USDZ/3MF），定价 FAQ 的下载格式列为 .fbx .obj .usdz .glb .stl .blend。
- **贴图打包差异**：**GLB 内嵌贴图（单文件）**；**FBX/OBJ 贴图是分离文件**，必须一起搬运（[Export & File Formats](https://docs.meshy.ai/en/webapp/guides/platform/export-formats)）。→ 对第 5/6 步，**GLB 是唯一省心的选择**。
- **贴图分辨率**：2k(2048²)／4k(4096²)／8k(8192²)。限制：meshy-6-lite 不支持 4k/8k；multi-image 的 4k/8k 需 meshy-6/meshy-7.1/latest；8k 不生成 emission map。
- **PBR 贴图集**：enable_pbr: true 会额外产出 metallic／roughness／normal（meshy-6 在非 8k 时还有 emission）；响应里以 texture_urls[] 给出 base_color/metallic/normal/roughness/emission。
- **面数控制**：Remesh/standard 路径 100–300,000（默认 30,000）；Smart Topology 100–15,000（默认 4,000）；decimation_mode 1–4 为自适应档位（设置后 target_polycount 失效）。
- **文件体积**：**官方没有任何 GLB/FBX 体积或“每模型 MB”的公开数据，本文也未实测 → 归入“未核实”。** 这直接影响 Supabase 存储与 Web 首屏预算，必须实测后再定。

---

## H. 成本

### H.1 API 单价（credits／次）

来源：[API Pricing](https://docs.meshy.ai/en/api/pricing)。

| 操作 | 费用 |
| --- | --- |
| Image to 3D（Meshy-6） | 20（无贴图）／30（含贴图）／35（含 8K 贴图） |
| Image to 3D（Meshy-7、7.1） | 同上，**另加 5 credits（geometry_resolution 2k 或 4k）** |
| Image to 3D（Smart Topology / Meshy T2） | 5（无贴图）／15（含贴图）／20（含 8K） |
| Multi Image to 3D（Meshy-7/7.1） | 20 / 30 / 35，**另加 5（2k）** |
| Text to 3D（Preview，Meshy-7/7.1） | 20，另加 5（2k 或 4k） |
| Text to 3D（Refine / 贴图） | 10（2k、4k）／**15（8k）** |
| Retexture | 10（2k/4k）／15（8k） |
| Remesh | 5 |
| Convert／Resize | 各 1 |
| UV Unwrap | 5 |
| **Auto-Rigging** | 5 |
| **Animation** | 3／动作；action_ids 为 3 × 动作数（≤10，故 ≤30） |
| Text to Motion | prime 10／swift 3 |
| Text to Image | nano-banana 3／-2 6／-pro 9／gpt-image-2 9／flare 9／sunburst 9 |
| Image to Image | nano-banana 3／-2 6／-pro 9／gpt-image-2 12／flare 12／sunburst 12 |
| 贴图引导（texture_prompt／texture_image_url） | 额外 10 credits／任务 |

### H.2 套餐与含赠 credits

来源：[meshy.ai/pricing](https://www.meshy.ai/pricing) 页面内嵌的官方 JSON-LD Product/Offer 与 FAQ 文本；[Webapp Pricing & Credits](https://docs.meshy.ai/en/webapp/pricing)。

| 套餐 | 月费（USD） | 含赠 credits | 其他要点 |
| --- | ---: | --- | --- |
| Free | 0 | **100／月** | 输出为 **CC BY 4.0**（需署名）；无 API |
| Pro | 20（年付 240） | 1,000／月 | 私有授权、更快生成、**API access**、无限重试 |
| Premium | 40 | 3,000／月 | 最多 300 个资产、优先生成 |
| Ultra | 100 | 8,000／月 | 最多 800 个资产、最高优先级 |
| Studio | 70（年付 840） | 5,500／月（**团队共享池**） | 最多 550 个资产、更高队列优先级、**每任务 24 次免费重试** |
| Enterprise | 定制 | 定制 | 保留期可配 |

- 月度 credits 在**每月 1 日 00:00 UTC 重置**；**追加购买的 credits 自购买日起 1 年后过期**（[ToS](https://www.meshy.ai/terms-of-use) §2.10）；Free 与付费的月度 credits 均不跨月结转。
- **Webapp 与 API 的 credits 表并不一致**：[Webapp Pricing](https://docs.meshy.ai/en/webapp/pricing) 的 Credit Usage Reference 写 Image to 3D（Meshy 7）＝25、Remesh＝0、Rigging＝0、Animate＝0；而 [API Pricing](https://docs.meshy.ai/en/api/pricing) 写 20/30/35（+5）、Remesh＝5、Rigging＝5、Animate＝3。**走 API 请以 API Pricing 页为准。**
- 单次“用户照片 → 可展示角色”流水线（全在 Meshy 内、使用 Meshy-7.1 + 贴图）：image-to-image（约 3–12）＋ image-to-3d（35，含 2k 几何与贴图）＋ rigging（5）＋ animation 1 个（3）≈ **46–55 credits／人**；按 Pro 套餐 1,000 credits 计约 **18–21 次／月**（未含重试与多视图图片生成的额外图片计费）。

---

## I. 授权与隐私

来源：[Terms of Use](https://www.meshy.ai/terms-of-use)、[Privacy Policy](https://www.meshy.ai/privacy-policy)（最后修订日 2026-09-19）、[Webapp Pricing & Credits](https://docs.meshy.ai/en/webapp/pricing)、[meshy.ai 定价 FAQ](https://www.meshy.ai/pricing)。

### I.1 商用权利与归属

- **免费套餐**：Meshy owns all right, title, and interest ... in and to the Customer Output and makes such rights available to free plan customers under the Creative Commons Attribution 4.0 International License (CC BY 4.0), as long as the free plan customer provides appropriate credit to Meshy.（ToS §3.2）→ 免费层**不是**“你拥有输出”，而是“Meshy 拥有、以 CC BY 4.0 授权给你”，商用须**署名 Meshy**。
- **付费套餐**：such customers on a paid Meshy plan own their Customer Output（ToS §3.2，to the extent possible under applicable law）；All paid plans support commercial use（[Webapp Pricing](https://docs.meshy.ai/en/webapp/pricing)）。
- **无独占性保证**：THE SERVICE MAY GENERATE SIMILAR OR IDENTICAL 3D MODELS FOR DIFFERENT USERS WHO PROVIDE SIMILAR 2D INPUTS. MESHY DOES NOT GUARANTEE THE UNIQUENESS OF THE CUSTOMER OUTPUT...（ToS §7.2）。
- **不得去除水印/标识**：输出可能内嵌机器可读元数据或数字水印，You agree not to remove, alter, disable, or otherwise tamper with such identifiers（ToS §2.4）。
- 社区页发布的内容会变成 CC0（3D 模型）／CC BY-NC 4.0（其他），并赋予 Meshy 永久不可撤销的再许可（ToS §3.3）——**不要把用户资产发到 Community**。

### I.2 上传图片与生成资产的处理

| 事项 | 官方原文位置与内容 |
| --- | --- |
| **禁止上传 PII** | ToS §2.2：You agree that you will not include any personally identifiable information about yourself or any third party in your Customer Input... |
| **训练用途** | ToS §2.9：Meshy may use Customer Inputs and Customer Outputs ("User Content") from non-Enterprise Customers to train, validate, test, or improve Services unless otherwise agreed to in the Order. |
| **质量测试用途** | Privacy Policy §3.5：We may use a limited selection of Customer Input and Customer Output to evaluate and test the quality, safety, and performance of our models and Services. |
| **付费层隐私** | ToS §3.2：Customers on a paid Meshy plan have the option to keep their User Content private and your User Content will not be used for any purpose other than as outlined here. |
| **API 产物保留** | ToS §2.5：非 Enterprise 的 API 输出**生成后 3 天删除**；Enterprise 默认无限期，可配置 1–30 天 |
| **数据存放地** | [meshy.ai 定价 FAQ](https://www.meshy.ai/pricing)：your data is stored securely with Amazon Web Services in the United States. We will NOT share your data or use it for any training purpose without your consent. |
| **用户权利** | Privacy Policy §7：包括 Erase Your Personal Data；营销邮件的 opt-out 仅覆盖营销通信 |

### I.3 **两份官方文件互相矛盾（高风险）**

- [meshy.ai 定价 FAQ](https://www.meshy.ai/pricing) 声称 We will NOT ... use it for any training purpose without your consent.
- [Terms of Use §2.9](https://www.meshy.ai/terms-of-use) 却写非 Enterprise 客户的输入与输出**可被用于训练/验证/测试/改进服务**，除非在 Order 中另有约定。

条款效力高于营销 FAQ。工程上必须按“**用户照片可能被用于训练**”这一更保守的口径设计，并在产品文案与隐私声明中如实披露。

### I.4 是否有 opt-out / 删除控制

- **文档化的 opt-out：仅“Enterprise 通过 Order 约定”与“付费套餐的私有选项”**（ToS §2.9、§3.2）。
- 面向普通用户的“上传即不用于训练”开关：**官方文档中未找到** → 见“未核实”。
- 删除控制：DELETE /openapi/v1/{endpoint}/{id} 可删任务与数据（终态无退款）；企业可配置保留期（ToS §2.5）。另有 DMCA 下架流程（ToS §6）。

---

## J. 多视图一致性（turnaround）

### J.1 Meshy 内的能力（有主源）

| 能力 | 端点/参数 | 产出 | 来源 |
| --- | --- | --- | --- |
| 文本→多视图 | text-to-image + generate_multi_view: true | image_urls 含 **3 个不同视角** | [Text to Image API](https://docs.meshy.ai/en/api/text-to-image) |
| **照片→多视图（关键）** | image-to-image + 1–5 张 reference_image_urls + generate_multi_view: true | image_urls 含 **3 个不同视角** | [Image to Image API](https://docs.meshy.ai/en/api/image-to-image) |
| 多视图任务直接喂 3D | multi-image-to-3d 的 input_task_id **明确接受 “Image to Image Multi-View”** | 一次建模吃 1–4 张 | [Multi-Image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d) |
| 多视图引导贴图 | retexture 的 multiview_image_urls（1–4，**要求 ai_model: "meshy-7"**） | 一致的多视图材质 | [Retexture API](https://docs.meshy.ai/en/api/retexture) |
| 生成后校验视图 | multi_view_thumbnails: true 渲染 front/right/back/left 四张缩略图（**仅当 auto_size: true**） | 4 张预览图 | [Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d) |
| 单图建模 | image-to-3d | 直接出模型（无 turnaround 步骤） | 同上 |

**这意味着流水线第 3 步无需第三方图像服务**：image-to-image（参考图＝用户照片，prompt＝风格）＋ generate_multi_view 就能一步产出“风格化 + 3 视角”，并可直接通过 input_task_id 交给 multi-image-to-3d。

### J.2 证据薄弱之处（必须诚实说明）

- 官方**没有承诺**这 3 张多视图在人物身份、脸型、服饰细节上互相一致；generate_multi_view 只被描述为“生成展示主体多角度的多视图图像”（[Image to Image API](https://docs.meshy.ai/en/api/image-to-image)）。
- 官方**没有说明这 3 个视角具体是哪三个**（是否就是 front/side/back），也没说明输出顺序。渲染缩略图那组才是明确写死 front/right/back/left。
- 官方**没有给出任何“单张照片 → 身份一致 turnaround”的专用能力或参数**；相反，[Webapp：Image to 3D](https://docs.meshy.ai/en/webapp/image-to-3d) 把一致性写成**对用户的输入要求**：Consistency requirement: All images should be of the same object, with similar lighting conditions。
- **结论**：Meshy 内部具备“照片→3 视角风格化”的**端点级能力**，但“3 视角是否足以支撑一个前后左右都可信的 3D 人物”**属于未验证的推断**，必须用真实照片做小样本实测（建议 10–20 张不同人像/角度）后再决定是否引入外部多视图模型。

---

## 证据与限制

- **核查方式**：匿名 HTTP GET（经本地代理）抓取官方页面 HTML，本地剥离脚本/样式后提取正文；定价页与 FAQ 另从页面内嵌的 application/ld+json 结构化数据提取；官方 GitHub 通过 REST API 与 raw 文件读取源码。缓存文件保存在 %TEMP%\dsh-research，未写入仓库。
- **实际成功抓取（HTTP 200）的主源 URL**：
  - API 文档：https://docs.meshy.ai/en/api/ 下的 image-to-3d、multi-image-to-3d、text-to-3d、text-to-image、image-to-image、rigging、animation、animation-library、text-to-motion、remesh、retexture、uv-unwrap、convert、resize、auto-split、webhooks、rate-limits、pricing、quick-start、authentication、asset-retention、balance、usage、errors
  - Webapp 文档：https://docs.meshy.ai/en/webapp/pricing 、 .../webapp/image-to-3d 、 .../webapp/3d-agent 、 .../webapp/guides/3d-model/rigging 、 .../webapp/guides/animate 、 .../webapp/guides/platform/export-formats 、 .../webapp/guides/choosing/generation-method 、 .../webapp/guides/choosing/post-processing 、 .../webapp/guides/image/ai-image-generation
  - 官网：https://www.meshy.ai/pricing 、 https://www.meshy.ai/terms-of-use 、 https://www.meshy.ai/privacy-policy 、 https://www.meshy.ai/acceptable-use-policy
  - 源码：https://github.com/meshy-dev/meshy-mcp-server （README）、 .../blob/main/src/tools/tasks.ts 、 .../blob/main/src/services/meshy-client.ts
  - 站点地图：https://docs.meshy.ai/sitemap.xml （用于确认**不存在** cancel 端点页面）
- **失败/不可用的抓取**：https://www.meshy.ai/terms 与 https://www.meshy.ai/privacy 均 404（正确路径是 /terms-of-use、/privacy-policy，由定价页页脚链接确认）。web_fetch 工具对 docs.meshy.ai 报 TypeError: fetch failed，全部改走本地代理 curl。
- **本文件的证据强度分级**：A/B/C/D/E/F/G/H/I 各节的**参数名、取值范围、行为描述、条款原文**均来自上列官方页面，属一手证据；H.2 的套餐价格与额度来自官网 JSON-LD；F.1 中“官方 MCP 的 cancel 实为 DELETE”来自官方仓库源码。**所有“效果好不好”的判断（多视图是否够用、模型是否够像、体积是否可接受）均无一手证据，属于必须实测的部分。**
- **未做**：未注册/登录 Meshy、未申请 API Key、未调用任何接口、未下载或测量任何 GLB/FBX、未做浏览器实测、未做法律意见。

## 未核实

以下项目在官方一手来源中**未找到**或**无法确认**，不得作为事实使用：

1. **输出文件体积**：GLB/FBX/USDZ 的典型或上限体积、每模型 MB 数——官方无公开数据，本文未实测。
2. **输入图片的像素上限、文件体积上限、最小分辨率**：API 文档未规定（只有 Webapp 的“建议 ≥512×512”）。
3. **generate_multi_view 的计费口径**：究竟按“每张生成图 3 credits”还是“每任务 3 credits”计价，官方未写明（nano-banana 单价写的是 per image）。
4. **多视图的 3 个视角具体是什么、输出顺序如何**，以及是否对人物**身份/脸部一致性**有任何保证。
5. **骨骼命名规范、骨架层级、权重格式**：Rigging API 文档未描述（仅承诺导出 FBX 可用于 Mixamo 兼容动画库）。
6. **Webhook 的重试次数、退避策略、自动禁用阈值、签名校验方式**：文档只写“多次连续失败可能延迟/乱序/自动禁用”，无量化规则，且页内引用的 “Auto-Disable Policy” 没有对应链接或章节。
7. **是否存在面向普通用户（非 Enterprise）的“训练数据 opt-out”开关**：ToS/Privacy 只给出 Enterprise Order 与付费层私有选项，未描述自助开关。
8. **Meshy 在 API 层是否提供“风格预设”**：API 无 style preset 字段；预设只见于 Webapp UI 描述。
9. **Free 套餐能否获取 API Key**：MCP README 与定价 FAQ 都指向“需 Pro 及以上”，但官方 API 文档本身未逐条写明套餐门槛。
10. **Enterprise 的具体价格、含赠 credits、SLA、定制保留期的配置入口**：官网只有 custom。
11. **multi_view_thumbnails 在未开启 auto_size 时的实际行为**：文档写 “Applies only when auto_size = true”，但该选项位于模型输出章节，语义存在歧义。
12. **官方 MCP Server 的 meshy_cancel_task 对 IN_PROGRESS 任务的实际返回**：源码用 DELETE，而 DELETE 文档写明 IN_PROGRESS 返回 409——两者一致时会失败，不一致时属于文档过期；未实测。
13. **Meshy 生成的 GLB 在 three.js／WebGL 下的实际加载体积、解析耗时、是否需要 Draco/Meshopt 压缩**：官方无相关说明。
14. **Meshy 多视图能力与第三方专用多视图模型（如角色 turnaround 专用方案）的对比**：本文仅核查 Meshy 官方来源，**未对第三方做一手核查**，因此本项为“无证据”，不是“更差”。

## 对上述流水线的关键结论

- **1. 用户上传照片 —— 高风险。** 最大隐患不是技术而是合规：[Terms of Use §2.2](https://www.meshy.ai/terms-of-use) 明确禁止把可识别个人身份信息（PII）放进 Customer Input，而“用户自拍”正是 PII；同时 §2.9 允许非 Enterprise 的输入输出被用于训练，与官网 FAQ 的“未经同意不用于训练”**相互矛盾**。最关键的注意事项：**在拿到 Meshy 书面的数据处理约定（DPA/Order 条款）之前，不应把真实用户照片直接送进 Meshy；可行替代是先用本地/自研手段做去身份化或非人脸化的风格图。**
- **2. 选择风格 —— 可行。** Meshy API 有 [text-to-image](https://docs.meshy.ai/en/api/text-to-image) 与 [image-to-image](https://docs.meshy.ai/en/api/image-to-image)，风格靠 prompt 或参考图表达（官方示例即 “cyberpunk style”）。最关键的注意事项：**API 没有风格预设字段**，“武侠/赛博朋克”必须由我们自己维护成 prompt 模板＋可选参考图，且 generate_multi_view 与 aspect_ratio 互斥。
- **3. 多视图风格化 —— 有条件可行。** [image-to-image](https://docs.meshy.ai/en/api/image-to-image) 支持 1–5 张参考图 + generate_multi_view，一次产出 **3 个视角**，并通过 input_task_id 直接对接 [multi-image-to-3d](https://docs.meshy.ai/en/api/multi-image-to-3d)（该端点明确接受 “Image to Image Multi-View”）。最关键的注意事项：**官方对“3 视角之间的人物身份一致性”没有任何保证或说明，视角种类与顺序也未定义**；必须用小样本实测验证“三视图是否足够重建可信人物”，且这 3 张图会**额外产生图像计费**（口径未核实）。
- **4. Meshy 生成 3D ＋ 绑定 ＋ 动画 —— 有条件可行。** [Rigging](https://docs.meshy.ai/en/api/rigging) 只对**标准双足人形**可靠，要求贴图、清晰肢体、面部朝 +Z、≤300,000 面；[Animation](https://docs.meshy.ai/en/api/animation) 提供 678 条预设动作（Webapp 称 500+）以及文本生成动作。最关键的注意事项：**完全不存在面部／blendshape／口型动画**（[Rigging 指南](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging) 与 [Animate 指南](https://docs.meshy.ai/en/webapp/guides/animate) 都要求“要表情就去 Blender/Maya 手工做”）——如果 Blueprint 首页人物需要眨眼或对话口型，本流水线**必须外挂一层自定义表情方案**，否则只能做身体待机动画。
- **5. GLB 存入 Supabase —— 有条件可行。** 下载格式齐全（GLB 内嵌贴图，[Export & File Formats](https://docs.meshy.ai/en/webapp/guides/platform/export-formats)），但 **API 产物对非 Enterprise 只保留 3 天**（[Asset Retention](https://docs.meshy.ai/en/api/asset-retention)、[ToS §2.5](https://www.meshy.ai/terms-of-use)），下载链接是**带 Expires 的签名 URL**。最关键的注意事项：**必须把“下载并转存 Supabase”做成任务成功后同一请求链内的强一致步骤（含重试与幂等），并且绝不能把 Meshy 的签名 URL 当长期地址存库**；同时注意 API 任务不出现在 Webapp 的 My Assets 中，任务 ID 需自行持久化。
- **6. three.js 首页展示 —— 可行（技术成熟度最高的一步）。** GLB 是官方推荐的 Web 展示格式（[Export & File Formats](https://docs.meshy.ai/en/webapp/guides/platform/export-formats)），带蒙皮的 *_withSkin.glb 已内含动画，可被 three.js AnimationMixer 直接播放。最关键的注意事项：**没有官方文件体积数据（未核实），而 polycount 可到 30 万面、贴图可到 8k，按默认参数直出很可能撑爆首屏预算**；应在生成时就锁定 model_type: smart-topology（5 credits、面数 100–15,000）或 target_polycount 低档 + texture_resolution: 2k，再配合 CDN 压缩（Draco/Meshopt）后实测首屏时间。

