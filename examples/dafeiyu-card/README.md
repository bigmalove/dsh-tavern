# 大肥鱼 · DSH 人物卡示例

[DSH Tavern Galgame](https://github.com/jerryzmtz/dsh-tavern-galgame) 分支的示例卡「大肥鱼」做成的 DSH 人物卡（`.dshcard`，见[格式设计](../../docs/design/dsh-card-format.md)）：一个文件里有人物卡、4 个素材包和一个卡内插件，导入后不用装别的插件就能玩到 Galgame 式的舞台。已取得原作者同意，作为演示卡使用。

- `大肥鱼.dshcard`：演示卡本体（约 270 MB）。体积太大，不随程序分发，已加入 `.gitignore`，只在本地保留。
- `plugin/`：卡内插件的源码。宿主侧（`index.mjs`）在每轮后台结算里顺带"导演"，按正文选场景、时段、服装和背景音乐；浏览器侧（`client.js`）用 `registerStageView` 画舞台：背景图、当前服装的情绪立绘、背景音乐。只用公开的[插件接口](../../docs/plugin-api.md)。
- `build.mjs`：改了插件后，用它从分支发布的卡包重新生成 `大肥鱼.dshcard`：

```sh
node examples/dafeiyu-card/build.mjs dafeiyu.card-bundle.zip examples/dafeiyu-card/大肥鱼.dshcard
```

使用：在 Tavern 的人物卡库导入 `大肥鱼.dshcard`（卡内插件随卡启用），刷新页面；在设置里打开「对话头像」，开一局，打开顶栏「舞台」。

`--cast` e2e 在这个文件存在时会导入它玩一轮（也可以用 `TAVERN_E2E_DSHCARD` 指定别的路径）。

这是最小可行版：没有 Live2D、分层立绘、口型、镜头和模组。素材的署名与许可见卡内各素材包的 `credits/`。
