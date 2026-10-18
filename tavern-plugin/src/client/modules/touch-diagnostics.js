// Real-device scroll diagnosis. The frame is an opaque origin, so the host cannot
// look inside it: it asks every message frame to run a probe, records what the
// conversation scroller does during the same stroke, and merges the two reports.
// Nothing here runs unless the user opens the diagnostic from settings.
function tavernScrollableAncestor(start, view) {
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
        if (node.scrollHeight > node.clientHeight) return node;
    }
    return null;
}

function tavernTouchReportText(report) {
    const lines = [];
    const frame = report.frame || {};
    const gesture = frame.gesture || {};
    lines.push('DSH Tavern 滑动诊断');
    lines.push('时间：' + new Date(report.at).toISOString());
    lines.push('UA：' + String(frame.userAgent || report.userAgent || '未知'));
    lines.push('视口：' + (frame.viewport ? frame.viewport.width + '×' + frame.viewport.height : '未知'));
    lines.push('');
    lines.push('【结论】');
    lines.push(report.verdict);
    lines.push('');
    lines.push('【同一笔手势内的位移】');
    lines.push('会话容器：' + report.host.delta + 'px（' + report.host.before + ' → ' + report.host.after + '）');
    lines.push('消息帧内：' + (gesture.endScrollTop - gesture.startScrollTop) + 'px（' + gesture.startScrollTop + ' → ' + gesture.endScrollTop + '）');
    lines.push('帧内 scroll 事件：' + (gesture.scrollEvents ?? '未知'));
    lines.push('touchmove 次数：' + (gesture.moves ?? '未知') + '，被 preventDefault：' + (gesture.cancelled ?? '未知'));
    lines.push('手势时长：' + (gesture.durationMs ?? '未知') + 'ms，触点：' + (gesture.target || '未知'));
    lines.push('存在选区：' + (gesture.selection ? '是' : '否'));
    lines.push('');
    lines.push('【帧文档】');
    if (frame.document) lines.push('scrollHeight ' + frame.document.scrollHeight + ' / clientHeight ' + frame.document.clientHeight + (frame.document.scrollHeight > frame.document.clientHeight + 8 ? '（帧内可滚）' : '（帧内不可滚）'));
    else lines.push('未取到');
    lines.push('');
    lines.push('【触点链样式（从里到外）】');
    for (const item of gesture.chain || []) {
        lines.push('· ' + item.node + '  overflow-y:' + item.overflowY + '  touch-action:' + item.touchAction
            + '  overscroll-y:' + item.overscrollBehaviorY + '  ' + item.scrollHeight + '/' + item.clientHeight);
    }
    lines.push('');
    lines.push('【环境】');
    lines.push('已连接消息帧：' + report.frames + '（应答 ' + report.answered + '），本次手势来自第 ' + report.frameIndex + ' 帧');
    lines.push('当前卡：' + (report.card || '无'));
    lines.push('宿主容器：' + report.host.node + '  ' + report.host.scrollHeight + '/' + report.host.clientHeight);
    return lines.join('\n');
}

function showTavernTouchReport(text) {
    const dialog = document.createElement('dialog');
    dialog.className = 'dsh-tavern-prompt';
    dialog.setAttribute('aria-label', '滑动诊断结果');
    const panel = document.createElement('div');
    panel.className = 'dsh-tavern-prompt-panel';
    panel.style.maxWidth = 'min(92vw, 560px)';
    const title = document.createElement('div');
    title.className = 'dsh-tavern-prompt-title';
    title.textContent = '滑动诊断结果';
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.rows = 16;
    area.style.width = '100%';
    area.style.font = '12px/1.5 ui-monospace, monospace';
    area.style.resize = 'vertical';
    const actions = document.createElement('div');
    actions.className = 'dsh-tavern-prompt-actions';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'dsh-tavern-btn primary'; copy.textContent = '复制';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'dsh-tavern-btn'; close.textContent = '关闭';
    copy.addEventListener('click', () => {
        area.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
        if (!copied && navigator.clipboard) navigator.clipboard.writeText(area.value).then(() => { copy.textContent = '已复制'; }, () => { copy.textContent = '请手动复制'; });
        else copy.textContent = '已复制';
    });
    close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
    actions.append(copy, close);
    panel.append(title, area, actions);
    dialog.append(panel);
    (document.querySelector('.dsh-tavern-dock') || document.body).append(dialog);
    dialog.showModal();
}

async function runTavernTouchDiagnostics(host, onStatus) {
    const status = typeof onStatus === 'function' ? onStatus : () => {};
    function messageFrames() {
        const marked = Array.from(host.document.querySelectorAll('iframe.dsh-tavern-message-frame'));
        // Older builds and the browser fixtures do not set the class; fall back to every
        // frame so the diagnostic still works, just with more noise.
        return (marked.length ? marked : Array.from(host.document.querySelectorAll('iframe')))
            .filter(frame => frame.isConnected);
    }
    let frames = messageFrames();
    if (!frames.length) return { ok: false, message: '当前页面没有消息帧，请打开一局对话后再试。' };

    // Every armed frame gets its own token, and EVERY report is accepted: the user may
    // drag any message, not the first frame that happened to answer. Waiting on one
    // chosen frame was why a slow drag on one message produced nothing while a fast
    // repeated drag (crossing the chosen frame) eventually did.
    const tokens = new Map();
    const byToken = new Map();
    function arm(frame) {
        if (tokens.has(frame)) return;
        const token = 'probe-' + Math.random().toString(36).slice(2, 10);
        tokens.set(frame, token);
        byToken.set(token, frame);
        try { frame.contentWindow.postMessage({ type: 'dsh-tavern-touch-probe-arm', probeToken: token }, '*'); } catch (_) { /* frame gone */ }
    }
    for (const frame of frames) arm(frame);

    const ready = new Set();
    const readyListener = event => {
        const data = event.data;
        if (!data || data.type !== 'dsh-tavern-touch-probe-ready') return;
        const frame = byToken.get(data.probeToken);
        if (frame) ready.add(frame);
    };
    host.addEventListener('message', readyListener);
    let collecting = true;
    const readyTimer = host.setInterval(() => {
        if (!collecting) return;
        // Frames that lazy-load while the user is scrolling still need arming, and an
        // arm posted before a frame's document parsed is silently dropped — re-arm until
        // that frame answers.
        for (const frame of messageFrames()) if (!tokens.has(frame) || !ready.has(frame)) { tokens.delete(frame); arm(frame); }
    }, 1500);

    // The conversation scroller is shared by every message, so one lookup is enough and
    // it must happen before the stroke: after it, the start position is gone.
    const anchor = frames[0];
    const scroller = tavernScrollableAncestor(anchor.parentElement, host) || host.document.scrollingElement;
    const startTop = scroller ? scroller.scrollTop : 0;
    let far = startTop, last = startTop;
    const sampler = host.setInterval(() => {
        if (!scroller) return;
        last = scroller.scrollTop;
        if (Math.abs(last - startTop) > Math.abs(far - startTop)) far = last;
    }, 16);

    await new Promise(resolve => host.setTimeout(resolve, 300));
    status(ready.size
        ? '已连接 ' + ready.size + ' 条消息，请在那条划不动的正文上拖一笔'
        : '正在连接消息帧，请稍候再拖');

    const report = await new Promise(resolve => {
        let settled = false;
        const finish = value => { if (settled) return; settled = true; resolve(value); };
        const listener = event => {
            const data = event.data;
            if (!data || data.type !== 'dsh-tavern-touch-probe-report') return;
            const frame = byToken.get(data.probeToken);
            if (!frame) return;
            // Give the momentum a moment to land before reading the final position.
            host.setTimeout(() => finish({ frame: data, frameElement: frame, index: frames.indexOf(frame) }), 350);
        };
        host.addEventListener('message', listener);
        // Long enough for a deliberate, slow stroke; the old 20s window expired while the
        // user was still reading the "drag now" hint.
        host.setTimeout(() => finish({ frame: null, frameElement: null, index: -1 }), 60000);
        host.setTimeout(() => host.removeEventListener('message', listener), 61000);
    });
    collecting = false;
    host.clearInterval(readyTimer);
    host.clearInterval(sampler);
    host.removeEventListener('message', readyListener);
    if (!report.frame) {
        for (const [frame, token] of tokens) {
            try { frame.contentWindow.postMessage({ type: 'dsh-tavern-touch-probe-cancel', probeToken: token }, '*'); } catch (_) { /* gone */ }
        }
        return { ok: false, message: '60 秒内没有等到手势。请确认已打开对话，并直接在那条划不动的正文上拖一笔（不是侧栏）。' };
    }

    const after = scroller ? scroller.scrollTop : 0;
    const gesture = report.frame.gesture || {};
    const frameMoved = (gesture.endScrollTop || 0) - (gesture.startScrollTop || 0);
    const frameCanScroll = report.frame.document ? report.frame.document.scrollHeight > report.frame.document.clientHeight + 8 : false;
    // Peak displacement, not the end position: a slow drag that springs back would
    // otherwise read as zero.
    const drag = far - startTop;
    let verdict;
    if (!gesture.moves) verdict = '这一笔没有产生 touchmove（位移小于浏览器的滑动阈值，或触点落在不可滚动区域）。请拖得更长一些再测一次。';
    else if (Math.abs(drag) > 8) verdict = '原生滚动生效：会话容器位移了 ' + drag + 'px，浏览器链路正常。';
    else if (Math.abs(frameMoved) > 8) verdict = '位移被帧内吃掉了 ' + frameMoved + 'px，没有传给会话容器（帧内可滚=' + frameCanScroll + '）。';
    else if (gesture.cancelled > 0) verdict = '手势被 preventDefault 取消了 ' + gesture.cancelled + ' 次，页面脚本拦住了滚动。';
    else verdict = '这一笔既没滚会话容器也没滚帧内（touchmove ' + (gesture.moves || 0) + ' 次）：看下面触点链的 touch-action / overscroll-behavior。';
    const text = tavernTouchReportText({
        at: Date.now(), verdict, frame: report.frame,
        answered: ready.size, frames: tokens.size, frameIndex: report.index + 1,
        userAgent: host.navigator.userAgent, card: document.querySelector('[data-dsh-tavern-card-name]')?.getAttribute('data-dsh-tavern-card-name') || '',
        host: { delta: drag, before: startTop, after,
            node: scroller ? String(scroller.tagName || '').toLowerCase() + (scroller.id ? '#' + scroller.id : '') : '未找到',
            scrollHeight: scroller ? scroller.scrollHeight : 0, clientHeight: scroller ? scroller.clientHeight : 0 },
    });
    showTavernTouchReport(text);
    return { ok: true, text };
}
