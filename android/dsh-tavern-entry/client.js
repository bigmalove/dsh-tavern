// DSH 0.1.5 session projections use findLast; Android WebView 95 lacks it.
(function () {
  for (const name of ['findLast', 'findLastIndex']) {
    if (typeof Array.prototype[name] === 'function') continue
    Object.defineProperty(Array.prototype, name, {
      configurable: true, writable: true,
      value: function (predicate, thisArg) {
        'use strict'
        if (this == null) throw new TypeError('Array receiver is null or undefined')
        const object = Object(this)
        const length = Math.min(Math.max(Math.trunc(Number(object.length)) || 0, 0), Number.MAX_SAFE_INTEGER)
        if (typeof predicate !== 'function') throw new TypeError('predicate must be a function')
        for (let index = length - 1; index >= 0; index--) {
          const value = object[index]
          if (predicate.call(thisArg, value, index, object)) return name === 'findLast' ? value : index
        }
        return name === 'findLast' ? undefined : -1
      }
    })
  }
})();

// MuMu / older Android WebView lack AbortSignal.throwIfAborted / any used by DSH history load.
// A bad AbortSignal.any polyfill aborts follow immediately → empty transcript, no error toast.
(function (global) {
	if (!global || !global.AbortSignal) return;
	var AbortSignal = global.AbortSignal;
	var AbortController = global.AbortController;
	if (typeof AbortSignal.prototype.throwIfAborted !== "function") {
		AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
			if (!this.aborted) return;
			if (this.reason !== undefined) throw this.reason;
			var error = new Error("This operation was aborted");
			error.name = "AbortError";
			throw error;
		};
	}
	if (typeof AbortSignal.any !== "function" && AbortController) {
		AbortSignal.any = function any(signals) {
			var list = Array.prototype.slice.call(signals || []);
			var controller = new AbortController();
			function onAbort() {
				if (controller.signal.aborted) return;
				var reason;
				for (var i = 0; i < list.length; i++) {
					if (list[i] && list[i].aborted) { reason = list[i].reason; break; }
				}
				if (reason === undefined) {
					reason = new Error("This operation was aborted");
					reason.name = "AbortError";
				}
				try { controller.abort(reason); } catch (_) { controller.abort(); }
			}
			for (var i = 0; i < list.length; i++) {
				var signal = list[i];
				if (!signal || typeof signal.addEventListener !== "function") continue;
				if (signal.aborted) { onAbort(); break; }
				(function (target) {
					function onAbortOnce() {
						if (typeof target.removeEventListener === "function") target.removeEventListener("abort", onAbortOnce);
						onAbort();
					}
					target.addEventListener("abort", onAbortOnce);
				})(signal);
			}
			return controller.signal;
		};
	}
	if (global.Promise && typeof global.Promise.withResolvers !== "function") {
		global.Promise.withResolvers = function withResolvers() {
			var resolve, reject;
			var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
			return { promise: promise, resolve: resolve, reject: reject };
		};
	}
})(typeof globalThis !== "undefined" ? globalThis : window);

window.__ModuleLoader__.load({
	id: "dsh-tavern-entry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const CSS = `
.dsh-tavern-embed { position:fixed; inset:0; z-index:2147483000; background:#14110d; display:flex; flex-direction:column; box-sizing:border-box; padding-top:env(safe-area-inset-top,0px); }
.dsh-tavern-embed iframe { flex:1; min-height:0; width:100%; border:0; background:white; }
.dsh-tavern-entry-btn {
  display: flex; align-items: center; gap: 7px; width: 100%;
  box-sizing: border-box; margin: 4px 0;
  padding: 7px 10px;
  border: 1px solid rgba(154,98,47,.45); border-radius: 9px;
  background: rgba(154,98,47,.10);
  color: #a66b35; cursor: pointer; font-size: 12.5px; font-weight: 650;
  text-align: left;
}
.dsh-tavern-entry-btn:hover { background: rgba(154,98,47,.20); color: #8e5728; }
.dsh-tavern-entry-btn:disabled { opacity: .45; cursor: default; }
.dsh-tavern-entry-actions { display: flex; gap: 5px; width: 100%; }
.dsh-tavern-entry-actions .dsh-tavern-entry-btn:first-child { flex: 1; }
.dsh-tavern-entry-manage { flex: none; width: auto; white-space: nowrap; }
.dsh-tavern-entry-state { margin-left: auto; font-size: 10.5px; font-weight: 400; opacity: .8; }
.dsh-tavern-entry-message { padding: 0 4px 4px; font-size: 10px; line-height: 1.35; opacity: .75; }
.dsh-tavern-entry-message.error { color: #c45f5f; opacity: 1; }
`;

		const tagId = "dsh-tavern-entry/tavern-entry.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-tavern-entry";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function installEmbeddedViewport(root) {
			if (!root) return function () {};
			const view = root.ownerDocument.defaultView;
			const viewport = view.visualViewport;
			let pending = 0;
			function sync() {
				pending = 0;
				if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
				// 内嵌 iframe 看不到顶层软键盘的遮挡，必须先缩小外壳，再由内部酒馆自然重排。
				root.style.top = (viewport ? viewport.offsetTop : 0) + "px";
				root.style.height = (viewport ? viewport.height : view.innerHeight) + "px";
				root.style.bottom = "auto";
			}
			function schedule() { if (!pending) pending = view.requestAnimationFrame(sync); }
			viewport?.addEventListener("resize", schedule);
			viewport?.addEventListener("scroll", schedule);
			view.addEventListener("resize", schedule);
			sync();
			return function () {
				if (pending) view.cancelAnimationFrame(pending);
				viewport?.removeEventListener("resize", schedule);
				viewport?.removeEventListener("scroll", schedule);
				view.removeEventListener("resize", schedule);
				root.style.removeProperty("top"); root.style.removeProperty("height"); root.style.removeProperty("bottom");
			};
		}

		function checkTavern() {
			return new Promise(function (resolve) {
				const img = new Image();
				img.onload = function () { resolve(true); };
				img.onerror = function () { resolve(false); };
				img.src = "http://127.0.0.1:3088/favicon.ico?probe=" + Date.now();
				setTimeout(function () { resolve(false); }, 2500);
			});
		}

		async function request(path, method) {
			const response = await fetch(path, { method: method || "GET", headers: { "Accept": "application/json" } });
			let payload = null;
			try { payload = await response.json(); } catch (_error) {}
			if (!response.ok) throw new Error(payload && payload.error || ("请求失败：" + response.status));
			return payload;
		}

		const inject = ["slots"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;

			ctx.effect(() => slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "dsh-tavern-entry", priority: 999 },
				function (props) {
					const [state, setState] = react.useState({ online: null, update: { phase: "idle", host: "android" } });
					const [error, setError] = react.useState("");
					const [frame, setFrame] = react.useState("");
					const frameRoot = react.useRef(null);
					// 全屏壳不能是插槽的后代：这个插槽是手机侧栏抽屉的底部，抽屉靠
					// transform 位移，会让 position:fixed 的包含块从视口变成抽屉
					// （宽度被 92vw 截断，右侧露出遮罩缺口）。壳用原生节点直接挂到
					// body，React 只负责侧栏按钮，层级与宽度都回到视口。
					react.useEffect(function () {
						if (!frame) return undefined;
						const root = document.createElement("div");
						root.className = "dsh-tavern-embed";
						root.setAttribute("role", "dialog");
						root.setAttribute("aria-modal", "true");
						root.setAttribute("aria-label", "酒馆工作台");
						const embedded = document.createElement("iframe");
						embedded.title = "酒馆工作台";
						embedded.referrerPolicy = "no-referrer";
						embedded.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
						embedded.allowFullscreen = true;
						embedded.src = frame;
						root.appendChild(embedded);
						document.body.appendChild(root);
						frameRoot.current = root;
						const release = installEmbeddedViewport(root);
						return function () {
							release();
							frameRoot.current = null;
							root.remove();
						};
					}, [frame]);
					// 零控件、按返回键也不退出：DSHA 的返回键会先问页面（注入脚本找可见的
					// dialog 并派发 Escape，说处理了就不回退、不 finish）。外壳带 role=dialog，
					// 就等于「本次返回已被处理」；再叠一层历史守卫，万一走了原生 goBack，
					// 也只是弹掉我们压的哨兵条目，页面不动，并且立刻补压回去，永远不会走到
					// finish()。Escape 监听只为吃掉宿主派发的那一下，不关闭窗口。
					react.useEffect(function () {
						if (!frame) return undefined;
						const marker = "dsh-tavern-embed-" + Date.now();
						const guard = function () { window.history.pushState({ dshTavernEmbed: marker }, ""); };
						guard();
						function onPopState() { if (!frameRoot.current) return; guard(); }
						function onKeyDown(event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } }
						window.addEventListener("popstate", onPopState);
						window.addEventListener("keydown", onKeyDown, true);
						return function () {
							window.removeEventListener("popstate", onPopState);
							window.removeEventListener("keydown", onKeyDown, true);
							if (window.history.state && window.history.state.dshTavernEmbed === marker) window.history.back();
						};
					}, [frame]);
					async function openEmbedded() {
					  try { const result = await request("/api/dsh-tavern-android/embed", "POST"); setFrame(result.url); setError(""); }
					  catch (err) { setError(String(err.message || err)); }
					}
					react.useEffect(function () {
						let stopped = false;
						async function refresh() {
							try {
								const next = await request("/api/dsh-tavern-android/status");
								if (!stopped) { setState(next); setError(""); }
							} catch (err) {
								const online = await checkTavern();
								if (!stopped) { setState(function (current) { return Object.assign({}, current, { online: online }); }); setError(String(err && err.message || err)); }
							}
						}
						refresh();
						const timer = setInterval(refresh, 3000);
						return function () { stopped = true; clearInterval(timer); };
					}, []);
					const updating = state.update && state.update.phase === "running";
					async function startUpdate() {
						setError("");
						setState(function (current) { return Object.assign({}, current, { update: { phase: "running", host: "android" } }); });
						try { setState(await request("/api/dsh-tavern-android/update", "POST")); }
						catch (err) { setError(String(err && err.message || err)); setState(function (current) { return Object.assign({}, current, { update: { phase: "failed", host: "android" } }); }); }
					}
					const updateFailed = state.update && state.update.phase === "failed";
					const message = updating
						? "正在下载、安装并重启酒馆…"
						: state.update && state.update.phase === "completed"
							? "更新完成；界面未变化时请重启 DSHA。"
							: updateFailed
								? (state.update.error || "更新失败，请重试。")
								: state.online === false ? "酒馆未启动，可点击更新/修复。" : "";
					return react.createElement("div", null,
						react.createElement("div", { className: "dsh-tavern-entry-actions" },
							react.createElement("button", {
								type: "button", className: "dsh-tavern-entry-btn",
								title: "打开酒馆工作台（3088）",
								onClick: openEmbedded
							}, react.createElement("span", null, "🍺"), react.createElement("span", null, "酒馆工作台"),
								react.createElement("span", { className: "dsh-tavern-entry-state" }, state.online === true ? "在线" : (state.online === false ? "未启动" : "检测中…"))),
							react.createElement("button", { type: "button", className: "dsh-tavern-entry-btn dsh-tavern-entry-manage", disabled: updating, onClick: startUpdate }, updating ? "更新中…" : "更新/修复")
						),
						react.createElement("div", { className: "dsh-tavern-entry-message" }, "酒馆在应用内全屏打开，窗口不带工具栏，返回键也不会退出。保持 DSHA 运行。"),
						message || error ? react.createElement("div", { className: "dsh-tavern-entry-message" + (error || updateFailed ? " error" : "") }, error || message) : null
					);
				}
			)), "dsh-tavern-entry: sidebar footer button");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
