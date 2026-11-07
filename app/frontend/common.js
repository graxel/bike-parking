/*
 * Note: Webpage hosted on kevingrazel.com (Github pages).
 * kevingrazel.com and data.kevingrazel.com are completely
 * separate hosts with separate infrastructure.
 *
 *
 * API Configuration
 *
 * The APIs live on data.kevingrazel.com (Local/RPi infrastructure).
 *
 * All requests are routed through a consolidated Nginx gateway:
 *   /bike-parking/current/ -> Consolidated API (port 40501)
 *   /bike-parking/history/ -> Consolidated API (port 40501)
 *
 * Environment endpoints:
 *   Prod (Main): https://data.kevingrazel.com/bike-parking
 *   QA (Test):   https://data.kevingrazel.com:8443/bike-parking
 */
const isLocal = ["localhost", "127.0.0.1", "kevingrazel.local"].includes(window.location.hostname)
    || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(window.location.hostname);

const API_CONFIGS = {
    prod: "https://data.kevingrazel.com/bike-parking",
    qa:   "https://data.kevingrazel.com:8443/bike-parking",
    dev:  "https://data.kevingrazel.local/bike-parking",
};

function getApiBase() {
    const params = new URLSearchParams(window.location.search);
    const env = params.get("api");

    if (env === "dev" && !isLocal) return API_CONFIGS.prod;
    if (env) return API_CONFIGS[env] || API_CONFIGS.prod;

    return API_CONFIGS.prod;
}

const API_BASE = getApiBase();

async function fetchJson(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${path} failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
    }
    return res.json();
}

// Link to another page, carrying over the ?api= environment and ?step= selections
function pageUrl(page, params = {}) {
    const query = new URLSearchParams(params);
    const current = new URLSearchParams(window.location.search);
    for (const key of ["api", "step"]) {
        if (current.get(key)) query.set(key, current.get(key));
    }
    const qs = query.toString();
    return qs ? `${page}?${qs}` : page;
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/*
 * Station status colors. Low docks take priority over low bikes:
 * a full station (no docks) is the most important thing to see when parking.
 */
const STATUS = {
    docks0: { color: "#000000", label: "0 docks" },
    docks1: { color: "#a90000", label: "1 dock" },
    docks2: { color: "#da7800", label: "2 docks" },
    docks3: { color: "#d7b700", label: "3 docks" },
    ok:     { color: "#0bb148", label: "Plenty" },
    bikes3: { color: "#1fadef", label: "3 bikes" },
    bikes2: { color: "#ad91ed", label: "2 bikes" },
    bikes1: { color: "#bebebe", label: "1 bike" },
    bikes0: { color: "#ebebeb", label: "0 bikes" },
    none:   { color: "#64748b", label: "No data" },
};

function stationStatus(docks, bikes) {
    if (docks == null || bikes == null) return STATUS.none;
    if (docks <= 3) return STATUS[`docks${Math.max(0, docks)}`];
    if (bikes <= 3) return STATUS[`bikes${Math.max(0, bikes)}`];
    return STATUS.ok;
}

// All times are shown in New York time regardless of the viewer's timezone
const NYC_TZ = "America/New_York";
const fmtDayTime = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, hour: "numeric", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, weekday: "short", month: "short", day: "numeric" });

// "Mon, Nov 2 at 5:10 PM"
function formatWhen(epochSec) {
    return `${fmtDate.format(epochSec * 1000)} at ${fmtTime.format(epochSec * 1000)}`;
}
const fmtDayShort = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, weekday: "short", day: "numeric" });
const fmtHour24 = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, hour: "numeric", hourCycle: "h23" });

function nycHour(epochSec) {
    return Number(fmtHour24.format(epochSec * 1000));
}

// NYC's UTC offset is a whole number of hours, so local midnight is also on a UTC hour
function isMidnight(epochSec) {
    return epochSec % 3600 === 0 && nycHour(epochSec) === 0;
}

// The legend order doubles as a continuous scale, from full (no docks) to empty (no bikes)
const SCALE = [STATUS.docks0, STATUS.docks1, STATUS.docks2, STATUS.docks3, STATUS.ok, STATUS.bikes3, STATUS.bikes2, STATUS.bikes1, STATUS.bikes0]
    .map(s => [1, 3, 5].map(o => parseInt(s.color.slice(o, o + 2), 16)));

/*
 * Continuous version of stationStatus. Scale positions: 0-3 = docks left,
 * 4 = rack half full (green), 5-8 = 3-0 bikes left. Fractional averages blend
 * between neighboring colors, and between "3 docks" and "3 bikes" the color
 * slides yellow -> green -> teal with how full the rack is.
 */
function scalePosition(docks, bikes) {
    if (docks <= 3) return Math.max(0, docks);
    if (bikes <= 3) return 8 - Math.max(0, bikes);
    // Both > 3, so the usable rack (bikes + docks) is > 6 and half > 3
    const half = (bikes + docks) / 2;
    return docks < half
        ? 4 - (half - docks) / (half - 3)   // fuller than half: toward yellow
        : 4 + (half - bikes) / (half - 3);  // emptier than half: toward teal
}

function stationColor(docks, bikes) {
    if (docks == null || bikes == null) return STATUS.none.color;
    const p = scalePosition(docks, bikes);
    const lo = Math.floor(p), hi = Math.min(8, lo + 1), f = p - lo;
    const [r, g, b] = SCALE[lo].map((c, k) => Math.round(c + (SCALE[hi][k] - c) * f));
    return `rgb(${r},${g},${b})`;
}
