/*
 * Pannable time tape: a strip of time ticks that slides under a fixed center
 * playhead. Drag/swipe (with glide), trackpad/mouse wheel, or tap to move it;
 * it settles on whole time steps and stops hard at either end.
 *
 * Positions are step indices 0..max (fractional while moving). The tape calls
 * onScrub(index) whenever the step under the playhead changes.
 */

const TAPE_FRICTION = 0.995;     // velocity multiplier per ms while gliding
const TAPE_MIN_SPEED = 0.025;    // px/ms below which a glide settles
const TAPE_TAP_SLOP = 4;         // px of movement still counted as a tap

const fmtHourShort = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, hour: "numeric" });

class TimeTape {
    // opts: { pxPerStep, stepSeconds() -> seconds per step, timeAt(p) -> epoch sec | null,
    //         bandAt(p) -> "loaded" | "gap" | null, onScrub(p), onUserStart() }
    constructor(el, opts) {
        this.el = el;
        this.opts = opts;
        this.px = opts.pxPerStep;
        this.canvas = el.querySelector("canvas");
        this.pos = 0;
        this.max = 0;
        this._last = null;   // last index reported via onScrub
        this._raf = null;    // glide/tween animation
        this._frame = null;  // coalesced render for pointer/wheel input
        this._bindInput();
        window.addEventListener("resize", () => this.render());
    }

    // Doesn't report a change; follow with setPosition to pick the starting step
    setScale(pxPerStep) {
        this.px = pxPerStep;
        this.render();
    }

    setMax(max) {
        this.max = Math.max(0, max);
        this.pos = this._clamp(this.pos);
        this.render();
    }

    // Move to step p, instantly or animated over `ms` ("linear" for playback, "out" to settle)
    setPosition(p, { ms = 0, ease = "out" } = {}) {
        this._stopMotion();
        const target = this._clamp(p);
        if (ms <= 0 || target === this.pos) return this._apply(target);
        const from = this.pos, start = performance.now();
        const easing = ease === "linear" ? k => k : k => 1 - Math.pow(1 - k, 3);
        const frame = now => {
            const k = Math.min(1, (now - start) / ms);
            this._apply(from + (target - from) * easing(k));
            this._raf = k < 1 ? requestAnimationFrame(frame) : null;
        };
        this._raf = requestAnimationFrame(frame);
    }

    _clamp(p) {
        return Math.min(this.max, Math.max(0, p));
    }

    // Set position, redraw, and report the step under the playhead if it changed
    _apply(p) {
        this.pos = this._clamp(p);
        this.render();
        const index = Math.round(this.pos);
        if (index !== this._last) {
            this._last = index;
            this.opts.onScrub(index);
        }
    }

    // Pointer events can outpace the display; apply at most once per frame
    _applySoon(p) {
        this.pos = this._clamp(p);
        if (!this._frame) {
            this._frame = requestAnimationFrame(() => {
                this._frame = null;
                this._apply(this.pos);
            });
        }
    }

    _stopMotion() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        clearTimeout(this._wheelTimer);
    }

    _settle() {
        this.setPosition(Math.round(this.pos), { ms: 150 });
    }

    _glide(v) {
        let last = performance.now();
        const frame = now => {
            const dt = now - last;
            last = now;
            this._apply(this.pos + v * dt);
            v *= Math.pow(TAPE_FRICTION, dt);
            if (this.pos <= 0 || this.pos >= this.max) v = 0;  // hard stop at the ends
            if (Math.abs(v * this.px) < TAPE_MIN_SPEED) {
                this._raf = null;
                return this._settle();
            }
            this._raf = requestAnimationFrame(frame);
        };
        this._raf = requestAnimationFrame(frame);
    }

    _bindInput() {
        const el = this.el;
        let drag = null;

        el.addEventListener("pointerdown", e => {
            this._stopMotion();
            this.opts.onUserStart?.();
            try {
                el.setPointerCapture(e.pointerId);
            } catch { /* capture is a nicety; dragging still works without it */ }
            drag = { x: e.clientX, pos: this.pos, moved: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
        });

        el.addEventListener("pointermove", e => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            if (Math.abs(dx) > TAPE_TAP_SLOP) drag.moved = true;
            if (!drag.moved) return;
            this._applySoon(drag.pos - dx / this.px);
            drag.samples.push({ t: e.timeStamp, x: e.clientX });
            while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
        });

        const end = (e, cancelled) => {
            if (!drag) return;
            const d = drag;
            drag = null;
            if (!d.moved) {
                if (cancelled) return;
                // Tap: bring the tapped time under the playhead
                const rect = el.getBoundingClientRect();
                const tapped = this.pos + (e.clientX - rect.left - rect.width / 2) / this.px;
                return this.setPosition(Math.round(tapped), { ms: 200 });
            }
            const first = d.samples[0], dt = e.timeStamp - first.t;
            const v = dt > 0 ? -(e.clientX - first.x) / this.px / dt : 0;  // steps per ms
            if (Math.abs(v * this.px) > TAPE_MIN_SPEED * 4) this._glide(v);
            else this._settle();
        };
        el.addEventListener("pointerup", e => end(e, false));
        el.addEventListener("pointercancel", e => end(e, true));

        el.addEventListener("wheel", e => {
            e.preventDefault();
            this._stopMotion();
            this.opts.onUserStart?.();
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            const unit = e.deltaMode === 1 ? 16 : 1;  // some mice report lines, not pixels
            this._applySoon(this.pos + (d * unit) / this.px);
            this._wheelTimer = setTimeout(() => this._settle(), 120);
        }, { passive: false });
    }

    render() {
        const { canvas, px } = this;
        const w = this.el.clientWidth, h = this.el.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const X = p => cx + (p - this.pos) * px;
        const p0 = Math.max(0, Math.floor(this.pos - cx / px) - 1);
        const p1 = Math.min(this.max, Math.ceil(this.pos + cx / px) + 1);
        const bandY = h - 6, tickBase = h - 11;

        // Data band: what's loaded, and gaps with no data
        for (let p = p0; p <= Math.min(p1, this.max - 1); p++) {
            const band = this.opts.bandAt(p);
            ctx.fillStyle = band === "loaded" ? "rgba(56, 189, 248, 0.55)"
                : band === "gap" ? "rgba(248, 113, 113, 0.6)"
                : "rgba(255, 255, 255, 0.08)";
            ctx.fillRect(X(p) - px / 2, bandY, px, 4);
        }

        // Day name of the left edge stays pinned until the next midnight pushes it off
        ctx.font = "600 14px Inter, sans-serif";
        ctx.textBaseline = "top";
        const leftT = this.opts.timeAt(Math.max(0, Math.min(this.max, Math.round(this.pos - cx / px))));
        let pinnedRight = 0;
        if (leftT != null) {
            const label = fmtDayShort.format(leftT * 1000);
            const lw = ctx.measureText(label).width;
            let nextMidnightX = Infinity;
            for (let p = p0; p <= p1; p++) {
                const t = this.opts.timeAt(p);
                if (t != null && isMidnight(t) && X(p) > 2) { nextMidnightX = X(p); break; }
            }
            const lx = Math.min(8, nextMidnightX - lw - 12);
            ctx.fillStyle = "#f8fafc";
            ctx.fillText(label, lx, 5);
            pinnedRight = lx + lw;
        }

        // Ticks and labels; hour labels every hour if there's room, else every 3 hours
        const labelEvery = (3600 / this.opts.stepSeconds()) * px >= 55 ? 1 : 3;
        for (let p = p0; p <= p1; p++) {
            const t = this.opts.timeAt(p);
            if (t == null) continue;
            const x = Math.round(X(p)) + 0.5;
            if (p === this.max) {
                ctx.fillStyle = "#38bdf8";
                ctx.fillRect(x - 1, 5, 2, tickBase - 5);
                ctx.font = "600 14px Inter, sans-serif";
                ctx.fillText("Now", x + 5, 5);
                continue;
            }
            if (t % 900 !== 0) {
                // Finer than 15 minutes: just a dot
                ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
                ctx.fillRect(x - 1, tickBase - 2, 2, 2);
                continue;
            }
            const onHour = t % 3600 === 0;
            const midnight = onHour && isMidnight(t);
            const labeled = onHour && !midnight && nycHour(t) % labelEvery === 0;
            const tickH = midnight ? 26 : onHour && nycHour(t) % 3 === 0 ? 13 : onHour ? 9 : 5;
            ctx.fillStyle = midnight ? "rgba(255, 255, 255, 0.7)" : "rgba(255, 255, 255, 0.3)";
            ctx.fillRect(x - 0.5, tickBase - tickH, 1, tickH);

            if (midnight && x > 2) {
                ctx.font = "600 14px Inter, sans-serif";
                ctx.fillStyle = "#f8fafc";
                ctx.fillText(fmtDayShort.format(t * 1000), x + 5, 5);
            } else if (labeled && x - 18 > pinnedRight + 8) {
                ctx.font = "400 13px Inter, sans-serif";
                ctx.fillStyle = "#94a3b8";
                ctx.textAlign = "center";
                ctx.fillText(fmtHourShort.format(t * 1000), x, 7);
                ctx.textAlign = "start";
            }
        }
    }
}
