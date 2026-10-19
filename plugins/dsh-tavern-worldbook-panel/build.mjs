// 把 src/panel.js（世界书面板本体）与 src/panel.css 裹进 DSH 的客户端插件外壳，生成 client.js。
//
// 为什么不直接改 client.js：panel.js 是从 Tavern 源码里搬出来的同一个模块，改它、
// 重新构建，比在两个文件里各改一遍可靠。client.js 是产物，不要手改。
//
// 运行：node build.mjs
import { readFile, writeFile } from 'node:fs/promises'

const here = new URL('./', import.meta.url)
const [panel, css, pkg] = await Promise.all([
  readFile(new URL('src/panel.js', here), 'utf8'),
  readFile(new URL('src/panel.css', here), 'utf8'),
  readFile(new URL('package.json', here), 'utf8').then(JSON.parse),
])

const name = pkg.name
if (!name) throw new Error('package.json 缺少 name')

// 面板用到的 Tavern 私有变量，插件里不存在，必须自带兜底。
const variables = `:root, body {
  --dsh-tavern-accent: var(--dsw-alias-brand-primary, #4d6bfe);
  --dsh-tavern-accent-border: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 42%, transparent);
  --dsh-tavern-font-sans: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
}`

const source = `// ${name} — 浏览器侧（由 build.mjs 生成，不要直接改；改 src/panel.js 后重新构建）。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(name)},
  factory: (require) => {
    const React = require("react")

    // 面板样式只注入一次；卸载插件时移除，页面里不留垃圾。
    const PANEL_CSS = ${JSON.stringify(css)}
    const VARIABLES_CSS = ${JSON.stringify(variables)}
    function installStyles() {
      if (typeof document === "undefined") return function () {}
      const existing = document.querySelector('style[data-dsh-worldbook-panel]')
      if (existing) return function () {}
      const style = document.createElement("style")
      style.dataset.dshWorldbookPanel = ""
      style.textContent = VARIABLES_CSS + "\\n" + PANEL_CSS
      document.head.append(style)
      return function () { style.remove() }
    }

    // Tavern 把世界书读写放在同源 HTTP 路由上（POST /api/dsh-tavern/<method>），
    // 浏览器侧本来就是这么调的。插件不是 Tavern 内部模块，只能走这层。
    const TAVERN_RPC_TIMEOUT = 15000
    async function readTavernJson(response) {
      if (response.status === 401) throw new Error("连接认证已失效，请用服务启动时提供的地址重新打开页面")
      if (response.status === 403) throw new Error("请求被拒绝，请检查访问地址和权限")
      if (!response.ok) throw new Error("服务请求失败（HTTP " + response.status + "），请稍后重试")
      const body = await response.text()
      if (!body.trim()) throw new Error("服务返回空响应，可能仍在启动或重启，请稍后重试")
      try { return JSON.parse(body) } catch (_) { throw new Error("服务返回非 JSON 或不完整的响应，请稍后重试") }
    }
    function tavernRpc(method, args, sessionId, options) {
      const payload = Object.assign({}, args || {})
      if (sessionId) payload.sessionId = sessionId
      return fetch("/api/dsh-tavern/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: options && options.signal,
      }).then(readTavernJson)
    }
    function rpcWithTimeout(method, args, sessionId) {
      const controller = new AbortController()
      const timer = window.setTimeout(function () { controller.abort() }, TAVERN_RPC_TIMEOUT)
      return tavernRpc(method, args, sessionId, { signal: controller.signal }).catch(function (error) {
        if (controller.signal.aborted) throw new Error("读取超时，请重新读取")
        throw error
      }).finally(function () { window.clearTimeout(timer) })
    }
    // 写入类请求不设超时（保存大量条目时可能慢），与 Tavern 里的用法保持一致。
    const rpc = tavernRpc
    // Tavern 的各个库靠这个事件互相刷新；插件改完数据也要喊一声，否则侧栏书库还显示旧内容。
    function notifyTavernDataChanged(kinds, source) {
      window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed", {
        detail: { kinds: (kinds || []).filter(Boolean), source: String(source || "") },
      }))
    }

${panel}

    // ---- 顶栏按钮 ----
    // 纯图标，跟 Tavern 自己的顶栏按钮同高同圆角；手机上不额外占宽度。
    function WorldBookPanelTrigger(props) {
      const h = React.createElement
      const onClick = function (event) {
        event.stopPropagation()
        props.open(event.currentTarget)
      }
      return h("button", {
        type: "button",
        className: "dsh-wbp-trigger",
        title: "世界书快捷面板",
        "aria-label": "世界书快捷面板",
        "aria-haspopup": "dialog",
        onClick: onClick,
      }, h("svg", {
        width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      }, h("path", { d: "M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0" })))
    }

    const TRIGGER_CSS = // 默认不显示：顶栏正常时会接管 Tavern 自带的「世界书」按钮，多加一个图标就是重复入口。
      ".dsh-wbp-trigger{display:none;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;transition:background .14s ease,color .14s ease}" +
      "body.dsh-wbp-needs-trigger .dsh-wbp-trigger{display:inline-flex}" +
      ".dsh-wbp-trigger:hover,.dsh-wbp-trigger[aria-expanded=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}" +
      ".dsh-wbp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}"

    return {
      name: ${JSON.stringify(name)},
      // slots 是 DSH 的顶栏/侧栏槽位服务（Tavern 自己也用它注册顶栏按钮）；
      // 写进 inject 才能保证 apply 时槽位已经就绪。
      inject: ["tavernUi", "slots"],
      apply(ctx) {
        const removeStyles = installStyles()
        const style = document.createElement("style")
        style.dataset.dshWorldbookPanelTrigger = ""
        style.textContent = TRIGGER_CSS
        document.head.append(style)

        // 面板本体挂到 body：顶栏 / 侧栏抽屉里常有 transform，position:fixed 会被
        // 换成相对它们的坐标，弹不到按钮下方。模块自己的 register() 负责建容器与挂载。
        function openLibrary(source, sessionId) {
          const betterSidebar = ctx.get && ctx.get("betterSidebar")
          if (!betterSidebar || typeof betterSidebar.openTab !== "function") throw new Error("右侧栏还没有准备好，请稍后再试")
          const seed = { type: "dsh-tavern:worldbooks" }
          if (source) seed.meta = { worldBookSource: source }
          betterSidebar.openTab(seed, { sessionId })
        }

        const unmountPanel = worldBookSwitcherFeature.register({ ctx: ctx, openLibrary: openLibrary })

        const slots = ctx.get && ctx.get("slots")
        // 诊断入口：面板没出现时，先在控制台看这条就知道卡在哪一步。
        try {
          window.__TAVERN_WORLDBOOK_PANEL__ = {
            name: ${JSON.stringify(name)},
            slots: Boolean(slots),
            hasInject: typeof slots?.inject === "function",
            hasRegister: typeof slots?.register === "function",
            mounted: unmountPanel !== null,
            takeover: null,
          }
        } catch (_) {}

        // 当前对局的会话号：接管核心按钮时也要用它。
        let currentSessionId = ""
        const CORE_ITEM = "[data-header-item='dsh-tavern:worldbooks']"

        /**
         * 接管 Tavern 自带的「世界书」顶栏按钮：那个按钮会弹出收窄版面板，
         * 与本插件的完整版撞车。拦截它的点击，改开完整版，界面上仍然只有一个入口
         * （位置、折叠进 ⋮ 的行为都沿用 Tavern 自己的逻辑）。
         * 没有这个按钮时（例如 Tavern 版本变了）退回插件自己的图标按钮。
         */
        function installTakeover() {
          function onPointerDown(event) {
            const target = event.target
            if (!target || typeof target.closest !== "function") return
            const coreButton = target.closest(CORE_ITEM)
            if (!coreButton) return
            // 捕获阶段先吃掉，React 的 onClick 就不会再开收窄版面板。
            event.preventDefault()
            event.stopPropagation()
            if (!currentSessionId) return
            worldBookSwitcherFeature.open(coreButton, currentSessionId)
          }
          document.addEventListener("click", onPointerDown, true)
          return function () { document.removeEventListener("click", onPointerDown, true) }
        }

        if (slots) {
          ctx.effect(() => slots.inject("conversation.session.header.utilities", function () {
            return slots.register(
              { name: "conversation.session.header.utilities", id: ${JSON.stringify(name + ":trigger")}, order: 79 },
              function (slotProps) {
                const sessionId = slotProps && slotProps.sessionId
                if (!sessionId) return null
                currentSessionId = String(sessionId)
                // 平时不显示（顶栏有 Tavern 自己的「世界书」按钮，由 installTakeover 接管）；
                // 只有确认那个按钮不在了才露出自己的图标，避免同一位置两个入口。
                return React.createElement(WorldBookPanelTrigger, {
                  open: function (node) { worldBookSwitcherFeature.open(node, currentSessionId) },
                })
              }
            )
          }), "worldbook panel: header trigger")

          ctx.effect(installTakeover, "worldbook panel: take over core button")

          // 顶栏按钮由另一个插件的插槽渲染，出现时间不定：用观察器跟着判断，
          // 有核心按钮就撤掉自己的，没有（例如 Tavern 改版删了它）就露出来兜底。
          ctx.effect(function () {
            let frame = 0
            // 环境不一定有 rAF（测试环境、老 WebView），退化成 setTimeout。
            const raf = function (fn) {
              return typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(fn) : window.setTimeout(fn, 16)
            }
            const caf = function (id) {
              if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(id)
              else window.clearTimeout(id)
            }
            const evaluate = function () {
              caf(frame)
              frame = raf(function () {
                const hasCore = Boolean(document.querySelector(CORE_ITEM))
                document.body.classList.toggle("dsh-wbp-needs-trigger", !hasCore)
                try { window.__TAVERN_WORLDBOOK_PANEL__.takeover = hasCore ? "core-button" : "own-trigger" } catch (_) {}
              })
            }
            evaluate()
            // 观察器不是每个环境都有；没有时靠下面那次 evaluate 兜底。
            const Observer = window.MutationObserver
            const observer = typeof Observer === "function"
              ? new Observer(evaluate)
              : null
            if (observer) observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ["data-header-item"] })
            return function () {
              caf(frame)
              if (observer) observer.disconnect()
              document.body.classList.remove("dsh-wbp-needs-trigger")
            }
          }, "worldbook panel: watch core header item")
        } else {
          console.warn("[worldbook-panel] 没有 slots 服务，顶栏按钮不会出现")
        }

        ctx.effect(() => function () {
          try { unmountPanel() } catch (_) {}
          style.remove()
          removeStyles()
        })
      },
    }
  },
})
`

await writeFile(new URL('client.js', here), source)
console.log('已生成 client.js：' + source.length + ' 字节')
