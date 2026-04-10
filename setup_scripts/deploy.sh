#!/usr/bin/env bash
# setup_scripts/deploy.sh
# Called remotely by GitHub Actions after git pull.
# Env vars are injected by appleboy/ssh-action via the 'envs' field.
set -euo pipefail

echo "==> Writing .env"
cat > .env <<EOF
DB_NAME=${DB_NAME}
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

AIRFLOW_HOME=./.airflow
AIRFLOW__CORE__DAGS_FOLDER=./data_pipeline/dags
AIRFLOW__CORE__LOAD_EXAMPLES=False
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=postgresql+psycopg2://\${DB_USER}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_NAME}?options=-csearch_path%3Dairflow,public
AIRFLOW__DATABASE__SQL_ALCHEMY_SCHEMA=airflow
AIRFLOW__CORE__EXECUTOR=LocalExecutor
EOF

echo "==> Building and starting containers"
docker compose up --build -d

echo "==> Running airflow-init"
docker compose run --rm airflow-init

echo "==> *** Deploy complete! ***"
echo "==> Unpausing Airflow DAG"
docker compose exec -T airflow-scheduler airflow dags unpause citibike_ingestion