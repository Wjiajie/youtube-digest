# 免费人物候选：实际入口与制作文件跟进

核查日期：2026-09-10。范围仅 A2 Ultimate Modular Women 与 Universal Base Characters Standard；补充 [9 月 6 日初查](open-asset-research.md)，不改写其历史记录。B2 环境对照未获正式美术认可，并不证明其他人物已合格；完整 P2／P1–P9 仍未完成。

本轮仅读取官方页面、作者链接的公共目录和两份小型 TXT 元数据；没有下载人物／压缩包、导入 Blender、试装、登录、发邮件或付费。下列“目录已见”不等于已打开制作文件。

## A2：可以定位单个人物，不必先取整包

[作者包页](https://quaternius.com/packs/ultimatemodularwomen.html) 的 Download 按钮实际打开 [公共 Drive 根目录](https://drive.google.com/drive/folders/1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf)。本次无凭据 HTTP GET 可读取目录，标题为 **Ultimate Modular Women - April 2022**；包页仍写 February 2022，不能据此宣称已确认精确发布版本。

- **实际目录元数据**：[Individual Characters](https://drive.google.com/drive/folders/1bX7nfzyaqNb2eCt25A57Zw9tEL2HNLho) 下有 Blends、FBX、glTF。[Blends](https://drive.google.com/drive/folders/1aWEtUbtmsP_NZmK20VnM2cT5g8FRh8J7) 与 [glTF](https://drive.google.com/drive/folders/1_FIjjIVE0SkQIrwgWJ3Q8NQku25ll5a2) 均列出 Adventurer、Casual、Formal、Medieval、Punk、SciFi、Soldier、Suit、Witch、Worker 共十组同名文件。这里确实能找到 `.blend` 条目，不只是页首通用格式图标。
- **作者使用说明**：[How To Use.txt](https://drive.google.com/uc?export=download&id=1-FqaGch58KXpO8GtWEFbKnO6ds763Hd5) 本次实际读到全文：All together 提供总 `.blend` 和 FBX；Individual Characters 为各自带 rig 与动画的独立人物；**Humanoid Rigs 没有动画**，用途是重定向；另有分离骨架网格与动画的组合方式。因此不能把包页“24 个动画”直接套用到每个 Humanoid 文件。说明提到 Mixamo 只是作者举例，本轮未访问、获取或授权其资源。
- **许可异常需要留档**：[实际 License.txt](https://drive.google.com/uc?export=download&id=1lIFL16xEpoPbr0j_HUATgmcEnAmYoIK2) 正文为 CC0 1.0，但标题写 **Ultimate Modular Males**，与 Women 目录不一致。作者 Women 包页同时明确标 CC0 和免费商用。可确认声明存在，不能自行“修正”原文或冒称无歧义的包内许可核对已完成。

具体下一件候选可定位为 [Casual.gltf 文件页](https://drive.google.com/file/d/18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh/view) 与 [Casual.blend 文件页](https://drive.google.com/file/d/1nxFlRC0tj4XIbuxGEzEgMV9O4DgeKfS_/view)；这两个 ID 来自上述实际目录。**本轮没有请求模型正文**，文件大小、glTF 是否内嵌、骨骼／动画名称和可导出性均未知。

## Universal Base Characters：免费层存在，完整源工程仍收费

[作者页](https://quaternius.com/packs/universalbasecharacters.html) 的 Download here 使用 itch.io 官方购买组件，另一按钮直达 [作者发行页](https://quaternius.itch.io/universal-base-characters)，不是一个已验证可匿名直取的 ZIP 地址。[官方零元选择入口](https://quaternius.itch.io/universal-base-characters/purchase) 本次无需账号即可读到跳过支持款的下载选项，并列出 Standard 122 MB；Source 600 MB，门槛 $19.99。没有填写邮箱、提交支付表单或生成下载会话，故仅确认到选择入口，不声称 ZIP 已取得。

作者把完整六个男女基础身体、二十种发型、约 13k 平均三角形、Humanoid 和动画库兼容性作为包级介绍；同时写免费层覆盖约 60–70%，而 rigged `.blend`、完整模型与定制 shader 属于 Source。**公开文字未逐项列明 Standard 究竟含哪些身体与发型**；不得将六身体／二十发型全部计入免费库存，也不能把动画库兼容当作 Standard 已附带动画。上述均为 [作者说明](https://quaternius.com/packs/universalbasecharacters.html)，不是本轮文件测量或导入结果。

## 建议与剩余门槛

**下一步优先 A2 的 Casual 单体制作链路试样**，理由是已定位独立 glTF 与源工程入口、读取了 rig／动画分支说明，能进行范围较小的接收；不是断言它在美术上优于 Universal。Universal Standard 保留为身体比例／拓扑候选，但需要另行接收免费 ZIP 后核对真实清单，不能为取得 rigged `.blend` 自动购买 Source。

后续接收需记录 A2 许可证标题与日期差异，保留原页及原 TXT；确认来源范围后，再取得所选文件、记录哈希、核验内嵌资源、绑定、待机、材质与真实体积。两候选都还缺东方服饰／发型适配和双主题实际画面审批，现有名称 Medieval、Witch 或基础身体不等于武侠主角。

两作者页面均声明 CC0；其一般授权允许修改、商用和分发，但不保证商标、肖像等其他权利，也不能暗示作者背书。[CC0 官方说明](https://creativecommons.org/publicdomain/zero/1.0/) 本轮未完成法律审查、包内一致性确认或商业美术验收。只推荐受控接收与试样，不推荐直接上线。
