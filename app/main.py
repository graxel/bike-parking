import os
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

# CORS is handled by nginx in production, but allow it here for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kevingrazel.com", "http://localhost:3000"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

@app.get("/current")
@app.get("/current/")
@app.get("/")
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
