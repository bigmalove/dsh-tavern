// Shared by the isolated frame and its host. Return only unconsumed distance.
function scrollTavernTouchChain(start, distance, view) {
    let rest = distance;
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const root = node === view.document.scrollingElement;
        if (!root && !/^(auto|scroll)$/.test(style.overflowY)) continue;
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
//
// Two mutually exclusive gesture paths:
//  · native — the frame (or a scrollable descendant) pans by itself, so the browser
//    owns the stroke and this module must not touch it at all.
//  · relay  — nothing in the frame can pan (a card declaring touch-action:none, or a
//    message document sized to its content), so the distance is consumed by the
//    frame's own scrollers first and only the remainder is handed to the host.
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
        if (queuedFrame) { cancelAnimationFrame(queuedFrame); queuedFrame = 0; flushQueue(); }
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
    }
    function selected() { return Boolean(String(window.getSelection() || '')); }
    // touch-action is intersected up to the first scroll container. A blocked axis
    // means the browser will not pan this stroke at all, so it has to be relayed.
    function blockedAxis(start) {
        for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            const action = String(style.touchAction || 'auto');
            if (action === 'none' || (/pan-/.test(action) && !/pan-y|pan-up|pan-down/.test(action))) return true;
            if (node === document.scrollingElement || /^(auto|scroll)$/.test(style.overflowY)) break;
        }
        return false;
    }
    // Only a frame that can actually pan something takes the native path. A message
    // document is sized to its content, so it sits within a few pixels of its own
    // height — measured per gesture, never cached: the verdict depends on the touched
    // node and on content height, which changes while a reply streams or an image loads.
    function scrollsItself(start) {
        for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (!/^(auto|scroll)$/.test(style.overflowY)) continue;
            if (String(style.touchAction || 'auto') === 'none') continue;
            if (node.scrollHeight > node.clientHeight + 8) return true;
        }
        const root = document.scrollingElement;
        return Boolean(root && root.scrollHeight > root.clientHeight + 8);
    }
    // One message per animation frame. A fast flick delivers touchmove faster than the
    // host can scroll (and every host step is a layout), so posting per event built a
    // backlog the finger had already left — measured on a phone as "the text lags
    // behind and the flick dies almost at once".
    let queued = 0, queuedFrame = 0;
    function queue(dy) {
        queued += dy;
        if (!queuedFrame) queuedFrame = requestAnimationFrame(flushQueue);
    }
    function flushQueue() {
        queuedFrame = 0;
        const dy = queued;
        queued = 0;
        if (dy) send('dsh-tavern-frame-scroll', { dy });
    }
    // Inner scrollers always get the stroke first; the host only receives what is left.
    function move(target, dy) {
        const rest = scrollChain(target, dy, view);
        if (rest) queue(rest);
    }
    addEventListener('touchstart', event => {
        // The touch probe measures the native path; its bypass must run before any of
        // this module's bookkeeping, or the measurement includes the very code it is
        // trying to rule out.
        if (window.__dshTavernTouchProbeBypass) return;
        stop();
        sequence++;
        send('dsh-tavern-frame-touch-start');
        if (event.touches.length !== 1 || event.defaultPrevented || selected()) return;
        const target = event.target;
        // Controls and authored drag surfaces keep their own gesture semantics.
        if (!target || target.nodeType !== 1 || target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),canvas,[draggable="true"],[role="slider"]')) return;
        const touch = event.touches[0], now = performance.now();
        const relay = blockedAxis(target) || !scrollsItself(target);
        gesture = { target, id: touch.identifier, x: touch.screenX, y: touch.screenY,
            lastY: touch.screenY, started: now, lastTime: now, lastMove: now, peak: 0, active: false,
            relay, native: !relay, samples: [[now, touch.screenY]] };
        // preventDefault is only needed on the relay path, and only for this gesture:
        // a standing non-passive touchmove would make every scroll in this frame wait
        // for JS. It is added to the bubble phase on purpose — after the sampling
        // listener — so the sampler does not see its own cancellation as another
        // handler taking the touch.
        if (relay) claim = move => { if (gesture && gesture.relay) { move.preventDefault(); claimed = true } };
        if (claim) addEventListener('touchmove', claim, { passive: false });
    }, { passive: true });
    addEventListener('touchmove', event => {
        const g = gesture;
        if (!g) return;
        if (event.touches.length !== 1 || event.touches[0].identifier !== g.id || selected()) { stop(); return; }
        // Another handler cancelling the touch still owns the gesture; our own claim
        // must not be mistaken for it, or the relay would stop on its first frame.
        if (event.defaultPrevented && !claimed) { stop(); return; }
        // Native: the browser is already panning (and chaining to the host). Doing
        // anything here would apply the same stroke a second time.
        if (g.native) return;
        const touch = event.touches[0], now = performance.now();
        const dy = g.lastY - touch.screenY;
        if (!g.active) {
            const totalY = g.y - touch.screenY, totalX = g.x - touch.screenX;
            if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 6) return;
            // No wall-clock limit: after a fling the main thread can be busy for
            // hundreds of ms, so a time window rejects a deliberate second stroke.
            if (Math.abs(totalX) >= Math.abs(totalY)) { stop(); return; }
            g.active = true;
        }
        // Peak speed, not just the tail: a flick is already decelerating on release,
        // so a short trailing window reads far slower than the stroke the user made.
        const instant = dy / Math.max(1, now - g.lastMove);
        if (Math.abs(instant) > Math.abs(g.peak)) g.peak = instant;
        move(g.target, dy);
        g.lastY = touch.screenY; g.lastTime = now; g.lastMove = now;
        g.samples.push([now, touch.screenY]);
        while (g.samples.length > 2 && now - g.samples[0][0] > 100) g.samples.shift();
    }, { passive: true });
    addEventListener('touchend', () => {
        const g = gesture;
        stop();
        const now = performance.now();
        if (!g || !g.active || !g.relay || selected()) return;
        flushQueue();
        // A relayed stroke has no browser inertia of its own, so carry the speed the
        // user reached and decay like a native fling.
        const first = g.samples[0], last = g.samples[g.samples.length - 1];
        let speed = last[0] > first[0] ? (first[1] - last[1]) / (last[0] - first[0]) : 0;
        if (Math.abs(g.peak) > Math.abs(speed)) speed = g.peak;
        speed = Math.max(-6, Math.min(6, speed));
        if (Math.abs(speed) < 0.06 || now - g.lastTime > 120) return;
        let previous = now;
        const step = time => {
            animation = 0;
            if (!g.target.isConnected || document.hidden || selected() || time - now > 2400) return;
            const dt = Math.min(40, time - previous); previous = time;
            move(g.target, speed * dt);
            speed *= Math.pow(0.965, dt / 16);
            if (Math.abs(speed) > 0.015) animation = requestAnimationFrame(step);
        };
        animation = requestAnimationFrame(step);
    }, { passive: true });
    addEventListener('touchcancel', stop, { passive: true });
    addEventListener('pagehide', stop);
    addEventListener('message', event => {
        if (event.source === parent && event.data && event.data.token === token && event.data.type === 'dsh-tavern-frame-touch-stop' && event.data.sequence === sequence) stop();
    });
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
                active = { frame, token, sequence: data.sequence, contentWindow: frame.contentWindow };
                tavernTouchOwners.set(host, stop);
                host.addEventListener('touchstart', stop, { passive: true, capture: true });
                host.addEventListener('wheel', stop, { passive: true, capture: true });
            } else if (active && active.frame === frame && active.token === token && active.sequence === data.sequence && Number.isFinite(data.dy)) {
                if (!frame.isConnected) { stop(); return; }
                // Fast flicks deliver >1000px between samples on low-latency panels;
                // clamping there dropped the stroke and read as "cannot swipe fast".
                scrollTavernTouchChain(frame.parentElement, Math.max(-4000, Math.min(4000, data.dy)), host);
            }
        }
    };
}
