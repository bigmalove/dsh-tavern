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
        // At an edge the stroke keeps climbing the chain: a scroller that is already
        // at its top must not swallow the rest, or the page reads as stuck there.
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
        if (queuedFrame) { cancelAnimationFrame(queuedFrame); queuedFrame = 0; flushQueue(); }
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
    }
    // A live selection only owns the stroke when the finger is on it (handle drag /
    // extend). Treating ANY selection as a blocker meant one accidental long-press
    // during a flick left a selection behind, and every later flick was ignored —
    // measured on a phone as "only the first of several quick flicks works".
    // Outside the selection the stale ranges are dropped, so the browser's own
    // tap-to-collapse never has to run mid-stroke.
    function selectionBlocks(x, y) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !String(selection)) return false;
        try {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if ((rect.width || rect.height) && x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 12 && y <= rect.bottom + 12) return true;
            const rects = range.getClientRects();
            for (let index = 0; index < rects.length; index++) {
                const line = rects[index];
                if (x >= line.left - 12 && x <= line.right + 12 && y >= line.top - 12 && y <= line.bottom + 12) return true;
            }
        } catch (_) { /* detached range: treat as not blocking */ }
        selection.removeAllRanges();
        return false;
    }
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
            // A frame sized to its content sits within a few pixels of its own height;
            // a 1px margin flipped the verdict between gestures on real devices, and a
            // "native" verdict there means the stroke scrolls nothing at all.
            if (node.scrollHeight > node.clientHeight + 8) return true;
        }
        const root = document.scrollingElement;
        return Boolean(root && root.scrollHeight > root.clientHeight + 8);
    }
    // The document's own scroll position does not change between gestures, so a whole
    // session on one message reuses the first answer instead of re-reading layout on
    // every touchstart (each getComputedStyle in the chain can force a style pass).
    let ownVerdict = null;
    function frameScrollsItself(start) {
        if (ownVerdict === null) ownVerdict = scrollsItself(start);
        return ownVerdict;
    }
    function relay(dy) {
        if (dy) send('dsh-tavern-frame-scroll', { dy });
    }
    // One message per animation frame. A fast flick delivers touchmove faster than
    // the host can scroll (and every host step is a layout), so posting per event
    // built a backlog the finger had already left — measured on a phone as "the text
    // lags behind and the flick dies almost at once".
    let queued = 0, queuedFrame = 0;
    function queue(dy) {
        queued += dy;
        if (!queuedFrame) queuedFrame = requestAnimationFrame(flushQueue);
    }
    function flushQueue() {
        queuedFrame = 0;
        const dy = queued;
        queued = 0;
        relay(dy);
    }
    // A stroke whose touchstart could not be adopted (a handler had cancelled it, or
    // the finger landed on a control) still leaves a usable origin. Keeping it lets the
    // first touchmove adopt the stroke instead of losing the whole flick: on a phone the
    // second of two quick flicks kept landing in that gap and did nothing at all.
    let pending = null;
    function adopt(target, touch, now) {
        const own = !blockedAxis(target) && frameScrollsItself(target);
        gesture = { target, id: touch.identifier, x: touch.screenX, y: touch.screenY,
            lastY: touch.screenY, started: now, lastTime: now, lastMove: now, peak: 0, active: false,
            relay: !own, samples: [[now, touch.screenY]] };
        // Only a relay gesture needs preventDefault, and it is installed for this
        // gesture alone: a standing non-passive touchmove would make every scroll in
        // this frame wait for JS, the same slowdown the host gesture layer avoids.
        // It is added to the bubble phase on purpose — after the sampling listener —
        // so the sampler never sees its own preventDefault (which it treats as another
        // handler owning the touch) and the browser cannot chain a second, lagging
        // copy of the same drag onto the parent scroller.
        // It claims from the first move, not from the axis lock: a vertical drag inside
        // a selectable paragraph starts a text selection before the lock lands, and a
        // live selection then re-armed every later stroke as "someone else owns it".
        if (!own) claim = move => { if (gesture && gesture.relay) { move.preventDefault(); claimed = true } };
        if (claim) addEventListener('touchmove', claim, { passive: false });
    }
    addEventListener('touchstart', event => {
        stop();
        sequence++;
        send('dsh-tavern-frame-touch-start');
        pending = null;
        if (event.touches.length !== 1) return;
        const target = event.target, touch = event.touches[0], now = performance.now();
        // Controls and authored drag surfaces keep their own gesture semantics.
        if (!target || target.nodeType !== 1 || target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),canvas,[draggable="true"],[role="slider"]')) return;
        pending = { target, touch: { identifier: touch.identifier, screenX: touch.screenX, screenY: touch.screenY }, at: now };
        // A stale selection no longer blocks the stroke here: it is checked against the
        // finger in touchmove (see selectionBlocks). Blocking at touchstart made one
        // accidental selection during a flick swallow every later flick in that frame.
        if (event.defaultPrevented) return;
        adopt(target, touch, now);
    }, { passive: true });
    addEventListener('touchmove', event => {
        const moving = event.touches[0];
        if (!gesture && pending) {
            // Adopt the stroke on its first move. Do not re-check the target: a handler
            // that cancelled touchstart usually wants the scroll, not a dead page.
            if (event.touches.length === 1 && moving && moving.identifier === pending.touch.identifier) {
                adopt(pending.target, pending.touch, pending.at);
            } else { pending = null; }
        }
        const g = gesture;
        if (!g || !moving) return;
        if (event.touches.length !== 1 || moving.identifier !== g.id) { stop(); return; }
        if (selectionBlocks(moving.clientX, moving.clientY)) { stop(); return; }
        // Another handler cancelling the touch still owns the gesture; our own claim
        // must not be mistaken for it, or the relay would stop on its first frame.
        if (event.defaultPrevented && !claimed) { stop(); return; }
        const touch = event.touches[0], now = performance.now();
        const dy = g.lastY - touch.screenY;
        if (!g.active) {
            const totalY = g.y - touch.screenY, totalX = g.x - touch.screenX;
            if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 6) return;
            // No time limit here on purpose: on a phone the main thread can be busy
            // for several hundred ms after a fling (the host relayouts the whole
            // conversation), so a wall-clock window silently rejected a deliberate
            // second stroke as "too late". Direction is the only thing that matters,
            // and a long press that turns into a selection is caught before this.
            if (Math.abs(totalX) >= Math.abs(totalY)) { stop(); return; }
            g.active = true;
        }
        // Peak speed, not just the tail: a flick decelerates before release, so the
        // release window alone reads far slower than the stroke the user made.
        const instant = dy / Math.max(1, now - g.lastMove);
        if (Math.abs(instant) > Math.abs(g.peak)) g.peak = instant;
        if (g.relay) queue(dy); else scrollChain(g.target, dy, view);
        g.lastY = touch.screenY; g.lastTime = now; g.lastMove = now;
        g.samples.push([now, touch.screenY]);
        while (g.samples.length > 2 && now - g.samples[0][0] > 100) g.samples.shift();
    }, { passive: true });
    addEventListener('touchend', () => {
        const g = gesture;
        stop();
        const now = performance.now();
        if (!g || !g.active || !g.relay) return;
        flushQueue();
        // A relay has no browser inertia of its own. Carry the stroke at the speed the
        // user actually reached (peak, unless the tail is faster) and decay like a
        // native fling: ~0.6 s to half speed, ~2 s to a stop.
        const first = g.samples[0], last = g.samples[g.samples.length - 1];
        let speed = last[0] > first[0] ? (first[1] - last[1]) / (last[0] - first[0]) : 0;
        if (Math.abs(g.peak) > Math.abs(speed)) speed = g.peak;
        speed = Math.max(-6, Math.min(6, speed));
        if (Math.abs(speed) < 0.06 || now - g.lastTime > 120) return;
        let previous = now;
        const step = time => {
            animation = 0;
            // A selection that the user made DURING the fling ends it; a selection that
            // merely survived from before does not (that froze the fling outright).
            if (!g.target.isConnected || document.hidden || time - now > 2400) return;
            const dt = Math.min(40, time - previous); previous = time;
            queue(speed * dt);
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

// The host's scrollable ancestors of a frame, resolved once per gesture: the old
// path ran getComputedStyle across the chain on every touchmove and capped each
// step at 1000px, which is what made a fast flick feel like it hit a wall.
function resolveTavernScrollChain(start, view) {
    const chain = [];
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const root = node === view.document.scrollingElement;
        if (root || /^(auto|scroll|overlay)$/.test(style.overflowY)) chain.push({ node });
    }
    return chain;
}

function applyTavernScrollChain(chain, distance) {
    let rest = distance;
    for (const item of chain) {
        const node = item.node;
        if (node.scrollHeight > node.clientHeight) {
            const before = node.scrollTop;
            // Direct scrollTop assignment: no options object, so old WebViews cannot
            // fall back to a smooth animation, and no read-back is needed for a clamp.
            node.scrollTop = before + rest;
            rest -= node.scrollTop - before;
            if (Math.abs(rest) < 0.01) return 0;
        }
        // At an edge the stroke keeps climbing the chain: a scroller that is already
        // at its top must not swallow the rest, or the page reads as stuck there.
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
