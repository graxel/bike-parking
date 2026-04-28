import os
import argparse
import logging
from db_connection import get_db_connection
from db_setup import init_db
from ingest_data import ingest_status, ingest_information

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Main entry point for the Citi Bike ingestion process."""
    parser = argparse.ArgumentParser(description="Ingest Citi Bike data.")
    parser.add_argument("--scheduled-time", type=str, help="ISO8601 scheduled time from Airflow")
    args = parser.parse_args()

    logger.info(f"Starting ingestion process (PID: {os.getpid()}). Scheduled time: {args.scheduled_time}")
    conn = None
    try:
        conn = get_db_connection()
        
        logger.info("Ensuring database tables are initialized...")
        init_db(conn)
        
        logger.info("Ingesting station information...")
        ingest_information(conn, args.scheduled_time)
        
        logger.info("Ingesting station status...")
        ingest_status(conn, args.scheduled_time)
        
        logger.info("Ingestion process completed successfully.")
        
    except Exception as e:
        logger.error(f"Ingestion failed: {str(e)}")
        raise
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
