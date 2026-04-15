#!/usr/bin/env bash
# setup_scripts/deploy.sh
# Called remotely by GitHub Actions after git pull.
# Env vars are injected by appleboy/ssh-action via the 'envs' field.
set -euo pipefail

# --- Determine environment from branch --------------------------
case "${GITHUB_REF_NAME}" in
  main) PREFIX="/bike-parking"      ;;
  test) PREFIX="/bike-parking/beta" ;;
  *)    echo "Unknown branch: ${GITHUB_REF_NAME}" >&2; exit 1 ;;
esac
echo "==> Environment: ${GITHUB_REF_NAME} (prefix: ${PREFIX})"

# --- Write secrets.env ------------------------------------------
echo "==> Writing secrets.env"
cat > secrets.env <<EOF
DB_NAME=${DB_NAME}
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
AIRFLOW__WEBSERVER__SECRET_KEY=${AIRFLOW__WEBSERVER__SECRET_KEY}
EOF

# --- Build .env for Docker Compose ------------------------------
echo "==> Refreshing .env for Docker Compose"
cat settings.env secrets.env > .env

# --- Set up nginx -----------------------------------------------
NGINX_APPS_DIR="/etc/nginx/sites-available/apps"
NGINX_CONF="bike-parking"

sudo nginx -v || sudo apt install nginx -y
sudo mkdir -p "${NGINX_APPS_DIR}"
echo "==> Installing nginx config (prefix: ${PREFIX})"
sed "s|__PREFIX__|${PREFIX}|g" nginx/bike-parking \
    | sudo tee "${NGINX_APPS_DIR}/${NGINX_CONF}" > /dev/null

echo "==> Testing nginx config"
sudo nginx -t

echo "==> Reloading nginx"
sudo systemctl reload nginx

# --- Build and start containers ---------------------------------
echo "==> Building and starting containers"
docker compose up --build -d

echo "==> Running airflow-init"
docker compose run --rm airflow-init

echo "==> *** Deploy complete! ***"
