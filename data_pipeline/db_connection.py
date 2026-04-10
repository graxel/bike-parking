import os
import psycopg2
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

def get_db_connection():
    """Establishes a connection to the Postgres database."""
    db_name = os.getenv("DB_NAME")
    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD")

    logger.info(f"Connecting to database: {db_name} at {host}")
    
    conn = psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname=db_name,
        connect_timeout=5,
        # Default statement timeout to protect against hangs
        options="-c statement_timeout=5000"
    )
    return conn
