import os
import json
import requests
import traceback
import subprocess
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from app.shared import get_db_connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="Citi Bike Parking Tracker — Health API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

def check_endpoint(url: str):
    try:
        resp = requests.get(url, timeout=5)
        is_ok = resp.status_code == 200
        data = resp.json()
        has_data = "data" in data
        return {
            "status": "ok" if is_ok and has_data else "error",
            "status_code": resp.status_code,
            "has_data_key": has_data,
        }
    except Exception as e:
        return {
            "status": "error",
            "error_msg": str(e)
        }

def get_docker_containers_state():
    try:
        # Use curl to query the docker socket directly
        docker_json_str = subprocess.check_output(
            ["curl", "-s", "--unix-socket", "/var/run/docker.sock", "http://localhost/containers/json"],
            text=True
        )
        containers = json.loads(docker_json_str)
        result = []
        for c in containers:
            # Container names usually start with a slash in the API, e.g., "/bike-parking-api-1"
            names = [n.strip("/") for n in c.get("Names", [])]
            result.append({
                "names": names,
                "state": c.get("State"),
                "status": c.get("Status")
            })
        return result, "ok"
    except Exception as e:
        return {"error": str(e)}, "degraded"

def verify_api_endpoints():
    history_port = os.getenv("HISTORY_PORT", "40501")
    # In docker-compose, the main API service is 'api'
    api_base_url = f"http://api:{history_port}"
    
    current_endpoint = check_endpoint(f"{api_base_url}/current")
    history_endpoint = check_endpoint(f"{api_base_url}/history")
    
    status = "ok"
    if current_endpoint["status"] == "error" or history_endpoint["status"] == "error":
        status = "degraded"
        
    return {
        "current_endpoint": current_endpoint,
        "history_endpoint": history_endpoint
    }, status

def get_airflow_dag_runs():
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT dag_id, state, execution_date, start_date, end_date
                FROM airflow.dag_run
                ORDER BY start_date DESC
                LIMIT 10;
            """)
            rows = cur.fetchall()
            dag_runs = []
            for r in rows:
                r_dict = dict(r)
                if r_dict.get("execution_date"):
                    r_dict["execution_date"] = r_dict["execution_date"].isoformat()
                if r_dict.get("start_date"):
                    r_dict["start_date"] = r_dict["start_date"].isoformat()
                if r_dict.get("end_date"):
                    r_dict["end_date"] = r_dict["end_date"].isoformat()
                dag_runs.append(r_dict)
            return {"recent_dag_runs": dag_runs}, "ok"
    except Exception as e:
        return {"error": str(e)}, "degraded"
    finally:
        if conn:
            conn.close()

def get_git_commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception as e:
        return "unknown"

@app.get("/")
def get_health():
    git_commit = get_git_commit()
    docker_containers, docker_status = get_docker_containers_state()
    api_verification, api_status = verify_api_endpoints()
    airflow_runs, airflow_status = get_airflow_dag_runs()

    overall_status = "ok"
    if "degraded" in (docker_status, api_status, airflow_status):
        overall_status = "degraded"

    return {
        "status": overall_status,
        "git_commit": git_commit,
        "docker_containers": docker_containers,
        "airflow": airflow_runs,
        "api_verification": api_verification
    }
