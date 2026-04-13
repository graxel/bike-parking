#!/usr/bin/env bash
# setup_scripts/deploy.sh
# Called remotely by GitHub Actions after git pull.
# Env vars are injected by appleboy/ssh-action via the 'envs' field.
set -euo pipefail

echo "==> Writing secrets.env"
cat > secrets.env <<EOF
DB_NAME=${DB_NAME}
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
EOF

 echo "==> Building and starting containers"
docker compose up --build -d

echo "==> Running airflow-init"
docker compose run --rm airflow-init

echo "==> *** Deploy complete! ***"
