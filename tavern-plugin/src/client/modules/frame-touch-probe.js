// Serialized into the message document, next to installTavernFrameTouch.
//
// Answers what the frame alone can see about one real stroke: the style chain under
// the finger, whether this document actually moved, and whether anything cancelled
// the touch. The host adds the one thing the frame cannot see — how far the
// conversation scroller moved. Armed on demand only; the listeners exist while a
// measurement is running, so a normal scroll pays nothing.
function installTavernTouchProbe(token) {
    let session = null;
    function styles(node) {
        const style = getComputedStyle(node);
        return {
            node: String(node.tagName || '').toLowerCase() + (node.id ? '#' + node.id : ''),
            overflowY: style.overflowY,
            touchAction: style.touchAction,
            overscrollBehaviorY: style.overscrollBehaviorY,
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
        };
    }
    function chain(start) {
        const out = [];
        // No cap: a real device report stopped at 10 nodes and never reached body, which
        // is exactly where the blocking touch-action lived.
        for (let node = start; node && node.nodeType === 1 && out.length < 24; node = node.parentElement) out.push(styles(node));
        const add = (node, name) => { if (node && out.length < 26 && !out.some(item => item.node === name)) out.push(Object.assign(styles(node), { node: name })); };
        add(document.body, 'body');
        add(document.documentElement, 'html');
        add(document.scrollingElement, 'scrollingElement');
        return out;
    }
    function detach() {
        removeEventListener('scroll', onScroll, { capture: true });
        removeEventListener('touchstart', onStart, { capture: true });
        removeEventListener('touchmove', onMove, { capture: true });
        removeEventListener('touchend', onEnd, { capture: true });
        removeEventListener('touchcancel', onEnd, { capture: true });
    }
    function stop() {
        const current = session;
        if (!current) return;
        session = null;
        window.__dshTavernTouchProbeBypass = false;
        detach();
        if (!current.chain) return;
        const root = document.scrollingElement;
        parent.postMessage({
            type: 'dsh-tavern-touch-probe-report', probeToken: current.probeToken,
            gesture: {
                moves: current.moves,
                cancelled: current.cancelled,
                scrollEvents: current.scrollEvents,
                startScrollTop: current.startScrollTop,
                endScrollTop: root ? root.scrollTop : 0,
                durationMs: Math.round(performance.now() - current.startedAt),
                chain: current.chain,
                target: current.target,
                selection: Boolean(String(window.getSelection() || '')),
            },
            document: root ? { scrollHeight: root.scrollHeight, clientHeight: root.clientHeight } : null,
            viewport: { width: innerWidth, height: innerHeight },
            userAgent: navigator.userAgent,
            // Values this build had to override to make panning possible again.
            rootTouchAction: window.__dshTavernRootTouchAction || null,
        }, '*');
    }
    function onScroll() { if (session) session.scrollEvents += 1; }
    function onStart(event) {
        if (!session) return;
        session.startedAt = performance.now();
        session.chain = chain(event.target);
        session.target = String(event.target && event.target.tagName || '').toLowerCase();
        const root = document.scrollingElement;
        session.startScrollTop = root ? root.scrollTop : 0;
        session.moves = 0;
        session.cancelled = 0;
        session.scrollEvents = 0;
    }
    function onMove(event) {
        if (!session || !session.chain) return;
        session.moves += 1;
        if (event.defaultPrevented) session.cancelled += 1;
    }
    function onEnd() {
        if (!session || !session.chain) return;
        // Momentum arrives after the finger lifts; wait for it before reporting.
        setTimeout(stop, 400);
    }
    addEventListener('message', event => {
        if (event.source !== parent || !event.data) return;
        if (event.data.type === 'dsh-tavern-touch-probe-arm') {
            // Bypass this module's own handlers so the stroke reaches the browser untouched.
            window.__dshTavernTouchProbeBypass = true;
            session = { startedAt: performance.now(), moves: 0, cancelled: 0, scrollEvents: 0, startScrollTop: 0, chain: null, probeToken: String(event.data.probeToken || '') };
            addEventListener('scroll', onScroll, { capture: true, passive: true });
            addEventListener('touchstart', onStart, { capture: true, passive: true });
            addEventListener('touchmove', onMove, { capture: true, passive: true });
            addEventListener('touchend', onEnd, { capture: true, passive: true });
            addEventListener('touchcancel', onEnd, { capture: true, passive: true });
            parent.postMessage({ type: 'dsh-tavern-touch-probe-ready', probeToken: session.probeToken }, '*');
        }
        if (event.data.type === 'dsh-tavern-touch-probe-finish') stop();
        if (event.data.type === 'dsh-tavern-touch-probe-cancel') {
            session = null;
            window.__dshTavernTouchProbeBypass = false;
            detach();
        }
    });
}
