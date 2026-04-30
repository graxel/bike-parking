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
 *   QA (Test):   https://data.kevingrazel.com:4443/bike-parking
 */
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

const API_CONFIGS = {
    // Use local Nginx proxies when developing locally to bypass CORS,
    // otherwise use absolute URLs for the deployed Github Pages site.
    prod: isLocal ? "/bike-parking/prod-proxy" : "https://data.kevingrazel.com/bike-parking",
    qa: isLocal ? "/bike-parking/qa-proxy" : "https://data.kevingrazel.com:4443/bike-parking",
    dev: `${window.location.origin}/bike-parking`,
};

function getApiBase() {
    const params = new URLSearchParams(window.location.search);
    const env = params.get("api");

    if (env) return API_CONFIGS[env] || API_CONFIGS.qa;

    // Default: dev for localhost, prod for remote
    return API_CONFIGS.qa;
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
        let totalCapacity = 0;
        let stationsHtml = '<div class="station-list" style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-secondary); border-top: 1px solid var(--surface-border); padding-top: 1rem;">';

        group.stations.forEach(station => {
            totalBikes += (station.num_bikes_available || 0);
            totalDocks += (station.num_docks_available || 0);
            totalCapacity += (station.capacity || 0);
            const stationSpanId = `station-${station.station_id}-val-${group.name.replace(/[^a-zA-Z0-9]/g, '-')}`;

            const safeDocks = Math.round(station.num_docks_available || 0);
            const paddedDocks = (safeDocks >= 0 && safeDocks < 10) ? `<span style="visibility: hidden;">0</span>${safeDocks}` : `${safeDocks}`;

            stationsHtml += `
                <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem; align-items:center;">
                    <span style="color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 50%;">${station.station_name || 'Station ' + station.station_id}</span>
                    <span id="${stationSpanId}" style="text-align: right; min-width: 150px; font-variant-numeric: tabular-nums;">
                        <span style="background: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 0.2rem 0.6rem; border-radius: 4px; font-weight:600;">docks: ${paddedDocks}</span>
                    </span>
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
        const groupSlug = group.name.replace(/[^a-zA-Z0-9]/g, '-');
        const dateAreaId = `date-area-${groupSlug}`;

        const padToTwo = (num) => {
            const val = Math.round(num);
            return (val >= 0 && val < 10) ? `<span style="visibility: hidden;">0</span>${val}` : `${val}`;
        };

        const defaultHudText = `
            <div style="display: grid; grid-template-columns: auto auto; gap: 0.15rem 0.5rem; align-items: center; justify-content: end;">
                <div style="font-size: 0.95rem;">&nbsp;</div>
                <div style="font-size: 0.95rem;">&nbsp;</div>
                <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right;">Docks:</div>
                <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right; font-variant-numeric: tabular-nums;">${padToTwo(totalDocks)}</div>
                <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right;">Bikes:</div>
                <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right; font-variant-numeric: tabular-nums;">${padToTwo(totalBikes)}</div>
            </div>
        `;

        card.innerHTML = `
            <div class="group-header" style="margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: none; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: nowrap; gap: 10px;">
                <div style="display: flex; flex-direction: column;">
                    <h2 class="group-title" style="margin-bottom: 0.25rem;">${group.name}</h2>
                    <div id="${dateAreaId}" style="visibility: hidden; color: var(--text-secondary); font-size: 0.95rem; line-height: 1.3;">
                        <div style="margin-top: 0.2rem;">Day</div>
                        <div>Time</div>
                    </div>
                </div>
                <div id="${hudId}" style="display: flex; align-items: flex-start; justify-content: flex-end;">${defaultHudText}</div>
            </div>
            <div class="chart-container" style="height: 265px; margin-bottom: 1rem;">
                <canvas id="${canvasId}"></canvas>
            </div>
            ${stationsHtml}
        `;

        container.appendChild(card);

        if (aggregatedHistory.length > 0) {
            renderChart(canvasId, hudId, defaultHudText, aggregatedHistory, totalCapacity, totalDocks, totalBikes, group.stations, hGroup ? hGroup.stations : {}, groupSlug);
        }
    });
}

function renderChart(canvasId, hudId, defaultHudText, historyData, totalCapacity, totalDocks, totalBikes, groupStations, historyStations, groupSlug) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext("2d");

    const now = new Date();

    // Sort chronologically
    historyData.sort((a, b) => new Date(a.reported_hour) - new Date(b.reported_hour));

    // Calculate expected interval dynamically without any magic multipliers.
    // Since SQL uses DATE_TRUNC, consecutive buckets will have exactly 'minInterval' diff.
    let minInterval = Infinity;
    for (let i = 1; i < historyData.length; i++) {
        const diff = new Date(historyData[i].reported_hour) - new Date(historyData[i - 1].reported_hour);
        if (diff > 0 && diff < minInterval) minInterval = diff;
    }

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

    // Use local time for chart bounds because the chartjs-adapter-date-fns generates
    // ticks in local time. Data timestamps (UTC ISO strings) are correctly converted
    // to epoch ms by Date.parse(), so they align with local Date boundaries.
    const chartMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const chartMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() < 12 ? 0 : 1), 23, 59, 59, 999);

    const lowerBars = historyData.map((d) => ({
        x: new Date(d.reported_hour).getTime() + 30 * 60 * 1000,
        y: [d.min_docks_available || 0, d.avg_docks_available || 0]
    }));

    const upperBars = historyData.map((d) => ({
        x: new Date(d.reported_hour).getTime() + 30 * 60 * 1000,
        y: [d.avg_docks_available || 0, d.max_docks_available || 0]
    }));

    const midnightGridLinesPlugin = {
        id: 'midnightGridLines',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;

            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
            ctx.lineWidth = 1;

            let currentDay = new Date(chartMin.getFullYear(), chartMin.getMonth(), chartMin.getDate() + 1);

            while (currentDay <= chartMax) {
                const x = xAxis.getPixelForValue(currentDay.getTime());

                // Only draw if within chart area visually
                if (x >= xAxis.left && x <= xAxis.right) {
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom + 40);
                    ctx.stroke();
                }
                currentDay = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate() + 1);
            }
            ctx.restore();
        }
    };

    /*
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

                    // Gap detection: If the time between points is strictly greater than our expected bucket interval...
                    if (index > 0) {
                        const prevDate = new Date(historyData[index - 1].reported_hour);
                        const currDate = new Date(d.reported_hour);
                        if (currDate - prevDate > minInterval) {
                            isFirst = true; // Break the average line to avoid bridging missing data
                        }
                    }

                    if (isFirst) {
                        ctx.moveTo(left, y);
                        isFirst = false;
                    } else {
                        ctx.lineTo(left, y);
                    }
                    ctx.lineTo(right, y);
                }
            });

            ctx.stroke();
            ctx.restore();
        }
    };
    */

    const xAxisLabelsPlugin = {
        id: 'xAxisLabels',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            const meta = chart.getDatasetMeta(0);

            if (!meta || meta.hidden) return;

            ctx.save();
            ctx.fillStyle = "#94a3b8";
            ctx.font = "bold 11px Inter";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            // Loop through each local day from chartMin to chartMax
            let currentDay = new Date(chartMin.getFullYear(), chartMin.getMonth(), chartMin.getDate());
            while (currentDay <= chartMax) {
                const dayStart = Math.max(currentDay.getTime(), chartMin.getTime());
                const nextDay = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate() + 1);

                const dayEnd = Math.min(nextDay.getTime() - 1, chartMax.getTime());

                // Find pixel positions
                const xStart = xAxis.getPixelForValue(dayStart);
                const xEnd = xAxis.getPixelForValue(dayEnd);
                const centerPixel = (xStart + xEnd) / 2;

                const dayStr = currentDay.toLocaleDateString([], { weekday: 'short' });
                const dateStr = `${currentDay.getMonth() + 1}/${currentDay.getDate()}`;

                ctx.fillText(dayStr, centerPixel, yAxis.bottom + 10);
                ctx.fillText(dateStr, centerPixel, yAxis.bottom + 24);

                // Advance to next day
                currentDay = nextDay;
            }

            ctx.restore();
        }
    };

    const hoverHighlightPlugin = {
        id: 'hoverHighlight',
        beforeDatasetsDraw: (chart) => {
            if (typeof chart.getActiveElements !== 'function') return;
            const activeElements = chart.getActiveElements();
            if (activeElements.length > 0) {
                const activePoint = activeElements[0];
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(activePoint.datasetIndex);
                if (!meta || meta.hidden) return;

                const element = meta.data[activePoint.index];
                if (element) {
                    ctx.save();
                    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
                    const left = element.x - (element.width / 2);
                    const top = chart.chartArea.top;
                    const bottom = chart.chartArea.bottom;
                    ctx.fillRect(left, top, element.width, bottom - top);
                    ctx.restore();
                }
            }
        }
    };

    const lowerBgColor = function(context) {
        const chart = context.chart;
        const {ctx, chartArea} = chart;
        if (!chartArea) return null;
        if (context.type !== 'data') return 'transparent';
        const meta = chart.getDatasetMeta(context.datasetIndex);
        const element = meta.data[context.dataIndex];
        if (!element) return 'transparent';
        
        const yTop = element.y;
        const yBottom = element.base;
        if (yTop === yBottom) return "#235c84";

        const gradient = ctx.createLinearGradient(0, yTop, 0, yBottom);
        gradient.addColorStop(0, "#235c84"); // more prominent (avg)
        gradient.addColorStop(1, "#14354c"); // less prominent (min)
        return gradient;
    };

    const upperBgColor = function(context) {
        const chart = context.chart;
        const {ctx, chartArea} = chart;
        if (!chartArea) return null;
        if (context.type !== 'data') return 'transparent';
        const meta = chart.getDatasetMeta(context.datasetIndex);
        const element = meta.data[context.dataIndex];
        if (!element) return 'transparent';
        
        const yTop = element.y;
        const yBottom = element.base;
        if (yTop === yBottom) return "#235c84";

        const gradient = ctx.createLinearGradient(0, yTop, 0, yBottom);
        gradient.addColorStop(0, "#14354c"); // less prominent (max)
        gradient.addColorStop(1, "#235c84"); // more prominent (avg)
        return gradient;
    };

    const chart = new Chart(ctx, {
        type: "bar", // "Flying bricks" as vertical bars
        plugins: [midnightGridLinesPlugin, /*averageLinesPlugin,*/ xAxisLabelsPlugin, hoverHighlightPlugin],
        data: {
            datasets: [
                {
                    label: "Lower Range",
                    type: "bar",
                    grouped: false,
                    data: lowerBars,
                    borderColor: "transparent",
                    backgroundColor: lowerBgColor,
                    borderWidth: 0,
                    borderSkipped: false,
                    categoryPercentage: 1.0,
                    barPercentage: 1.0
                },
                {
                    label: "Upper Range",
                    type: "bar",
                    grouped: false,
                    data: upperBars,
                    borderColor: "transparent",
                    backgroundColor: upperBgColor,
                    borderWidth: 0,
                    borderSkipped: false,
                    categoryPercentage: 1.0,
                    barPercentage: 1.0
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
                        // This function handles the custom HTML tooltip / HUD updates.
                        // It reads the raw data from `historyData` corresponding to the hovered bar.
                        const tooltipModel = context.tooltip;
                        const hudEl = document.getElementById(hudId);
                        const dateAreaEl = document.getElementById(`date-area-${groupSlug}`);

                        if (!hudEl) return;

                        // If mouse leaves chart, restore the live 'Now' default stats
                        if (tooltipModel.opacity === 0) {
                            hudEl.innerHTML = defaultHudText;

                            if (dateAreaEl) {
                                dateAreaEl.style.visibility = "hidden";
                            }

                            // Restore individual stations
                            groupStations.forEach(s => {
                                const sId = `station-${s.station_id}-val-${groupSlug}`;
                                const el = document.getElementById(sId);
                                if (el) {
                                    const safeDocks = Math.round(s.num_docks_available || 0);
                                    const paddedDocks = (safeDocks >= 0 && safeDocks < 10) ? `<span style="visibility: hidden;">0</span>${safeDocks}` : `${safeDocks}`;
                                    el.innerHTML = `<span style="background: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 0.2rem 0.6rem; border-radius: 4px; font-weight:600;">docks: ${paddedDocks}</span>`;
                                }
                            });
                            return;
                        }

                        // If hovering a block, inject the bounds dynamically into the metrics and HUD
                        if (tooltipModel.body) {
                            const dataIndex = tooltipModel.dataPoints[0].dataIndex;
                            const d = historyData[dataIndex];
                            const hoverHour = d.reported_hour;

                            // We read the original reported_hour string from the database (e.g., "2026-04-13T18:00:00+00:00")
                            // and parse it into a JavaScript Date object.
                            const start = new Date(d.reported_hour);
                            // We define the end of the interval as 1 hour (60 * 60 * 1000 ms) after the start.
                            const end = new Date(start.getTime() + 60 * 60 * 1000);
                            const day = start.toLocaleDateString([], { weekday: 'long' });
                            const startStr = start.toLocaleTimeString([], { hour: 'numeric' }).toLowerCase();
                            const endStr = end.toLocaleTimeString([], { hour: 'numeric' }).toLowerCase();

                            const formatVal = (val) => {
                                const num = parseFloat(val);
                                let fixedStr = num.toFixed(1);

                                if (num >= 0 && num < 10) {
                                    fixedStr = `<span style="visibility: hidden;">0</span>${fixedStr}`;
                                }

                                if (fixedStr.endsWith('.0')) {
                                    return `${fixedStr.slice(0, -2)}<span style="visibility: hidden;">.0</span>`;
                                }
                                return fixedStr;
                            };

                            const max = formatVal(d.max_docks_available || 0);
                            const avg = formatVal(d.avg_docks_available || 0);
                            const min = formatVal(d.min_docks_available || 0);

                            // Set HUD to active min/avg/max
                            hudEl.innerHTML = `
                                <div style="display: grid; grid-template-columns: auto auto; gap: 0.15rem 0.5rem; align-items: center; justify-content: end;">
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right;">Max Docks:</div>
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right; font-variant-numeric: tabular-nums;">${max}</div>
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right;">Avg Docks:</div>
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right; font-variant-numeric: tabular-nums;">${avg}</div>
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right;">Min Docks:</div>
                                    <div style="color: var(--success-color); font-weight: 600; font-size: 1.0rem; text-align: right; font-variant-numeric: tabular-nums;">${min}</div>
                                </div>
                            `;

                            if (dateAreaEl) {
                                dateAreaEl.innerHTML = `
                                    <div style="margin-top: 0.2rem;">${day}</div>
                                    <div>${startStr} - ${endStr}</div>
                                `;
                                dateAreaEl.style.visibility = "visible";
                            }

                            // Update individual stations with avg
                            groupStations.forEach(s => {
                                const sId = `station-${s.station_id}-val-${groupSlug}`;
                                const el = document.getElementById(sId);
                                if (el) {
                                    const sHistory = historyStations[s.station_id] || [];
                                    const hEntry = sHistory.find(h => h.reported_hour === hoverHour);
                                    if (hEntry) {
                                        const hAvg = formatVal(hEntry.avg_docks_available || 0);
                                        el.innerHTML = `<span style="background: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 0.2rem 0.6rem; border-radius: 4px; font-weight:600;">avg docks: ${hAvg}</span>`;
                                    } else {
                                        el.innerHTML = `<span style="color: var(--text-secondary); font-size: 0.9rem;">no data</span>`;
                                    }
                                }
                            });
                        }
                    }
                }
            },
            scales: {
                x: {
                    // The 'time' scale instructs Chart.js to treat the x-axis as a continuous timeline.
                    // It maps the 'x' epoch ms values from our dataset exactly to their physical position on the axis.
                    type: 'time',
                    min: chartMin.getTime(),
                    max: chartMax.getTime(),
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm'
                        }
                    },
                    display: true,
                    grid: {
                        drawBorder: false,
                        drawTicks: false,
                        drawOnChartArea: true,
                        color: "transparent"
                    },
                    offset: false,
                    ticks: {
                        color: "transparent",
                        font: { size: 11, family: "Inter", weight: "bold" },
                        maxRotation: 0,
                        autoSkip: false,
                        padding: 30
                    }
                },
                y: {
                    display: true,
                    min: 0,
                    // max: totalCapacity,
                    grid: {
                        color: function (context) {
                            if (context.tick.value === 0) return "rgba(255, 255, 255, 0.4)";
                            return "rgba(255, 255, 255, 0.05)";
                        },
                        drawBorder: false,
                        borderDash: function (context) {
                            if (context.tick.value === 0) return [];
                            return [5, 5];
                        }
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

    // On mobile, tapping the chart triggers the hover state. 
    // We want the hover state to immediately clear when the user lifts their finger.
    const clearHoverState = (e) => {
        // Prevent the browser from firing synthetic mousemove/click events
        // immediately after the touchend, which would re-trigger the chart hover.
        if (e && e.cancelable && e.type.startsWith('touch')) {
            e.preventDefault();
        }

        // Delay the clear slightly so any pending Chart.js animation frames 
        // (from a late touchmove) are processed first, ensuring our clear isn't overwritten.
        setTimeout(() => {
            // Clear Chart.js internal state
            chart.setActiveElements([]);
            chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            chart.update();

            // Force an immediate synchronous reset of the HUD and UI elements
            // bypassing any async Chart.js render queues.
            const hudEl = document.getElementById(hudId);
            if (hudEl) hudEl.innerHTML = defaultHudText;

            const dateAreaEl = document.getElementById(`date-area-${groupSlug}`);
            if (dateAreaEl) dateAreaEl.style.visibility = "hidden";

            groupStations.forEach(s => {
                const sId = `station-${s.station_id}-val-${groupSlug}`;
                const elId = document.getElementById(sId);
                if (elId) {
                    const safeDocks = Math.round(s.num_docks_available || 0);
                    const paddedDocks = (safeDocks >= 0 && safeDocks < 10) ? `<span style="visibility: hidden;">0</span>${safeDocks}` : `${safeDocks}`;
                    elId.innerHTML = `<span style="background: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 0.2rem 0.6rem; border-radius: 4px; font-weight:600;">docks: ${paddedDocks}</span>`;
                }
            });
        }, 50);
    };

    // { passive: false } is required so we can call e.preventDefault()
    el.addEventListener('touchend', clearHoverState, { passive: false });
    el.addEventListener('touchcancel', clearHoverState, { passive: false });
    el.addEventListener('mouseleave', clearHoverState);
}