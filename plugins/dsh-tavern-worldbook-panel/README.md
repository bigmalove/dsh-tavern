# dsh-tavern-worldbook-panel

把社区 PR [flizzywine/dsh-tavern#271](https://github.com/flizzywine/dsh-tavern/pull/271) 的完整版世界书面板做成 Tavern 插件。

上游把那个 PR 收窄成了 260 行（只能换书 + 开关条目），砍掉的编辑器、查找替换、条目详情、常用条目、文件夹、设置、手机标签页都在这里。

## 装

复制整个文件夹到 Tavern 数据目录的 `plugins/`：

```sh
cp -r dsh-tavern-worldbook-panel ~/.dsh-tavern/profile-data/tavern/data/plugins/
```

不重启也能生效：宿主侧几秒内加载，浏览器侧刷新一次页面出现。删掉文件夹即卸载。

## 用法

顶栏的「世界书」按钮点开就是完整版面板：

| 区域 | 能做什么 |
|---|---|
| 主面板 | 选书下拉、逐条开关、搜索条目、置顶、删除 |
| 全部世界书 | 分列列出所有书，按文件夹归类，可折叠 |
| 常用条目 | 按开关次数排序，可置顶，跨书汇总 |
| 条目详情 | 只读正文、常驻/关键词两档、排序、扫描消息、二级条件 |
| 大窗编辑 | 全屏编辑、`Ctrl+S` 保存、`Ctrl+F` 查找替换（单个/全部、区分大小写、实时计数）、未保存关闭会确认 |
| 设置 | 开关样式、显示元素、桌面/手机可视行数、手机双窗口、文件夹管理 |
| 「完整」 | 带当前书跳到右侧栏世界书库 |

手机（`<768px`）自动改成「世界书 / 条目 / 常用」三个标签页，详情与设置在面板内替换显示；设置里可以开「双窗口」，左栏固定书列表。

面板位置、置顶、使用次数、文件夹都记在 `localStorage`，不跟存档走。

## 实现说明

**为什么能接管 Tavern 自己的按钮**：Tavern 的顶栏项带 `data-header-item="dsh-tavern:worldbooks"`。插件在捕获阶段拦掉它的点击，改开自己的面板，所以界面里始终只有一个入口，位置和「折叠进 ⋮」的行为都还是 Tavern 自己的。如果哪天 Tavern 删了这个按钮，插件会自己露出一个图标兜底。

**数据怎么来**：走 Tavern 的同源路由 `POST /api/dsh-tavern/<method>`，用的还是 `listWorldBooks` / `getWorldBook` / `updateWorldBook` / `setGlobalWorldBook` / `deleteWorldBook` 这几个方法。这些不是 `docs/plugin-api.md` 承诺的插件接口，属于内部请求——Tavern 升级后若改名，面板会整体失效（报错停在面板里，不影响对局正文）。

**为什么类名是 `dsh-wbp-`**：插件和 Tavern 同时注入样式，Tavern 那份后注入且同样用 `.dsh-tavern-wbsw-*`，`flex-direction` 会被它覆盖成 `column`，三栏就叠成了竖排。换前缀是最省事也最不会互相打架的做法。

**没有「向量化」档**：`worldbook-activation.js` 只读 `constant`，其余条目一律走关键词匹配，`vectorized` 字段能存但没人读。摆出来就是改完不生效的开关。

## 开发

```sh
node build.mjs        # src/panel.js + src/panel.css → client.js
node --test tests/panel.test.mjs
```

`client.js` 是产物，不要手改；改 `src/panel.js`（与 Tavern 的 `features/worldbook-switcher.js` 同源）后重新构建。
