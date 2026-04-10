import os
import yaml
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        dbname=os.getenv("DB_NAME"),
    )
    return conn

def load_groups():
    config_path = os.path.join(os.path.dirname(__file__), "config", "groups.yaml")
    if not os.path.exists(config_path):
        return []
    with open(config_path, "r") as f:
        data = yaml.safe_load(f)
    return data.get("groups", [])

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.groups = load_groups()
    yield
    # Shutdown

app = FastAPI(title="Citi Bike Parking Tracker", lifespan=lifespan)

@app.get("/api/groups")
def get_groups():
    return {"groups": app.state.groups}

@app.get("/api/availability/current")
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

@app.get("/api/availability/history")
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

# Mount frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
os.makedirs(frontend_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
