		function TavernDockedPanel(props) {
			const ref = React.useRef(null);
			React.useLayoutEffect(function () {
				tavernPanelRegistry.dock(props.id, ref.current);
				return function () { tavernPanelRegistry.restore(props.id); };
			}, [props.id]);
			return React.createElement("div", { ref: ref });
		}
		function TavernPersistentStatusRuntime(props) {
			const entries = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
			const [selected, setSelected] = React.useState("");
			const [refreshes, setRefreshes] = React.useState({});
			const view = props.view;
			// "pinned": only panels pinned from messages (status bar shown in the story body);
			// "status": only the card's status views (that body copy). Default: both.
			const statuses = view && isPlayMode(view.mode) && props.panels !== "pinned" ? (view.tavernStatusViews || []) : [];
			const manual = props.panels === "status" ? [] : entries.filter(function (entry) { return entry.sessionId === props.sessionId && entry.pinned; });
			const newest = manual.reduce(function (latest, entry) { return !latest || entry.activation > latest.activation ? entry : latest; }, null);
			React.useEffect(function () { if (newest) setSelected(newest.id); }, [props.sessionId, newest && newest.activation]);
			const ids = statuses.map(function (panel) { return panel.viewId; }).concat(manual.map(function (entry) { return entry.id; }));
			const active = ids.includes(selected) ? selected : ids[0];
			if (!view || !view.tavernHelper || !ids.length) return null;
			const h = React.createElement;
			const runtime = h("section", { className: "dsh-tavern-status-runtime" + (ids.length === 1 ? " single-panel" : "") },
				h("div", { className: "dsh-tavern-panel-toolbar" }, ids.length > 1 ? h("div", { className: "dsh-tavern-panel-tabs", role: "tablist", "aria-label": "人物卡面板" },
					statuses.concat(manual.map(function (entry) { return { viewId: entry.id, title: entry.title }; })).map(function (panel) {
						return h("button", { key: panel.viewId, role: "tab", type: "button", "aria-selected": active === panel.viewId,
							className: "dsh-tavern-panel-tab", onClick: function () { setSelected(panel.viewId); } }, panel.title || "角色状态");
					})) : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "放大面板", title: "全屏查看此面板", onClick: function (event) { expandTavernFrame(event.currentTarget.closest(".dsh-tavern-status-runtime")?.querySelector('[role="tabpanel"]:not([hidden])')); } }, "⤢") : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "刷新状态", title: "重新加载此面板，未保存的输入会清空", onClick: function () { tavernRetainedFrames.invalidatePanel(props.sessionId, active); setRefreshes(function (previous) { return Object.assign({}, previous, { [active]: (previous[active] || 0) + 1 }); }); } }, "↻") : null),
				statuses.map(function (statusView) { return h("div", { key: props.sessionId + statusView.viewId, role: "tabpanel", hidden: active !== statusView.viewId,
					"data-status-view-id": statusView.viewId, "data-template-revision": statusView.templateRevision },
					h(TavernMessageFrame, {
					key: props.sessionId + statusView.viewId + (refreshes[statusView.viewId] || 0),
					content: String(statusView.content), sessionId: props.sessionId,
					turn: Math.max(1, Number(statusView.targetTurn) || 1), partIndex: Math.max(0, Number(statusView.sourcePartIndex) || 0),
					panelId: statusView.viewId, helperContext: view.tavernHelper,
                    frameSizing: view.tavernRuntimePolicy?.frameSizing,
					trustedCardMode: Boolean(view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode),
					eager: true, persistent: true, executeSlash: props.executeSlash,
					observeMvuView: false, runtimeReporting: true
				})); }),
				manual.map(function (entry) { return h("div", { key: entry.id, role: "tabpanel", hidden: active !== entry.id },
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { tavernPanelRegistry.pin(entry.id, false); } }, "返回正文栏"),
					h(TavernDockedPanel, { id: entry.id })); })
			);
			return props.section ? h("section", { className: "dsh-tavern-status-section" }, runtime) : runtime;
		}

		function latestTavernAssistantMessageId(snapshot) {
			// alpha.2 keeps message projections on Chat, separate from Session lifecycle.
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
			}
			return null;
		}

		// @include turn-error-controls.js

		function createSupersededErrorProjection(root) {
			const owned = new Map();
			function restore(row, previous) {
				row.hidden = previous.hidden;
				if (row.style) row.style.display = previous.display;
			}
			function dispose() {
				for (const [row, previous] of owned) restore(row, previous);
				owned.clear();
			}
			function apply(turns) {
				const hidden = new Set(turns.map(String));
				const rows = root.querySelectorAll('[data-chat-flow-kind]');
				const keep = new Set();
				let pending = [];
				let failedTurn = "";
				function flush(turn) {
					for (const row of pending) {
						const owner = row.getAttribute("data-chat-turn") || turn;
						if (!hidden.has(owner)) continue;
						keep.add(row);
						if (!owned.has(row)) owned.set(row, { hidden: row.hidden, display: row.style && row.style.display });
						row.hidden = true;
						// Native process rows update `hidden` themselves when folding.
						// Keep suppression independent of that presentation state.
						if (row.style) row.style.display = "none";
					}
					pending = [];
				}
				for (const row of rows) {
					pending.push(row);
					const kind = row.getAttribute("data-chat-flow-kind");
					if (kind !== "turn-error" && kind !== "turn-tail") { failedTurn = ""; continue; }
					// Legacy rows have message IDs, not turn IDs. The terminal error or
					// tail anchors the whole turn, including its input and reasoning.
					// A failed tail can be empty, so inherit its preceding error's turn.
					const key = row.getAttribute("data-chat-flow-key") || "";
					const prefix = kind.length + ":" + kind;
					const keyTurn = key.startsWith(prefix) ? key.slice(prefix.length) : "";
					const tail = kind === "turn-tail" && row.querySelector ? row.querySelector("[data-turn-tail]") : null;
					const turn = row.getAttribute("data-chat-turn") || row.getAttribute("data-turn-tail") || (tail && tail.getAttribute("data-turn-tail")) || (/^\d+$/.test(keyTurn) ? keyTurn : "") || (kind === "turn-tail" ? failedTurn : "");
					flush(turn);
					failedTurn = kind === "turn-error" ? turn : "";
				}
				// alpha has explicit ownership even before its tail is mounted.
				flush("");
				for (const [row, previous] of owned) {
					if (!keep.has(row)) { restore(row, previous); owned.delete(row); }
				}
			}
			return { apply: apply, dispose: dispose };
		}
		// One owner for persisted suppression and legacy browser-only history records.
		// Kept in the loader bundle so DSH needs no new browser module protocol.
		function createTurnHistoryProjection(options) {
			options = options || {};
			const root = options.root || function () { return document; };
			const storage = options.storage || function () { return window.localStorage; };
        const hiddenRows = new Map();
        function hideRow(row) {
            if (!hiddenRows.has(row)) hiddenRows.set(row, { display: row.style.display, priority: row.style.getPropertyPriority ? row.style.getPropertyPriority("display") : "" });
            // 宿主自己的样式表可能给这些行设 display，inline 声明加 !important 才压得住。
            if (row.style.setProperty) row.style.setProperty("display", "none", "important");
            else row.style.display = "none";
            row.hidden = true;
        }
        function restoreHiddenRows() {
            for (const [row, previous] of hiddenRows) {
                const value = previous && typeof previous === "object" ? previous.display : previous;
                const priority = previous && typeof previous === "object" ? previous.priority : "";
                if (row.style.setProperty) {
                    if (value) row.style.setProperty("display", value, priority || "");
                    else row.style.removeProperty("display");
                } else row.style.display = value;
                row.hidden = false;
            }
            hiddenRows.clear();
        }
		const HIDDEN_TURNS_KEY = "dsh-tavern-hidden-turns";
		const ROLLED_BACK_TURNS_KEY = "dsh-tavern-rolled-back-turns";
		const HIDDEN_REGEN_USER_TURNS_KEY = "dsh-tavern-hidden-regen-user-turns";
		function forgetHiddenTurn(storageKey, sessionId, turn) {
			try {
				const all = JSON.parse(storage().getItem(storageKey) || "{}");
				const list = Array.isArray(all[sessionId]) ? all[sessionId].filter(function (item) { return Number(item) !== Number(turn); }) : [];
				if (list.length) all[sessionId] = list;
				else delete all[sessionId];
				storage().setItem(storageKey, JSON.stringify(all));
			} catch (err) {}
		}
		// Rows of the same turn before its tail, nearest first. Every DSH conversation row
		// carries data-chat-flow-kind; anything without it (pagination, host controls)
		// is outside the conversation and ends the turn as surely as the previous tail.
		function turnRowsBefore(tail, owner) {
			const rows = [];
			for (let sib = tail.previousElementSibling; sib; sib = sib.previousElementSibling) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (!kind || kind === "turn-tail") break;
				const siblingTurn = sib.getAttribute("data-chat-turn");
				if (owner && siblingTurn && siblingTurn !== owner) break;
				rows.push(sib);
			}
			return rows;
		}
		// Rows up to, but not including, the turn's user input.
		function turnReplyRowsBefore(tail, owner) {
			const rows = turnRowsBefore(tail, owner);
			const user = rows.findIndex(function (row) { return row.getAttribute("data-chat-flow-kind") === "user"; });
			return user === -1 ? rows : rows.slice(0, user);
		}
		function hideUserForTurnTail(tail) {
			if (!tail) return;
			const user = turnRowsBefore(tail, tailTurnOf(tail)).find(function (row) { return row.getAttribute("data-chat-flow-kind") === "user"; });
			if (user) hideRow(user);
		}
		function applyHiddenRegenUserTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideUserForTurnTail(tail);
				}
			} catch (err) {}
		}
		function hideTurnTail(el) {
			if (!el) return;
			hideRow(el);
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(hideRow);
		}
		function showTurnTail(el) {
			if (!el) return;
			el.style.display = "";
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(function (row) { row.style.display = ""; });
		}
		function hideTurnTailWithUser(el) {
			if (!el) return;
			hideRow(el);
			// System prompts precede the user row. Hide through the turn boundary,
			// not just through its input; alpha also supplies explicit ownership.
			turnRowsBefore(el, el.getAttribute("data-chat-turn")).forEach(hideRow);
		}
		function tailTurnOf(el) {
			if (!el) return "";
			if (el.getAttribute("data-chat-turn")) return el.getAttribute("data-chat-turn");
			if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
			const inner = el.querySelector("[data-turn-tail]");
			return inner ? inner.getAttribute("data-turn-tail") : "";
		}
		function applyHiddenTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTail(tail);
				}
			} catch (err) {}
		}
		function applyRolledBackTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTailWithUser(tail);
				}
			} catch (err) {}
		}
		function applySuppressedDshTurns(turns, regeneratedDshTurns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const visibleRegenerations = new Set(Object.values(regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {}).map(String));
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				const turn = tailTurnOf(tail);
				if (!set.has(turn)) continue;
				if (visibleRegenerations.has(turn)) {
					showTurnTail(tail);
					hideUserForTurnTail(tail);
				} else hideTurnTailWithUser(tail);
			}
		}
		function applyRegeneratedDshTurns(regeneratedDshTurns) {
			const mappings = regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {};
			const hiddenStoryTurns = new Set(Object.keys(mappings).map(String));
			if (hiddenStoryTurns.size === 0) return;
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				if (hiddenStoryTurns.has(tailTurnOf(tail))) hideTurnTail(tail);
			}
		}
		// 单条删除只藏那一楼正文，尾行（复制/分支/用时/时间）是宿主另画的节点，会留在
		// 页面上。这里只藏尾行本身：玩家输入与同回合其它楼层都还在，不能顺手带走。
		// 页面上那条行的 turn 可能来自宿主 Chat（native），也可能来自存档（story）：
		// 服务端把两套编号都展开过，这里再顺手把 flow-key 里的数字也算一个候选。
		function tailTurnKeys(node) {
			const keys = [];
			const turn = tailTurnOf(node);
			if (turn !== "") keys.push(String(turn));
			const key = node.getAttribute ? node.getAttribute("data-chat-flow-key") : "";
			const matched = typeof key === "string" ? key.match(/(?:^|:)(\d+)$/) : null;
			if (matched && !keys.includes(matched[1])) keys.push(matched[1]);
			return keys;
		}
		// 已删除的正文行留下一个不可见标记（assistant-renderer 里写的）。尾行紧跟在它
		// 后面，按 DOM 邻接就能认出「这一回合的正文已经删了」——不依赖回合编号，
		// 页面编号与存档编号不同也照样成立。
		// 正文行的 flow kind 随宿主版本变：0.1.x 是 `assistant`，0.2.1 改成
		// `assistant-step`。这里按前缀认，别把新宿主当成「前面不是正文」。
		function isAssistantFlowKind(kind) {
			return typeof kind === "string" && (kind === "assistant" || kind === "assistant-step" || kind === "assistant-message");
		}
		function previousReplyRowIsDeleted(tail) {
			for (let sibling = tail.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
				const kind = sibling.getAttribute ? sibling.getAttribute("data-chat-flow-kind") : "";
				if (kind === "user" || kind === "turn-tail") return false;
				if (!isAssistantFlowKind(kind)) continue;
				return Boolean(sibling.querySelector && sibling.querySelector('[data-tavern-deleted-floor]'));
			}
			return false;
		}
		// 0.2.1 给 surface 编辑（删除标记、撤销删除）另开一个 turn，宿主于是为它画出
		// turn-process 和一行空 turn-tail：正文一条没有，页面上却多一排「已完成」。
		// 判据是「这一回合在页面上没有任何正文行」，不依赖回合编号。
		function applyEmptyTurnRows() {
			const scope = root();
			const steps = scope.querySelectorAll('[data-chat-flow-kind]');
			const turnsWithBody = new Set();
			for (let i = 0; i < steps.length; i++) {
				const node = steps[i];
				if (!isAssistantFlowKind(node.getAttribute && node.getAttribute("data-chat-flow-kind"))) continue;
				const turn = String(node.getAttribute("data-chat-turn") || "");
				if (turn !== "") turnsWithBody.add(turn);
			}
			const rows = scope.querySelectorAll('[data-chat-flow-kind="turn-tail"], [data-turn-tail]');
			for (let i = 0; i < rows.length; i++) {
				const node = rows[i];
				const turn = tailTurnOf(node);
				// 编号缺失、或者这一回合有正文：都不动。尾行只有回合结束后才画，所以
				// 「尾行已存在但没有正文」就足以说明这是编辑留下的空回合。
				if (turn === "" || turnsWithBody.has(turn)) continue;
				hideRow(node);
				// 同回合的过程行也一起收掉，否则只留下一条「已完成」。
				const sameTurn = scope.querySelectorAll('[data-chat-flow-kind]');
				for (let j = 0; j < sameTurn.length; j++) {
					const row = sameTurn[j];
					if (String(row.getAttribute && row.getAttribute("data-chat-turn") || "") !== turn) continue;
					if (row.getAttribute && row.getAttribute("data-chat-flow-kind") === "turn-tail") continue;
					if (isAssistantFlowKind(row.getAttribute && row.getAttribute("data-chat-flow-kind"))) continue;
					hideRow(row);
				}
			}
		}
		function applyDeletedReplyTurns(turns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			const rows = root().querySelectorAll('[data-chat-flow-kind="turn-tail"], [data-turn-tail]');
			for (let i = 0; i < rows.length; i++) {
				const node = rows[i];
				// 编号命中，或者紧邻的正文已经被删——任一条成立就藏。
				if (set.size && tailTurnKeys(node).some(key => set.has(key))) { hideRow(node); continue; }
				if (previousReplyRowIsDeleted(node)) hideRow(node);
			}
			applyEmptyTurnRows();
		}
		// 一次性的现场取证：把页面上真实的行属性发回服务端日志。残留问题只能靠这个
		// 定位——编号到底是 native 还是 story、尾行带的是哪一个属性，猜不出来。
		let tailDiagnosticAt = 0;
		function reportTailDiagnostics(sessionId, expected) {
			const now = Date.now();
			if (now - tailDiagnosticAt < 4000) return;
			tailDiagnosticAt = now;
			try {
				const rows = root().querySelectorAll('[data-chat-flow-kind="turn-tail"], [data-turn-tail]');
				const payload = {
					expected: Array.isArray(expected) ? expected : [],
					rows: Array.prototype.map.call(rows, function (node) {
						return {
							kind: node.getAttribute && node.getAttribute("data-chat-flow-kind"),
							turn: node.getAttribute && node.getAttribute("data-chat-turn"),
							tail: node.getAttribute && node.getAttribute("data-turn-tail"),
							key: node.getAttribute && node.getAttribute("data-chat-flow-key"),
							display: node.style ? node.style.display : "",
							hidden: node.hidden === true,
							tags: typeof node.innerHTML === "string" ? node.innerHTML.slice(0, 40) : ""
						};
					})
				};
				if (typeof rpc === "function") rpc("reportDeletedTailDiagnostics", { payload: payload }, sessionId).catch(function () {});
			} catch (error) { /* 诊断绝不打断渲染 */ }
		}
			function apply(sessionId, turns, regeneratedDshTurns, deletedReplyTurns) {
                // Reconcile both directions: an older observer may have hidden a
                // restored turn after the action's immediate DOM update.
                restoreHiddenRows();
				applySuppressedDshTurns(turns, regeneratedDshTurns);
				applyRegeneratedDshTurns(regeneratedDshTurns);
				applyDeletedReplyTurns(deletedReplyTurns);
				if (Array.isArray(deletedReplyTurns) && deletedReplyTurns.length) reportTailDiagnostics(sessionId, deletedReplyTurns);
                // Native rows can mount without their turn tail. Explicit ownership
                // must remain authoritative during streaming and partial hydration.
                const suppressed = new Set((Array.isArray(turns) ? turns : []).map(String));
                const mappings = regeneratedDshTurns || {};
                const replacements = new Set(Object.values(mappings).map(String));
                for (const row of root().querySelectorAll('[data-chat-turn]')) {
                    const turn = row.getAttribute("data-chat-turn");
                    const kind = row.getAttribute("data-chat-flow-kind");
                    if (!kind) continue;
                    if (suppressed.has(turn) && (!replacements.has(turn) || kind === "user")) hideRow(row);
                    if (Object.prototype.hasOwnProperty.call(mappings, turn) && kind !== "user") hideRow(row);
                }
				applyHiddenTurns(sessionId);
				applyRolledBackTurns(sessionId);
				applyHiddenRegenUserTurns(sessionId);
                for (const row of root().querySelectorAll('[data-chat-flow-kind="context"]')) {
                    const source = row.querySelector('[data-context-source]');
                    if (source && source.textContent.trim() === "dsh-tavern-surface-restore") hideRow(row);
                }
			}
			function regenerated(sessionId, view, tail) {
				const adopted = view && view.adopted;
				if (adopted && Number(adopted.hiddenTurn) > 0) forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, Number(adopted.hiddenTurn));
				if (adopted && Number(adopted.syntheticTurn) > 0) forgetHiddenTurn(HIDDEN_REGEN_USER_TURNS_KEY, sessionId, Number(adopted.syntheticTurn));
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.deletedReplyTurns);
			}
            function restored(sessionId, view) {
                const turn = Number(view && view.undoneRollback && view.undoneRollback.turn);
                const turns = [turn].concat(Object.values(view && view.regeneratedDshTurns || {})).map(String);
                for (const restoredTurn of turns) {
                    forgetHiddenTurn(ROLLED_BACK_TURNS_KEY, sessionId, restoredTurn);
                    forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, restoredTurn);
                }
                const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
                for (const tail of tails) {
                    if (!turns.includes(tailTurnOf(tail))) continue;
                    tail.style.display = "";
                    turnRowsBefore(tail, tail.getAttribute("data-chat-turn")).forEach(function (row) { row.style.display = ""; });
                }
                apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.deletedReplyTurns);
            }
			function rolledBack(sessionId, view) {
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.deletedReplyTurns);
			}
			return Object.freeze({ apply: apply, regenerated: regenerated, rolledBack: rolledBack, restored: restored });
		}
		function applyBodyRegenerationResult(options) {
			options.liveTavernView.setView(options.sessionId, options.view);
			options.historyProjection.regenerated(options.sessionId, options.view, options.tail);
		}

		function resolveConversationChatBinding(uiConversation, binding) {
			if (uiConversation && typeof uiConversation.binding === "function") {
				return uiConversation.binding(binding).target("chat");
			}
			if (!binding || !binding.session || typeof binding.session.subscribe !== "function" || typeof binding.session.getSnapshot !== "function") {
				throw new Error("当前 DSHA 无法提供酒馆状态所需的对话消息");
			}
			return {
				subscribe: function (listener) { return binding.session.subscribe(listener); },
				getSnapshot: function () {
					const snapshot = binding.session.getSnapshot();
					if (!snapshot || !snapshot.chat) throw new Error("当前 DSHA 的对话消息尚未就绪");
					return snapshot.chat;
				}
			};
		}
