import os
from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime, timedelta

# Calculate project root relative to this file
# This ensures interoperability between Mac (Dev) and Linux (QA/Prod)
DAGS_FOLDER = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(DAGS_FOLDER))
VENV_PYTHON = os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
VENV_DBT = os.path.join(PROJECT_ROOT, ".venv", "bin", "dbt")

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 0,
}

with DAG(
    'citibike_ingestion',
    default_args=default_args,
    description='Fetch Citi Bike GBFS data every minute',
    schedule_interval='* * * * *',
    catchup=False,
    max_active_runs=1,
    is_paused_upon_creation=False
) as dag:

    ingest_task = BashOperator(
        task_id='run_ingest_script',
        bash_command=f'cd {PROJECT_ROOT} && exec {VENV_PYTHON} data_pipeline/ingest.py --scheduled-time "{{{{ ts }}}}"',
        execution_timeout=timedelta(seconds=20),
    )

    # dbt_run_task = BashOperator(
    #     task_id='run_dbt_models',
    #     bash_command=f'cd {PROJECT_ROOT}/data_pipeline/dbt && exec {VENV_DBT} run --profiles-dir .',
    #     execution_timeout=timedelta(seconds=35),
    # )

    # ingest_task >> dbt_run_task
    ingest_task