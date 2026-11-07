/*
 * Canvas layer of station areas: each station's Voronoi cell, clipped to a
 * circle of CELL_RADIUS_M around it so outlying stations don't claim huge areas.
 * Geometry is computed once; redraws only re-project and re-fill.
 */

const CELL_RADIUS_M = 304.8;  // 1000 ft
const CIRCLE_SIDES = 32;
const CANVAS_PADDING = 0.3;  // fraction of the viewport drawn beyond each edge
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQUATOR = 111320;

// Sutherland–Hodgman: clip `subject` to the convex polygon `clip` (a closed ring
// whose interior contains `inside`)
function clipConvex(subject, clip, inside) {
    let out = subject;
    for (let k = 0; k < clip.length - 1 && out.length; k++) {
        const [ax, ay] = clip[k], [bx, by] = clip[k + 1];
        const side = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const ref = Math.sign(side(inside)) || 1;
        const input = out;
        out = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j], q = input[(j + 1) % input.length];
            const sp = side(p) * ref, sq = side(q) * ref;
            if (sp >= 0) out.push(p);
            if ((sp >= 0) !== (sq >= 0)) {
                const t = sp / (sp - sq);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
    }
    return out;
}

const CellsLayer = L.Layer.extend({
    options: { pane: "overlayPane", opacity: 0.5 },

    // colorAt(i) -> CSS color for station i (or null to leave it blank), read on every redraw
    initialize(stations, colorAt, options) {
        L.setOptions(this, options);
        this._colorAt = colorAt;
        this._build(stations);
    },

    _build(stations) {
        // Work in a local flat projection in meters, accurate enough at city scale
        const lat0 = stations.reduce((a, s) => a + s.lat, 0) / stations.length;
        const lon0 = stations.reduce((a, s) => a + s.lon, 0) / stations.length;
        const kx = M_PER_DEG_LON_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
        this._toXY = (lat, lng) => [(lng - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT];
        const toLatLng = ([x, y]) => L.latLng(y / M_PER_DEG_LAT + lat0, x / kx + lon0);

        const pts = stations.map(s => this._toXY(s.lat, s.lon));
        this._pts = pts;
        this._delaunay = d3.Delaunay.from(pts);
        const R = CELL_RADIUS_M;
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const voronoi = this._delaunay.voronoi([
            Math.min(...xs) - R, Math.min(...ys) - R, Math.max(...xs) + R, Math.max(...ys) + R,
        ]);

        // Store each cell as flat zoom-0 pixel coords, so a redraw is just scale + offset
        this._cells = pts.map(([cx, cy], i) => {
            const poly = voronoi.cellPolygon(i);  // null for duplicate points
            if (!poly) return new Float64Array(0);
            const circle = [];
            for (let k = 0; k < CIRCLE_SIDES; k++) {
                const a = (k / CIRCLE_SIDES) * 2 * Math.PI;
                circle.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
            }
            const ring = clipConvex(circle, poly, [cx, cy]);
            const flat = new Float64Array(ring.length * 2);
            ring.forEach((xy, k) => {
                const p = L.CRS.EPSG3857.latLngToPoint(toLatLng(xy), 0);
                flat[2 * k] = p.x;
                flat[2 * k + 1] = p.y;
            });
            return flat;
        });
    },

    // Index of the station whose area contains latlng, or -1
    find(latlng) {
        const [x, y] = this._toXY(latlng.lat, latlng.lng);
        const i = this._delaunay.find(x, y, this._lastFound || 0);
        this._lastFound = i;
        const [px, py] = this._pts[i];
        return Math.hypot(px - x, py - y) <= CELL_RADIUS_M ? i : -1;
    },

    onAdd(map) {
        // Like Leaflet's own vector renderer: stretch the last drawing during zoom
        // animations instead of hiding it, and redraw once the zoom settles
        const zoomClass = map._zoomAnimated ? "leaflet-zoom-animated" : "leaflet-zoom-hide";
        this._canvas = L.DomUtil.create("canvas", `cells-layer ${zoomClass}`);
        this.getPane().appendChild(this._canvas);
        this.redraw();
    },

    onRemove() {
        this._canvas.remove();
        this._canvas = null;
    },

    // Leaflet binds these to the map while the layer is added
    getEvents() {
        return {
            move: this.redraw,
            resize: this.redraw,
            zoomend: this.redraw,
            viewreset: this.redraw,
            zoomanim: this._animateZoom,
        };
    },

    _animateZoom(e) {
        if (!this._bounds || !this._canvas) return;
        const map = this._map;
        const scale = map.getZoomScale(e.zoom);
        const offset = map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
        L.DomUtil.setTransform(this._canvas, offset, scale);
    },

    // Redraw on the next animation frame. Leaflet's canvas renderer repaints markers
    // the same way, so calling this right after changing marker colors keeps the
    // dots and their areas changing in the same frame.
    redrawSoon() {
        if (this._frame) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.redraw();
        });
    },

    redraw() {
        const map = this._map;
        // Mid-animation the canvas is being CSS-scaled; zoomend redraws properly
        if (!map || !this._canvas || map._animatingZoom) return;
        const view = map.getSize();
        // Draw a margin beyond the viewport so zooming out doesn't reveal empty edges
        const pad = view.multiplyBy(CANVAS_PADDING).round();
        const size = view.add(pad.multiplyBy(2));
        const dpr = window.devicePixelRatio || 1;
        const canvas = this._canvas;
        if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
            canvas.width = size.x * dpr;
            canvas.height = size.y * dpr;
            canvas.style.width = `${size.x}px`;
            canvas.style.height = `${size.y}px`;
        }
        const topLeft = map.containerPointToLayerPoint(pad.multiplyBy(-1));
        L.DomUtil.setPosition(canvas, topLeft);
        this._bounds = L.latLngBounds(
            map.layerPointToLatLng(topLeft),
            map.layerPointToLatLng(topLeft.add(size)),
        );

        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.x, size.y);
        ctx.globalAlpha = this.options.opacity;

        // zoom-0 pixels -> canvas pixels
        const s = map.options.crs.scale(map.getZoom()) / map.options.crs.scale(0);
        const origin = map.getPixelOrigin();
        const ox = origin.x + topLeft.x, oy = origin.y + topLeft.y;
        // Generous bound on a cell's size in screen pixels, for culling
        const metersPerPx = (40075016 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / map.options.crs.scale(map.getZoom());
        const reach = (2 * CELL_RADIUS_M) / metersPerPx;

        this._cells.forEach((flat, i) => {
            const color = this._colorAt(i);
            if (!color || flat.length < 6) return;
            const x0 = flat[0] * s - ox, y0 = flat[1] * s - oy;
            if (x0 < -reach || y0 < -reach || x0 > size.x + reach || y0 > size.y + reach) return;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            for (let k = 2; k < flat.length; k += 2) ctx.lineTo(flat[k] * s - ox, flat[k + 1] * s - oy);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        });
    },
});
