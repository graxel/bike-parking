import argparse
import logging
from psycopg2 import connect
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_connection(url):
    return connect(url)

def get_existing_minutes(conn, table):
    """
    Returns a set of all minutes (as strings) that already exist in the target database.
    Since ingestion is atomic per minute, if a minute exists, we have all stations for that minute.
    """
    logger.info(f"Scanning target database for existing minutes in {table}...")
    query = f"""
        SELECT DISTINCT DATE_TRUNC('minute', COALESCE(airflow_scheduled_time, ingested_at))
        FROM {table}
    """
    with conn.cursor() as cur:
        cur.execute(query)
        # Convert datetime objects to string format for easy comparison
        return {row[0].strftime("%Y-%m-%d %H:%M:00") for row[0] in cur.fetchall() if row[0]}

def patch_station_information(source_url, target_url):
    """
    station_information only keeps the latest record per station (via UPSERT). 
    We can just blindly copy all records from source to target and let Postgres UPSERT handle it.
    """
    logger.info("Starting patch for raw.station_information...")
    
    with get_connection(source_url) as src_conn, get_connection(target_url) as tgt_conn:
        with src_conn.cursor() as src_cur:
            src_cur.execute("SELECT station_id, raw_json, ingested_at, airflow_scheduled_time FROM raw.station_information")
            rows = src_cur.fetchall()
            
            if not rows:
                logger.info("No station_information records found in source.")
                return
                
            insert_query = """
                INSERT INTO raw.station_information (
                    station_id, raw_json, ingested_at, airflow_scheduled_time
                ) VALUES %s
                ON CONFLICT (station_id) DO UPDATE SET
                    raw_json = EXCLUDED.raw_json,
                    ingested_at = EXCLUDED.ingested_at,
                    airflow_scheduled_time = EXCLUDED.airflow_scheduled_time;
            """
            
            with tgt_conn.cursor() as tgt_cur:
                execute_values(tgt_cur, insert_query, rows)
            tgt_conn.commit()
            
            logger.info(f"Successfully patched {len(rows)} station_information records.")

def patch_station_status(source_url, target_url):
    """
    Patches raw.station_status by identifying entire minutes (payloads) that are missing 
    in the target database, and copying them over from the source database.
    """
    logger.info("Starting patch for raw.station_status...")
    
    with get_connection(target_url) as tgt_conn:
        existing_target_minutes = get_existing_minutes(tgt_conn, 'raw.station_status')
    
    with get_connection(source_url) as src_conn:
        existing_source_minutes = get_existing_minutes(src_conn, 'raw.station_status')
        
    missing_minutes = existing_source_minutes - existing_target_minutes
    
    if not missing_minutes:
        logger.info("Target database is already fully up to date with the Source database. No patching needed!")
        return
        
    logger.info(f"Found {len(missing_minutes)} missing payload minutes in Target database.")
    
    # Process each missing minute
    total_inserted = 0
    with get_connection(source_url) as src_conn, get_connection(target_url) as tgt_conn:
        # Sort minutes chronologically for ordered patching
        for minute in sorted(missing_minutes):
            logger.info(f"Patching payload for minute: {minute}")
            
            with src_conn.cursor() as src_cur:
                # Fetch all rows from the source that belong to this minute
                src_cur.execute("""
                    SELECT raw_json, ingested_at, airflow_scheduled_time 
                    FROM raw.station_status 
                    WHERE DATE_TRUNC('minute', COALESCE(airflow_scheduled_time, ingested_at)) = %s
                """, (minute,))
                
                rows_to_insert = src_cur.fetchall()
            
            if rows_to_insert:
                insert_query = """
                    INSERT INTO raw.station_status (raw_json, ingested_at, airflow_scheduled_time) 
                    VALUES %s
                """
                with tgt_conn.cursor() as tgt_cur:
                    execute_values(tgt_cur, insert_query, rows_to_insert)
                tgt_conn.commit()
                total_inserted += len(rows_to_insert)
                
    logger.info(f"Successfully patched {total_inserted} total station_status rows across {len(missing_minutes)} minutes.")

def main():
    parser = argparse.ArgumentParser(description="Patch Citi Bike data between databases.")
    parser.add_argument("--source", required=True, help="Source database connection string")
    parser.add_argument("--target", required=True, help="Target database connection string")
    parser.add_argument("--table", choices=['information', 'status', 'both'], default='both', 
                        help="Which table to patch (default: both)")
    
    args = parser.parse_args()
    
    if args.table in ['information', 'both']:
        patch_station_information(args.source, args.target)
        
    if args.table in ['status', 'both']:
        patch_station_status(args.source, args.target)

if __name__ == "__main__":
    main()
