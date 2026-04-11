from airflow.utils.db import synchronize_log_template
from airflow.utils.session import create_session
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    logger.info("Synchronizing Airflow log templates...")
    try:
        with create_session() as session:
            synchronize_log_template(session=session)
            session.commit()
        logger.info("Log templates synchronized successfully.")
    except Exception as e:
        logger.error(f"Failed to synchronize log templates: {e}")
        raise

if __name__ == "__main__":
    main()
