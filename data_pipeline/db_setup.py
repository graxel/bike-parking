import logging

logger = logging.getLogger(__name__)

def create_airflow_schema(conn):
    """Creates the dedicated Airflow metadata schema if it doesn't exist."""
    logger.info("Ensuring 'airflow' schema exists...")
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS airflow;")
    conn.commit()

def init_db(conn):
    """Initializes raw ingestion tables and app tables."""
    logger.info("Initializing database schemas and tables...")
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")

        cur.execute("CREATE SCHEMA IF NOT EXISTS app;")

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

        cur.execute("""
            CREATE TABLE IF NOT EXISTS app.users (
                id UUID PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS app.station_groups (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT station_groups_user_id_name_key UNIQUE (user_id, name)
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS app.station_group_stations (
                station_group_id UUID NOT NULL REFERENCES app.station_groups(id) ON DELETE CASCADE,
                station_id VARCHAR(255) NOT NULL REFERENCES raw.station_information(station_id) ON DELETE CASCADE,
                added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                sort_order INT,
                PRIMARY KEY (station_group_id, station_id)
            );
        """)

        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_station_groups_user_id
            ON app.station_groups (user_id);
        """)

        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_station_group_stations_station_id
            ON app.station_group_stations (station_id);
        """)

        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_station_group_stations_group_sort
            ON app.station_group_stations (station_group_id, sort_order);
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
