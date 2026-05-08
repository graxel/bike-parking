import os
from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime, timedelta

# Path logic for cross-platform support
DAGS_FOLDER = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(DAGS_FOLDER))
VENV_DBT = os.path.join(PROJECT_ROOT, ".venv", "bin", "dbt")

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'retries': 0,
}

with DAG(
    'citibike_dbt_current',
    default_args=default_args,
    description='Run dbt current models every minute',
    schedule_interval='* * * * *',
    catchup=False,
    max_active_runs=1,
    is_paused_upon_creation=False
) as dag:

    dbt_run_task = BashOperator(
        task_id='run_dbt_current_models',
        bash_command=f'cd {PROJECT_ROOT}/data_pipeline/dbt && exec {VENV_DBT} run --select tag:current --profiles-dir .',
        execution_timeout=timedelta(minutes=2),
    )
