# 真实资产接收台账

核验日期：2026-09-08。阶段状态以 [执行路线](execution-roadmap.md) 为准。
本台账证明已获取文件及许可证据，不证明美术、骨架运行或商用品质已验收。

## Quaternius / Cyberpunk Game Kit / Character

- 作者：Quaternius；发行页标记 July 2022，无更细的下载版本号。
- [官方发行页](https://quaternius.com/packs/cyberpunkgamekit.html) 明确为 CC0，允许个人及商业使用；列出 FBX、OBJ、Blend、glTF。
- 从官方 Download 入口观察到的 [作者下载目录](https://drive.google.com/drive/folders/1GyKLypoBxrpLN6GERF9U610Wiub48v9y)。通过 ego-browser 的正常下载取得文件，没有购买或调用转录／模型服务。
- [包内 License.txt](https://drive.google.com/file/d/1-hNes9woutDvbaJCpPYOKJlvO_cTMSU8/view) 明确列出 CC0 1.0 Universal 及 [许可地址](https://creativecommons.org/publicdomain/zero/1.0/)。**文件抬头为 Ultimate Platformer Pack，与发行页名称不一致**；可能是作者复用模板，但该原因未经证实。保留原文件，不替作者修正名称。当前仅用于内部候选试装，正式分发前再次核对对应关系。
- CC0 不要求署名；仍保留作者、来源和修改说明。不以项目 MIT 许可覆盖模型许可。
- 文件置于外置盘仓库 `.tools/asset-intake/quaternius-cyberpunk/`（Git 忽略），尚未放入 Web public 或扩展，也不将整个素材包纳入产品。

| 文件 | SHA-256 |
| --- | --- |
| Character.gltf | `bb818f848ab17bce362fdbdbed509a17864f7dee62f761d0d8a7074f69ee52e8` |
| Character.fbx | `811ac6278a32c52343c65e7613b904fb5b5e179d04aaf0577cad2d23b6705430` |
| License.txt | `de990ef6fc68cffd7fd1ae342c4d0c823b541b8848d8f76bca5d3339f4de6f6e` |

glTF 结构检查：1,500,456 字节，4 个 mesh、1 个 skin、22 个动画，包含 `Idle_Neutral`；buffer 内嵌，没有列出外部 image。材质名包含 Blade、Blade_Edge，需实际判断武器部件是否能安全移除。以上是文件结构，不等于骨骼、待机姿态、遮挡与材质效果正确。

FBX 是额外可导入格式，不冒称作者原始 Blend 工程。尚未获取 Blend、平台、东方人物和自然场景；尚未改造、压缩或产出实际 3D 样片。下一步是许可证对应关系复核、精简候选试装和东方服饰／人物来源核验。
