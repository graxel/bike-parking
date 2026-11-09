/*
 * Station map with a pannable time tape (see tape.js).
 *
 * Scrubber positions 0..H-1 are past time steps (15-minute averages from
 * /map/snapshots), position H is "now" (live data from /map/now). History is
 * fetched in 24-hour chunks, newest first, in the background so playback can
 * run smoothly.
 * Future predictions can later be appended as positions after H.
 */

const CHUNK_SECONDS = 24 * 3600;
// Playback pace as ms per 15 minutes of map time, so it's the same at any step size
const SPEEDS = [
    { label: "1×", ms: 600 },
    { label: "2×", ms: 300 },
    { label: "5×", ms: 90 },
];
const TAPE_PX_PER_MINUTE = 1;
// Time step in minutes, e.g. ?step=5 to try the 5-minute table (API default is 15)
const STEP_PARAM = new URLSearchParams(window.location.search).get("step");
const STEP_QUERY = STEP_PARAM ? `step=${Number(STEP_PARAM) * 60}` : "";
const VIEW_KEY = "bike-parking:map-view";
const LAYERS_KEY = "bike-parking:map-layers";

const state = {
    stations: [],         // [{id, name, lat, lon, capacity}]
    indexById: new Map(), // station id -> index into stations/markers
    markers: [],
    colors: [],           // color currently painted for each station (markers and cells)
    cells: null,          // CellsLayer, once stations are loaded
    times: [],            // epoch seconds of each past time step, ascending
    step: 900,            // seconds between time steps (from /map/stations)
    frames: new Map(),    // hour epoch -> {t, docks: Float32Array, bikes: Float32Array}, NaN = no data
    nowFrame: null,
    chunks: new Map(),    // chunk index -> Promise
    loadedChunks: new Set(),
    position: 0,
    playing: false,
    historyDone: false,   // preloadHistory has finished (successfully or not)
    loadProgress: "",     // e.g. "Loading 7/9" while history chunks load
    timer: null,
    speed: 0,
    hourly: new Map(),    // station id -> Promise of hourly series (card chart)
    selected: null,       // station index whose card is open
    hovered: null,        // station index whose hover label is showing
};

const els = {
    tape: document.getElementById("tape"),
    timeLabel: document.getElementById("time-label"),
    play: document.getElementById("play-btn"),
    playNote: document.getElementById("play-note"),
    speed: document.getElementById("speed-btn"),
    now: document.getElementById("now-btn"),
    toast: document.getElementById("toast"),
    timeline: document.querySelector(".timeline"),
};

// Distance from the bottom of the window to the top of the timeline, so
// the legend (on narrow screens) can sit just above it without overlapping
function measureTimeline() {
    const clear = window.innerHeight - els.timeline.getBoundingClientRect().top;
    document.documentElement.style.setProperty("--timeline-clear", `${Math.ceil(clear)}px`);
}
new ResizeObserver(measureTimeline).observe(els.timeline);
window.addEventListener("resize", measureTimeline);

const nowPosition = () => state.times.length;

const map = L.map("map", {
    preferCanvas: true,
    // Default wheel/pinch zoom jumps too far on trackpads; zoom in finer steps
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 370,
    wheelDebounceTime: 100,
}).setView([40.73, -73.95], 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
}).addTo(map);
const renderer = L.canvas({ padding: 0.5, tolerance: 4 });
const stationLayer = L.layerGroup().addTo(map);
// Areas sit under the station markers (overlayPane is z-index 400)
map.createPane("cells").style.zIndex = 350;
map.getPane("cells").style.pointerEvents = "none";
// Station card, opened by clicking a marker or area; one shared popup for all stations
const CARD_WIDTH = window.matchMedia("(max-width: 640px)").matches ? 238 : 282;
const stationPopup = L.popup({ className: "station-tip", offset: [0, -4], minWidth: CARD_WIDTH, maxWidth: CARD_WIDTH });
map.on("popupclose", e => { if (e.popup === stationPopup) state.selected = null; });

// Circle marker that draws as an X when the station has no data for the selected time.
// Reaches into Leaflet's canvas renderer internals (_drawing, _ctx), as its own
// _updateCircle does.
const StationMarker = L.CircleMarker.extend({
    _updatePath() {
        if (this.options.fillColor !== STATUS.none.color) {
            return L.CircleMarker.prototype._updatePath.call(this);
        }
        const r = this._renderer;
        if (!r._drawing || this._empty()) return;
        const ctx = r._ctx, p = this._point, s = Math.max(2, this._radius * 0.75);
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s);
        ctx.lineTo(p.x + s, p.y + s);
        ctx.moveTo(p.x + s, p.y - s);
        ctx.lineTo(p.x - s, p.y + s);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#475569";
        ctx.stroke();
    },
});

function radiusForZoom(z) {
    if (z >= 16) return 8;
    if (z >= 15) return 6;
    if (z >= 14) return 5;
    if (z >= 13) return 4;
    return 3;
}

/* ---------- data ---------- */

// Re-key a {stations, frames} response onto our marker order
function alignFrames(resp) {
    const n = state.stations.length;
    const toMarker = resp.stations.map(id => state.indexById.get(id) ?? -1);
    return resp.frames.map(f => {
        const docks = new Float32Array(n).fill(NaN);
        const bikes = new Float32Array(n).fill(NaN);
        toMarker.forEach((mi, ri) => {
            if (mi < 0) return;
            if (f.docks[ri] != null) docks[mi] = f.docks[ri];
            if (f.bikes[ri] != null) bikes[mi] = f.bikes[ri];
        });
        return { t: f.t, docks, bikes };
    });
}

function frameAt(pos) {
    return pos === nowPosition() ? state.nowFrame : state.frames.get(state.times[pos]);
}

function valuesAt(frame, i) {
    const docks = frame ? frame.docks[i] : NaN;
    const bikes = frame ? frame.bikes[i] : NaN;
    return { docks: Number.isNaN(docks) ? null : docks, bikes: Number.isNaN(bikes) ? null : bikes };
}

function chunkOf(pos) {
    return Math.floor((nowPosition() - 1 - pos) / chunkSteps());
}

// Past hour whose chunk has loaded but which has no frame (pipeline gap)
function isGap(pos) {
    return pos < nowPosition() && !frameAt(pos) && state.loadedChunks.has(chunkOf(pos));
}

function chunkSteps() {
    return Math.max(1, Math.round(CHUNK_SECONDS / state.step));
}

function chunkCount() {
    return Math.ceil(state.times.length / chunkSteps());
}

function loadChunk(k) {
    if (!state.chunks.has(k)) {
        const hi = nowPosition() - 1 - k * chunkSteps();
        const lo = Math.max(0, hi - chunkSteps() + 1);
        const iso = t => new Date(t * 1000).toISOString();
        const p = fetchJson(`/map/snapshots/?start=${iso(state.times[lo])}&end=${iso(state.times[hi])}&${STEP_QUERY}`)
            .then(resp => {
                alignFrames(resp).forEach(f => state.frames.set(f.t, f));
                state.loadedChunks.add(k);
                tape.render();  // refresh the loaded-data band
                renderPlayButton();
            })
            .catch(err => {
                state.chunks.delete(k);  // allow a retry
                throw err;
            });
        state.chunks.set(k, p);
    }
    return state.chunks.get(k);
}

async function preloadHistory() {
    const total = chunkCount();
    for (let k = 0; k < total; k++) {
        state.loadProgress = `Loading ${k + 1}/${total}`;
        renderPlayButton();
        try {
            await loadChunk(k);
        } catch (err) {
            console.error("History chunk failed:", err);
            showToast(`Couldn't load part of the history: ${err.message}`);
        }
    }
    state.loadProgress = "";
    state.historyDone = true;
    renderPlayButton();
}

function loadHourly(id) {
    if (!state.hourly.has(id)) {
        const p = fetchJson(`/station/${encodeURIComponent(id)}/?resolution=hour`)
            .then(resp => resp.series)
            .catch(err => {
                state.hourly.delete(id);
                throw err;
            });
        state.hourly.set(id, p);
    }
    return state.hourly.get(id);
}

/* ---------- rendering ---------- */

// Past steps are fractional averages, so colors blend along the scale;
// live data is whole numbers and lands exactly on the legend colors
function paint(frame) {
    state.markers.forEach((m, i) => {
        const { docks, bikes } = valuesAt(frame, i);
        const color = stationColor(docks, bikes);
        if (state.colors[i] !== color) {
            state.colors[i] = color;
            m.setStyle({ fillColor: color });
        }
    });
    // Queued after Leaflet's marker repaint (requested by setStyle above) so both land in one frame
    state.cells?.redrawSoon();
}

function positionLabel(pos) {
    if (pos === nowPosition()) {
        return state.nowFrame?.t ? formatWhen(state.nowFrame.t) : "";
    }
    const label = formatWhen(state.times[pos]);
    return isGap(pos) ? `${label} · no data` : label;
}

function showPosition(pos) {
    state.position = pos;
    els.timeLabel.textContent = positionLabel(pos);
    els.tape.setAttribute("aria-valuetext", els.timeLabel.textContent);
    els.now.classList.toggle("active", pos === nowPosition());
    renderPlayButton();

    const frame = frameAt(pos);
    if (!frame && pos < nowPosition() && !state.loadedChunks.has(chunkOf(pos))) {
        loadChunk(chunkOf(pos))
            .then(() => { if (state.position === pos) showPosition(pos); })
            .catch(err => showToast(`Couldn't load that time: ${err.message}`));
    }
    // Paint even when missing (as "no data") so the map never shows a stale hour
    paint(frame);
    refreshCard();
}

// Moving the tape is what changes the shown time: it calls showPosition via onScrub
const tape = new TimeTape(els.tape, {
    pxPerStep: (state.step / 60) * TAPE_PX_PER_MINUTE,
    stepSeconds: () => state.step,
    timeAt: p => (p === nowPosition() ? state.nowFrame?.t ?? null : state.times[p] ?? null),
    bandAt: p => (frameAt(p) ? "loaded" : isGap(p) ? "gap" : null),
    onScrub: showPosition,
    onUserStart: () => { if (state.playing) setPlaying(false); },
});

function buildLegend() {
    document.getElementById("legend-items").innerHTML = Object.values(STATUS)
        .map(s => s === STATUS.none
            ? `<li><span class="swatch-x">✕</span>${s.label}</li>`
            : `<li><span class="swatch" style="background:${s.color}"></span>${s.label}</li>`)
        .join("");
}

/* ---------- layer toggles ---------- */

function loadLayerPrefs() {
    try {
        return { stations: true, cells: true, ...JSON.parse(localStorage.getItem(LAYERS_KEY)) };
    } catch {
        return { stations: true, cells: true };
    }
}

function applyLayers() {
    const showStations = document.getElementById("toggle-stations").checked;
    const showCells = document.getElementById("toggle-cells").checked && state.cells;
    if (showStations) stationLayer.addTo(map); else stationLayer.remove();
    if (showCells) state.cells.addTo(map); else state.cells?.remove();
    try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify({ stations: showStations, cells: !!showCells }));
    } catch { /* not important */ }
}

function setupLayerToggles() {
    const prefs = loadLayerPrefs();
    const stations = document.getElementById("toggle-stations");
    const cells = document.getElementById("toggle-cells");
    stations.checked = prefs.stations;
    cells.checked = prefs.cells;
    if (!state.cells) {
        cells.checked = false;
        cells.disabled = true;  // d3-delaunay failed to load
    }
    stations.addEventListener("change", applyLayers);
    cells.addEventListener("change", applyLayers);
    applyLayers();
}

/* ---------- station card ---------- */

// Hourly bars of fullness (bikes / (bikes + docks)), each colored like the marker would be
function historySvg(series, cursorT) {
    const W = 280, H = 64;
    const n = series.t.length;
    const t0 = state.times[0] ?? series.t[0];
    const t1 = (state.times[state.times.length - 1] ?? series.t[n - 1]) + state.step;
    const x = t => ((t - t0) / (t1 - t0)) * W;
    const barW = Math.max(1, (3600 / (t1 - t0)) * W);

    let bars = "";
    for (let i = 0; i < n; i++) {
        const bikes = series.bikes_avg[i], docks = series.docks_avg[i];
        const total = bikes + docks;
        const h = Math.max(1, total > 0 ? (bikes / total) * H : 0);
        const color = stationColor(docks, bikes);
        bars += `<rect x="${x(series.t[i]).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(barW + 0.4).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"/>`;
    }

    let grid = "";
    state.times.forEach(t => {
        if (isMidnight(t)) grid += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="0" y2="${H}" stroke="#94a3b8" stroke-width="0.5"/>`;
    });

    const cx = Math.min(W - 1, x(cursorT)).toFixed(1);
    const cursor = `<line x1="${cx}" x2="${cx}" y1="0" y2="${H}" stroke="#0284c7" stroke-width="2"/>`;

    return `<svg class="tip-chart" width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" height="${H}">${grid}${bars}${cursor}</svg>`;
}

// "3 bikes · 12 docks" at the shown time; past steps are interval averages, so may be fractional
function countsText(docks, bikes) {
    const count = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
    return docks == null ? "No data" : `${plural(bikes, "bike")} · ${plural(docks, "dock")}`;
}

// Small hover label on station markers
function hoverHtml(i) {
    const { docks, bikes } = valuesAt(frameAt(state.position), i);
    return countsText(docks, bikes);
}

function cardHtml(i) {
    const st = state.stations[i];
    const pos = state.position;
    const { docks, bikes } = valuesAt(frameAt(pos), i);
    const color = stationColor(docks, bikes);
    const counts = countsText(docks, bikes);
    const cursorT = pos === nowPosition() ? (state.nowFrame?.t ?? Date.now() / 1000) : state.times[pos] + state.step / 2;

    let chart = `<div class="tip-empty">Loading history…</div>`;
    const cached = state.hourly.get(st.id);
    if (cached?.series) {
        chart = cached.series.t.length ? historySvg(cached.series, cursorT) : `<div class="tip-empty">No history yet</div>`;
    } else if (cached?.error) {
        chart = `<div class="tip-empty">History unavailable</div>`;
    }

    return `
        <div class="tip-name">${escapeHtml(st.name)}</div>
        <div class="tip-now"><span class="swatch" style="background:${color}"></span>${counts}<span class="tip-when">${escapeHtml(positionLabel(pos))}</span></div>
        ${chart}
        <div class="tip-foot"><span>Fullness, last 8 days</span><a href="${escapeHtml(pageUrl("station.html", { id: st.id }))}">View details →</a></div>`;
}

function refreshCard() {
    if (state.selected != null) stationPopup.setContent(cardHtml(state.selected));
    if (state.hovered != null) state.markers[state.hovered].getTooltip()?.update();
}

// With markers hidden, the areas themselves are the click targets
function areasAreTargets() {
    return state.cells && map.hasLayer(state.cells) && !map.hasLayer(stationLayer);
}

function openCard(i) {
    stationPopup.setLatLng(state.stations[i]).setContent(cardHtml(i)).openOn(map);
    state.selected = i;
    const p = loadHourly(state.stations[i].id);
    // Stash the resolved value on the promise so cardHtml can read it synchronously
    p.then(series => { p.series = series; }, () => { p.error = true; })
        .finally(() => { if (state.selected === i) refreshCard(); });
}

// Clicking empty map or pressing Esc closes the card (Leaflet popup defaults)
map.on("click", e => {
    if (!areasAreTargets()) return;
    const i = state.cells.find(e.latlng);
    if (i >= 0) openCard(i);
});
map.on("mousemove", e => {
    if (!areasAreTargets()) return;
    map.getContainer().style.cursor = state.cells.find(e.latlng) >= 0 ? "pointer" : "";
});
map.on("mouseout", () => { map.getContainer().style.cursor = ""; });

/* ---------- playback ---------- */

function setPlaying(on) {
    state.playing = on;
    clearTimeout(state.timer);
    renderPlayButton();
    if (on) {
        if (state.position >= nowPosition()) {
            // Slide (not jump) back, so it's clear the tape can be dragged further
            tape.setPosition(playStartFromNow(), { ms: REWIND_MS });
            schedule(REWIND_MS + stepMs());
        } else {
            schedule();
        }
    }
}

// At "now" with no history loaded yet, there's nothing to play
function playUnavailable() {
    return !state.playing && state.position >= nowPosition() && playStartFromNow() >= nowPosition();
}

function renderPlayButton() {
    const unavailable = playUnavailable();
    const waiting = unavailable && !state.historyDone;
    els.play.textContent = state.playing ? "❚❚" : "▶";
    els.play.classList.toggle("active", state.playing);
    els.play.classList.toggle("unavailable", unavailable);
    els.play.classList.toggle("waiting", waiting);
    els.play.setAttribute("aria-disabled", unavailable);
    els.play.setAttribute("aria-label", waiting ? "Play (loading history)" : state.playing ? "Pause" : "Play");
    els.playNote.textContent = state.loadProgress || (waiting ? "Loading…" : unavailable ? "No history" : "");
    els.play.title = waiting ? "Loading history — play will be ready in a moment"
        : unavailable ? "No history to play"
        : "Play / pause (space)";
}

function togglePlay() {
    if (playUnavailable()) {
        showToast(state.historyDone ? "No history to play." : "History is still loading — play will be ready in a moment.");
        return;
    }
    setPlaying(!state.playing);
}

// Pressing play at "now": rewind to the earliest data loaded continuously
// back from now, but no more than one day
function playStartFromNow() {
    const floor = Math.max(0, nowPosition() - Math.round(86400 / state.step));
    let p = nowPosition();
    while (p - 1 >= floor && (frameAt(p - 1) || isGap(p - 1))) p--;
    return p;
}

const REWIND_MS = 800;

function stepMs() {
    return SPEEDS[state.speed].ms * (state.step / 900);
}

function schedule(ms = stepMs()) {
    state.timer = setTimeout(tick, ms);
}

function tick() {
    if (!state.playing) return;
    if (state.position >= nowPosition()) return setPlaying(false);
    const next = state.position + 1;
    if (!frameAt(next) && !isGap(next)) {
        // Wait for the chunk to arrive rather than flashing "no data"
        loadChunk(chunkOf(next)).catch(() => {});
        schedule();
        return;
    }
    // Glide the tape one step over the tick interval; stop once it reaches "now"
    tape.setPosition(next, { ms: stepMs(), ease: "linear" });
    if (next === nowPosition()) setPlaying(false);
    else schedule();
}

/* ---------- UI wiring ---------- */

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 6000);
}

function step(delta) {
    setPlaying(false);
    tape.setPosition(state.position + delta, { ms: 120 });
}

els.play.addEventListener("click", togglePlay);
renderPlayButton();
els.speed.addEventListener("click", () => {
    state.speed = (state.speed + 1) % SPEEDS.length;
    els.speed.textContent = SPEEDS[state.speed].label;
});
els.now.addEventListener("click", () => {
    setPlaying(false);
    tape.setPosition(nowPosition(), { ms: 400 });
});
document.addEventListener("keydown", e => {
    if (e.target.matches("input, textarea, button")) return;
    const stepBy = e.shiftKey ? 3600 / state.step : 1;  // Shift: one hour
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-stepBy); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(stepBy); }
});

map.on("zoomend", () => {
    const r = radiusForZoom(map.getZoom());
    state.markers.forEach(m => m.setRadius(r));
});
map.on("moveend", () => {
    try {
        const c = map.getCenter();
        localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    } catch { /* storage unavailable; not important */ }
});

function restoreView() {
    try {
        const v = JSON.parse(localStorage.getItem(VIEW_KEY));
        if (v) {
            map.setView([v.lat, v.lng], v.zoom, { animate: false });
            return true;
        }
    } catch { /* ignore */ }
    return false;
}

function buildMarkers() {
    const r = radiusForZoom(map.getZoom());
    state.markers = state.stations.map((st, i) => {
        const marker = new StationMarker([st.lat, st.lon], {
            renderer,
            radius: r,
            color: "#1e293b",
            weight: 1,
            fillColor: STATUS.none.color,
            fillOpacity: 0.95,
        }).addTo(stationLayer);

        marker.bindTooltip(() => hoverHtml(i), { className: "station-hover", direction: "top", offset: [0, -6] });
        marker.on("tooltipopen", () => { state.hovered = i; });
        marker.on("tooltipclose", () => { if (state.hovered === i) state.hovered = null; });
        marker.on("click", () => {
            marker.closeTooltip();  // the card shows the same counts
            openCard(i);
        });
        return marker;
    });
    state.colors = state.markers.map(() => STATUS.none.color);
}

async function init() {
    buildLegend();
    document.getElementById("dashboard-link").href = pageUrl("dashboard.html");

    const params = new URLSearchParams(window.location.search);
    const focusId = params.get("focus");
    const restored = !focusId && restoreView();

    try {
        const [meta, now] = await Promise.all([fetchJson(`/map/stations/?${STEP_QUERY}`), fetchJson("/map/now/")]);

        state.stations = meta.stations;
        state.stations.forEach((st, i) => state.indexById.set(st.id, i));
        buildMarkers();
        if (window.d3?.Delaunay && state.stations.length) {
            const cellColor = i => (state.colors[i] === STATUS.none.color ? null : state.colors[i]);
            state.cells = new CellsLayer(state.stations, cellColor, { pane: "cells", opacity: 0.5 });
        }
        setupLayerToggles();
        if (!focusId && !restored && state.stations.length) {
            map.fitBounds(L.latLngBounds(state.stations.map(st => [st.lat, st.lon])), { padding: [24, 24], animate: false });
        }

        if (meta.history_start != null && meta.history_end != null) {
            state.step = meta.step_seconds || 3600;
            for (let t = meta.history_start; t <= meta.history_end; t += state.step) state.times.push(t);
        }
        state.nowFrame = alignFrames(now)[0] ?? null;

        tape.setScale((state.step / 60) * TAPE_PX_PER_MINUTE);
        tape.setMax(nowPosition());
        tape.setPosition(nowPosition());

        if (focusId && state.indexById.has(focusId)) {
            const i = state.indexById.get(focusId);
            map.setView(state.markers[i].getLatLng(), 16, { animate: false });
            openCard(i);
        }

        preloadHistory();
    } catch (err) {
        console.error("Error loading map data:", err);
        els.timeLabel.textContent = "Couldn't load stations";
        showToast(err.message);
    }
}

init();
