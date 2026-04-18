"""Current conditions service — port 40502.

Returns live station availability, organized by station groups.
Accessed via: data.kevingrazel.com/bike-parking/current/
"""

import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from app.shared import get_db_connection, load_groups


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.groups = load_groups()
    yield

app = FastAPI(title="Bike Parking — Current Conditions", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kevingrazel.com", "http://localhost:3000"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def get_current_availability():
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM consumption.con_station_status_current
            """)
            rows = cur.fetchall()

            # Map by station_id for quick lookup
            station_map = {str(r["station_id"]): dict(r) for r in rows}

            result = []
            for group in app.state.groups:
                group_data = {"name": group["name"], "stations": []}
                for sid in group.get("stations", []):
                    if str(sid) in station_map:
                        # Convert datetime to ISO string
                        st = dict(station_map.get(str(sid), {}))
                        if st:
                            if st.get("last_reported") and not isinstance(st["last_reported"], str):
                                st["last_reported"] = st["last_reported"].isoformat()
                            group_data["stations"].append(st)
                result.append(group_data)
            return {"data": result}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=traceback.format_exc())
    finally:
        conn.close()
