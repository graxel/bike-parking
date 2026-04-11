import json
import logging
import requests
from datetime import datetime
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

def ingest_status(conn):
    """Fetches station status and inserts it into raw.station_status."""
    url = "https://gbfs.citibikenyc.com/gbfs/en/station_status.json"
    logger.info(f"Requesting station status from {url}")
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    
    stations = data.get("data", {}).get("stations", [])
    
    insert_query = """
        INSERT INTO raw.station_status (raw_json) VALUES %s
    """
    
    values = []
    for s in stations:
        values.append((
            json.dumps(s),
        ))
    
    with conn.cursor() as cur:
        execute_values(cur, insert_query, values)
    conn.commit()
    logger.info(f"Ingested {len(stations)} station status records.")

def ingest_information(conn):
    """Fetches station information and updates it in raw.station_information."""
    url = "https://gbfs.citibikenyc.com/gbfs/en/station_information.json"
    logger.info(f"Requesting station information from {url}")
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    
    stations = data.get("data", {}).get("stations", [])
    
    insert_query = """
        INSERT INTO raw.station_information (
            station_id, raw_json
        ) VALUES %s
        ON CONFLICT (station_id) DO UPDATE SET
            raw_json = EXCLUDED.raw_json,
            ingested_at = CURRENT_TIMESTAMP;
    """
    values = []
    for s in stations:
        values.append((
            s.get("station_id"),
            json.dumps(s)
        ))
        
    with conn.cursor() as cur:
        execute_values(cur, insert_query, values)
    conn.commit()
    logger.info(f"Ingested {len(stations)} station information records.")
