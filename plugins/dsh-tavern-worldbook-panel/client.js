// dsh-tavern-worldbook-panel — 浏览器侧（由 build.mjs 生成，不要直接改；改 src/panel.js 后重新构建）。
window.__ModuleLoader__.load({
  id: "dsh-tavern-worldbook-panel",
  factory: (require) => {
    const React = require("react")

    // 面板样式只注入一次；卸载插件时移除，页面里不留垃圾。
    const PANEL_CSS = "/* 世界书切换器：顶栏世界书按钮弹出的快速面板。 */\n.dsh-wbp-shell { position: fixed; z-index: 3000; display: flex; align-items: stretch; gap: 8px; overflow: visible; color: var(--dsw-alias-label-primary); font-family: var(--dsh-tavern-font-sans); font-size: 13px; line-height: 1.45; }\n.dsh-wbp-shell > .dsh-wbp-column { animation: dsh-wbp-in 160ms cubic-bezier(0.23, 1, 0.32, 1); }\n.dsh-wbp-all { animation-name: dsh-wbp-in-left !important; }\n.dsh-wbp-frequent, .dsh-wbp-detail, .dsh-wbp-settings, .dsh-wbp-folders { animation-name: dsh-wbp-in-right !important; }\n@keyframes dsh-wbp-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }\n@keyframes dsh-wbp-in-left { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }\n@keyframes dsh-wbp-in-right { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }\n@media (prefers-reduced-motion: reduce) { .dsh-wbp-shell > .dsh-wbp-column { animation: none; } }\n.dsh-wbp-shell.is-mobile { flex-direction: column; gap: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 16px 40px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); }\n.dsh-wbp-column { box-sizing: border-box; flex: none; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, var(--dsw-specific-sidebar-fill)); box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }\n.dsh-wbp-main { width: var(--wbsw-main-width, 300px); }\n.dsh-wbp-all { width: var(--wbsw-all-width, 250px); }\n.dsh-wbp-frequent { width: var(--wbsw-frequent-width, 280px); }\n.dsh-wbp-detail, .dsh-wbp-settings, .dsh-wbp-folders { width: var(--wbsw-side-width, 340px); }\n.dsh-wbp-shell.is-mobile .dsh-wbp-column { width: 100%; flex: 1 1 auto; border: 0; border-radius: 0; box-shadow: none; background: transparent; }\n.dsh-wbp-head { display: flex; flex: none; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dsh-wbp-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600; }\n.dsh-wbp-head-actions { display: inline-flex; flex: none; align-items: center; gap: 2px; }\n.dsh-wbp-main-head { gap: 5px; }\n.dsh-wbp-select { flex: 1; min-width: 0; height: 26px; padding: 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }\n.dsh-wbp-select:focus-visible { border-color: var(--dsh-tavern-accent-border); outline: none; }\n.dsh-wbp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }\n.dsh-wbp-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; cursor: pointer; transition: background .14s ease, opacity .14s ease; }\n.dsh-wbp-row:hover { background: color-mix(in srgb, var(--dsh-tavern-accent) 10%, transparent); }\n.dsh-wbp-row.is-active { background: color-mix(in srgb, var(--dsh-tavern-accent) 16%, transparent); box-shadow: inset 0 0 0 1px var(--dsh-tavern-accent-border); }\n.dsh-wbp-row.is-disabled { opacity: .5; }\n.dsh-wbp-row.is-off { opacity: .62; }\n.dsh-wbp-row-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }\n.dsh-wbp-row-name { flex: 1; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-row-sub { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-row-actions { display: inline-flex; flex: none; align-items: center; gap: 1px; }\n.dsh-wbp-pin-mark { margin-right: 3px; font-size: 9px; }\n.dsh-wbp-tag { display: inline-grid; flex: none; place-items: center; width: 22px; height: 17px; border-radius: 4px; background: color-mix(in srgb, #a855f7 18%, transparent); color: #a855f7; font-size: 9px; font-weight: 700; }\n.dsh-wbp-icon { display: inline-grid; flex: none; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; line-height: 1; }\n.dsh-wbp-icon:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }\n.dsh-wbp-icon.is-active { background: var(--dsh-tavern-accent-soft); color: var(--dsh-tavern-accent); }\n.dsh-wbp-icon.is-pinned { color: #d99a3f; }\n.dsh-wbp-icon.compact { width: 20px; height: 20px; font-size: 10px; }\n.dsh-wbp-danger { color: var(--dsw-alias-label-tertiary); }\n.dsh-wbp-danger:hover { background: color-mix(in srgb, #c45f5f 14%, transparent); color: #c45f5f; }\n.dsh-wbp-btn { flex: none; height: 26px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; font-size: 11px; }\n.dsh-wbp-btn:hover { border-color: var(--dsh-tavern-accent-border); color: var(--dsh-tavern-accent); }\n.dsh-wbp-btn.primary { border-color: transparent; background: var(--dsh-tavern-accent); color: var(--dsw-alias-label-primary-foreground, #fff); }\n.dsh-wbp-btn.primary:disabled { cursor: default; opacity: .5; }\n.dsh-wbp-switch { position: relative; display: inline-flex; flex: none; width: 30px; height: 17px; cursor: pointer; }\n.dsh-wbp-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }\n.dsh-wbp-track { position: relative; display: block; width: 100%; height: 100%; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 38%, transparent); transition: background .16s ease; }\n.dsh-wbp-knob { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .28); transition: transform .16s ease; }\n.dsh-wbp-switch input:checked + .dsh-wbp-track { background: var(--dsh-tavern-accent); }\n.dsh-wbp-switch input:checked + .dsh-wbp-track .dsh-wbp-knob { transform: translateX(13px); }\n.dsh-wbp-switch.simple { width: 20px; height: 20px; }\n.dsh-wbp-switch.simple .dsh-wbp-track { width: 14px; height: 14px; margin: auto; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 55%, transparent); background: transparent; }\n.dsh-wbp-switch.simple .dsh-wbp-knob { top: 50%; left: 50%; width: 8px; height: 8px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 60%, transparent); transform: translate(-50%, -50%); box-shadow: none; }\n.dsh-wbp-switch.simple input:checked + .dsh-wbp-track { border-color: var(--dsh-tavern-accent); background: transparent; }\n.dsh-wbp-switch.simple input:checked + .dsh-wbp-track .dsh-wbp-knob { background: var(--dsh-tavern-accent); transform: translate(-50%, -50%); }\n.dsh-wbp-footer { display: flex; flex: none; align-items: center; gap: 5px; padding: 6px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dsh-wbp-footer-gap { flex: 1; }\n.dsh-wbp-search { flex: 1; min-width: 0; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }\n.dsh-wbp-search::placeholder { color: var(--dsw-alias-label-tertiary); }\n.dsh-wbp-search:focus { border-color: var(--dsh-tavern-accent-border); }\n.dsh-wbp-empty { padding: 20px 12px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.6; text-align: center; }\n.dsh-wbp-error { margin: 4px; padding: 7px 9px; border-radius: 6px; background: color-mix(in srgb, #c45f5f 12%, transparent); color: #b34646; font-size: 11px; line-height: 1.5; }\n.dsh-wbp-group + .dsh-wbp-group { margin-top: 4px; }\n.dsh-wbp-group-head { display: flex; justify-content: space-between; gap: 6px; width: 100%; padding: 5px 7px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; text-align: left; }\n.dsh-wbp-group-head:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-wbp-count { color: var(--dsw-alias-label-tertiary); font-weight: 400; }\n.dsh-wbp-confirm { display: inline-flex; flex: none; align-items: center; gap: 3px; }\n.dsh-wbp-confirm-text { color: #b34646; font-size: 11px; }\n.dsh-wbp-confirm-yes, .dsh-wbp-confirm-no { height: 22px; padding: 0 6px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 10px; }\n.dsh-wbp-confirm-yes { border: 1px solid transparent; background: #c45f5f; color: #fff; }\n.dsh-wbp-confirm-no { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); }\n.dsh-wbp-detail-body, .dsh-wbp-settings-body { display: flex; flex: 1; flex-direction: column; gap: 9px; min-height: 0; overflow-y: auto; padding: 9px; }\n.dsh-wbp-detail-book { color: var(--dsw-alias-label-tertiary); font-size: 10px; }\n.dsh-wbp-content { flex: 1; min-height: 160px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; resize: none; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.6; }\n.dsh-wbp-strategy { display: inline-flex; align-items: center; gap: 6px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; width: fit-content; }\n.dsh-wbp-strategy-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font-size: 12px; }\n.dsh-wbp-strategy-btn.is-active { border-color: var(--wbsw-color); color: var(--wbsw-color); background: color-mix(in srgb, var(--wbsw-color) 12%, transparent); }\n.dsh-wbp-fields { display: flex; align-items: flex-end; gap: 8px; }\n.dsh-wbp-field { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }\n.dsh-wbp-field select, .dsh-wbp-field input { height: 28px; min-width: 0; padding: 0 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }\n.dsh-wbp-field-narrow { flex: none; width: 78px; }\n.dsh-wbp-field.is-idle > span { opacity: .55; }\n.dsh-wbp-field.is-idle input, .dsh-wbp-field.is-idle select { opacity: .55; }\n.dsh-wbp-feedback { min-height: 16px; color: var(--dsw-alias-label-tertiary); font-size: 10px; }\n.dsh-wbp-section-title { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 700; letter-spacing: .04em; }\n.dsh-wbp-toggles { display: grid; gap: 2px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }\n.dsh-wbp-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }\n.dsh-wbp-rows { display: flex; gap: 8px; }\n.dsh-wbp-rows .dsh-wbp-field { flex: 1; }\n.dsh-wbp-wide-btn { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--dsh-tavern-accent-border); border-radius: 7px; background: var(--dsh-tavern-accent-soft); color: var(--dsh-tavern-accent); cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }\n.dsh-wbp-wide-btn:hover { background: color-mix(in srgb, var(--dsh-tavern-accent) 20%, transparent); }\n.dsh-wbp-wide-btn.is-compact { width: auto; flex: none; height: 28px; padding: 0 10px; font-size: 11px; }\n.dsh-wbp-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.6; }\n.dsh-wbp-inline { display: flex; align-items: center; gap: 6px; }\n.dsh-wbp-folder-name { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-folder-list { display: grid; gap: 4px; }\n.dsh-wbp-assign-list { display: grid; flex: 1; gap: 3px; min-height: 0; overflow-y: auto; }\n.dsh-wbp-assign { display: flex; align-items: center; gap: 8px; font-size: 11px; }\n.dsh-wbp-assign > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-assign select { width: 104px; height: 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; }\n.dsh-wbp-mobile-tabs { display: flex; flex: none; align-items: center; gap: 4px; padding: 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); overflow-x: auto; }\n.dsh-wbp-tab { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 11px; white-space: nowrap; }\n.dsh-wbp-tab.is-active { border-color: transparent; background: var(--dsh-tavern-accent); color: var(--dsw-alias-label-primary-foreground, #fff); }\n.dsh-wbp-tab.is-ghost { flex: none; }\n.dsh-wbp-mobile-dual { display: flex; flex: 1; min-height: 0; }\n.dsh-wbp-dual-left { display: flex; flex: none; flex-direction: column; width: 44%; min-width: 148px; border-right: 1px solid var(--dsw-alias-border-l2); overflow: hidden; }\n.dsh-wbp-dual-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }\n.dsh-wbp-editor-layer { position: fixed; inset: 0; z-index: 3100; display: flex; justify-content: center; align-items: stretch; padding: 16px; background: color-mix(in srgb, #000 42%, transparent); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); }\n.dsh-wbp-editor { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; max-width: 1100px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 24px 60px rgba(0, 0, 0, .32); }\n.dsh-wbp-editor-head { display: flex; flex: none; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dsh-wbp-editor-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }\n.dsh-wbp-editor-title { overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-editor-sub { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-wbp-editor-actions { display: inline-flex; flex: none; align-items: center; gap: 6px; }\n.dsh-wbp-editor-actions .dsh-wbp-btn { height: 30px; padding: 0 12px; font-size: 12px; }\n.dsh-wbp-toolbar { display: flex; flex: none; flex-wrap: wrap; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dsh-wbp-toolgroup { display: inline-flex; flex-wrap: wrap; gap: 3px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-wbp-tool { height: 26px; min-width: 28px; padding: 0 7px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 11px; white-space: nowrap; }\n.dsh-wbp-tool:hover { background: color-mix(in srgb, var(--dsh-tavern-accent) 14%, transparent); color: var(--dsh-tavern-accent); }\n.dsh-wbp-tool.is-active { background: var(--dsh-tavern-accent-soft); color: var(--dsh-tavern-accent); }\n.dsh-wbp-finder { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-wbp-finder-input { flex: 1 1 130px; min-width: 96px; height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }\n.dsh-wbp-finder-input:focus { border-color: var(--dsh-tavern-accent-border); }\n.dsh-wbp-finder-case { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; cursor: pointer; }\n.dsh-wbp-finder-case input { accent-color: var(--dsh-tavern-accent); }\n.dsh-wbp-finder-count { flex: none; min-width: 62px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }\n.dsh-wbp-finder-btn { flex: none; height: 26px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; font-size: 11px; }\n.dsh-wbp-finder-btn:hover { border-color: var(--dsh-tavern-accent-border); color: var(--dsh-tavern-accent); }\n.dsh-wbp-finder-btn.is-ghost { border-color: transparent; color: var(--dsw-alias-label-secondary); }\n.dsh-wbp-editor-body { display: flex; flex: 1; min-height: 0; padding: 10px 14px; }\n.dsh-wbp-editor-textarea { flex: 1; min-height: 0; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; outline: none; resize: none; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.65; }\n.dsh-wbp-editor-textarea:focus { border-color: var(--dsh-tavern-accent-border); }\n.dsh-wbp-editor-foot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; padding: 0 14px 12px; }\n.dsh-wbp-dialog-backdrop { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, #000 40%, transparent); }\n.dsh-wbp-dialog { display: flex; flex-direction: column; gap: 10px; width: min(400px, 100%); padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 16px 40px rgba(0, 0, 0, .3); }\n.dsh-wbp-dialog-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }\n.dsh-wbp-dialog select, .dsh-wbp-dialog input { height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }\n.dsh-wbp-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }\n@media (max-width: 767px) {\n  .dsh-wbp-editor-layer { padding: 0; }\n  .dsh-wbp-editor { max-width: none; max-height: none; border: 0; border-radius: 0; }\n  .dsh-wbp-toolbar { flex-wrap: nowrap; overflow-x: auto; }\n  .dsh-wbp-toolgroup { flex: 0 0 auto; flex-wrap: nowrap; }\n}\n@media (hover: none) {\n  .dsh-wbp-row-actions { opacity: 1; }\n}"
    const VARIABLES_CSS = ":root, body {\n  --dsh-tavern-accent: var(--dsw-alias-brand-primary, #4d6bfe);\n  --dsh-tavern-accent-border: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 42%, transparent);\n  --dsh-tavern-font-sans: Inter, \"Segoe UI\", system-ui, -apple-system, sans-serif;\n}"
    function installStyles() {
      if (typeof document === "undefined") return function () {}
      const existing = document.querySelector('style[data-dsh-worldbook-panel]')
      if (existing) return function () {}
      const style = document.createElement("style")
      style.dataset.dshWorldbookPanel = ""
      style.textContent = VARIABLES_CSS + "\n" + PANEL_CSS
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
			className: "dsh-wbp-icon" + (props.className ? " " + props.className : ""),
			title: props.title || "", "aria-label": props.title || "", "aria-pressed": props.pressed,
			disabled: Boolean(props.disabled),
			onClick: props.onClick
		}, h(WbIcon, { name: props.name, size: props.size, thick: props.thick }));
	}

	function WbSwitch(props) {
		const h = React.createElement;
		const style = props.style === "simple" ? " simple" : "";
		return h("label", { className: "dsh-wbp-switch" + style, title: props.title || "", onClick: function (event) { event.stopPropagation(); } },
			h("input", { type: "checkbox", checked: Boolean(props.checked), disabled: Boolean(props.disabled), onChange: function (event) { if (props.onChange) props.onChange(event.target.checked); } }),
			h("span", { className: "dsh-wbp-track", "aria-hidden": "true" }, h("span", { className: "dsh-wbp-knob" })));
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
			return h("span", { className: "dsh-wbp-confirm", onClick: function (event) { event.stopPropagation(); } },
				h("button", { type: "button", className: "dsh-wbp-confirm-yes", onClick: function (event) { event.stopPropagation(); setArmed(false); if (props.onConfirm) props.onConfirm(); } }, "确认"),
				h("button", { type: "button", className: "dsh-wbp-confirm-no", onClick: function (event) { event.stopPropagation(); setArmed(false); } }, "取消"));
		}
		return h(WbIconButton, {
			className: "dsh-wbp-danger" + (props.compact ? " compact" : ""),
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
			className: "dsh-wbp-row" + (disabled ? " is-disabled" : "") + (props.active ? " is-active" : ""),
			onClick: function () { if (props.onOpen) props.onOpen(); }
		},
			h(WbSwitch, { checked: !disabled, style: props.toggleStyle, title: disabled ? "启用条目" : "停用条目", onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-wbp-row-name", title: wbRowLabel(entry) }, wbRowLabel(entry)),
			h("span", { className: "dsh-wbp-row-actions" },
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
			className: "dsh-wbp-row dsh-wbp-frequent-row" + (entry.enabled ? "" : " is-disabled"),
			onClick: function () { if (props.onOpen) props.onOpen(); }
		},
			h(WbSwitch, { checked: entry.enabled !== false, style: props.toggleStyle, onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-wbp-row-text" },
				h("span", { className: "dsh-wbp-row-name", title: entry.name },
					visible.pin && entry.pinned ? h("span", { className: "dsh-wbp-pin-mark", "aria-hidden": "true" }, h(WbIcon, { name: "pin", size: 10 })) : null,
					entry.name),
				h("span", { className: "dsh-wbp-row-sub", title: entry.bookName }, entry.bookName)),
			h("span", { className: "dsh-wbp-row-actions" },
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
			className: "dsh-wbp-row dsh-wbp-book-row" + (props.active ? " is-active" : "") + (row.embedded ? " is-embedded" : "") + (!row.embedded && row.globalEnabled !== true ? " is-off" : ""),
			onClick: function () { if (props.onSelect) props.onSelect(); }
		},
			row.embedded ? h("span", { className: "dsh-wbp-tag", title: "人物卡内置世界书" }, "卡") :
				h(WbSwitch, { checked: row.globalEnabled === true, style: props.toggleStyle, title: row.globalEnabled ? "停用全局生效" : "全局生效", onChange: function (next) { if (props.onToggle) props.onToggle(next); } }),
			h("span", { className: "dsh-wbp-row-text" },
				h("span", { className: "dsh-wbp-row-name", title: row.name },
					visible.pin && pinned ? h("span", { className: "dsh-wbp-pin-mark", "aria-hidden": "true" }, h(WbIcon, { name: "pin", size: 10 })) : null,
					row.name),
				h("span", { className: "dsh-wbp-row-sub" }, (row.entryCount || 0) + " 条 · " + (row.enabledCount || 0) + " 启用" + (row.embedded && row.cardName ? " · " + row.cardName : ""))),
			h("span", { className: "dsh-wbp-row-actions" },
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
		return h("div", { className: "dsh-wbp-footer" },
			visible.bottomSearch ? h("input", {
				type: "search", className: "dsh-wbp-search", value: props.value,
				placeholder: props.placeholder || "搜索…", "aria-label": props.placeholder || "搜索",
				onChange: function (event) { if (props.onChange) props.onChange(event.target.value); }
			}) : h("span", { className: "dsh-wbp-footer-gap" }),
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
		return h("div", { className: "dsh-wbp-column dsh-wbp-all" },
			props.hideHead ? null : h("div", { className: "dsh-wbp-head" },
				h("span", { className: "dsh-wbp-title" }, h(WbIcon, { name: "books", size: 12 }), " 全部世界书"),
				h(WbIconButton, { name: "close", title: "关闭", onClick: props.onClose })),
			h("div", { className: "dsh-wbp-list" },
				total === 0 ? h("div", { className: "dsh-wbp-empty" }, "暂无世界书") : null,
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
					return h("section", { key: group.id, className: "dsh-wbp-group" },
						h("button", { type: "button", className: "dsh-wbp-group-head", onClick: function () { toggleFolder(group.id); } },
							h("span", null, (isCollapsed ? "▸ " : "▾ ") + group.name),
							h("span", { className: "dsh-wbp-count" }, String(group.rows.length))),
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
		return h("div", { className: "dsh-wbp-column dsh-wbp-frequent" },
			props.hideHead ? null : h("div", { className: "dsh-wbp-head" },
				h("span", { className: "dsh-wbp-title" }, h(WbIcon, { name: "star", size: 12 }), " 常用条目"),
				h(WbIconButton, { name: "close", title: "关闭", onClick: props.onClose })),
			h("div", { className: "dsh-wbp-list" },
				props.loading ? h("div", { className: "dsh-wbp-empty" }, "正在读取…") : null,
				!props.loading && rows.length === 0 ? h("div", { className: "dsh-wbp-empty" }, "暂无使用记录，开关条目后会在这里显示") : null,
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
		return h("div", { className: "dsh-wbp-column dsh-wbp-detail" },
			h("div", { className: "dsh-wbp-head" },
				h("span", { className: "dsh-wbp-title", title: wbRowLabel(entry) }, wbRowLabel(entry)),
				h("span", { className: "dsh-wbp-head-actions" },
					h(WbIconButton, { name: "expand", size: 13, title: "大窗口编辑", onClick: function () { props.onExpand(); } }),
					visible.deleteEntry ? h(WbDeleteAction, { title: "删除条目", onConfirm: props.onDelete }) : null,
					h(WbIconButton, { name: props.backLabel ? "back" : "close", title: props.backLabel || "关闭详情", onClick: props.onClose }))),
			h("div", { className: "dsh-wbp-detail-body" },
				h("div", { className: "dsh-wbp-detail-book" }, props.bookName + " · " + (entry.enabled ? "已启用" : "已停用")),
				h("textarea", { className: "dsh-wbp-content", readOnly: true, spellCheck: false, value: entry.content || "", "aria-label": "条目正文" }),
				h("div", { className: "dsh-wbp-strategy" }, WBSW_STRATEGIES.map(function (option) {
					return h("button", {
						key: option.value, type: "button",
						className: "dsh-wbp-strategy-btn" + (strategy === option.value ? " is-active" : ""),
						style: { "--wbsw-color": option.color },
						title: option.label, "aria-label": option.label, "aria-pressed": strategy === option.value,
						disabled: busy,
						onClick: function () { chooseStrategy(option.value); }
					}, option.glyph);
				})),
				h("div", { className: "dsh-wbp-fields" },
					h("label", { className: "dsh-wbp-field dsh-wbp-field-narrow" }, h("span", null, "排序"),
						h("input", {
							type: "number", step: 1, inputMode: "numeric", value: order, disabled: busy,
							title: "越大越优先入选；预算用完就停在这一条之后",
							onChange: function (event) { setOrder(event.target.value); },
							onBlur: commitOrder,
							onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }
						})),
					h("label", { className: "dsh-wbp-field dsh-wbp-field-narrow" + (busy ? " is-idle" : "") }, h("span", null, "扫描消息"),
						h("input", {
							type: "number", min: 0, max: 1000, step: 1, inputMode: "numeric", value: scanDepth, disabled: busy,
							placeholder: "跟随 " + (props.scanDepthFallback ?? 2),
							title: "关键词只在最近 N 条消息里找；留空跟随世界书默认值",
							onChange: function (event) { setScanDepth(event.target.value); },
							onBlur: commitScanDepth,
							onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }
						})),
					h("label", { className: "dsh-wbp-field" + (keywordMode ? "" : " is-idle") }, h("span", null, "二级条件"),
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
				h("p", { className: "dsh-wbp-hint" }, "常驻不看触发词、不占预算；关键词条目按排序从大到小入选，共用世界书 Token 预算，注入后 10 回合内不再自动召回。"),
				h("div", { className: "dsh-wbp-feedback", role: "status" }, feedback)));
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
		return h("div", { className: "dsh-wbp-column dsh-wbp-settings" },
			h("div", { className: "dsh-wbp-head" },
				h("span", { className: "dsh-wbp-title" }, h(WbIcon, { name: "gear", size: 12 }), " 设置"),
				h(WbIconButton, { name: props.backLabel ? "back" : "close", title: props.backLabel || "关闭设置", onClick: props.onClose })),
			h("div", { className: "dsh-wbp-settings-body" },
				h("label", { className: "dsh-wbp-field" }, h("span", null, "开关样式"),
					h("select", { value: config.toggleStyle, onChange: function (event) { patch({ toggleStyle: event.target.value === "simple" ? "simple" : "default" }); } },
						h("option", { value: "default" }, "默认"),
						h("option", { value: "simple" }, "简洁圆点"))),
				h("div", { className: "dsh-wbp-section-title" }, "显示元素"),
				h("div", { className: "dsh-wbp-toggles" },
					[["pin", "置顶"], ["deleteWorldbook", "删除世界书"], ["deleteEntry", "删除条目"], ["viewDetail", "查看详情"], ["bottomSearch", "底部搜索栏"]].map(function ([key, label]) {
						return h("label", { key: key, className: "dsh-wbp-toggle-row" },
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
				h("div", { className: "dsh-wbp-rows" },
					h("label", { className: "dsh-wbp-field" }, h("span", null, "桌面可视行数"),
						h(WbNumberField, { value: config.desktopVisibleRows, min: WBSW_MIN_ROWS, max: WBSW_MAX_ROWS, onCommit: function (next) { patch({ desktopVisibleRows: next }); } })),
					h("label", { className: "dsh-wbp-field" }, h("span", null, "手机可视行数"),
						h(WbNumberField, { value: config.mobileVisibleRows, min: WBSW_MIN_ROWS, max: WBSW_MAX_ROWS, onCommit: function (next) { patch({ mobileVisibleRows: next }); } }))),
				h("label", { className: "dsh-wbp-toggle-row" },
					h("span", null, "手机双窗口模式"),
					h(WbSwitch, { checked: config.mobileDualPane, style: "simple", title: "手机双窗口模式", onChange: function (next) { patch({ mobileDualPane: next }); } })),
				h("button", { type: "button", className: "dsh-wbp-wide-btn", onClick: props.onFolders }, h(WbIcon, { name: "folder", size: 12 }), " 世界书文件夹"),
				h("p", { className: "dsh-wbp-hint" }, "「完整」按钮打开右侧栏世界书库：编辑触发词、绑定人物卡、导入导出。")));
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
		return h("div", { className: "dsh-wbp-column dsh-wbp-folders" },
			h("div", { className: "dsh-wbp-head" },
				h("span", { className: "dsh-wbp-title" }, h(WbIcon, { name: "folder", size: 12 }), " 文件夹"),
				h(WbIconButton, { name: "back", title: "返回设置", onClick: props.onBack })),
			h("div", { className: "dsh-wbp-settings-body" },
				h("div", { className: "dsh-wbp-inline" },
					h("input", { className: "dsh-wbp-search", type: "text", value: name, placeholder: "新建文件夹名称", onChange: function (event) { setName(event.target.value); }, onKeyDown: function (event) { if (event.key === "Enter") addFolder(); } }),
					h("button", { type: "button", className: "dsh-wbp-wide-btn is-compact", onClick: addFolder }, "新建")),
				h("div", { className: "dsh-wbp-folder-list" },
					config.folders.length === 0 ? h("div", { className: "dsh-wbp-empty" }, "暂无文件夹，先创建一个。") : null,
					config.folders.map(function (folder) {
						const editing = Object.prototype.hasOwnProperty.call(renaming, folder.id);
						return h("div", { key: folder.id, className: "dsh-wbp-inline" },
							editing ? h("input", { className: "dsh-wbp-search", type: "text", autoFocus: true, value: renaming[folder.id], onChange: function (event) { setRenaming(Object.assign({}, renaming, { [folder.id]: event.target.value })); } })
								: h("span", { className: "dsh-wbp-folder-name" }, folder.name),
							editing ? h(WbIconButton, { name: "check", title: "保存名称", onClick: function () { renameFolder(folder.id); } })
								: h(WbIconButton, { name: "pencil", title: "重命名", onClick: function () { setRenaming(Object.assign({}, renaming, { [folder.id]: folder.name })); } }),
							h(WbDeleteAction, { title: "删除文件夹", compact: true, onConfirm: function () { removeFolder(folder.id); } }));
					})),
				h("div", { className: "dsh-wbp-section-title" }, "归类"),
				h("p", { className: "dsh-wbp-hint" }, "每本世界书只属于一个文件夹；删除文件夹后其中的世界书回到未归类。"),
				h("div", { className: "dsh-wbp-assign-list" },
					(props.catalog ? props.catalog.all : []).map(function (row) {
						const folderId = config.folderAssignments[row.key] || WBSW_UNFILED;
						return h("label", { key: row.key, className: "dsh-wbp-assign" },
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
		const node = h("div", { className: "dsh-wbp-editor-layer", role: "dialog", "aria-modal": "true", "aria-label": "编辑世界书条目" },
			h("div", { className: "dsh-wbp-editor" },
				h("div", { className: "dsh-wbp-editor-head" },
					h("div", { className: "dsh-wbp-editor-meta" },
						h("div", { className: "dsh-wbp-editor-title" }, wbRowLabel(entry)),
						h("div", { className: "dsh-wbp-editor-sub" }, props.bookName)),
					h("div", { className: "dsh-wbp-editor-actions" },
						h("button", { type: "button", className: "dsh-wbp-btn primary", disabled: !dirty || busy, onClick: function () { void save(); } }, busy ? "保存中…" : "保存"),
						h("button", { type: "button", className: "dsh-wbp-btn", onClick: requestClose }, "关闭"))),
				h("div", { className: "dsh-wbp-toolbar" }, tools.map(function (group, index) {
					return h("div", { key: index, className: "dsh-wbp-toolgroup" }, group.map(function ([label, action]) {
						return h("button", { key: label, type: "button", className: "dsh-wbp-tool" + (label === "查找替换" && finder.open ? " is-active" : ""), title: label, onClick: action }, label);
					}));
				})),
				finder.open ? h("div", { className: "dsh-wbp-finder", role: "search" },
					h("input", {
						ref: findInputRef, className: "dsh-wbp-finder-input", type: "text", value: finder.find,
						placeholder: "查找", "aria-label": "查找",
						onChange: function (event) { applyFinder({ find: event.target.value, message: "" }); },
						onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); findNext(); } }
					}),
					h("input", {
						className: "dsh-wbp-finder-input", type: "text", value: finder.replace,
						placeholder: "替换为", "aria-label": "替换为",
						onChange: function (event) { applyFinder({ replace: event.target.value }); },
						onKeyDown: function (event) { if (event.key === "Enter") { event.preventDefault(); replaceOne(); } }
					}),
					h("label", { className: "dsh-wbp-finder-case", title: "区分大小写" },
						h("input", { type: "checkbox", checked: finder.caseSensitive, onChange: function (event) { applyFinder({ caseSensitive: event.target.checked, message: "" }); } }),
						"区分大小写"),
					h("span", { className: "dsh-wbp-finder-count" }, finder.message || (finder.find ? "共 " + hitCount + " 处" : "")),
					h("button", { type: "button", className: "dsh-wbp-finder-btn", onClick: findNext }, "下一个"),
					h("button", { type: "button", className: "dsh-wbp-finder-btn", onClick: replaceOne }, "替换"),
					h("button", { type: "button", className: "dsh-wbp-finder-btn", onClick: replaceAll }, "全部替换"),
					h("button", { type: "button", className: "dsh-wbp-finder-btn is-ghost", title: "关闭查找替换", onClick: function () { applyFinder({ open: false, message: "" }); } }, "✕")) : null,
				h("div", { className: "dsh-wbp-editor-body" },
					h("textarea", {
						ref: areaRef, className: "dsh-wbp-editor-textarea", spellCheck: false, value: value,
						"aria-label": "条目正文", onChange: function (event) { update(event.target.value); }
					})),
				h("div", { className: "dsh-wbp-editor-foot" },
					h("span", { className: "dsh-wbp-feedback" }, feedback || (dirty ? "有未保存的修改 · Ctrl+S 保存" : "没有未保存的修改")),
					confirmClose ? h("span", { className: "dsh-wbp-confirm" },
						h("span", { className: "dsh-wbp-confirm-text" }, "有未保存的改动，确定关闭？"),
						h("button", { type: "button", className: "dsh-wbp-confirm-yes", onClick: props.onClose }, "确认"),
						h("button", { type: "button", className: "dsh-wbp-confirm-no", onClick: function () { setConfirmClose(false); } }, "取消")) : null),
				tagDialog ? h("div", { className: "dsh-wbp-dialog-backdrop" },
					h("div", { className: "dsh-wbp-dialog" },
						h("div", { className: "dsh-wbp-dialog-title" }, "标签改名"),
						h("select", { value: tagDialog.from, onChange: function (event) { setTagDialog(Object.assign({}, tagDialog, { from: event.target.value })); } },
							tagDialog.names.map(function (name) { return h("option", { key: name, value: name }, "<" + name + ">"); })),
						h("input", { type: "text", value: tagDialog.to, placeholder: "新的标签名", autoFocus: true, onChange: function (event) { setTagDialog(Object.assign({}, tagDialog, { to: event.target.value })); } }),
						h("div", { className: "dsh-wbp-dialog-actions" },
							h("button", { type: "button", className: "dsh-wbp-btn", onClick: function () { setTagDialog(null); } }, "取消"),
							h("button", { type: "button", className: "dsh-wbp-btn primary", onClick: renameTags }, "应用")))) : null));
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
				if (event.target && event.target.closest && event.target.closest(".dsh-wbp-editor-layer")) return;
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
				return h("div", { className: "dsh-wbp-column" },
					h("div", { className: "dsh-wbp-head" }, h("span", { className: "dsh-wbp-title" }, "详情"),
						h(WbIconButton, { name: backLabel ? "back" : "close", title: "关闭", onClick: function () { setPane(null); } })),
					h("div", { className: "dsh-wbp-empty" }, "正在读取条目…"));
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
			return h("div", { className: "dsh-wbp-column dsh-wbp-main" },
				h("div", { className: "dsh-wbp-head dsh-wbp-main-head" },
					compact ? null : h(WbIconButton, {
						className: allOpen ? "is-active" : "", name: "books", size: 14, title: "全部世界书",
						onClick: function () { togglePanels("all"); }
					}),
					h("select", {
						className: "dsh-wbp-select", value: currentBookKey, "aria-label": "选择世界书",
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
					compact ? null : h("button", { type: "button", className: "dsh-wbp-btn", title: "打开右侧栏完整世界书库", onClick: function () { openLibrary(book); } }, "完整"),
					compact ? null : h(WbIconButton, { name: "close", title: "关闭", onClick: closeWorldBookSwitcher })),
				h("div", { className: "dsh-wbp-list" },
					loading ? h("div", { className: "dsh-wbp-empty" }, "正在读取世界书…") : null,
					!loading && error ? h("div", { className: "dsh-wbp-error", role: "alert" }, error) : null,
					!loading && !book ? h("div", { className: "dsh-wbp-empty" }, "还没有世界书。用「完整」进入世界书库导入。") : null,
					!loading && book && entries.length === 0 ? h("div", { className: "dsh-wbp-empty" }, needle ? "没有匹配的条目" : "这本世界书还没有条目") : null,
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
				h("div", { className: "dsh-wbp-mobile-tabs" },
					tabs.map(function ([id, label]) {
						return h("button", {
							key: id, type: "button", className: "dsh-wbp-tab" + (!paneActive && tab === id ? " is-active" : ""),
							onClick: function () { setPane(null); setTab(id); }
						}, label);
					}),
					h("button", { type: "button", className: "dsh-wbp-tab is-ghost", title: "完整世界书库", onClick: function () { openLibrary(book); } }, "完整"),
					h(WbIconButton, { name: "close", title: "关闭", onClick: closeWorldBookSwitcher })),
				dual
					? h("div", { className: "dsh-wbp-mobile-dual" },
						h("div", { className: "dsh-wbp-dual-left" },
							h(WbAllPane, {
								catalog: catalog || { all: [] }, config: config, visible: config.visibleElements,
								currentKey: currentBookKey, hideHead: true,
								onSelect: function (row) { void selectRow(row); },
								onToggle: toggleWorldbook, onPin: togglePinWorldbook, onDelete: removeWorldbook,
								onCollapsed: function (list) { updateConfig({ collapsedFolders: list }); }
							})),
						h("div", { className: "dsh-wbp-dual-main" },
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
			className: "dsh-wbp-shell" + (geometry && geometry.narrow ? " is-mobile" : ""),
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
		container.className = "dsh-wbp-portal";
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
      name: "dsh-tavern-worldbook-panel",
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
            name: "dsh-tavern-worldbook-panel",
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
              { name: "conversation.session.header.utilities", id: "dsh-tavern-worldbook-panel:trigger", order: 79 },
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
