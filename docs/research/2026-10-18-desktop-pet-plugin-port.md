# 酒馆 Live2D 桌宠移植为 Tavern 插件：可行性与方案

日期：2026-10-18。范围：浅克隆 [bigmalove/tavern-desktop-pet](https://github.com/bigmalove/tavern-desktop-pet)（`fba526b`，tag `v0.8`）读源码与产物；读本项目 `docs/plugin-api.md`、`docs/plugin-design.md`、`docs/design/tavern-to-galgame.md`、客户端插件加载器与配音/舞台实现。**未运行上游插件，未启动 Tavern 实例做端到端验证**；下文「能接」指接口形状匹配，不等于已跑通。没有修改产品代码。

## 结论

| 问题 | 判断 |
| --- | --- |
| 能不能做成插件 | 能。这不是硬塞：`docs/design/tavern-to-galgame.md` 已经把「Live2D、镜头、特效」写成插件替换第 3、4 层（舞台）的典型场景，`registerStageView` 的文档原文就举了 Live2D。 |
| 怎么搬 | **整包搬浏览器半身，不重写**。上游是一个 2.3 万行的 Vue 3 应用，真正依赖 SillyTavern 的只有约 20 处调用点；Live2D（8.1k 行）、TTS（3.5k 行）、UI（8.4k 行）都是框架无关代码。 |
| 最大的不确定性 | Live2D 引擎的三个脚本（pixi 6.5.10、pixi-live2d-display 0.4.0、Cubism Core）现在从 jsDelivr 动态加载。国内网络下这是唯一会「装了但不出人」的风险，必须做本地兜底。 |
| 唯一缺的接口 | 「当前打开的是哪一局」。浏览器侧可用 DSH 自己的 `ctx.sessions.list`（Tavern 自己的客户端也在用）；要长期稳定，建议给 Tavern 补一个 `tavernUi.watchActiveGame()`。 |
| 不建议 | ① 做进 Tavern 本体（违背项目自己的分层）；② 用 iframe 把上游 `dist/index.js` 原样塞进来（一天能亮，但拖拽、性能、调试都变差，只适合做验证 spike，不适合交付）。 |
| 体量 | 插件包约 600 KB（Vue 内联、引擎按需），gzip 约 150 KB——比 Tavern 自己的 `client.js`（1.8 MB）小。 |
| 估算 | 净改动约 1,900 行、新增约 1,200 行；按阶段 7–11 个工作日（含 2 个半天的验证 spike）。 |

## 1. 上游是什么

| 模块 | 行数 | 作用 | 与 ST 的耦合 |
| --- | --- | --- | --- |
| `index.ts` | 206 | ST 扩展引导：注入「桌面宠物设置」菜单项、挂 Vue、pagehide 清理 | 中。jQuery 13 处、`SillyTavern.getCurrentChatId`、`eventOn` |
| `ui/*.vue` | 8,436 | `PetContainer`（浮层、拖拽、手势、气泡）、`SettingsPanel`（5,331 行设置）、`ModelBrowser`、`FunctionMenu`、`ChatBubble` | 低。4 处 ST 上下文、1 处第三方扩展设置（手机 UI） |
| `live2d/*.ts` | 8,152 | pixi-live2d-display 封装、Cubism 2/4/5 运行时路由、表情/动作/口型、模型上传与在线模型库 | 极低。只有 loader 里 18 处 `window.top`（跨 iframe 注入脚本用，同窗口时等价于 `window`） |
| `audio/*.ts` | 3,554 | Edge TTS 直连（WebSocket）、GPT-SoVITS v2、小白盒、分句与播放 | 低。toastr 2 处 |
| `chat/*.ts` | 2,021 | 事件监听触发计数、吐槽生成（三种后端）、332 行提示词模板、情绪 CoT | **高**。`eventOn`、`getChatMessages`、`generateRaw`、ST 连接配置、`/api/backends/chat-completions` |
| `core/ db/ utils/` | 1,109 | zod 设置、10 个中文情绪标签与别名、IndexedDB（模型/ SDK 缓存） | 低 |
| `dist/index.js` | 503 KB | 打包产物（Vue 内联，`pinia`/`klona` 走 `testingcf.jsdelivr.net` 的 ESM） | — |

耦合实测：16 个文件、170 处命中，其中 **toastr 70 处、`window.parent/top` 约 60 处占了绝大多数**；真正的 ST API（`SillyTavern.*`、`eventOn`、`getChatMessages`、`generateRaw`、`/api/*`）只有 20 处左右。也就是说：**90% 的代码不需要为移植改动。**

两个上游本身的问题，动手前要知道：

- **没有 `package.json`、没有构建脚本、没有 LICENSE。** 仓库只提交了源码 + `dist`。要改代码就必须自建打包（vite + `@vitejs/plugin-vue`），并把 `pinia`/`klona` 从 CDN 改成内联，否则在 Tavern 的 classic-script 加载器里会直接报 import 失败。
- **`live2d/loader.ts` 有 GBK 乱码注释**（`缂撳瓨鍔犺浇鍣?`），说明有文件经历过编码转换；搬运时统一转 UTF-8，并检查字符串常量有没有被破坏。上次提交是 2026-03-13，已停更 7 个月。

## 2. 五个子系统都有现成接缝

| 上游能力 | 接到 Tavern 的哪里 | 要做的事 |
| --- | --- | --- |
| 聊天监听（谁说完了一轮、第几轮） | 浏览器侧 `tavernUi.watchTurnState(gameId)`（`busy`/`settled` 跳变）+ `getStage(gameId,{count})`（最近 N 轮正文与台词） | 重写 `chat/monitor.ts`（242 行）里的 `eventOn` 部分，保留「间隔 / 概率 / 手动」触发逻辑 |
| 吐槽生成 | 宿主侧 `runTask({ gameId, prompt })`（带人物卡、世界书、近两轮，用这局后台模型）或自定义端点；`ctx.tavern.handle()` + `callHost()` 打通 | 换掉 3 个后端里的 `generateRaw`/ST 连接配置；332 行提示词模板原样搬 |
| 情绪 | **直接用 `getCast()` 的台词标注**（ST 的 28 情绪名） | 宠物的 10 个中文标签别名表已覆盖 `joy/anger/sad/surprise/smirk/shy/think/laugh/playful/neutral`，映射几乎免费；没标注时回退它自己的情绪 CoT |
| 立绘 / 表情 / 动作 / 口型 | 舞台：`registerStageView({ id, label, render })`（官方就是给这个用的）；浮层：自己往 `document.body` 挂一个固定层 | 引擎代码基本不动，只换挂载点与生命周期（`app.unmount()`、`renderer.dispose()`） |
| 配音 | Tavern 已有 `browser / OpenAI 兼容 / GPT-SoVITS / MiniMax` 四个渠道；缺 Edge TTS | 把 `audio/edge-tts-direct.ts`（666 行，Node 22 自带 WebSocket）包成 `speechProvider`；或先用 `synthesizeSpeech` 复用现成渠道 |
| 设置 | `registerPanel({ id, title, render })`（侧栏「插件」组） | 换掉 4 处 ST 读取（连接配置、请求头），删掉「预设模式」和第三方手机扩展；toastr 换成插件自己的提示 |

顺带一个收益：Tavern 的台词标注是结算时顺手做的，**宠物不用再单独发一次「情绪分析」模型请求**，既省钱也不会和正文的情绪判断打架。

## 3. 两种形态，推荐先 B 后 A

| 方案 | 挂载点 | 体验 | 依赖 | 判断 |
| --- | --- | --- | --- | --- |
| A 舞台桌宠 | `registerStageView` | 只在右侧「舞台」页与全屏舞台里出现 | 零新增接口；但入口要求玩家先打开「对话头像」 | 先做，风险最低，正好验证引擎 |
| B 全局浮层桌宠 | `document.body` 固定层，`z-index` 1100–2300 | 和 ST 一样：聊天时一直在右下角，可拖、可点 | 要知道「当前是哪一局」+ 与右侧栏/输入框避让 | 目标形态；A 跑通后把同一个引擎换挂载点 |
| C iframe 塞 `dist` | `iframe srcdoc` + ST 全局 shim | 一天能亮 | 拖拽跨边界、双份 DOM/Canvas、调试困难 | 只做 spike，不进主线 |

B 的「当前局」有两条路：`ctx.sessions.list.getSnapshot().current`（DSH 客户端服务，Tavern 自己的 `main.js` 就在用它，插件 `inject: ['sessions']` 即可；属 DSH 内部服务，非 Tavern 插件接口），或给 Tavern 加 `tavernUi.watchActiveGame()`（十几行，推荐，但要动产品代码）。建议先用前者验证，稳定后再提升为正式接口。

## 4. 落地设计

### 4.1 包结构

按「随 Tavern 分发的插件包」走，和 `dsh-dream-skin`/`dsh-tavern-remote` 同一套：`dsh.client` + `dsh.bundle.patch`，再进 `package.json` 的 `dsh.profile.bundles`。开发期也可以先放进 `profile-data/tavern/data/plugins/` 直接热更 `client.js`。

```text
tavern-plugin/packages/dsh-tavern-desktop-pet/
├─ package.json          # dsh.client: { platform: web, inject: [dsh-tavern-plugin, sessions] }
├─ cordis.patch.yml      # insert: { id: desktop-pet, name: 'dsh-tavern-desktop-pet' }
├─ src/host/index.mjs    # runTask 吐槽、Edge TTS 渠道、设置读取
├─ src/client/main.js    # 插件入口：inject ['tavernUi']，挂 Vue、注册面板/舞台
├─ src/pet/              # 上游代码（保持目录形状，便于以后对齐上游）
│  ├─ live2d/ audio/ core/ db/ utils/ ui/
│  └─ bridge/            # 新写：monitor / comment / speech / settings 的 Tavern 适配
├─ build.mjs             # vite + @vitejs/plugin-vue → classic CJS wrapper + CSS 注入
└─ tests/                # 情绪映射、触发计数、提示词拼装
```

`package.json` 关键字段（形状照 `dsh-tavern-remote` 的 `dsh.client`）：

```json
{ "dsh": { "client": { "platform": "web", "inject": ["dsh-tavern-plugin", "sessions"] },
           "bundle": { "patch": "./cordis.patch.yml" } } }
```

### 4.2 构建

上游产物是 ESM + CDN import，Tavern 的加载器要的是 classic script + CJS factory：

```js
// build.mjs 输出的头尾（同 dsh-tavern-remote 的 tsdown 配置）
banner: 'window.__ModuleLoader__.load({ id: "dsh-tavern-desktop-pet", factory: (require) => {',
footer: 'return module.exports; } });',
intro:  'var module = { exports: {} }; var exports = module.exports;',
```

三条硬要求：`require('react')` 只用一次（薄壳），Vue/Pinia/klona/zod 全部内联，CSS 由 `vite-plugin-css-injected-by-js` 注入并整体收进 `#dsh-pet-root`；pixi 与 live2d 显示器仍按需动态加载（见 5.1）。

### 4.3 必须替换的接触点

| 上游写法 | 出现位置 | 换成 |
| --- | --- | --- |
| `$('#extensionsMenu').append(...)` 菜单项 | `index.ts` | 删掉。设置入口用 `registerPanel`，另加一个 `registerComposerAction`（「逗一下」） |
| `toastr.*` | 70 处，集中在 `SettingsPanel.vue` | 插件自带的轻量 toast（一个 Vue 组件），或直接 `console.warn` |
| `eventOn(MESSAGE_SENT / GENERATION_ENDED)` | `chat/monitor.ts` | `watchTurnState`：`busy` 由 true→false 记一轮；保留间隔/概率/手动三种触发 |
| `getChatMessages('0-{{lastMessageId}}')` | `chat/commentator.ts`、`ui/PetContainer.vue` | `getStage(gameId,{count:5})`（正文 + 台词 + 情绪）或宿主 `getHistory` |
| `generateRaw(...)`、`connectionManager` 预设 | `chat/commentator.ts` | `callHost('.../comment')` → 宿主 `runTask`（默认）；自定义端点走宿主 `fetch`，Key 存 DSH 凭据 |
| `SillyTavern.getRequestHeaders()`、`/api/backends/chat-completions/generate` | `commentator.ts`、`SettingsPanel.vue` | 宿主侧请求，不再经过页面 |
| `extension_settings.acsusPawsPuffs.phone` | `PetContainer.vue`、`SettingsPanel.vue` | 删（第三方手机扩展，Tavern 有自己的移动端） |
| `teleport_style()`（jQuery 把 `<style>` 塞父页面） | `index.ts`、`utils/style-teleport.ts` | 直接 `document.head.append(style)`，卸载时移除 |
| `window.parent/top.document`（60 处） | `live2d/*`、`ui/*` | 同窗口下 `window.top === window`，**不用改**；只把 `topURL`/proxy 相关分支删掉 |
| IndexedDB（模型、SDK 缓存） | `db/*` | 保留。同源即可用，玩家上传的模型不上传服务器 |

### 4.4 数据流

```text
watchTurnState(busy→false) ──┐
getStage(最近5轮) ───────────┤
getCast(台词+28情绪) ────────┴→ 触发判定(间隔/概率) → callHost('comment')
                                      │
                   宿主 runTask(这局后台模型 + 卡/世界书/近两轮)
                                      │
                    文本 + 情绪 → Vue 状态 → 气泡 / 表情动作 / TTS / 口型
```

## 5. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| **Live2D 引擎依赖 CDN**（jsDelivr 国内常被墙） | 装了不出人，最伤体验 | pixi（460 KB）与 pixi-live2d-display 打进插件；Cubism Core 保留三级 CDN 回退 + 允许玩家指定本地文件（上游已有 `useCdn` 开关，改成「本地/自定义」）。本机实测三个 CDN 均 200，但那不是国内网络 |
| **Vue 3 与 React 19 共存** | 包体 +150 KB、两套响应式 | 所有 SFC 本来就是 `scoped`；Vue 只挂自己的 `div`，不与 React 树交叉；面板关闭/插件卸载时 `app.unmount()` |
| **浮层与布局打架** | 挡输入框、盖侧栏 | `z-index` 取 1100–2300 之间（Tavern 弹窗是 2300，顶层是 2147483000）；只有模型区域 `pointer-events:auto`，其余穿透；窄屏默认关闭 |
| **拿不到「当前局」** | 浮层不知道给谁演 | 先用 `ctx.sessions.list.current`；稳定后提 `tavernUi.watchActiveGame()` |
| **吐槽消耗模型额度** | 玩家被偷偷扣费 | 默认用这局后台模型；默认 3 轮一次、60% 概率（沿用上游）；可切「只手动」；请求进这局请求记录，可查 |
| **舞台入口依赖「对话头像」** | A 方案对普通玩家不可见 | B 方案不依赖；A 只作为「舞台样式」 |
| **人物卡带 Live2D 模型** | CHARX 导入有 50 MB 上限 | 首版只支持在线模型库 + 本地上传（IndexedDB）；卡包内模型放二期 |
| **上游停更、无 LICENSE、乱码** | 维护与合规 | 以你自己的 fork 为准；搬入时统一 UTF-8、补 LICENSE；只搬需要的模块，UI 设置页可以二期再精简 |
| **移动端（dsh-web-mobile）** | 拖拽与滚动冲突 | <720px 默认不挂浮层，面板里可手动打开「仅舞台」 |

## 6. 分期与验收

| 期 | 内容 | 验收（可验证） | 估算 |
| --- | --- | --- | --- |
| P0 骨架 | 包 + `client.js` 薄壳 + 固定层 + 面板空页 | 刷新后 `#dsh-pet-root` 存在；删插件后消失；控制台无 require 错误 | 0.5 天 |
| P1 引擎 | 搬 live2d/core/db/utils，自建 vite 构建；先接 `registerStageView` | 舞台里 2 秒内出模型；来回切「舞台样式」不泄漏 canvas/WebGL（`renderer.dispose()` 后 context 数不增长） | 2–3 天 |
| P2 接数据 | monitor 重写、`runTask` 吐槽、`getCast` 情绪、设置面板 | 发一轮后按间隔出气泡；回退/重生成不重复触发；本局关掉插件后不再触发 | 2–3 天 |
| P3 声音 | Edge TTS 渠道 + 与 `speak` 共用 + 口型 | 同一句第二次不重复合成；换渠道后新声音生效；口型与音频同步 | 1–2 天 |
| P4 打磨 | 避让、移动端、性能（页面隐藏暂停）、错误提示 | 页面切后台 CPU 接近 0；窄屏不挂浮层 | 1–2 天 |

每期结束按仓库约定只跑相关测试：`node bin/test-tavern.mjs tests/<新增>.test.mjs`。

## 7. 开工前要先做的两个 spike（各半天）

1. **加载链**：在真实 Tavern 页面里加载一个 500 KB 的 Vue `client.js`，确认 `__ModuleLoader__` 接受、浮层不被布局挤掉、卸载干净。**未执行。**
2. **引擎兜底**：在无代理的国内网络下拉三个 CDN，确认哪一级可用、本地 `assets/` 兜底是否必要。**未执行**（本机测的是带代理环境，不能代表玩家）。

这两件事任一失败，方案就要改（前者退回 iframe，后者必须内置引擎），所以先做。

## 附：为什么不把 Tavern 伪装成 SillyTavern

上游依赖的三样东西——`eventOn`、`getChatMessages`、`generateRaw`——在 Tavern 里都没有对应物。写一层 ST 全局 shim 能让上游产物原样跑，但会把两套生命周期绑死：Tavern 每次改会话/回合模型，shim 都要跟着改，而且 shim 里拿不到 `textVersion`、回退、分集这些保证。原生适配约 1,900 行，一次写完；shim 是长期负债。

## 落地结果（2026-10-18 晚）

已按上述方案实现并跑通，但**没有放进本仓库**：插件独立成 `/mnt/E/vibecode/dsh-tavern-desktop-pet`（自己的 git 仓库，保留 3 个提交历史），本仓库不再包含它，也不进 `dsh.profile.bundles`。安装走它自己的 `node build.mjs --deploy`（写到 `$DSH_HOME/profile-data/tavern/data/plugins/`）。

实测修正了方案里的两处判断：

- **`getStage` 不是万能入口**：写作/剧本局没有人物卡，它直接抛「这一局没有绑定人物卡」。要靠宿主侧 `getTurnState` + `getHistory` 兜底。
- **`runTask` 不是随时可用**：它要求这一局在 DSH 里有活跃前台 Agent，刚打开还没发言时报「前台会话不可用」，需要直连 `llm` 兜底。

另外踩到一个与插件无关、但会让所有模型调用失败的坑：插件包的 `package.json` 必须有 `version`，否则 DSH 的请求扩展（`deepseekLlmApiExtensions`）在列 `name@version` 时抛错，症状是统一的 `DeepSeek request extension preparation failed`。
