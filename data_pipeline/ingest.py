import os
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
    logger.info(f"Starting ingestion process (PID: {os.getpid()})...")
    conn = None
    try:
        conn = get_db_connection()
        
        logger.info("Ensuring database tables are initialized...")
        init_db(conn)
        
        logger.info("Ingesting station information...")
        ingest_information(conn)
        
        logger.info("Ingesting station status...")
        ingest_status(conn)
        
        logger.info("Ingestion process completed successfully.")
        
    except Exception as e:
        logger.error(f"Ingestion failed: {str(e)}")
        raise
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
