import logging

logger = logging.getLogger(__name__)

def create_airflow_schema(conn):
    """Creates the dedicated Airflow metadata schema if it doesn't exist."""
    logger.info("Ensuring 'airflow' schema exists...")
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS airflow;")
    conn.commit()

def init_db(conn):
    """Initializes the raw data schemas and tables for the Citi Bike ingestion."""
    logger.info("Initializing 'raw' schema and Citi Bike tables...")
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw.station_status (
                raw_json JSONB,
                ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw.station_information (
                station_id VARCHAR(255) PRIMARY KEY,
                raw_json JSONB,
                ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
    conn.commit()

if __name__ == "__main__":
    from data_pipeline.db_connection import get_db_connection
    conn = get_db_connection()
    try:
        create_airflow_schema(conn)
        init_db(conn)
        logger.info("Database setup completed successfully.")
    finally:
        conn.close()
