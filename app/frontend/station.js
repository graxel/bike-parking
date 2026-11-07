/*
 * Station detail page: current state plus a minute-level history chart.
 * Falls back to hourly averages if the raw series can't be loaded.
 */

const stationId = new URLSearchParams(window.location.search).get("id");
let chart = null;

function renderHeader(st) {
    document.title = `${st.name} · Citi Bike`;
    document.getElementById("station-name").textContent = st.name;
    document.getElementById("m-bikes").textContent = st.bikes ?? "–";
    document.getElementById("m-docks").textContent = st.docks ?? "–";
    document.getElementById("m-capacity").textContent = st.capacity ?? "–";
    document.getElementById("m-updated").textContent = st.reported_at ? fmtDayTime.format(st.reported_at * 1000) : "–";
    document.getElementById("status-swatch").style.background = stationColor(st.docks, st.bikes);

    const copy = document.getElementById("copy-id");
    copy.textContent = st.id;
    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(st.id);
            copy.textContent = "Copied!";
        } catch {
            copy.textContent = "Copy failed";
        }
        setTimeout(() => { copy.textContent = st.id; }, 1500);
    };
}

function toPoints(series, key, nowValue) {
    const pts = series.t.map((t, i) => ({ x: t * 1000, y: series[key][i] }));
    // Carry the latest reading through to the present so the line doesn't stop short
    if (nowValue != null) pts.push({ x: Date.now(), y: nowValue });
    return pts;
}

function renderChart(st, series, raw) {
    const ctx = document.getElementById("chart").getContext("2d");
    const bikesKey = raw ? "bikes" : "bikes_avg";
    const docksKey = raw ? "docks" : "docks_avg";
    const accent = "#38bdf8";
    const grid = "rgba(255, 255, 255, 0.06)";
    const tick = "#94a3b8";

    chart = new Chart(ctx, {
        type: "line",
        data: {
            datasets: [
                {
                    label: "Bikes available",
                    data: toPoints(series, bikesKey, st.bikes),
                    borderColor: accent,
                    backgroundColor: "rgba(56, 189, 248, 0.15)",
                    fill: "origin",
                    stepped: raw ? "after" : false,
                    borderWidth: 1.5,
                    pointRadius: 0,
                },
                {
                    label: "Docks available",
                    data: toPoints(series, docksKey, st.docks),
                    borderColor: "#10b981",
                    stepped: raw ? "after" : false,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    hidden: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            normalized: true,
            animation: false,
            interaction: { mode: "index", intersect: false },
            scales: {
                x: {
                    type: "time",
                    time: { unit: "day", displayFormats: { hour: "h a", day: "EEE MMM d" } },
                    min: Date.now() - 8 * 86400 * 1000,
                    max: Date.now(),
                    grid: { color: grid },
                    ticks: { color: tick, maxRotation: 0, autoSkipPadding: 16 },
                },
                y: {
                    min: 0,
                    suggestedMax: st.capacity || undefined,
                    grid: { color: grid },
                    ticks: { color: tick, precision: 0 },
                },
            },
            plugins: {
                decimation: { enabled: true, algorithm: "min-max" },
                legend: { labels: { color: "#f8fafc", boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        title: items => items.length ? fmtDayTime.format(items[0].parsed.x) : "",
                        label: item => `${item.dataset.label}: ${Math.round(item.parsed.y * 10) / 10}`,
                    },
                },
            },
        },
    });
}

function setRange(days) {
    document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("active", Number(b.dataset.days) === days));
    if (!chart) return;
    chart.options.scales.x.time.unit = days > 1 ? "day" : "hour";
    chart.options.scales.x.min = Date.now() - days * 86400 * 1000;
    chart.options.scales.x.max = Date.now();
    chart.update("none");
}

document.getElementById("ranges").addEventListener("click", e => {
    const days = Number(e.target.dataset?.days);
    if (days) setRange(days);
});

async function init() {
    document.getElementById("map-link").href = pageUrl("./", stationId ? { focus: stationId } : {});
    document.getElementById("dashboard-link").href = pageUrl("dashboard.html");
    const note = document.getElementById("chart-note");

    if (!stationId) {
        document.getElementById("station-name").textContent = "No station selected";
        return;
    }

    const id = encodeURIComponent(stationId);
    let resp, raw = true;
    try {
        resp = await fetchJson(`/station/${id}/?resolution=raw&days=8`);
    } catch (err) {
        console.error("Raw history failed, falling back to hourly:", err);
        raw = false;
        try {
            resp = await fetchJson(`/station/${id}/?resolution=hour`);
        } catch (err2) {
            document.getElementById("station-name").textContent = "Couldn't load station";
            note.textContent = err2.message;
            return;
        }
    }

    renderHeader(resp.station);
    renderChart(resp.station, resp.series, raw);
    note.textContent = raw
        ? "Every station check-in over the last 8 days."
        : "Showing hourly averages (detailed history unavailable).";
}

init();
