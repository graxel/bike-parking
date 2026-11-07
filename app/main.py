import os
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.gzip import GZipMiddleware
from psycopg2.extras import RealDictCursor
from app.shared import get_db_connection

# Default User ID for current phase
DEFAULT_USER_ID = "11111111-1111-1111-1111-111111111111"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks if needed
    yield
    # Shutdown tasks if needed

app = FastAPI(title="Citi Bike Parking Tracker — Master API", lifespan=lifespan)
# nginx doesn't gzip proxied responses, so compress here (map payloads are large)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Longest window a single /map/snapshots request may cover
MAX_SNAPSHOT_SPAN = timedelta(hours=48)
# Map time steps (seconds) -> the bucketed model that serves them
MAP_TABLES = {
    900: "consumption.con_station_availability_15min",
    300: "consumption.con_station_availability_5min",
}
DEFAULT_MAP_STEP = 900
# How long a silent station keeps its last value on the map
CARRY_FORWARD = timedelta(hours=1)

@app.get("/")
def base_api():
    return {"APIs": [
        "/current",
        "/history",
        "/map/stations",
        "/map/now",
        "/map/snapshots",
        "/station/{station_id}",
        # "/forecast"
    ]}

@app.get("/current")
@app.get("/current/")
def get_current_availability(user_id: str = DEFAULT_USER_ID):
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Efficiently query only the stations assigned to this user's groups
            cur.execute("""
                SELECT 
                    c.*,
                    sg.name as group_name
                FROM consumption.con_station_status_current c
                JOIN app.station_group_stations sgs ON c.station_id = sgs.station_id
                JOIN app.station_groups sg ON sgs.station_group_id = sg.id
                WHERE sg.user_id = %s
                ORDER BY sg.name, sgs.sort_order;
            """, (user_id,))
            rows = cur.fetchall()
            
            # Group rows by group_name
            groups_map = {}
            for r in rows:
                g_name = r["group_name"]
                if g_name not in groups_map:
                    groups_map[g_name] = {"name": g_name, "stations": []}
                
                # Cleanup row for JSON response
                st = dict(r)
                del st["group_name"]
                if st.get("last_reported") and not isinstance(st["last_reported"], str):
                    st["last_reported"] = st["last_reported"].isoformat()
                
                groups_map[g_name]["stations"].append(st)
            
            return {"data": list(groups_map.values())}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=traceback.format_exc())
    finally:
        conn.close()

@app.get("/history")
@app.get("/history/")
def get_history_availability(user_id: str = DEFAULT_USER_ID):
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Query history only for stations assigned to this user
            cur.execute("""
                SELECT 
                    h.station_id,
                    h.reported_hour,
                    h.min_docks_available,
                    h.avg_docks_available,
                    h.max_docks_available,
                    sg.name as group_name
                FROM consumption.con_station_availability_history h
                JOIN app.station_group_stations sgs ON h.station_id = sgs.station_id
                JOIN app.station_groups sg ON sgs.station_group_id = sg.id
                WHERE sg.user_id = %s
                  AND h.reported_hour >= date_trunc('day', NOW() - INTERVAL '8 days')
                ORDER BY h.reported_hour ASC;
            """, (user_id,))
            rows = cur.fetchall()
            
            # Organize by group name and then station_id
            groups_map = {}
            for raw_r in rows:
                r = dict(raw_r)
                g_name = r["group_name"]
                sid = str(r["station_id"])
                
                if g_name not in groups_map:
                    groups_map[g_name] = {"name": g_name, "stations": {}}
                
                if sid not in groups_map[g_name]["stations"]:
                    groups_map[g_name]["stations"][sid] = []
                
                if r.get("reported_hour"):
                    r["reported_hour"] = r["reported_hour"].isoformat()
                
                # Convert Decimals to floats for JSON
                r["min_docks_available"] = float(r["min_docks_available"]) if r.get("min_docks_available") is not None else 0.0
                r["avg_docks_available"] = float(r["avg_docks_available"]) if r.get("avg_docks_available") is not None else 0.0
                r["max_docks_available"] = float(r["max_docks_available"]) if r.get("max_docks_available") is not None else 0.0
                
                # Cleanup the row
                del r["group_name"]
                groups_map[g_name]["stations"][sid].append(r)
                
            return {"data": list(groups_map.values())}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


def _epoch(ts):
    return int(ts.timestamp()) if ts is not None else None


def _map_table(step: int) -> str:
    if step not in MAP_TABLES:
        raise HTTPException(status_code=400, detail=f"step must be one of {sorted(MAP_TABLES)}")
    return MAP_TABLES[step]


def _as_utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


@app.get("/map/stations")
@app.get("/map/stations/")
def get_map_stations(response: Response, step: int = DEFAULT_MAP_STEP):
    """Static info for every station, plus the range of time steps available for the time tape."""
    table = _map_table(step)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT station_id, station_name, lat, lon, capacity
                FROM consumption.con_station_status_current
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                ORDER BY station_id;
            """)
            stations = [
                {"id": sid, "name": name, "lat": lat, "lon": lon, "capacity": capacity}
                for sid, name, lat, lon, capacity in cur.fetchall()
            ]
            cur.execute(f"SELECT MIN(bucket_start), MAX(bucket_start) FROM {table};")
            history_start, history_end = cur.fetchone()

        response.headers["Cache-Control"] = "public, max-age=300"
        return {
            "stations": stations,
            "history_start": _epoch(history_start),
            "history_end": _epoch(history_end),
            "step_seconds": step,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/map/now")
@app.get("/map/now/")
def get_map_now(response: Response):
    """Live docks/bikes for every station, in the same frame format as /map/snapshots."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT station_id, num_docks_available, num_bikes_available, reported_at
                FROM consumption.con_station_status_current
                ORDER BY station_id;
            """)
            rows = cur.fetchall()

        latest = max((r[3] for r in rows if r[3] is not None), default=None)
        response.headers["Cache-Control"] = "public, max-age=30"
        return {
            "stations": [r[0] for r in rows],
            "frames": [{
                "t": _epoch(latest),
                "docks": [r[1] for r in rows],
                "bikes": [r[2] for r in rows],
            }],
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/map/snapshots")
@app.get("/map/snapshots/")
def get_map_snapshots(response: Response, start: datetime, end: datetime, step: int = DEFAULT_MAP_STEP):
    """
    Average docks/bikes (1 decimal) per `step`-second bucket for every station between
    start and end (inclusive).
    Column-oriented to keep the payload small: each frame's docks/bikes arrays
    line up with the top-level stations list, with null where a station has no data.

    Stations don't check in every 15 minutes, so a station's last bucket is carried
    forward for up to CARRY_FORWARD; longer silences show as no data.
    """
    table = _map_table(step)
    start, end = _as_utc(start), _as_utc(end)
    if end < start:
        raise HTTPException(status_code=400, detail="end must be after start")
    if end - start > MAX_SNAPSHOT_SPAN:
        raise HTTPException(status_code=400, detail=f"span may not exceed {MAX_SNAPSHOT_SPAN}")

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    EXTRACT(EPOCH FROM bucket_start)::bigint,
                    station_id,
                    avg_docks_available::float8,
                    avg_bikes_available::float8
                FROM {table}
                WHERE bucket_start >= %s AND bucket_start <= %s
                ORDER BY bucket_start;
            """, (start - CARRY_FORWARD, end))
            rows = cur.fetchall()

        station_ids = sorted({r[1] for r in rows})
        index = {sid: i for i, sid in enumerate(station_ids)}
        by_bucket = {}
        for t, sid, docks, bikes in rows:
            by_bucket.setdefault(t, []).append((index[sid], docks, bikes))

        carry = int(CARRY_FORWARD.total_seconds())
        first = int(start.timestamp()) // step * step
        last_seen = {}  # station index -> (bucket epoch, docks, bikes)
        frames = []
        for t in range(first - carry, int(end.timestamp()) + 1, step):
            for i, docks, bikes in by_bucket.get(t, ()):
                last_seen[i] = (t, docks, bikes)
            if t < first:
                continue
            docks_col = [None] * len(station_ids)
            bikes_col = [None] * len(station_ids)
            for i, (seen, docks, bikes) in last_seen.items():
                if t - seen <= carry:
                    docks_col[i] = docks
                    bikes_col[i] = bikes
            # Buckets where nobody reported (pipeline outage) are left out entirely
            if any(d is not None for d in docks_col):
                frames.append({"t": t, "docks": docks_col, "bikes": bikes_col})

        # The model re-aggregates the last couple of hours each run, so only
        # older windows are safe to cache for long.
        settled = end < datetime.now(timezone.utc) - timedelta(hours=3)
        response.headers["Cache-Control"] = "public, max-age=86400" if settled else "public, max-age=60"
        return {"stations": station_ids, "frames": frames}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/station/{station_id}")
@app.get("/station/{station_id}/")
def get_station(
    station_id: str,
    resolution: str = Query("hour", pattern="^(hour|raw)$"),
    days: int = Query(8, ge=1, le=8),
):
    """
    One station's current state plus its history.
    resolution=hour -> hourly min/avg/max from the history table (light; used for map hover)
    resolution=raw  -> every reported change from int_station_status (used for the detail page)
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT station_id, station_name, lat, lon, capacity,
                       num_bikes_available, num_docks_available, reported_at
                FROM consumption.con_station_status_current
                WHERE station_id = %s;
            """, (station_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="station not found")
            station = {
                "id": row[0], "name": row[1], "lat": row[2], "lon": row[3], "capacity": row[4],
                "bikes": row[5], "docks": row[6], "reported_at": _epoch(row[7]),
            }

            if resolution == "hour":
                cur.execute("""
                    SELECT EXTRACT(EPOCH FROM reported_hour)::bigint,
                           avg_bikes_available, min_bikes_available, max_bikes_available,
                           avg_docks_available, min_docks_available, max_docks_available
                    FROM consumption.con_station_availability_history
                    WHERE station_id = %s
                      AND reported_hour >= date_trunc('hour', NOW() - make_interval(days => %s))
                    ORDER BY reported_hour;
                """, (station_id, days))
                keys = ["t", "bikes_avg", "bikes_min", "bikes_max", "docks_avg", "docks_min", "docks_max"]
            else:
                cur.execute("""
                    SELECT EXTRACT(EPOCH FROM reported_at)::bigint, num_bikes_available, num_docks_available
                    FROM intermediate.int_station_status
                    WHERE station_id = %s
                      AND reported_at >= NOW() - make_interval(days => %s)
                    ORDER BY reported_at;
                """, (station_id, days))
                keys = ["t", "bikes", "docks"]
            rows = cur.fetchall()

        # Column-oriented series; Decimals -> floats for JSON
        series = {k: [] for k in keys}
        for r in rows:
            for k, v in zip(keys, r):
                series[k].append(float(v) if v is not None and k != "t" else v)
        return {"station": station, "resolution": resolution, "series": series}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
