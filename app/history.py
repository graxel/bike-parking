"""History service — port 40501.

Returns hourly aggregated station availability history, organized by station groups.
Accessed via: data.kevingrazel.com/bike-parking/history/
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from app.shared import get_db_connection, load_groups


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.groups = load_groups()
    yield

app = FastAPI(title="Bike Parking — History", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kevingrazel.com", "http://localhost:3000"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def get_history_availability():
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    station_id,
                    reported_hour,
                    min_docks_available,
                    avg_docks_available,
                    max_docks_available
                FROM consumption.con_station_availability_history
                ORDER BY reported_hour ASC
            """)
            rows = cur.fetchall()

            # Organize by station_id
            history_map = {}
            for raw_r in rows:
                r = dict(raw_r)
                sid = str(r["station_id"])
                if sid not in history_map:
                    history_map[sid] = []

                if r.get("reported_hour"):
                    r["reported_hour"] = r["reported_hour"].isoformat()

                # Conversion to primitive types
                r["min_docks_available"] = float(r["min_docks_available"]) if r.get("min_docks_available") is not None else 0.0
                r["avg_docks_available"] = float(r["avg_docks_available"]) if r.get("avg_docks_available") is not None else 0.0
                r["max_docks_available"] = float(r["max_docks_available"]) if r.get("max_docks_available") is not None else 0.0

                history_map[sid].append(r)

            result = []
            for group in app.state.groups:
                group_data = {"name": group["name"], "stations": {}}
                for sid in group.get("stations", []):
                    group_data["stations"][str(sid)] = history_map.get(str(sid), [])
                result.append(group_data)
            return {"data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
