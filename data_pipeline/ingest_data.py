import json
import logging
import requests
from datetime import datetime
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

def ingest_status(conn, scheduled_time=None):
    """Fetches station status and inserts it into raw.station_status."""
    url = "https://gbfs.citibikenyc.com/gbfs/en/station_status.json"
    logger.info(f"Requesting station status from {url}")
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    
    stations = data.get("data", {}).get("stations", [])
    
    insert_query = """
        INSERT INTO raw.station_status (raw_json, airflow_scheduled_time) VALUES %s
    """
    
    values = []
    for s in stations:
        values.append((
            json.dumps(s),
            scheduled_time
        ))
    
    with conn.cursor() as cur:
        execute_values(cur, insert_query, values)
    conn.commit()
    logger.info(f"Ingested {len(stations)} station status records.")

def ingest_information(conn, scheduled_time=None):
    """Fetches station information and updates it in raw.station_information."""
    url = "https://gbfs.citibikenyc.com/gbfs/en/station_information.json"
    logger.info(f"Requesting station information from {url}")
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    
    stations = data.get("data", {}).get("stations", [])
    
    insert_query = """
        INSERT INTO raw.station_information (
            station_id, raw_json, airflow_scheduled_time
        ) VALUES %s
        ON CONFLICT (station_id) DO UPDATE SET
            raw_json = EXCLUDED.raw_json,
            ingested_at = CURRENT_TIMESTAMP,
            airflow_scheduled_time = EXCLUDED.airflow_scheduled_time;
    """
    values = []
    for s in stations:
        values.append((
            s.get("station_id"),
            json.dumps(s),
            scheduled_time
        ))
        
    with conn.cursor() as cur:
        execute_values(cur, insert_query, values)
    conn.commit()
    logger.info(f"Ingested {len(stations)} station information records.")
