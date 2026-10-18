// Shared by the isolated frame and its host. Return only unconsumed distance.
function scrollTavernTouchChain(start, distance, view) {
    let rest = distance;
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const root = node === view.document.scrollingElement;
        if (!root && !/^(auto|scroll|overlay)$/.test(style.overflowY)) continue;
        const max = Math.max(0, node.scrollHeight - node.clientHeight);
        if (max > 0) {
            const before = node.scrollTop;
            // Explicit instant behavior avoids the card/host's scroll-behavior:smooth.
            node.scrollTo({ top: Math.max(0, Math.min(max, before + rest)), behavior: 'instant' });
            rest -= node.scrollTop - before;
            if (Math.abs(rest) < 0.01) return 0;
        }
        if (/^(contain|none)$/.test(style.overscrollBehaviorY)) return 0;
    }
    return rest;
}

// Serialized into the message document; keep dependencies explicit.
function installTavernFrameTouch(token, scrollChain) {
    const view = { document, getComputedStyle: node => getComputedStyle(node) };
    let gesture = null, animation = 0, sequence = 0, claim = null, claimed = false;
    const send = (type, extra) => parent.postMessage(Object.assign({ type, token, sequence }, extra), '*');
    function releaseClaim() {
        if (claim) removeEventListener('touchmove', claim);
        claim = null;
    }
    function stop() {
        gesture = null;
        claimed = false;
        releaseClaim();
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
    }
    function selected() { return Boolean(String(window.getSelection() || '')); }
    function blockedAxis(start) {
        // touch-action is intersected up to the first scroll container.
        for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            const action = String(style.touchAction || 'auto');
            if (action === 'none' || (/pan-/.test(action) && !/pan-y|pan-up|pan-down/.test(action))) return true;
            if (node === document.scrollingElement || /^(auto|scroll|overlay)$/.test(style.overflowY)) break;
        }
        return false;
    }
    // A frame that cannot scroll itself has no native gesture to hand the touch back
    // to: the message document is sized to its content, so the parent conversation is
    // the only scroller. Without a relay a drag started on the prose moves nothing
    // (browsers do not chain a sandboxed frame's pan to the parent document), which is
    // exactly the "imported text scrolls, generated prose does not" report — imported
    // replies render as host markdown, generated ones render inside this frame.
    function scrollsItself(start) {
        for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (!/^(auto|scroll|overlay)$/.test(style.overflowY)) continue;
            if (String(style.touchAction || 'auto') === 'none') continue;
            if (node.scrollHeight > node.clientHeight + 1) return true;
        }
        const root = document.scrollingElement;
        return Boolean(root && root.scrollHeight > root.clientHeight + 1);
    }
    function relay(dy) {
        if (dy) send('dsh-tavern-frame-scroll', { dy });
    }
    addEventListener('touchstart', event => {
        stop();
        sequence++;
        send('dsh-tavern-frame-touch-start');
        if (event.touches.length !== 1 || event.defaultPrevented || selected()) return;
        const target = event.target;
        // Controls and authored drag surfaces keep their own gesture semantics.
        if (!target || target.nodeType !== 1 || target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),canvas,[draggable="true"],[role="slider"]')) return;
        const touch = event.touches[0], now = performance.now();
        const own = !blockedAxis(target) && scrollsItself(target);
        gesture = { target, id: touch.identifier, x: touch.screenX, y: touch.screenY,
            lastY: touch.screenY, started: now, lastTime: now, active: false,
            relay: !own, samples: [[now, touch.screenY]] };
        // Only a relay gesture needs preventDefault, and it is installed for this
        // gesture alone: a standing non-passive touchmove would make every scroll in
        // this frame wait for JS, the same slowdown the host gesture layer avoids.
        // It is added to the bubble phase on purpose — after the sampling listener —
        // so the sampler never sees its own preventDefault (which it treats as another
        // handler owning the touch) and the browser cannot chain a second, lagging
        // copy of the same drag onto the parent scroller.
        if (!own) claim = move => { if (gesture && gesture.relay) { move.preventDefault(); claimed = true } };
        if (claim) addEventListener('touchmove', claim, { passive: false });
    }, { passive: true });
    addEventListener('touchmove', event => {
        const g = gesture;
        if (!g) return;
        if (event.touches.length !== 1 || event.touches[0].identifier !== g.id || selected()) { stop(); return; }
        // Another handler cancelling the touch still owns the gesture; our own claim
        // must not be mistaken for it, or the relay would stop on its first frame.
        if (event.defaultPrevented && !claimed) { stop(); return; }
        const touch = event.touches[0], now = performance.now();
        const dy = g.lastY - touch.screenY;
        if (!g.active) {
            const totalY = g.y - touch.screenY, totalX = g.x - touch.screenX;
            if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 6) return;
            if (now - g.started > 350 || Math.abs(totalX) >= Math.abs(totalY)) { stop(); return; }
            g.active = true;
        }
        if (g.relay) relay(dy); else scrollChain(g.target, dy, view);
        g.lastY = touch.screenY; g.lastTime = now;
        g.samples.push([now, touch.screenY]);
        while (g.samples.length > 2 && now - g.samples[0][0] > 80) g.samples.shift();
    }, { passive: true });
    addEventListener('touchend', () => {
        const g = gesture;
        stop();
        const now = performance.now();
        if (!g || !g.active || !g.relay || selected() || now - g.lastTime > 80) return;
        const first = g.samples[0], last = g.samples[g.samples.length - 1];
        if (last[0] <= first[0]) return;
        // A relay has no browser inertia of its own, so carry the release speed the
        // way a native fling would: ~2-4px/ms for a fast flick, easing out over 1.4s.
        let speed = Math.max(-4, Math.min(4, (first[1] - last[1]) / (last[0] - first[0])));
        if (Math.abs(speed) < 0.05) return;
        let previous = now;
        const step = time => {
            animation = 0;
            if (!g.target.isConnected || document.hidden || selected() || time - now > 1400) return;
            const dt = Math.min(32, time - previous); previous = time;
            relay(speed * dt);
            speed *= Math.pow(0.945, dt / 16);
            if (Math.abs(speed) > 0.02) animation = requestAnimationFrame(step);
        };
        animation = requestAnimationFrame(step);
    }, { passive: true });
    addEventListener('touchcancel', stop, { passive: true });
    addEventListener('pagehide', stop);
    addEventListener('message', event => {
        if (event.source === parent && event.data && event.data.token === token && event.data.type === 'dsh-tavern-frame-touch-stop' && event.data.sequence === sequence) stop();
    });
}

// The host's scrollable ancestors of a frame, resolved once per gesture: the old
// path ran getComputedStyle across the chain on every touchmove and capped each
// step at 1000px, which is what made a fast flick feel like it hit a wall.
function resolveTavernScrollChain(start, view) {
    const chain = [];
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const contains = /^(contain|none)$/.test(style.overscrollBehaviorY);
        const root = node === view.document.scrollingElement;
        if (root || /^(auto|scroll|overlay)$/.test(style.overflowY)) chain.push({ node, contains });
        else if (contains) break;
    }
    return chain;
}

function applyTavernScrollChain(chain, distance) {
    let rest = distance;
    for (const item of chain) {
        const node = item.node;
        const max = Math.max(0, node.scrollHeight - node.clientHeight);
        if (max > 0) {
            const before = node.scrollTop;
            node.scrollTo({ top: Math.max(0, Math.min(max, before + rest)), behavior: 'instant' });
            rest -= node.scrollTop - before;
            if (Math.abs(rest) < 0.01) return 0;
        }
        if (item.contains) return 0;
    }
    return rest;
}

// At most one manually scrolling frame per host; no persistent global listeners.
const tavernTouchOwners = new WeakMap();
function createTavernTouchRelay(host) {
    let active = null;
    function stop() {
        if (active) active.contentWindow.postMessage({ type: 'dsh-tavern-frame-touch-stop', token: active.token, sequence: active.sequence }, '*');
        active = null;
        if (tavernTouchOwners.get(host) === stop) tavernTouchOwners.delete(host);
        host.removeEventListener('touchstart', stop, true);
        host.removeEventListener('wheel', stop, true);
    }
    return {
        stop,
        receive(frame, token, data) {
            if (data.type === 'dsh-tavern-frame-touch-start') {
                const previous = tavernTouchOwners.get(host);
                if (previous) previous();
                active = { frame, token, sequence: data.sequence, contentWindow: frame.contentWindow, chain: null };
                tavernTouchOwners.set(host, stop);
                host.addEventListener('touchstart', stop, { passive: true, capture: true });
                host.addEventListener('wheel', stop, { passive: true, capture: true });
            } else if (active && active.frame === frame && active.token === token && active.sequence === data.sequence && Number.isFinite(data.dy)) {
                if (!frame.isConnected) { stop(); return; }
                if (active.chain === null) active.chain = resolveTavernScrollChain(frame.parentElement, host);
                // Fast flicks deliver >1000px between samples on low-latency panels;
                // clamping there dropped the stroke and read as "cannot swipe fast".
                applyTavernScrollChain(active.chain, Math.max(-4000, Math.min(4000, data.dy)));
            }
        }
    };
}
