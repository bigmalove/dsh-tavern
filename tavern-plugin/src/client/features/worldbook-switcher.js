// 世界书切换器：顶栏世界书按钮下方弹出的快速面板。
// 主面板（当前书的条目）、全部世界书、常用条目、条目详情、大窗编辑、设置与文件夹管理。
// 「完整」按钮交给右侧栏的世界书库（编辑触发词、绑定人物卡、导入导出都在那里）。
const WBSW_STORAGE_KEY = "dsh-tavern-worldbook-switcher";
const WBSW_UNFILED = "__unfiled__";
const WBSW_MIN_ROWS = 4;
const WBSW_MAX_ROWS = 40;
const WBSW_DESKTOP_ROWS = 12;
const WBSW_MOBILE_ROWS = 8;
const WBSW_DEFAULT_VISIBLE = Object.freeze({
	pin: true,
	deleteWorldbook: true,
	deleteEntry: true,
	viewDetail: true,
	bottomSearch: true
});
// 只有常驻与关键词两档：召回只看 constant，剩下的必然走关键词匹配
// （worldbook-activation.js）。vectorized 字段能存但没人读，不摆这个开关。
const WBSW_STRATEGIES = Object.freeze([
	{ value: "constant", label: "常驻（蓝）", color: "#3b82f6", glyph: "●" },
	{ value: "selective", label: "关键词触发（绿）", color: "#10b981", glyph: "◉" }
]);
const WBSW_USAGE_LIMIT = 400;

function wbConfigVisible(value) {
	const source = value && typeof value === "object" ? value : {};
	const next = {};
	for (const key of Object.keys(WBSW_DEFAULT_VISIBLE)) next[key] = source[key] !== false;
	return next;
}

function wbConfigRows(value, fallback) {
	const number = Number.parseInt(value, 10);
	if (!Number.isInteger(number)) return fallback;
	return Math.min(WBSW_MAX_ROWS, Math.max(WBSW_MIN_ROWS, number));
}

function normalizeWbSwitcherConfig(value) {
	const source = value && typeof value === "object" ? value : {};
	const usage = {};
	if (source.entryUsage && typeof source.entryUsage === "object") {
		for (const [key, item] of Object.entries(source.entryUsage)) {
			if (typeof key !== "string" || !key || !item || typeof item !== "object") continue;
			const count = Number(item.count);
			if (!Number.isFinite(count) || count <= 0) continue;
			usage[key] = {
				count: Math.floor(count),
				last: Math.max(0, Number(item.last) || 0),
				name: typeof item.name === "string" ? item.name : "",
				book: typeof item.book === "string" ? item.book : "",
				ref: typeof item.ref === "string" ? item.ref : ""
			};
		}
	}
	const folders = [];
	if (Array.isArray(source.folders)) {
		const seen = new Set();
		for (const folder of source.folders) {
			const id = folder && typeof folder.id === "string" ? folder.id.trim() : "";
			const name = folder && typeof folder.name === "string" ? folder.name.trim() : "";
			if (!id || !name || seen.has(id)) continue;
			seen.add(id);
			folders.push({ id: id, name: name });
		}
	}
	const assignments = {};
	if (source.folderAssignments && typeof source.folderAssignments === "object") {
		for (const [key, folderId] of Object.entries(source.folderAssignments)) {
			if (typeof key !== "string" || !key || typeof folderId !== "string" || !folderId) continue;
			assignments[key] = folderId;
		}
	}
	return {
		selectedKey: typeof source.selectedKey === "string" ? source.selectedKey : "",
		pinnedWorldbooks: Array.isArray(source.pinnedWorldbooks) ? source.pinnedWorldbooks.filter(item => typeof item === "string" && item) : [],
		pinnedEntries: Array.isArray(source.pinnedEntries) ? source.pinnedEntries.filter(item => typeof item === "string" && item) : [],
		entryUsage: usage,
		folders: folders,
		folderAssignments: assignments,
		collapsedFolders: Array.isArray(source.collapsedFolders) ? source.collapsedFolders.filter(item => typeof item === "string" && item) : [],
		panelState: {
			allWorldbooks: Boolean(source.panelState && source.panelState.allWorldbooks),
			frequentEntries: Boolean(source.panelState && source.panelState.frequentEntries)
		},
		toggleStyle: source.toggleStyle === "simple" ? "simple" : "default",
		visibleElements: wbConfigVisible(source.visibleElements),
		desktopVisibleRows: wbConfigRows(source.desktopVisibleRows, WBSW_DESKTOP_ROWS),
		mobileVisibleRows: wbConfigRows(source.mobileVisibleRows, WBSW_MOBILE_ROWS),
		mobileDualPane: source.mobileDualPane === true
	};
}

function readWbSwitcherConfig() {
	try {
		const saved = window.localStorage.getItem(WBSW_STORAGE_KEY);
		if (saved) return normalizeWbSwitcherConfig(JSON.parse(saved));
	} catch (_) {}
	return normalizeWbSwitcherConfig({});
}

function writeWbSwitcherConfig(config) {
	try { window.localStorage.setItem(WBSW_STORAGE_KEY, JSON.stringify(config)); } catch (_) {}
}

function wbSourceKey(source) {
	if (!source || typeof source !== "object") return "";
	return source.kind === "card" ? "card:" + String(source.cardPath || "") : "standalone:" + String(source.path || "");
}

function wbSourceOfKey(key) {
	const value = String(key || "");
	if (value.startsWith("card:")) return { kind: "card", cardPath: value.slice(5) };
	if (value.startsWith("standalone:")) return { kind: "standalone", path: value.slice(11) };
	return null;
}

function wbSourceOfRow(row) {
	return row && row.kind === "card" ? { kind: "card", cardPath: row.cardPath } : { kind: "standalone", path: row.path };
}

function wbEntryKey(bookKey, ref) {
	return String(bookKey || "") + "|" + String(ref || "");
}

function wbClamp(value, min, max) {
	const lower = Number(min) || 0;
	const upper = Number(max) || 0;
	return Math.max(lower, Math.min(upper, Number(value) || 0));
}

function wbPanelHeight(rows, mobile, viewportHeight) {
	const base = mobile ? 128 : 112;
	const min = mobile ? 320 : 360;
	const max = Math.max(min, (Number(viewportHeight) || 720) - (mobile ? 16 : 24));
	return Math.min(max, Math.max(min, base + rows * 34));
}

// 三栏并排时按可用宽度分配：默认宽度优先，放不下就等比收窄，最低保住可读宽度。
function wbColumnWidths(options) {
	const wanted = [
		{ key: "main", width: 300, min: 264 },
		{ key: "all", width: 250, min: 214, active: Boolean(options.all) },
		{ key: "frequent", width: 280, min: 236, active: Boolean(options.frequent) },
		{ key: "side", width: 340, min: 300, active: Boolean(options.pane) }
	].filter(column => column.active !== false);
	const gap = 8 * Math.max(0, wanted.length - 1);
	const available = Math.max(0, Number(options.available) || 0);
	const widths = {};
	for (const column of wanted) widths[column.key] = column.width;
	let overflow = wanted.reduce((total, column) => total + column.width, 0) + gap - available;
	if (overflow > 0) {
		const shrinkable = wanted.filter(column => column.width > column.min);
		const room = shrinkable.reduce((total, column) => total + (column.width - column.min), 0);
		const ratio = room > 0 ? Math.min(1, overflow / room) : 0;
		for (const column of shrinkable) widths[column.key] = Math.round(column.width - (column.width - column.min) * ratio);
	}
	return { widths: widths, total: wanted.reduce((total, column) => total + widths[column.key], 0) + gap };
}

function wbRowLabel(entry) {
	return String(entry && (entry.title || entry.comment) || "").trim() || "未命名条目";
}

function wbSortRows(rows, pinned) {
	const set = new Set(pinned || []);
	return (rows || []).slice().sort(function (left, right) {
		const leftPinned = set.has(wbSourceKey(wbSourceOfRow(left)));
		const rightPinned = set.has(wbSourceKey(wbSourceOfRow(right)));
		if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
		return String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN");
	});
}

function wbGroupRows(rows, config) {
	const folders = config.folders || [];
	const assignments = config.folderAssignments || {};
	const groups = folders.map(function (folder) {
		return {
			id: folder.id,
			name: folder.name,
			rows: wbSortRows(rows.filter(function (row) { return assignments[wbSourceKey(wbSourceOfRow(row))] === folder.id; }), config.pinnedWorldbooks)
		};
	});
	const known = new Set(folders.map(folder => folder.id));
	const unfiled = rows.filter(function (row) {
		const folderId = assignments[wbSourceKey(wbSourceOfRow(row))];
		return !folderId || !known.has(folderId);
	});
	groups.push({ id: WBSW_UNFILED, name: "未归类", rows: wbSortRows(unfiled, config.pinnedWorldbooks) });
	return groups;
}

function wbStrategyOf(entry) {
	if (entry && entry.constant === true) return "constant";
	return "selective";
}

// 切换时顺手把历史遗留的 vectorized 写回 false：这个字段不参与召回，
// 留着 true 只会让人以为它在起作用。
function wbStrategyPatch(strategy) {
	if (strategy === "constant") return { constant: true, selective: false, vectorized: false };
	return { constant: false, selective: true, vectorized: false };
}

function createWorldBookSwitcherFeatureModule() {
	let switcherState = { open: false, anchor: null, rect: null, sessionId: "" };
	const switcherListeners = new Set();

	function publishSwitcher(next) {
		switcherState = Object.assign({}, switcherState, next);
		for (const listener of Array.from(switcherListeners)) {
			try { listener(); } catch (_) {}
		}
	}

	function subscribeSwitcher(listener) {
		switcherListeners.add(listener);
		return function () { switcherListeners.delete(listener); };
	}

	function snapshotSwitcher() {
		return switcherState;
	}

	function openWorldBookSwitcher(anchor, sessionId) {
		const element = anchor && anchor.nodeType === 1 ? anchor : null;
		if (switcherState.open && switcherState.anchor === element) {
			publishSwitcher({ open: false, anchor: null, rect: null });
			return false;
		}
		let rect = null;
		if (element) {
			const box = element.getBoundingClientRect();
			rect = { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
		}
		publishSwitcher({ open: true, anchor: element, rect: rect, sessionId: String(sessionId || "") });
		return true;
	}

	function closeWorldBookSwitcher() {
		if (!switcherState.open) return;
		publishSwitcher({ open: false, anchor: null, rect: null });
	}

	async function loadWbCatalog(sessionId) {
		const result = await rpcWithTimeout("listWorldBooks", {}, sessionId);
		const standalone = (result && Array.isArray(result.standalone) ? result.standalone : []).map(function (row) {
			return Object.assign({}, row, { key: "standalone:" + row.path, source: { kind: "standalone", path: row.path }, embedded: false });
		});
		const embedded = (result && Array.isArray(result.embedded) ? result.embedded : []).map(function (row) {
			return Object.assign({}, row, { key: "card:" + row.cardPath, source: { kind: "card", cardPath: row.cardPath }, embedded: true });
		});
		return {
			standalone: standalone,
			embedded: embedded,
			all: standalone.concat(embedded),
			diagnostics: result && Array.isArray(result.diagnostics) ? result.diagnostics : []
		};
	}

	async function loadWbBook(sessionId, source) {
		return await rpcWithTimeout("getWorldBook", { source: source }, sessionId);
	}

	async function patchWbEntry(sessionId, source, ref, patch) {
		return await rpc("updateWorldBook", { source: source, update: { operations: [{ op: "update", ref: ref, patch: patch }] } }, sessionId);
	}

	async function deleteWbEntry(sessionId, source, ref) {
		return await rpc("updateWorldBook", { source: source, update: { operations: [{ op: "delete", ref: ref }] } }, sessionId);
	}

	const WBSW_ICON_PATHS = Object.freeze({
		book: "M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0",
		books: "M3 5c0-2 6-2 6 0s-6 2-6 0v14c0 2 6 2 6 0V5M10 5c0-2 8-2 8 0s-8 2-8 0v14c0 2 8 2 8 0V5M21 5v14",
		star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z",
		pin: "M9 3h6l-1 5 3.5 3.5H6.5L10 8zM12 11.5V21",
		gear: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z",
		folder: "M3 7V5h6l2 2h10v12H3z",
		expand: "M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5",
		close: "M6 6l12 12M18 6L6 18",
		trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
		back: "M15 5l-7 7 7 7",
		dot: "M5 12h.01M12 12h.01M19 12h.01",
		check: "M4 12l5 5L20 6",
		pencil: "M4 20h4l10-10-4-4L4 16zM14 6l4 4",
		plus: "M12 5v14M5 12h14"
	});

	function WbIcon(props) {
		const h = React.createElement;
		const path = WBSW_ICON_PATHS[props.name] || WBSW_ICON_PATHS.dot;
		const size = Number(props.size) || 13;
		return h("svg", {
			width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
			strokeWidth: props.thick ? 2.4 : 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
		}, h("path", { d: path }));
	}

	function WbIconButton(props) {
		const h = React.createElement;
		return h("button", {
			type: "button",
			className: "dsh-tavern-wbsw-icon" + (props.className ? " " + props.className : ""),
			title: props.title || "", "aria-label": props.title || "", "aria-pressed": props.pressed,
			disabled: Boolean(props.disabled),
			onClick: props.onClick
		}, h(WbIcon, { name: props.name, size: props.size, thick: props.thick }));
	}

	function WbSwitch(props) {
		const h = React.createElement;
		const style = props.style === "simple" ? " simple" : "";
		return h("label", { className: "dsh-tavern-wbsw-switch" + style, title: props.title || "", onClick: function (event) { event.stopPropagation(); } },
			h("input", { type: "checkbox", checked: Boolean(props.checked), disabled: Boolean(props.disabled), onChange: function (event) { if (props.onChange) props.onChange(event.target.checked); } }),
			h("span", { className: "dsh-tavern-wbsw-track", "aria-hidden": "true" }, h("span", { className: "dsh-tavern-wbsw-knob" })));
	}

	// 两段式删除：先变成「确认 / 取消」，再点确认才真正删除。
	function WbDeleteAction(props) {
		const h = React.createElement;
		const [armed, setArmed] = React.useState(false);
		React.useEffect(function () {
			if (!armed) return undefined;
			const timer = window.setTimeout(function () { setArmed(false); }, 5000);
			return function () { window.clearTimeout(timer); };
		}, [armed]);
		if (armed) {
			return h("span", { className: "dsh-tavern-wbsw-confirm", onClick: function (event) { event.stopPropagation(); } },
				h("button", { type: "button", className: "dsh-tavern-wbsw-confirm-yes", onClick: function (event) { event.stopPropagation(); setArmed(false); if (props.onConfirm) props.onConfirm(); } }, "确认"),
				h("button", { type: "button", className: "dsh-tavern-wbsw-confirm-no", onClick: function (event) { event.stopPropagation(); setArmed(false); } }, "取消"));
		}
		return h(WbIconButton, {
			className: "dsh-tavern-wbsw-danger" + (props.compact ? " compact" : ""),
			name: "trash", size: props.compact ? 10 : 12,
			title: props.title || "删除",
			onClick: function (event) { event.stopPropagation(); setArmed(true); }
		});
	}

	function WbEntryRow(props) {
		const h = React.createElement;
		const entry = props.entry;
		const visible = props.visible || WBSW_DEFAULT_VISIBLE;
		const disabled = entry.enabled === false;
		return h("div", {
			className: "dsh-tavern-wbsw-row" + (disabled ? " is-disabled" : "") + (props.active ? " is-active" : ""),
			onClick: function () { if (props.onOpen) props.onOpen(); }
		},
			h(WbSwitch, { checked: !disabled, style: props.toggleStyle, title: disabled ? "启用条目" : "停用条目", onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-tavern-wbsw-row-name", title: wbRowLabel(entry) }, wbRowLabel(entry)),
			h("span", { className: "dsh-tavern-wbsw-row-actions" },
				visible.viewDetail ? h(WbIconButton, {
					name: "dot", title: "查看详情",
					onClick: function (event) { event.stopPropagation(); if (props.onOpen) props.onOpen(); }
				}) : null,
				visible.deleteEntry ? h(WbDeleteAction, { title: "删除条目", compact: true, onConfirm: props.onDelete }) : null));
	}

	function WbFrequentRow(props) {
		const h = React.createElement;
		const entry = props.entry;
		const visible = props.visible || WBSW_DEFAULT_VISIBLE;
		return h("div", {
			className: "dsh-tavern-wbsw-row dsh-tavern-wbsw-frequent-row" + (entry.enabled ? "" : " is-disabled"),
			onClick: function () { if (props.onOpen) props.onOpen(); }
		},
			h(WbSwitch, { checked: entry.enabled !== false, style: props.toggleStyle, onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-tavern-wbsw-row-text" },
				h("span", { className: "dsh-tavern-wbsw-row-name", title: entry.name },
					visible.pin && entry.pinned ? h("span", { className: "dsh-tavern-wbsw-pin-mark", "aria-hidden": "true" }, h(WbIcon, { name: "pin", size: 10 })) : null,
					entry.name),
				h("span", { className: "dsh-tavern-wbsw-row-sub", title: entry.bookName }, entry.bookName)),
			h("span", { className: "dsh-tavern-wbsw-row-actions" },
				visible.pin ? h(WbIconButton, {
					className: entry.pinned ? "is-pinned" : "", name: "pin", size: 12,
					title: entry.pinned ? "取消置顶" : "置顶",
					onClick: function (event) { event.stopPropagation(); if (props.onPin) props.onPin(); }
				}) : null,
				visible.viewDetail ? h(WbIconButton, {
					name: "dot", title: "查看详情",
					onClick: function (event) { event.stopPropagation(); if (props.onOpen) props.onOpen(); }
				}) : null,
				visible.deleteEntry ? h(WbDeleteAction, { title: "删除条目", compact: true, onConfirm: props.onDelete }) : null));
	}

	function WbWorldbookRow(props) {
		const h = React.createElement;
		const row = props.row;
		const visible = props.visible || WBSW_DEFAULT_VISIBLE;
		const pinned = (props.pinned || []).includes(row.key);
		return h("div", {
			className: "dsh-tavern-wbsw-row dsh-tavern-wbsw-book-row" + (props.active ? " is-active" : "") + (row.embedded ? " is-embedded" : "") + (!row.embedded && row.globalEnabled !== true ? " is-off" : ""),
			onClick: function () { if (props.onSelect) props.onSelect(); }
		},
			row.embedded ? h("span", { className: "dsh-tavern-wbsw-tag", title: "人物卡内置世界书" }, "卡") :
				h(WbSwitch, { checked: row.globalEnabled === true, style: props.toggleStyle, title: row.globalEnabled ? "停用全局生效" : "全局生效", onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-tavern-wbsw-row-text" },
				h("span", { className: "dsh-tavern-wbsw-row-name", title: row.name },
					visible.pin && pinned ? h("span", { className: "dsh-tavern-wbsw-pin-mark", "aria-hidden": "true" }, h(WbIcon, { name: "pin", size: 10 })) : null,
					row.name),
				h("span", { className: "dsh-tavern-wbsw-row-sub" }, (row.entryCount || 0) + " 条 · " + (row.enabledCount || 0) + " 启用" + (row.embedded && row.cardName ? " · " + row.cardName : ""))),
			h("span", { className: "dsh-tavern-wbsw-row-actions" },
				visible.pin ? h(WbIconButton, {
					className: pinned ? "is-pinned" : "", name: "pin", size: 12,
					title: pinned ? "取消置顶" : "置顶",
					onClick: function (event) { event.stopPropagation(); if (props.onPin) props.onPin(); }
				}) : null,
				visible.deleteWorldbook ? h(WbDeleteAction, { title: "删除世界书", compact: true, onConfirm: props.onDelete }) : null));
	}

	function WbSearchFooter(props) {
		const h = React.createElement;
		const visible = props.visible || WBSW_DEFAULT_VISIBLE;
		if (!visible.bottomSearch && !props.settings) return null;
		return h("div", { className: "dsh-tavern-wbsw-footer" },
			visible.bottomSearch ? h("input", {
				type: "search", className: "dsh-tavern-wbsw-search", value: props.value,
				placeholder: props.placeholder || "搜索…", "aria-label": props.placeholder || "搜索",
				onChange: function (event) { if (props.onChange) props.onChange(event.target.value); }
			}) : h("span", { className: "dsh-tavern-wbsw-footer-gap" }),
			props.settings ? h(WbIconButton, { name: "gear", size: 13, title: "设置", onClick: props.settings }) : null);
	}

	function WbAllPane(props) {
		const h = React.createElement;
		const [query, setQuery] = React.useState("");
		const [collapsed, setCollapsed] = React.useState(function () { return (props.config.collapsedFolders || []).slice(); });
		const needle = query.trim().toLocaleLowerCase();
		function rowsOf(rows) {
			if (!needle) return rows;
			return rows.filter(function (row) {
				return [row.name, row.cardName].some(function (value) { return String(value || "").toLocaleLowerCase().includes(needle); });
			});
		}
		const groups = wbGroupRows(wbSortRows(props.catalog ? props.catalog.all : [], props.config.pinnedWorldbooks), props.config).map(function (group) {
			return { id: group.id, name: group.name, rows: rowsOf(group.rows) };
		}).filter(function (group) { return group.rows.length > 0 || !needle; });
		function toggleFolder(id) {
			const next = collapsed.includes(id) ? collapsed.filter(item => item !== id) : collapsed.concat([id]);
			setCollapsed(next);
			if (props.onCollapsed) props.onCollapsed(next);
		}
		const total = props.catalog ? (props.catalog.all || []).length : 0;
		const plain = (props.config.folders || []).length === 0;
		return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-all" },
			props.hideHead ? null : h("div", { className: "dsh-tavern-wbsw-head" },
				h("span", { className: "dsh-tavern-wbsw-title" }, h(WbIcon, { name: "books", size: 12 }), " 全部世界书"),
				h(WbIconButton, { name: "close", title: "关闭", onClick: props.onClose })),
			h("div", { className: "dsh-tavern-wbsw-list" },
				total === 0 ? h("div", { className: "dsh-tavern-wbsw-empty" }, "暂无世界书") : null,
				groups.map(function (group) {
					const isCollapsed = collapsed.includes(group.id);
					const rows = group.rows.map(function (row) {
						return h(WbWorldbookRow, {
							key: row.key, row: row, visible: props.visible, toggleStyle: props.config.toggleStyle,
							active: row.key === props.currentKey, pinned: props.config.pinnedWorldbooks,
							onSelect: function () { if (props.onSelect) props.onSelect(row); },
							onToggle: function (next) { if (props.onToggle) props.onToggle(row, next); },
							onPin: function () { if (props.onPin) props.onPin(row); },
							onDelete: function () { if (props.onDelete) props.onDelete(row); }
						});
					});
					if (plain && group.id === WBSW_UNFILED) return rows;
					return h("section", { key: group.id, className: "dsh-tavern-wbsw-group" },
						h("button", { type: "button", className: "dsh-tavern-wbsw-group-head", onClick: function () { toggleFolder(group.id); } },
							h("span", null, (isCollapsed ? "▸ " : "▾ ") + group.name),
							h("span", { className: "dsh-tavern-wbsw-count" }, String(group.rows.length))),
						isCollapsed ? null : rows);
				})),
			h(WbSearchFooter, { visible: props.visible, value: query, onChange: setQuery, placeholder: "搜索世界书…" }));
	}

	function WbFrequentPane(props) {
		const h = React.createElement;
		const [query, setQuery] = React.useState("");
		const needle = query.trim().toLocaleLowerCase();
		const rows = (props.entries || []).filter(function (entry) {
			if (!needle) return true;
			return [entry.name, entry.bookName].some(function (value) { return String(value || "").toLocaleLowerCase().includes(needle); });
		});
		return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-frequent" },
			props.hideHead ? null : h("div", { className: "dsh-tavern-wbsw-head" },
				h("span", { className: "dsh-tavern-wbsw-title" }, h(WbIcon, { name: "star", size: 12 }), " 常用条目"),
				h(WbIconButton, { name: "close", title: "关闭", onClick: props.onClose })),
			h("div", { className: "dsh-tavern-wbsw-list" },
				props.loading ? h("div", { className: "dsh-tavern-wbsw-empty" }, "正在读取…") : null,
				!props.loading && rows.length === 0 ? h("div", { className: "dsh-tavern-wbsw-empty" }, "暂无使用记录，开关条目后会在这里显示") : null,
				rows.map(function (entry) {
					return h(WbFrequentRow, {
						key: entry.id, entry: entry, visible: props.visible, toggleStyle: props.config.toggleStyle,
						onToggle: function (next) { if (props.onToggle) props.onToggle(entry, next); },
						onOpen: function () { if (props.onOpen) props.onOpen(entry); },
						onPin: function () { if (props.onPin) props.onPin(entry); },
						onDelete: function () { if (props.onDelete) props.onDelete(entry); }
					});
				})),
			h(WbSearchFooter, { visible: props.visible, value: query, onChange: setQuery, placeholder: "搜索常用条目…" }));
	}

	function WbDetailPane(props) {
		const h = React.createElement;
		const entry = props.entry;
		const visible = props.visible || WBSW_DEFAULT_VISIBLE;
		const [strategy, setStrategy] = React.useState(wbStrategyOf(entry));
		const [order, setOrder] = React.useState(String(entry.order ?? 100));
		const [scanDepth, setScanDepth] = React.useState(entry.scanDepth === null || entry.scanDepth === undefined ? "" : String(entry.scanDepth));
		const [logic, setLogic] = React.useState(Number(entry.selectiveLogic) || 0);
		const [feedback, setFeedback] = React.useState("");
		const [busy, setBusy] = React.useState(false);
		React.useEffect(function () {
			setStrategy(wbStrategyOf(props.entry));
			setOrder(String(props.entry.order ?? 100));
			setScanDepth(props.entry.scanDepth === null || props.entry.scanDepth === undefined ? "" : String(props.entry.scanDepth));
			setLogic(Number(props.entry.selectiveLogic) || 0);
			setFeedback("");
		}, [props.bookKey, props.entry.ref, props.entry.order, props.entry.scanDepth, props.entry.selectiveLogic, props.entry.constant]);
		async function persist(patch, message) {
			if (busy) return;
			setBusy(true); setFeedback("");
			try {
				await props.onPatch(patch);
				setFeedback(message || "已保存");
			} catch (error) {
				setFeedback(String(error && error.message || error));
			} finally { setBusy(false); }
		}
		function chooseStrategy(next) {
			if (next === strategy) return;
			setStrategy(next);
			void persist(wbStrategyPatch(next), "已切换触发策略");
		}
		function commitOrder() {
			const next = Number.parseInt(order, 10);
			if (!Number.isInteger(next)) { setOrder(String(entry.order ?? 100)); return; }
			if (next === Number(entry.order ?? 100)) return;
			void persist({ order: next }, "排序已改为 " + next);
		}
		function commitScanDepth() {
			const raw = String(scanDepth).trim();
			if (raw === "") {
				if (entry.scanDepth === null || entry.scanDepth === undefined) return;
				void persist({ scanDepth: null }, "已跟随世界书默认扫描深度");
				return;
			}
			const next = Number.parseInt(raw, 10);
			if (!Number.isInteger(next) || next < 0 || next > 1000) { setScanDepth(entry.scanDepth === null || entry.scanDepth === undefined ? "" : String(entry.scanDepth)); return; }
			if (next === Number(entry.scanDepth)) return;
			void persist({ scanDepth: next }, "改为扫描最近 " + next + " 条消息");
		}
		const keywordMode = strategy === "selective";
		return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-detail" },
			h("div", { className: "dsh-tavern-wbsw-head" },
				h("span", { className: "dsh-tavern-wbsw-title", title: wbRowLabel(entry) }, wbRowLabel(entry)),
				h("span", { className: "dsh-tavern-wbsw-head-actions" },
					h(WbIconButton, { name: "expand", size: 13, title: "大窗口编辑", onClick: function () { props.onExpand(); } }),
					visible.deleteEntry ? h(WbDeleteAction, { title: "删除条目", onConfirm: props.onDelete }) : null,
					h(WbIconButton, { name: props.backLabel ? "back" : "close", title: props.backLabel || "关闭详情", onClick: props.onClose }))),
			h("div", { className: "dsh-tavern-wbsw-detail-body" },
				h("div", { className: "dsh-tavern-wbsw-detail-book" }, props.bookName + " · " + (entry.enabled ? "已启用" : "已停用")),
				h("textarea", { className: "dsh-tavern-wbsw-content", readOnly: true, spellCheck: false, value: entry.content || "", "aria-label": "条目正文" }),
				h("div", { className: "dsh-tavern-wbsw-strategy" }, WBSW_STRATEGIES.map(function (option) {
					return h("button", {
						key: option.value, type: "button",
						className: "dsh-tavern-wbsw-strategy-btn" + (strategy === option.value ? " is-active" : ""),
						style: { "--wbsw-color": option.color },
						title: option.label, "aria-label": option.label, "aria-pressed": strategy === option.value,
						disabled: busy,
						onClick: function () { chooseStrategy(option.value); }
					}, option.glyph);
				})),
				h("div", { className: "dsh-tavern-wbsw-fields" },
					h("label", { className: "dsh-tavern-wbsw-field dsh-tavern-wbsw-field-narrow" }, h("span", null, "排序"),
						h("input", {
							type: "number", step: 1, inputMode: "numeric", value: order, disabled: busy,
							title: "越大越优先入选；预算用完就停在这一条之后",
							onChange: function (event) { setOrder(event.target.value); },
							onBlur: commitOrder,
							onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }
						})),
					h("label", { className: "dsh-tavern-wbsw-field dsh-tavern-wbsw-field-narrow" + (busy ? " is-idle" : "") }, h("span", null, "扫描消息"),
						h("input", {
							type: "number", min: 0, max: 1000, step: 1, inputMode: "numeric", value: scanDepth, disabled: busy,
							placeholder: "跟随 " + (props.scanDepthFallback ?? 2),
							title: "关键词只在最近 N 条消息里找；留空跟随世界书默认值",
							onChange: function (event) { setScanDepth(event.target.value); },
							onBlur: commitScanDepth,
							onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }
						})),
					h("label", { className: "dsh-tavern-wbsw-field" + (keywordMode ? "" : " is-idle") }, h("span", null, "二级条件"),
						h("select", {
							value: logic, disabled: busy || !keywordMode,
							title: keywordMode ? "主触发词命中后再看二级触发词" : "仅关键词触发时生效",
							onChange: function (event) {
								const next = Number(event.target.value) || 0;
								setLogic(next);
								// 二级条件只在 selective 为真时参与匹配；老条目可能带着 selective:false，
								// 只写 selectiveLogic 会变成一个改完不生效的开关。
								void persist({ selective: true, selectiveLogic: next }, "已更新二级条件");
							}
						}, ["至少一个命中", "不全部命中", "全部不命中", "全部命中"].map(function (label, value) {
							return h("option", { key: value, value: value }, label);
						})))),
				h("p", { className: "dsh-tavern-wbsw-hint" }, "常驻不看触发词、不占预算；关键词条目按排序从大到小入选，共用世界书 Token 预算，注入后 10 回合内不再自动召回。"),
				h("div", { className: "dsh-tavern-wbsw-feedback", role: "status" }, feedback)));
	}

	function WbNumberField(props) {
		const h = React.createElement;
		const [draft, setDraft] = React.useState(String(props.value));
		React.useEffect(function () { setDraft(String(props.value)); }, [props.value]);
		return h("input", {
			type: "number", min: props.min, max: props.max, step: 1, inputMode: "numeric", value: draft,
			onChange: function (event) { setDraft(event.target.value); },
			onBlur: function () {
				const next = Number.parseInt(draft, 10);
				if (!Number.isInteger(next)) { setDraft(String(props.value)); return; }
				const clamped = Math.min(props.max, Math.max(props.min, next));
				setDraft(String(clamped));
				if (clamped !== props.value) props.onCommit(clamped);
			}
		});
	}

	function WbSettingsPane(props) {
		const h = React.createElement;
		const config = props.config;
		function patch(patchValue) { if (props.onChange) props.onChange(patchValue); }
		return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-settings" },
			h("div", { className: "dsh-tavern-wbsw-head" },
				h("span", { className: "dsh-tavern-wbsw-title" }, h(WbIcon, { name: "gear", size: 12 }), " 设置"),
				h(WbIconButton, { name: props.backLabel ? "back" : "close", title: props.backLabel || "关闭设置", onClick: props.onClose })),
			h("div", { className: "dsh-tavern-wbsw-settings-body" },
				h("label", { className: "dsh-tavern-wbsw-field" }, h("span", null, "开关样式"),
					h("select", { value: config.toggleStyle, onChange: function (event) { patch({ toggleStyle: event.target.value === "simple" ? "simple" : "default" }); } },
						h("option", { value: "default" }, "默认"),
						h("option", { value: "simple" }, "简洁圆点"))),
				h("div", { className: "dsh-tavern-wbsw-section-title" }, "显示元素"),
				h("div", { className: "dsh-tavern-wbsw-toggles" },
					[["pin", "置顶"], ["deleteWorldbook", "删除世界书"], ["deleteEntry", "删除条目"], ["viewDetail", "查看详情"], ["bottomSearch", "底部搜索栏"]].map(function ([key, label]) {
						return h("label", { key: key, className: "dsh-tavern-wbsw-toggle-row" },
							h("span", null, label),
							h(WbSwitch, {
								checked: config.visibleElements[key] !== false, style: "simple", title: label,
								onChange: function (next) {
									const visibleElements = Object.assign({}, config.visibleElements);
									visibleElements[key] = next;
									patch({ visibleElements: visibleElements });
								}
							}));
					})),
				h("div", { className: "dsh-tavern-wbsw-rows" },
					h("label", { className: "dsh-tavern-wbsw-field" }, h("span", null, "桌面可视行数"),
						h(WbNumberField, { value: config.desktopVisibleRows, min: WBSW_MIN_ROWS, max: WBSW_MAX_ROWS, onCommit: function (next) { patch({ desktopVisibleRows: next }); } })),
					h("label", { className: "dsh-tavern-wbsw-field" }, h("span", null, "手机可视行数"),
						h(WbNumberField, { value: config.mobileVisibleRows, min: WBSW_MIN_ROWS, max: WBSW_MAX_ROWS, onCommit: function (next) { patch({ mobileVisibleRows: next }); } }))),
				h("label", { className: "dsh-tavern-wbsw-toggle-row" },
					h("span", null, "手机双窗口模式"),
					h(WbSwitch, { checked: config.mobileDualPane, style: "simple", title: "手机双窗口模式", onChange: function (next) { patch({ mobileDualPane: next }); } })),
				h("button", { type: "button", className: "dsh-tavern-wbsw-wide-btn", onClick: props.onFolders }, h(WbIcon, { name: "folder", size: 12 }), " 世界书文件夹"),
				h("p", { className: "dsh-tavern-wbsw-hint" }, "「完整」按钮打开右侧栏世界书库：编辑触发词、绑定人物卡、导入导出。")));
	}

	function WbFoldersPane(props) {
		const h = React.createElement;
		const config = props.config;
		const [name, setName] = React.useState("");
		const [renaming, setRenaming] = React.useState({});
		function addFolder() {
			const value = name.trim();
			if (!value) return;
			props.onChange({ folders: config.folders.concat([{ id: "folder:" + Date.now().toString(36), name: value }]) });
			setName("");
		}
		function removeFolder(folderId) {
			const assignments = {};
			for (const [key, value] of Object.entries(config.folderAssignments || {})) if (value !== folderId) assignments[key] = value;
			props.onChange({ folders: config.folders.filter(function (folder) { return folder.id !== folderId; }), folderAssignments: assignments });
		}
		function renameFolder(folderId) {
			const value = String(renaming[folderId] || "").trim();
			if (!value) return;
			props.onChange({ folders: config.folders.map(function (folder) { return folder.id === folderId ? { id: folder.id, name: value } : folder; }) });
			setRenaming(function (current) { const next = Object.assign({}, current); delete next[folderId]; return next; });
		}
		return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-folders" },
			h("div", { className: "dsh-tavern-wbsw-head" },
				h("span", { className: "dsh-tavern-wbsw-title" }, h(WbIcon, { name: "folder", size: 12 }), " 文件夹"),
				h(WbIconButton, { name: "back", title: "返回设置", onClick: props.onBack })),
			h("div", { className: "dsh-tavern-wbsw-settings-body" },
				h("div", { className: "dsh-tavern-wbsw-inline" },
					h("input", { className: "dsh-tavern-wbsw-search", type: "text", value: name, placeholder: "新建文件夹名称", onChange: function (event) { setName(event.target.value); }, onKeyDown: function (event) { if (event.key === "Enter") addFolder(); } }),
					h("button", { type: "button", className: "dsh-tavern-wbsw-wide-btn is-compact", onClick: addFolder }, "新建")),
				h("div", { className: "dsh-tavern-wbsw-folder-list" },
					config.folders.length === 0 ? h("div", { className: "dsh-tavern-wbsw-empty" }, "暂无文件夹，先创建一个。") : null,
					config.folders.map(function (folder) {
						const editing = Object.prototype.hasOwnProperty.call(renaming, folder.id);
						return h("div", { key: folder.id, className: "dsh-tavern-wbsw-inline" },
							editing ? h("input", { className: "dsh-tavern-wbsw-search", type: "text", autoFocus: true, value: renaming[folder.id], onChange: function (event) { setRenaming(Object.assign({}, renaming, { [folder.id]: event.target.value })); } })
								: h("span", { className: "dsh-tavern-wbsw-folder-name" }, folder.name),
							editing ? h(WbIconButton, { name: "check", title: "保存名称", onClick: function () { renameFolder(folder.id); } })
								: h(WbIconButton, { name: "pencil", title: "重命名", onClick: function () { setRenaming(Object.assign({}, renaming, { [folder.id]: folder.name })); } }),
							h(WbDeleteAction, { title: "删除文件夹", compact: true, onConfirm: function () { removeFolder(folder.id); } }));
					})),
				h("div", { className: "dsh-tavern-wbsw-section-title" }, "归类"),
				h("p", { className: "dsh-tavern-wbsw-hint" }, "每本世界书只属于一个文件夹；删除文件夹后其中的世界书回到未归类。"),
				h("div", { className: "dsh-tavern-wbsw-assign-list" },
					(props.catalog ? props.catalog.all : []).map(function (row) {
						const folderId = config.folderAssignments[row.key] || WBSW_UNFILED;
						return h("label", { key: row.key, className: "dsh-tavern-wbsw-assign" },
							h("span", { title: row.name }, row.name),
							h("select", {
								value: folderId,
								onChange: function (event) {
									const assignments = Object.assign({}, config.folderAssignments);
									if (event.target.value === WBSW_UNFILED) delete assignments[row.key];
									else assignments[row.key] = event.target.value;
									props.onChange({ folderAssignments: assignments });
								}
							},
								h("option", { value: WBSW_UNFILED }, "未归类"),
								config.folders.map(function (folder) { return h("option", { key: folder.id, value: folder.id }, folder.name); })));
					}))));
	}

	function WbFullscreenEditor(props) {
		const h = React.createElement;
		const entry = props.entry;
		const [value, setValue] = React.useState(entry.content || "");
		const [dirty, setDirty] = React.useState(false);
		const [busy, setBusy] = React.useState(false);
		const [confirmClose, setConfirmClose] = React.useState(false);
		const [feedback, setFeedback] = React.useState("");
		const [tagDialog, setTagDialog] = React.useState(null);
		// 查找替换条：打开时停靠在工具栏下方，替换结果写回正文（保存仍由 Ctrl+S / 保存按钮负责）。
		const [finder, setFinder] = React.useState({ open: false, find: "", replace: "", caseSensitive: false, message: "" });
		const areaRef = React.useRef(null);
		const findInputRef = React.useRef(null);
		const savedRef = React.useRef(entry.content || "");
		function update(next) {
			setValue(next);
			setDirty(next !== savedRef.current);
		}
		async function save() {
			if (!dirty || busy) return;
			setBusy(true); setFeedback("");
			try {
				await props.onSave({ content: value });
				savedRef.current = value;
				setDirty(false);
				setFeedback("已保存");
			} catch (error) {
				setFeedback(String(error && error.message || error));
			} finally { setBusy(false); }
		}
		function requestClose() {
			if (dirty) setConfirmClose(true);
			else props.onClose();
		}
		React.useEffect(function () {
			function onKey(event) {
				const key = String(event.key).toLowerCase();
				if ((event.ctrlKey || event.metaKey) && key === "s") {
					event.preventDefault();
					void save();
				} else if ((event.ctrlKey || event.metaKey) && key === "f") {
					event.preventDefault();
					openFinder();
				} else if (event.key === "Escape") {
					event.preventDefault();
					if (tagDialog) setTagDialog(null);
					else if (finder.open) setFinder(function (current) { return Object.assign({}, current, { open: false, message: "" }); });
					else requestClose();
				}
			}
			document.addEventListener("keydown", onKey, true);
			return function () { document.removeEventListener("keydown", onKey, true); };
		}, [value, dirty, busy, tagDialog, finder]);
		function selection() {
			const area = areaRef.current;
			if (!area) return { start: 0, end: 0, text: "" };
			return { start: area.selectionStart || 0, end: area.selectionEnd || 0, text: value.slice(area.selectionStart || 0, area.selectionEnd || 0) };
		}
		function replaceRange(start, end, replacement, selectionStart, selectionEnd) {
			update(value.slice(0, start) + replacement + value.slice(end));
			window.requestAnimationFrame(function () {
				const area = areaRef.current;
				if (!area) return;
				area.focus();
				const from = selectionStart === undefined ? start + replacement.length : selectionStart;
				const to = selectionEnd === undefined ? from : selectionEnd;
				area.setSelectionRange(from, to);
			});
		}
		function wrap(prefix, suffix, placeholder) {
			const part = selection();
			const selected = part.text || placeholder || "";
			replaceRange(part.start, part.end, prefix + selected + suffix, part.start + prefix.length, part.start + prefix.length + selected.length);
		}
		function prefixLines(transformer) {
			const area = areaRef.current;
			if (!area) return;
			const all = value;
			const from = all.lastIndexOf("\n", Math.max(0, area.selectionStart - 1)) + 1;
			let to = all.indexOf("\n", area.selectionEnd);
			if (to < 0) to = all.length;
			const block = all.slice(from, to).split("\n").map(transformer).join("\n");
			replaceRange(from, to, block, from, from + block.length);
		}
		function insertAtCursor(text) {
			const part = selection();
			replaceRange(part.start, part.end, text);
		}
		function exec(command) {
			const area = areaRef.current;
			if (!area) return;
			area.focus();
			try { document.execCommand(command); } catch (_) {}
			update(area.value);
		}
		function removeBlankLines() {
			update(value.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n"));
		}
		// 查找替换：命中的下标从 0 开始，按大小写设置做匹配。
		function matchesOf(text, needle, caseSensitive) {
			if (!needle) return [];
			const haystack = caseSensitive ? text : text.toLowerCase();
			const target = caseSensitive ? needle : needle.toLowerCase();
			const hits = [];
			let index = haystack.indexOf(target);
			while (index >= 0) {
				hits.push(index);
				index = haystack.indexOf(target, index + Math.max(1, target.length));
			}
			return hits;
		}
		const hitCount = finder.open ? matchesOf(value, finder.find, finder.caseSensitive).length : 0;
		function openFinder() {
			setFinder(function (current) { return Object.assign({}, current, { open: true, message: "" }); });
			window.requestAnimationFrame(function () { if (findInputRef.current) findInputRef.current.focus(); });
		}
		function applyFinder(patch) {
			setFinder(function (current) { return Object.assign({}, current, patch); });
		}
		function findNext() {
			const needle = finder.find;
			if (!needle) { applyFinder({ message: "先输入要查找的内容" }); return; }
			const hits = matchesOf(value, needle, finder.caseSensitive);
			if (!hits.length) { applyFinder({ message: "没有找到：" + needle }); return; }
			const area = areaRef.current;
			const from = area ? (area.selectionEnd || 0) : 0;
			const index = hits.find(position => position >= from) ?? hits[0];
			if (area) {
				area.focus();
				area.setSelectionRange(index, index + needle.length);
			}
			applyFinder({ message: (hits.indexOf(index) + 1) + " / " + hits.length });
		}
		function replaceOne() {
			const needle = finder.find;
			if (!needle) { applyFinder({ message: "先输入要查找的内容" }); return; }
			const area = areaRef.current;
			if (!area) return;
			const start = area.selectionStart || 0;
			const end = area.selectionEnd || 0;
			const selected = value.slice(start, end);
			const equal = finder.caseSensitive ? selected === needle : selected.toLowerCase() === needle.toLowerCase();
			// 没有落在命中上就当作“先找下一个”。
			if (!equal || !selected) { findNext(); return; }
			const next = value.slice(0, start) + finder.replace + value.slice(end);
			const caret = start + finder.replace.length;
			update(next);
			const hits = matchesOf(next, needle, finder.caseSensitive);
			const index = hits.find(position => position >= caret);
			window.requestAnimationFrame(function () {
				const node = areaRef.current;
				if (!node) return;
				node.focus();
				if (index === undefined) node.setSelectionRange(caret, caret);
				else node.setSelectionRange(index, index + needle.length);
			});
			applyFinder({ message: index === undefined ? "已替换，后面没有更多" : "已替换 1 处，继续找下一处" });
		}
		function replaceAll() {
			const needle = finder.find;
			if (!needle) { applyFinder({ message: "先输入要查找的内容" }); return; }
			const hits = matchesOf(value, needle, finder.caseSensitive);
			if (!hits.length) { applyFinder({ message: "没有找到：" + needle }); return; }
			let result = "";
			let last = 0;
			for (const index of hits) {
				result += value.slice(last, index) + finder.replace;
				last = index + needle.length;
			}
			result += value.slice(last);
			update(result);
			applyFinder({ message: "已全部替换 " + hits.length + " 处" });
		}
		function autoCloseTags() {
			const stack = [];
			const token = /<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
			let match;
			while ((match = token.exec(value))) {
				if (match[2] === "/") continue;
				const name = match[1].toLowerCase();
				if (match[0].startsWith("</")) {
					const index = stack.lastIndexOf(name);
					if (index >= 0) stack.length = index;
				} else stack.push(name);
			}
			const closing = stack.slice().reverse().map(function (name) { return "</" + name + ">"; }).join("\n");
			if (!closing) { setFeedback("没有需要闭合的标签"); return; }
			update(value + (value.endsWith("\n") ? "" : "\n") + closing);
			setFeedback("已补上 " + stack.length + " 个闭合标签");
		}
		function openTagRename() {
			const names = [];
			const token = /<\/?([a-zA-Z][\w-]*)/g;
			let match;
			while ((match = token.exec(value))) if (!names.includes(match[1])) names.push(match[1]);
			if (names.length === 0) { setFeedback("正文里没有 HTML 标签"); return; }
			setTagDialog({ names: names, from: names[0], to: "" });
		}
		function renameTags() {
			if (!tagDialog) return;
			const from = String(tagDialog.from || "").trim();
			const to = String(tagDialog.to || "").trim();
			if (!from || !to) return;
			const pattern = new RegExp("<\\/?\\s*" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[\\s/>])", "g");
			update(value.replace(pattern, function (matchText) { return matchText.replace(from, to); }));
			setTagDialog(null);
			setFeedback("已把 <" + from + "> 改为 <" + to + ">");
		}
		const tools = [
			[["撤销", function () { exec("undo"); }], ["重做", function () { exec("redo"); }], ["复制", function () { exec("copy"); }], ["剪切", function () { exec("cut"); }], ["全选", function () { exec("selectAll"); }], ["查找替换", openFinder], ["去空行", removeBlankLines]],
			[["标题", function () { prefixLines(function (line) { return line.startsWith("#") ? line : "# " + line; }); }], ["加粗", function () { wrap("**", "**", "粗体"); }], ["斜体", function () { wrap("_", "_", "斜体"); }], ["无序列表", function () { prefixLines(function (line) { return "- " + line.replace(/^[-*]\s+/, ""); }); }], ["有序列表", function () { let index = 0; prefixLines(function (line) { index += 1; return index + ". " + line.replace(/^\d+\.\s+/, ""); }); }], ["引用", function () { prefixLines(function (line) { return "> " + line; }); }], ["行内代码", function () { wrap("`", "`", "code"); }], ["代码块", function () { wrap("```\n", "\n```", "code"); }], ["分隔线", function () { insertAtCursor("\n---\n"); }], ["链接", function () { wrap("[", "](https://)", "文字"); }]],
			[["<>", function () { wrap("<tag>", "", "内容"); }], ["</>", function () { insertAtCursor("\n<tag>\n\n</tag>\n"); }], ["自动闭合", autoCloseTags], ["标签改名", openTagRename]]
		];
		const node = h("div", { className: "dsh-tavern-wbsw-editor-layer", role: "dialog", "aria-modal": "true", "aria-label": "编辑世界书条目" },
			h("div", { className: "dsh-tavern-wbsw-editor" },
				h("div", { className: "dsh-tavern-wbsw-editor-head" },
					h("div", { className: "dsh-tavern-wbsw-editor-meta" },
						h("div", { className: "dsh-tavern-wbsw-editor-title" }, wbRowLabel(entry)),
						h("div", { className: "dsh-tavern-wbsw-editor-sub" }, props.bookName)),
					h("div", { className: "dsh-tavern-wbsw-editor-actions" },
						h("button", { type: "button", className: "dsh-tavern-wbsw-btn primary", disabled: !dirty || busy, onClick: function () { void save(); } }, busy ? "保存中…" : "保存"),
						h("button", { type: "button", className: "dsh-tavern-wbsw-btn", onClick: requestClose }, "关闭"))),
				h("div", { className: "dsh-tavern-wbsw-toolbar" }, tools.map(function (group, index) {
					return h("div", { key: index, className: "dsh-tavern-wbsw-toolgroup" }, group.map(function ([label, action]) {
						return h("button", { key: label, type: "button", className: "dsh-tavern-wbsw-tool" + (label === "查找替换" && finder.open ? " is-active" : ""), title: label, onClick: action }, label);
					}));
				})),
				finder.open ? h("div", { className: "dsh-tavern-wbsw-finder", role: "search" },
					h("input", {
						ref: findInputRef, className: "dsh-tavern-wbsw-finder-input", type: "text", value: finder.find,
						placeholder: "查找", "aria-label": "查找",
						onChange: function (event) { applyFinder({ find: event.target.value, message: "" }); },
						onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); findNext(); } }
					}),
					h("input", {
						className: "dsh-tavern-wbsw-finder-input", type: "text", value: finder.replace,
						placeholder: "替换为", "aria-label": "替换为",
						onChange: function (event) { applyFinder({ replace: event.target.value }); },
						onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); replaceOne(); } }
					}),
					h("label", { className: "dsh-tavern-wbsw-finder-case", title: "区分大小写" },
						h("input", { type: "checkbox", checked: finder.caseSensitive, onChange: function (event) { applyFinder({ caseSensitive: event.target.checked, message: "" }); } }),
						"区分大小写"),
					h("span", { className: "dsh-tavern-wbsw-finder-count" }, finder.message || (finder.find ? "共 " + hitCount + " 处" : "")),
					h("button", { type: "button", className: "dsh-tavern-wbsw-finder-btn", onClick: findNext }, "下一个"),
					h("button", { type: "button", className: "dsh-tavern-wbsw-finder-btn", onClick: replaceOne }, "替换"),
					h("button", { type: "button", className: "dsh-tavern-wbsw-finder-btn", onClick: replaceAll }, "全部替换"),
					h("button", { type: "button", className: "dsh-tavern-wbsw-finder-btn is-ghost", title: "关闭查找替换", onClick: function () { applyFinder({ open: false, message: "" }); } }, "✕")) : null,
				h("div", { className: "dsh-tavern-wbsw-editor-body" },
					h("textarea", {
						ref: areaRef, className: "dsh-tavern-wbsw-editor-textarea", spellCheck: false, value: value,
						"aria-label": "条目正文", onChange: function (event) { update(event.target.value); }
					})),
				h("div", { className: "dsh-tavern-wbsw-editor-foot" },
					h("span", { className: "dsh-tavern-wbsw-feedback" }, feedback || (dirty ? "有未保存的修改 · Ctrl+S 保存" : "没有未保存的修改")),
					confirmClose ? h("span", { className: "dsh-tavern-wbsw-confirm" },
						h("span", { className: "dsh-tavern-wbsw-confirm-text" }, "有未保存的改动，确定关闭？"),
						h("button", { type: "button", className: "dsh-tavern-wbsw-confirm-yes", onClick: props.onClose }, "确认"),
						h("button", { type: "button", className: "dsh-tavern-wbsw-confirm-no", onClick: function () { setConfirmClose(false); } }, "取消")) : null),
				tagDialog ? h("div", { className: "dsh-tavern-wbsw-dialog-backdrop" },
					h("div", { className: "dsh-tavern-wbsw-dialog" },
						h("div", { className: "dsh-tavern-wbsw-dialog-title" }, "标签改名"),
						h("select", { value: tagDialog.from, onChange: function (event) { setTagDialog(Object.assign({}, tagDialog, { from: event.target.value })); } },
							tagDialog.names.map(function (name) { return h("option", { key: name, value: name }, "<" + name + ">"); })),
						h("input", { type: "text", value: tagDialog.to, placeholder: "新的标签名", autoFocus: true, onChange: function (event) { setTagDialog(Object.assign({}, tagDialog, { to: event.target.value })); } }),
						h("div", { className: "dsh-tavern-wbsw-dialog-actions" },
							h("button", { type: "button", className: "dsh-tavern-wbsw-btn", onClick: function () { setTagDialog(null); } }, "取消"),
							h("button", { type: "button", className: "dsh-tavern-wbsw-btn primary", onClick: renameTags }, "应用")))) : null));
		return require("react-dom").createPortal(node, document.body);
	}

	function WorldBookSwitcherPanel(props) {
		const h = React.createElement;
		const state = props.state;
		const sessionId = state.sessionId;
		const [config, setConfig] = React.useState(readWbSwitcherConfig);
		const configRef = React.useRef(config);
		configRef.current = config;
		const [catalog, setCatalog] = React.useState(null);
		const [book, setBook] = React.useState(null);
		const [loading, setLoading] = React.useState(true);
		const [error, setError] = React.useState("");
		const [pane, setPane] = React.useState(null);
		const [allOpen, setAllOpen] = React.useState(false);
		const [frequentOpen, setFrequentOpen] = React.useState(false);
		const [frequent, setFrequent] = React.useState({ loading: false, entries: [] });
		const [editor, setEditor] = React.useState(null);
		const [tab, setTab] = React.useState("entries");
		const [query, setQuery] = React.useState("");
		const [mobile, setMobile] = React.useState(function () { return window.innerWidth < 768; });
		const [geometry, setGeometry] = React.useState(null);
		const rootRef = React.useRef(null);
		const bookCache = React.useRef(new Map());
		// 设置与文件夹是临时面板：关掉后回到打开前的详情。
		const paneReturn = React.useRef(null);

		function openSettings() {
			paneReturn.current = pane && (pane.kind === "detail" ? pane : null);
			setPane({ kind: "settings" });
		}

		function closeSettings() {
			const back = paneReturn.current;
			paneReturn.current = null;
			setPane(back || null);
		}

		function updateConfig(patchValue) {
			const next = normalizeWbSwitcherConfig(Object.assign({}, configRef.current, patchValue));
			configRef.current = next;
			setConfig(next);
			writeWbSwitcherConfig(next);
		}

		async function selectRow(row, sourceCatalog) {
			const pool = sourceCatalog || catalog;
			if (!pool || !row) return;
			setError("");
			try {
				const record = await loadWbBook(sessionId, row.source);
				bookCache.current.set(row.key, record);
				setBook(Object.assign({}, record, { key: row.key, row: row }));
				setQuery("");
				updateConfig({ selectedKey: row.key });
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		React.useEffect(function () {
			let alive = true;
			const initial = readWbSwitcherConfig();
			configRef.current = initial;
			setConfig(initial);
			setAllOpen(initial.panelState.allWorldbooks);
			setFrequentOpen(initial.panelState.frequentEntries);
			setPane(null);
			setEditor(null);
			setQuery("");
			setLoading(true);
			loadWbCatalog(sessionId).then(async function (next) {
				if (!alive) return;
				setCatalog(next);
				const row = next.all.find(item => item.key === initial.selectedKey) || next.all.find(item => item.globalEnabled === true) || next.all[0];
				if (!row) { setBook(null); setLoading(false); return; }
				const record = await loadWbBook(sessionId, row.source);
				if (!alive) return;
				bookCache.current.set(row.key, record);
				setBook(Object.assign({}, record, { key: row.key, row: row }));
				if (!initial.selectedKey) updateConfig({ selectedKey: row.key });
				setLoading(false);
			}).catch(function (err) {
				if (!alive) return;
				setError(String(err && err.message || err));
				setLoading(false);
			});
			return function () { alive = false; };
		}, [sessionId]);

		React.useEffect(function () {
			function onResize() { setMobile(window.innerWidth < 768); }
			window.addEventListener("resize", onResize);
			return function () { window.removeEventListener("resize", onResize); };
		}, []);

		// 位置：锚点下方；三栏按可用宽度分配，整块不越出视口。
		React.useLayoutEffect(function () {
			const rect = state.rect;
			const vw = window.innerWidth || 1280;
			const vh = window.innerHeight || 720;
			const narrow = vw < 768;
			const rows = narrow ? config.mobileVisibleRows : config.desktopVisibleRows;
			const height = wbPanelHeight(rows, narrow, vh);
			if (narrow) {
				const width = Math.min(520, vw - 16);
				const left = Math.max(8, Math.round((vw - width) / 2));
				const top = Math.max(8, Math.min(vh - height - 8, (rect ? rect.bottom + 8 : 72)));
				setGeometry({ left: left, top: top, width: width, height: height, narrow: true, widths: null });
				return;
			}
			const allocated = wbColumnWidths({ available: vw - 16, all: allOpen, frequent: frequentOpen, pane: Boolean(pane) });
			const anchorLeft = rect ? rect.left : Math.round(vw / 2 - 150);
			const wanted = anchorLeft + (rect ? rect.width : 0) / 2 - allocated.widths.main / 2 - (allOpen ? allocated.widths.all + 8 : 0);
			const left = wbClamp(wanted, 8, Math.max(8, vw - allocated.total - 8));
			const top = Math.max(8, Math.min(vh - height - 8, (rect ? rect.bottom + 8 : 80)));
			setGeometry({ left: left, top: top, width: allocated.total, height: height, narrow: false, widths: allocated.widths });
		}, [state.rect, config.desktopVisibleRows, config.mobileVisibleRows, allOpen, frequentOpen, pane, mobile]);

		React.useEffect(function () {
			function onPointer(event) {
				const root = rootRef.current;
				if (!root) return;
				if (root.contains(event.target)) return;
				if (event.target && event.target.closest && event.target.closest(".dsh-tavern-wbsw-editor-layer")) return;
				if (state.anchor && state.anchor.contains(event.target)) return;
				closeWorldBookSwitcher();
			}
			function onKey(event) {
				if (event.key !== "Escape") return;
				if (editor) return;
				if (pane && pane.kind === "detail") { setPane(null); return; }
				if (pane && (pane.kind === "settings" || pane.kind === "folders")) { closeSettings(); return; }
				if (frequentOpen) { setFrequentOpen(false); persistPanels({ frequentEntries: false }); return; }
				if (allOpen) { setAllOpen(false); persistPanels({ allWorldbooks: false }); return; }
				closeWorldBookSwitcher();
			}
			document.addEventListener("pointerdown", onPointer, true);
			document.addEventListener("keydown", onKey);
			return function () {
				document.removeEventListener("pointerdown", onPointer, true);
				document.removeEventListener("keydown", onKey);
			};
		}, [state.anchor, pane, editor, allOpen]);

		React.useEffect(function () {
			if (!frequentOpen || !catalog) return undefined;
			let alive = true;
			setFrequent(function (current) { return Object.assign({}, current, { loading: true }); });
			const keys = new Set(Object.values(config.entryUsage || {}).map(item => item.book).filter(Boolean));
			Promise.all(Array.from(keys).map(async function (key) {
				if (bookCache.current.has(key)) return;
				const source = wbSourceOfKey(key);
				if (!source) return;
				try { bookCache.current.set(key, await loadWbBook(sessionId, source)); } catch (_) {}
			})).then(function () {
				if (!alive) return;
				const pinned = new Set(config.pinnedEntries || []);
				const entries = Object.entries(config.entryUsage || {}).map(function ([usageKey, item]) {
					const record = bookCache.current.get(item.book);
					const view = record && record.view;
					const entry = view && (view.entries || []).find(row => row.ref === item.ref);
					const bookRow = (catalog.all || []).find(row => row.key === item.book);
					return {
						id: usageKey,
						key: item.book,
						ref: item.ref,
						name: entry ? wbRowLabel(entry) : (item.name || "已删除的条目"),
						bookName: bookRow ? bookRow.name : (item.book || ""),
						enabled: entry ? entry.enabled !== false : false,
						missing: !entry,
						pinned: pinned.has(usageKey),
						count: item.count,
						last: item.last
					};
				}).filter(item => !item.missing);
				entries.sort(function (left, right) {
					if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
					if (left.count !== right.count) return right.count - left.count;
					return right.last - left.last;
				});
				setFrequent({ loading: false, entries: entries });
			});
			return function () { alive = false; };
		}, [frequentOpen, catalog, config.entryUsage, config.pinnedEntries, sessionId]);

		function applyBookRecord(bookKey, record) {
			if (!record || !bookKey) return;
			bookCache.current.set(bookKey, record);
			if (book && book.key === bookKey) setBook(Object.assign({}, record, { key: bookKey, row: book.row }));
			if (!catalog) return;
			const replace = row => {
				if (row.key !== bookKey) return row;
				return Object.assign({}, row, {
					entryCount: record.view ? record.view.entries.length : row.entryCount,
					enabledCount: record.view ? record.view.entries.filter(entry => entry.enabled !== false).length : row.enabledCount
				});
			};
			setCatalog(Object.assign({}, catalog, {
				all: catalog.all.map(replace),
				standalone: catalog.standalone.map(replace),
				embedded: catalog.embedded.map(replace)
			}));
		}

		function recordUsage(bookKey, entry) {
			const usageKey = wbEntryKey(bookKey, entry.ref);
			const next = Object.assign({}, configRef.current.entryUsage);
			const previous = next[usageKey] || { count: 0, last: 0 };
			next[usageKey] = { count: previous.count + 1, last: Date.now(), name: wbRowLabel(entry), book: bookKey, ref: entry.ref };
			const trimmed = Object.entries(next).sort(function (left, right) { return right[1].last - left[1].last; }).slice(0, WBSW_USAGE_LIMIT);
			updateConfig({ entryUsage: Object.fromEntries(trimmed) });
		}

		async function toggleEntry(entry, next) {
			if (!book || !entry) return;
			recordUsage(book.key, entry);
			try {
				applyBookRecord(book.key, await patchWbEntry(sessionId, book.source, entry.ref, { enabled: next }));
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		async function patchEntryOf(bookKey, entry, patchValue) {
			const source = wbSourceOfKey(bookKey);
			if (!source) throw new Error("世界书不存在");
			const record = await patchWbEntry(sessionId, source, entry.ref, patchValue);
			applyBookRecord(bookKey, record);
			notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			return record;
		}

		async function toggleFrequentEntry(entry, next) {
			const source = wbSourceOfKey(entry.key);
			if (!source) return;
			try {
				recordUsage(entry.key, { ref: entry.ref, title: entry.name });
				const record = await patchWbEntry(sessionId, source, entry.ref, { enabled: next });
				applyBookRecord(entry.key, record);
				setFrequent(function (current) {
					return Object.assign({}, current, { entries: current.entries.map(item => item.id === entry.id ? Object.assign({}, item, { enabled: next }) : item) });
				});
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		async function removeEntry(bookKey, entry) {
			const source = wbSourceOfKey(bookKey);
			if (!source || !entry) return;
			try {
				const record = await deleteWbEntry(sessionId, source, entry.ref);
				applyBookRecord(bookKey, record);
				const usage = Object.assign({}, configRef.current.entryUsage);
				delete usage[wbEntryKey(bookKey, entry.ref)];
				const pinnedEntries = (configRef.current.pinnedEntries || []).filter(item => item !== wbEntryKey(bookKey, entry.ref));
				updateConfig({ entryUsage: usage, pinnedEntries: pinnedEntries });
				if (pane && pane.kind === "detail" && pane.bookKey === bookKey && pane.ref === entry.ref) setPane(null);
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		async function toggleWorldbook(row, next) {
			if (!row || row.embedded) return;
			try {
				await rpc("setGlobalWorldBook", { source: row.source, enabled: next }, sessionId);
				const refreshed = await loadWbCatalog(sessionId);
				setCatalog(refreshed);
				if (!refreshed.all.some(item => item.key === configRef.current.selectedKey)) {
					const fallback = refreshed.all.find(item => item.globalEnabled === true) || refreshed.all[0];
					if (fallback) await selectRow(fallback, refreshed);
				}
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		async function removeWorldbook(row) {
			if (!row) return;
			try {
				await rpc("deleteWorldBook", { source: row.source }, sessionId);
				const refreshed = await loadWbCatalog(sessionId);
				setCatalog(refreshed);
				if (book && book.key === row.key) {
					const fallback = refreshed.all.find(item => item.globalEnabled === true) || refreshed.all[0];
					if (fallback) await selectRow(fallback, refreshed);
					else setBook(null);
				}
				if (pane && pane.kind === "detail" && pane.bookKey === row.key) setPane(null);
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		function togglePinWorldbook(row) {
			const pinned = configRef.current.pinnedWorldbooks || [];
			updateConfig({ pinnedWorldbooks: pinned.includes(row.key) ? pinned.filter(item => item !== row.key) : pinned.concat([row.key]) });
		}

		function togglePinEntry(entry) {
			const key = wbEntryKey(entry.key, entry.ref);
			const pinned = configRef.current.pinnedEntries || [];
			updateConfig({ pinnedEntries: pinned.includes(key) ? pinned.filter(item => item !== key) : pinned.concat([key]) });
		}

		function persistPanels(next) {
			updateConfig({ panelState: Object.assign({}, configRef.current.panelState, next) });
		}

		function togglePanels(which) {
			if (which === "all") {
				const next = !allOpen;
				setAllOpen(next);
				persistPanels({ allWorldbooks: next });
			} else {
				const next = !frequentOpen;
				setFrequentOpen(next);
				persistPanels({ frequentEntries: next });
			}
		}

		function openEntry(bookKey, entry) {
			setPane({ kind: "detail", bookKey: bookKey, ref: entry.ref });
			const record = bookCache.current.get(bookKey);
			if (!record || !record.view) {
				const source = wbSourceOfKey(bookKey);
				if (!source) return;
				loadWbBook(sessionId, source).then(function (loaded) {
					if (!loaded) return;
					bookCache.current.set(bookKey, loaded);
					if (book && book.key === bookKey) applyBookRecord(bookKey, loaded);
					setPane(function (current) { return current && current.kind === "detail" && current.bookKey === bookKey ? Object.assign({}, current) : current; });
				}).catch(function (err) { setError(String(err && err.message || err)); });
				return;
			}
			if (!mobile) setTab("entries");
		}

		function openLibrary(current) {
			closeWorldBookSwitcher();
			props.openLibrary(current ? current.source : null, sessionId);
		}

		const currentBookKey = book ? book.key : "";
		const allEntries = book && book.view && Array.isArray(book.view.entries) ? book.view.entries : [];
		const needle = query.trim().toLocaleLowerCase();
		const entries = needle ? allEntries.filter(function (entry) {
			return [entry.title, entry.comment, entry.content].concat(entry.primaryKeys || [], entry.secondaryKeys || [])
				.some(value => String(value || "").toLocaleLowerCase().includes(needle));
		}) : allEntries;
		const detailRecord = pane && pane.kind === "detail" ? (book && book.key === pane.bookKey ? book : bookCache.current.get(pane.bookKey)) : null;
		const detailEntry = detailRecord && detailRecord.view ? (detailRecord.view.entries || []).find(entry => entry.ref === pane.ref) : null;

		const selectable = (catalog ? catalog.standalone.filter(row => row.globalEnabled === true) : []).slice();
		if (book && book.row && !selectable.some(row => row.key === book.key)) selectable.push(book.row);
		const sortedSelectable = selectable.slice().sort(function (left, right) {
			return String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN");
		});

		function renderSettings(backLabel) {
			return h(WbSettingsPane, {
				config: config,
				onChange: function (patchValue) { updateConfig(patchValue); },
				onFolders: function () { setPane({ kind: "folders" }); },
				onClose: backLabel ? function () { setPane(null); } : closeSettings,
				backLabel: backLabel
			});
		}

		function renderFolders(backLabel) {
			return h(WbFoldersPane, {
				config: config, catalog: catalog,
				onChange: function (patchValue) { updateConfig(patchValue); },
				onBack: function () { setPane(backLabel ? null : { kind: "settings" }); }
			});
		}

		function renderDetail(backLabel) {
			if (!detailEntry || !detailRecord) {
				return h("div", { className: "dsh-tavern-wbsw-column" },
					h("div", { className: "dsh-tavern-wbsw-head" }, h("span", { className: "dsh-tavern-wbsw-title" }, "详情"),
						h(WbIconButton, { name: backLabel ? "back" : "close", title: "关闭", onClick: function () { setPane(null); } })),
					h("div", { className: "dsh-tavern-wbsw-empty" }, "正在读取条目…"));
			}
			return h(WbDetailPane, {
				entry: detailEntry,
				bookName: detailRecord.view ? detailRecord.view.displayName : "", bookKey: pane.bookKey,
				// 世界书级的默认扫描深度：条目留空时用它。
				scanDepthFallback: detailRecord.view ? detailRecord.view.scanDepth : 2,
				visible: config.visibleElements, backLabel: backLabel,
				onPatch: function (patchValue) { return patchEntryOf(pane.bookKey, detailEntry, patchValue); },
				onDelete: function () { void removeEntry(pane.bookKey, detailEntry); },
				onClose: function () { setPane(null); },
				onExpand: function () { setEditor({ bookKey: pane.bookKey, entry: detailEntry }); }
			});
		}

		function renderMainColumn(options) {
			const compact = Boolean(options && options.compact);
			return h("div", { className: "dsh-tavern-wbsw-column dsh-tavern-wbsw-main" },
				h("div", { className: "dsh-tavern-wbsw-head dsh-tavern-wbsw-main-head" },
					compact ? null : h(WbIconButton, {
						className: allOpen ? "is-active" : "", name: "books", size: 14, title: "全部世界书",
						onClick: function () { togglePanels("all"); }
					}),
					h("select", {
						className: "dsh-tavern-wbsw-select", value: currentBookKey, "aria-label": "选择世界书",
						onChange: function (event) {
							const row = (catalog ? catalog.all : []).find(item => item.key === event.target.value);
							if (row) void selectRow(row);
						}
					},
						sortedSelectable.length === 0 ? h("option", { value: "" }, "无已启用的世界书") : null,
						sortedSelectable.map(function (row) { return h("option", { key: row.key, value: row.key }, row.name); })),
					compact ? null : h(WbIconButton, {
						className: frequentOpen ? "is-active" : "", name: "star", size: 14, title: "常用条目",
						onClick: function () { togglePanels("frequent"); }
					}),
					compact ? null : h("button", { type: "button", className: "dsh-tavern-wbsw-btn", title: "打开右侧栏完整世界书库", onClick: function () { openLibrary(book); } }, "完整"),
					compact ? null : h(WbIconButton, { name: "close", title: "关闭", onClick: closeWorldBookSwitcher })),
				h("div", { className: "dsh-tavern-wbsw-list" },
					loading ? h("div", { className: "dsh-tavern-wbsw-empty" }, "正在读取世界书…") : null,
					!loading && error ? h("div", { className: "dsh-tavern-wbsw-error", role: "alert" }, error) : null,
					!loading && !book ? h("div", { className: "dsh-tavern-wbsw-empty" }, "还没有世界书。用「完整」进入世界书库导入。") : null,
					!loading && book && entries.length === 0 ? h("div", { className: "dsh-tavern-wbsw-empty" }, needle ? "没有匹配的条目" : "这本世界书还没有条目") : null,
					entries.map(function (entry) {
						return h(WbEntryRow, {
							key: entry.ref, entry: entry, visible: config.visibleElements, toggleStyle: config.toggleStyle,
							active: pane && pane.kind === "detail" && pane.bookKey === currentBookKey && pane.ref === entry.ref,
							onToggle: function (next) { void toggleEntry(entry, next); },
							onOpen: function () { openEntry(currentBookKey, entry); },
							onDelete: function () { void removeEntry(currentBookKey, entry); }
						});
					})),
				h(WbSearchFooter, {
					visible: config.visibleElements, value: query, onChange: setQuery,
					placeholder: "搜索条目…", settings: function () { openSettings(); }
				}));
		}

		function renderDesktop() {
			return h(React.Fragment, null,
				allOpen ? h(WbAllPane, {
					catalog: catalog || { all: [] }, config: config, visible: config.visibleElements,
					currentKey: currentBookKey,
					onClose: function () { setAllOpen(false); persistPanels({ allWorldbooks: false }); },
					onSelect: function (row) { void selectRow(row); },
					onToggle: toggleWorldbook, onPin: togglePinWorldbook, onDelete: removeWorldbook,
					onCollapsed: function (list) { updateConfig({ collapsedFolders: list }); }
				}) : null,
				renderMainColumn(),
				frequentOpen ? h(WbFrequentPane, {
					entries: frequent.entries, loading: frequent.loading, config: config, visible: config.visibleElements,
					onClose: function () { setFrequentOpen(false); persistPanels({ frequentEntries: false }); },
					onToggle: function (entry, next) { void toggleFrequentEntry(entry, next); },
					onOpen: function (entry) { openEntry(entry.key, { ref: entry.ref }); },
					onPin: function (entry) { togglePinEntry(entry); },
					onDelete: function (entry) { void removeEntry(entry.key, { ref: entry.ref }); }
				}) : null,
				pane && pane.kind === "settings" ? renderSettings("") : null,
				pane && pane.kind === "folders" ? renderFolders("") : null,
				pane && pane.kind === "detail" ? renderDetail("") : null);
		}

		function renderMobile() {
			const dual = config.mobileDualPane === true;
			const paneActive = Boolean(pane);
			const tabs = dual ? [["entries", "条目"], ["frequent", "常用"]] : [["worldbooks", "世界书"], ["entries", "条目"], ["frequent", "常用"]];
			const body = paneActive
				? (pane.kind === "settings" ? renderSettings("返回") : pane.kind === "folders" ? renderFolders("返回") : renderDetail("返回"))
				: (tab === "worldbooks" ? renderMobileWorldbooks() : tab === "frequent" ? renderMobileFrequent() : renderMainColumn({ compact: true }));
			return h(React.Fragment, null,
				h("div", { className: "dsh-tavern-wbsw-mobile-tabs" },
					tabs.map(function ([id, label]) {
						return h("button", {
							key: id, type: "button", className: "dsh-tavern-wbsw-tab" + (!paneActive && tab === id ? " is-active" : ""),
							onClick: function () { setPane(null); setTab(id); }
						}, label);
					}),
					h("button", { type: "button", className: "dsh-tavern-wbsw-tab is-ghost", title: "完整世界书库", onClick: function () { openLibrary(book); } }, "完整"),
					h(WbIconButton, { name: "close", title: "关闭", onClick: closeWorldBookSwitcher })),
				dual
					? h("div", { className: "dsh-tavern-wbsw-mobile-dual" },
						h("div", { className: "dsh-tavern-wbsw-dual-left" },
							h(WbAllPane, {
								catalog: catalog || { all: [] }, config: config, visible: config.visibleElements,
								currentKey: currentBookKey, hideHead: true,
								onSelect: function (row) { void selectRow(row); },
								onToggle: toggleWorldbook, onPin: togglePinWorldbook, onDelete: removeWorldbook,
								onCollapsed: function (list) { updateConfig({ collapsedFolders: list }); }
							})),
						h("div", { className: "dsh-tavern-wbsw-dual-main" },
							paneActive || tab !== "entries" ? body : renderMainColumn({ compact: true })))
					: body);
		}

		function renderMobileWorldbooks() {
			return h(WbAllPane, {
				catalog: catalog || { all: [] }, config: config, visible: config.visibleElements,
				currentKey: currentBookKey, hideHead: true,
				onSelect: function (row) { void selectRow(row); },
				onToggle: toggleWorldbook, onPin: togglePinWorldbook, onDelete: removeWorldbook,
				onCollapsed: function (list) { updateConfig({ collapsedFolders: list }); }
			});
		}

		function renderMobileFrequent() {
			return h(WbFrequentPane, {
				entries: frequent.entries, loading: frequent.loading, config: config, visible: config.visibleElements, hideHead: true,
				onToggle: function (entry, next) { void toggleFrequentEntry(entry, next); },
				onOpen: function (entry) { openEntry(entry.key, { ref: entry.ref }); },
				onPin: function (entry) { togglePinEntry(entry); },
				onDelete: function (entry) { void removeEntry(entry.key, { ref: entry.ref }); }
			});
		}

		const content = h("div", {
			ref: rootRef,
			className: "dsh-tavern-wbsw-shell" + (geometry && geometry.narrow ? " is-mobile" : ""),
			style: geometry
				? {
					left: geometry.left + "px", top: geometry.top + "px",
					width: geometry.width + "px", height: geometry.height + "px",
					"--wbsw-main-width": geometry.widths ? geometry.widths.main + "px" : "300px",
					"--wbsw-all-width": geometry.widths ? geometry.widths.all + "px" : "250px",
					"--wbsw-frequent-width": geometry.widths ? geometry.widths.frequent + "px" : "280px",
					"--wbsw-side-width": geometry.widths ? geometry.widths.side + "px" : "340px"
				}
				: { visibility: "hidden" }
		},
			geometry && geometry.narrow ? renderMobile() : renderDesktop(),
			editor ? h(WbFullscreenEditor, {
				entry: editor.entry,
				bookName: (bookCache.current.get(editor.bookKey) || book || {}).view ? (bookCache.current.get(editor.bookKey) || book).view.displayName : "",
				onSave: function (patchValue) { return patchEntryOf(editor.bookKey, editor.entry, patchValue); },
				onClose: function () { setEditor(null); }
			}) : null);

		return content;
	}

	function WorldBookSwitcherLayer(props) {
		const state = React.useSyncExternalStore(subscribeSwitcher, snapshotSwitcher, snapshotSwitcher);
		if (!state.open) return null;
		return React.createElement(WorldBookSwitcherPanel, { state: state, openLibrary: props.openLibrary });
	}

	function register(input) {
		const ctx = input.ctx;
		const container = document.createElement("div");
		container.className = "dsh-tavern-wbsw-portal";
		document.body.append(container);
		const root = require("react-dom/client").createRoot(container);
		root.render(React.createElement(WorldBookSwitcherLayer, { openLibrary: input.openLibrary }));
		return function () {
			try { root.unmount(); } catch (_) {}
			container.remove();
		};
	}

	return Object.freeze({
		register: register,
		open: openWorldBookSwitcher,
		close: closeWorldBookSwitcher,
		subscribe: subscribeSwitcher,
		snapshot: snapshotSwitcher,
		normalizeConfig: normalizeWbSwitcherConfig,
		visibleConfig: wbConfigVisible,
		rowsConfig: wbConfigRows,
		groupRows: wbGroupRows,
		sourceKey: wbSourceKey,
		sourceOfKey: wbSourceOfKey,
		strategyOf: wbStrategyOf,
		strategyPatch: wbStrategyPatch,
		panelHeight: wbPanelHeight,
		columnWidths: wbColumnWidths,
		rowLabel: wbRowLabel
	});
}

const worldBookSwitcherFeature = createWorldBookSwitcherFeatureModule();
