/*
 * API Configuration
 * 
 * The frontend is served from kevingrazel.com (GitHub Pages).
 * The APIs live on data.kevingrazel.com (RPi servers behind router).
 *
 * Prod:  https://data.kevingrazel.com/bike-parking
 * Beta:  https://data.kevingrazel.com:4443/bike-parking/beta
 *
 * To switch environments, change API_BASE below or set it via query param:
 *   ?api=beta  → use beta API
 *   ?api=prod  → use prod API (default)
 */
const API_CONFIGS = {
    prod: "https://data.kevingrazel.com/bike-parking",
    qa:   "https://data.kevingrazel.com:4443/bike-parking",
    // Always uses the current hostname (Mac IP or localhost) for local testing
    dev:  `${window.location.origin}/bike-parking`,
};

function getApiBase() {
    const params = new URLSearchParams(window.location.search);
    const env = params.get("api");
    if (env) return API_CONFIGS[env] || API_CONFIGS.prod;

    // Default to local for localhost, prod for remote
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        return API_CONFIGS.dev;
    }
    return API_CONFIGS.prod;
}

const API_BASE = getApiBase();

document.addEventListener("DOMContentLoaded", async () => {
    const dashboard = document.getElementById("dashboard");

    try {
        const [currentRes, historyRes] = await Promise.all([
            fetch(`${API_BASE}/current/`),
            fetch(`${API_BASE}/history/`)
        ]);

        const currentData = await currentRes.json();
        const historyData = await historyRes.json();

        renderDashboard(currentData.data, historyData.data, dashboard);
    } catch (err) {
        console.error("Error fetching station data:", err);
        dashboard.innerHTML = `<div class="loader" style="color:#ef4444; width:100%; text-align: left; padding: 20px;"><h2 style="color:white; margin-bottom:10px;">Javascript UI Crash</h2><b style="font-size:16px;">${err.message}</b><br><br><pre style="white-space: pre-wrap; font-size:13px; color:#94a3b8; background:rgba(0,0,0,0.5); padding:15px; border-radius:8px;">${err.stack}</pre></div>`;
    }
});

function renderDashboard(currentGroups, historyGroups, container) {
    container.innerHTML = "";
    let delay = 0;

    if (currentGroups.length === 0) {
        container.innerHTML = `<div class="loader" style="animation:none;">No station groups configured in YAML. Update groups.yaml.</div>`;
        return;
    }

    currentGroups.forEach((group) => {
        const hGroup = historyGroups.find(g => g.name === group.name);

        const card = document.createElement("div");
        card.className = "group-card";
        card.style.animationDelay = `${delay}s`;
        delay += 0.15;

        // Aggregate Current Stats
        let totalBikes = 0;
        let totalDocks = 0;
        let stationsHtml = '<div class="station-list" style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-secondary); border-top: 1px solid var(--surface-border); padding-top: 1rem;">';

        group.stations.forEach(station => {
            totalBikes += (station.num_bikes_available || 0);
            totalDocks += (station.num_docks_available || 0);
            stationsHtml += `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem; align-items:center;">
                    <span style="color: var(--text-primary);">${station.station_name || 'Station ' + station.station_id}</span>
                    <span style="background: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 0.2rem 0.6rem; border-radius: 4px; font-weight:600;">${station.num_docks_available || 0} docks</span>
                </div>
            `;
        });
        stationsHtml += '</div>';

        // Aggregate History Stats (Docks) for the Group Plot
        const groupHistoryMap = {};
        if (hGroup && hGroup.stations) {
            Object.values(hGroup.stations).forEach(hStations => {
                if (hStations && Array.isArray(hStations)) {
                    hStations.forEach(h => {
                        // DB returns bucketed dates: YYYY-MM-DDTHH:MM:SS
                        const tsHour = h.reported_hour ? h.reported_hour : null;
                        if (tsHour) {
                            if (!groupHistoryMap[tsHour]) {
                                groupHistoryMap[tsHour] = { min: 0, avg: 0, max: 0 };
                            }
                            groupHistoryMap[tsHour].min += (h.min_docks_available || 0);
                            groupHistoryMap[tsHour].avg += (h.avg_docks_available || 0);
                            groupHistoryMap[tsHour].max += (h.max_docks_available || 0);
                        }
                    });
                }
            });
        }

        const aggregatedHistory = Object.keys(groupHistoryMap).map(ts => ({
            reported_hour: ts,
            min_docks_available: groupHistoryMap[ts].min,
            avg_docks_available: groupHistoryMap[ts].avg,
            max_docks_available: groupHistoryMap[ts].max
        }));

        const canvasId = `chart-group-${group.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const hudId = `hud-${canvasId}`;

        const now = new Date();
        const nowDay = now.toLocaleDateString([], { weekday: 'short' });
        const nowTime = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();

        const defaultHudText = `
            <div style="display: grid; grid-template-columns: 125px 1px 65px 1px 70px 1px 65px; column-gap: 12px; align-items: center; text-align: left;">
                <span style="color:#f8fafc;">${nowDay} ${nowTime}</span>
                <div style="width:1px; height:12px; background:rgba(255,255,255,0.15);"></div>
                <span style="grid-column: 3 / span 5;"><b>${Math.round(totalDocks)} docks available</b></span>
            </div>
        `;

        card.innerHTML = `
            <div class="group-header" style="margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: none; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                <div>
                    <h2 class="group-title">${group.name}</h2>
                    <div class="station-metrics">
                        <span class="metric docks" style="font-size: 1.15rem;">🅿️ ${Math.round(totalDocks)} Docks</span>
                        <span class="metric bikes" style="font-size: 1.0rem; opacity: 0.7;">🚲 ${Math.round(totalBikes)} Bikes</span>
                    </div>
                </div>
                <div id="${hudId}" style="color: #94a3b8; font-family: 'Inter', sans-serif; font-size: 0.85rem; padding: 0.5rem 0.8rem; background: rgba(15, 23, 42, 0.4); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">${defaultHudText}</div>
            </div>
            <div class="chart-container" style="height: 220px; margin-bottom: 1rem;">
                <canvas id="${canvasId}"></canvas>
            </div>
            ${stationsHtml}
        `;

        container.appendChild(card);

        if (aggregatedHistory.length > 0) {
            renderChart(canvasId, hudId, defaultHudText, aggregatedHistory);
        }
    });
}

function renderChart(canvasId, hudId, defaultHudText, historyData) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext("2d");

    // Sort chronologically
    historyData.sort((a, b) => new Date(a.reported_hour) - new Date(b.reported_hour));

    // Calculate the dynamic daily midpoint index to consistently center the x-axis text label
    const dayIndexGroups = {};
    historyData.forEach((d, i) => {
        const dateStr = new Date(d.reported_hour).toLocaleDateString();
        if (!dayIndexGroups[dateStr]) {
            dayIndexGroups[dateStr] = [];
        }
        dayIndexGroups[dateStr].push(i);
    });

    const midpointIndices = new Set();
    Object.values(dayIndexGroups).forEach(indices => {
        // Floor division gets the exact center index of the available contiguous hours for that date
        const mid = indices[Math.floor(indices.length / 2)];
        midpointIndices.add(mid);
    });

    // X Axis Labels
    const labels = historyData.map(d => {
        const date = new Date(d.reported_hour);
        const day = date.toLocaleDateString([], { weekday: 'short' });
        const time = date.toLocaleTimeString([], { hour: 'numeric' });
        return `${day} ${time}`;
    });

    // High–low "bricks" plus average line
    const highLowBars = historyData.map((d, index) => ({
        x: labels[index],
        y: [d.min_docks_available || 0, d.max_docks_available || 0]
    }));

    const midnightDividerPlugin = {
        id: 'midnightDivider',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            historyData.forEach((d, index) => {
                const date = new Date(d.reported_hour);
                if (date.getHours() === 0) {
                    // Shift x offset to the boundary edge of the category (true midnight gridline location)
                    let x;
                    if (index > 0) {
                        x = (xAxis.getPixelForTick(index) + xAxis.getPixelForTick(index - 1)) / 2;
                    } else if (historyData.length > 1) {
                        const step = xAxis.getPixelForTick(1) - xAxis.getPixelForTick(0);
                        x = xAxis.getPixelForTick(0) - step / 2;
                    } else {
                        x = xAxis.getPixelForTick(0);
                    }

                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.bottom);
                    ctx.lineTo(x, yAxis.bottom + 22);
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.restore();
                }
            });
        }
    };

    const averageLinesPlugin = {
        id: 'averageLines',
        afterDatasetsDraw: (chart) => {
            const ctx = chart.ctx;
            const yAxis = chart.scales.y;
            const meta = chart.getDatasetMeta(0); // High-Low Bars dataset

            if (!meta || meta.hidden) return;

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(56, 189, 248, 1)"; // Same as box border blue
            ctx.lineWidth = 1.5; // 1.5x the weight of the box border

            let isFirst = true;

            historyData.forEach((d, index) => {
                const avg = d.avg_docks_available || 0;
                const element = meta.data[index];

                if (element && !element.hidden) {
                    const y = yAxis.getPixelForValue(avg);
                    const left = element.x - (element.width / 2);
                    const right = element.x + (element.width / 2);

                    if (isFirst) {
                        ctx.moveTo(left, y);
                        isFirst = false;
                    } else {
                        // Connect previous block's right edge vertically down/up to current block's height
                        ctx.lineTo(left, y);
                    }
                    // Trace horizontal line covering current block
                    ctx.lineTo(right, y);
                }
            });

            ctx.stroke();
            ctx.restore();
        }
    };

    const xAxisLabelsPlugin = {
        id: 'xAxisLabels',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const yAxis = chart.scales.y;
            const meta = chart.getDatasetMeta(0);

            if (!meta || meta.hidden) return;

            ctx.save();
            ctx.fillStyle = "#94a3b8";
            ctx.font = "bold 11px Inter";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            Object.values(dayIndexGroups).forEach(indices => {
                const firstIdx = indices[0];
                const lastIdx = indices[indices.length - 1];

                const firstEl = meta.data[firstIdx];
                const lastEl = meta.data[lastIdx];

                if (firstEl && lastEl && !firstEl.hidden && !lastEl.hidden) {
                    const leftPixel = firstEl.x - (firstEl.width / 2);
                    const rightPixel = lastEl.x + (lastEl.width / 2);
                    const centerPixel = (leftPixel + rightPixel) / 2;

                    const date = new Date(historyData[firstIdx].reported_hour);
                    const day = date.toLocaleDateString([], { weekday: 'short' });
                    const text = `${day} ${date.getMonth() + 1}/${date.getDate()}`;

                    ctx.fillText(text, centerPixel, yAxis.bottom + 16); // Follows the 16px user layout padding dynamically
                }
            });

            ctx.restore();
        }
    };

    const hoverHighlightPlugin = {
        id: 'hoverHighlight',
        beforeDatasetsDraw: (chart) => {
            if (typeof chart.getActiveElements !== 'function') return; // Lifecycle safety guarantee
            const activeElements = chart.getActiveElements();
            if (activeElements.length > 0) {
                const activePoint = activeElements[0];
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(activePoint.datasetIndex);
                if (!meta || meta.hidden) return;

                const element = meta.data[activePoint.index];
                if (element) {
                    ctx.save();
                    ctx.fillStyle = "rgba(255, 255, 255, 0.04)"; // Extremely subtle vertical timeline optical crosshair trace down timeline
                    const left = element.x - (element.width / 2);
                    const top = chart.chartArea.top;
                    const bottom = chart.chartArea.bottom;
                    ctx.fillRect(left, top, element.width, bottom - top);
                    ctx.restore();
                }
            }
        }
    };

    new Chart(ctx, {
        type: "bar", // "Flying bricks" as vertical bars
        plugins: [midnightDividerPlugin, averageLinesPlugin, xAxisLabelsPlugin, hoverHighlightPlugin],
        data: {
            labels: labels,
            datasets: [
                {
                    label: "High–Low Range",
                    type: "bar",
                    data: highLowBars,
                    borderColor: "transparent", // Box borders removed
                    backgroundColor: "#1b4968", // Solid blended color completely bypasses floating-pixel alpha-overlap accumulation
                    // hoverBackgroundColor dropped so the block tone remains neutral, deferring highlight entirely to the unified background column trace
                    borderWidth: 0,
                    borderSkipped: false,
                    categoryPercentage: 1.0, // Touches interval grid bounds perfectly
                    barPercentage: 1.0       // Computes layout width precisely without arbitrary overflow
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Dropped the legend natively
                },
                tooltip: {
                    enabled: false, // Suppresses native tooltip rendering
                    mode: "index",
                    intersect: false,
                    external: function (context) {
                        const tooltipModel = context.tooltip;
                        const hudEl = document.getElementById(hudId);
                        if (!hudEl) return;

                        // If mouse leaves chart, restore the live 'Now' default stats
                        if (tooltipModel.opacity === 0) {
                            hudEl.innerHTML = defaultHudText;
                            return;
                        }

                        // If hovering a block, inject the bounds dynamically into the HUD header DOM node
                        if (tooltipModel.body) {
                            const dataIndex = tooltipModel.dataPoints[0].dataIndex;
                            const d = historyData[dataIndex];

                            const start = new Date(d.reported_hour);
                            const end = new Date(start.getTime() + 60 * 60 * 1000);
                            const day = start.toLocaleDateString([], { weekday: 'short' });
                            const startStr = start.toLocaleTimeString([], { hour: 'numeric' }).toLowerCase();
                            const endStr = end.toLocaleTimeString([], { hour: 'numeric' }).toLowerCase();

                            const formatVal = (val) => {
                                const num = parseFloat(val);
                                return Number.isInteger(num) ? num.toString() : num.toFixed(1).replace(/\.0$/, '');
                            };

                            const max = formatVal(d.max_docks_available || 0);
                            const avg = formatVal(d.avg_docks_available || 0);
                            const min = formatVal(d.min_docks_available || 0);

                            hudEl.innerHTML = `
                                <div style="display: grid; grid-template-columns: 125px 1px 65px 1px 70px 1px 65px; column-gap: 12px; align-items: center; text-align: left;">
                                    <span style="color:#f8fafc;">${day} ${startStr} - ${endStr}</span>
                                    <div style="width:1px; height:12px; background:rgba(255,255,255,0.15);"></div>
                                    <span>Max: <br><b style="color:#fff;">${max}</b></span>
                                    <div style="width:1px; height:12px; background:rgba(255,255,255,0.15);"></div>
                                    <span>Avg: <br><b style="color:#fff;">${avg}</b></span>
                                    <div style="width:1px; height:12px; background:rgba(255,255,255,0.15);"></div>
                                    <span>Min: <br><b style="color:#fff;">${min}</b></span>
                                </div>
                            `;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        drawBorder: false,
                        drawTicks: false, // Turned off native ticks
                        color: function (context) {
                            if (context.index !== undefined && historyData[context.index]) {
                                const date = new Date(historyData[context.index].reported_hour);
                                if (date.getHours() === 0) return "rgba(255, 255, 255, 0.15)"; // Midnight vertical gridline
                            }
                            return "transparent";
                        }
                    },
                    ticks: {
                        color: "transparent", // Hide native text, drawn by custom xAxisLabelsPlugin to ensure true sub-pixel layout centering
                        font: { size: 11, family: "Inter", weight: "bold" },
                        maxRotation: 0,
                        autoSkip: false,
                        padding: 16, // Pushes x-axis labels down slightly
                        callback: function (value, index) {
                            if (midpointIndices.has(index) && historyData[index]) {
                                const date = new Date(historyData[index].reported_hour);
                                const day = date.toLocaleDateString([], { weekday: 'short' });
                                return `${day} ${date.getMonth() + 1}/${date.getDate()}`; // Date label dynamically centered with descriptive day attached
                            }
                            // Empty string ensures the tick still exists for the midnight gridline,
                            // without drawing overlapping text text labels.
                            return "";
                        }
                    }
                },
                y: {
                    display: true,
                    min: 0,
                    grid: {
                        color: "rgba(255, 255, 255, 0.05)",
                        drawBorder: false,
                        borderDash: [5, 5]
                    },
                    ticks: {
                        color: "#94a3b8",
                        font: { size: 10, family: "Inter" },
                        maxTicksLimit: 5,
                        padding: 10
                    }
                }
            },
            interaction: {
                mode: "nearest",
                axis: "x",
                intersect: false
            }
        }
    });
}