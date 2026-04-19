#!/usr/bin/env bash
# setup_scripts/deploy.sh
# Universal deployment script for Local (Mac), QA (RPi), and Prod (RPi).
set -euo pipefail

# --- 1. Detect environment ---
OS_TYPE=$(uname -s)
if [ -n "${GITHUB_REF_NAME:-}" ]; then
    BRANCH="${GITHUB_REF_NAME}"
else
    BRANCH="local"
fi

case "${BRANCH}" in
  main)  ENV="prod"  ;;
  test)  ENV="qa"    ;;
  local) ENV="local" ;;
  *)     echo "Unknown branch: ${BRANCH}" >&2; exit 1 ;;
esac

echo "==> Deploying to Environment: ${ENV} (OS: ${OS_TYPE})"

# --- 2. environment-specific variables ---
if [ "${OS_TYPE}" == "Darwin" ]; then
    # Mac (Homebrew) paths
    NGINX_APPS_DIR="/opt/homebrew/etc/nginx/sites-available/apps"
    NGINX_ENABLED_APPS_DIR="/opt/homebrew/etc/nginx/sites-enabled/apps"
    RELOAD_CMD="brew services restart nginx"
    SUDO=""
    # Add Docker Desktop to path for local dev
    export PATH="/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
else
    # Linux (Debian/RPi) paths
    NGINX_APPS_DIR="/etc/nginx/sites-available/apps"
    NGINX_ENABLED_APPS_DIR="/etc/nginx/sites-enabled/apps"
    RELOAD_CMD="sudo systemctl reload nginx"
    SUDO="sudo"
fi

# --- 3. Handle Secrets ---
if [ "${ENV}" != "local" ]; then
    echo "==> Writing secrets.env from injected variables"
    cat > secrets.env <<EOF
DB_NAME=${DB_NAME}
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
AIRFLOW__WEBSERVER__SECRET_KEY=${AIRFLOW__WEBSERVER__SECRET_KEY}
EOF
else
    if [ ! -f secrets.env ]; then
        echo "ERROR: secrets.env not found. Please create it first for local dev!" >&2
        exit 1
    fi
fi

# --- 4. Build .env for Docker Compose ---
echo "==> Refreshing .env"
cat settings.env secrets.env > .env

# --- 5. Configure Nginx ---
$SUDO mkdir -p "${NGINX_APPS_DIR}"
$SUDO mkdir -p "${NGINX_ENABLED_APPS_DIR}"

echo "==> Generating nginx config"
CONFIG_CONTENT=$(cat nginx/bike-parking)

# Add local-only overrides
if [ "${ENV}" == "local" ]; then
    # Relax CORS for local dev and append local frontend locations
    CONFIG_CONTENT=$(echo "${CONFIG_CONTENT}" | sed "s|'https://kevingrazel.com'|'*'|g")
    
    CONFIG_CONTENT="${CONFIG_CONTENT}

# --- Frontend (Local Development) ---
location /bike-parking/ {
    alias $(pwd)/app/frontend/;
    index index.html;
}"
fi

echo "${CONFIG_CONTENT}" | $SUDO tee "${NGINX_APPS_DIR}/bike-parking" > /dev/null

echo "==> Enabling nginx config (symlink)"
$SUDO ln -sf "${NGINX_APPS_DIR}/bike-parking" "${NGINX_ENABLED_APPS_DIR}/bike-parking"

echo "==> Testing and reloading nginx"
$SUDO nginx -t
$RELOAD_CMD

# --- 6. Orchestrate Containers ---
echo "==> Shutting down existing containers to free ports"
docker compose down --remove-orphans

echo "==> Starting containers"
docker compose up --build -d --remove-orphans

echo "==> *** Deployment complete for ${ENV}! ***"
if [ "${ENV}" == "local" ]; then
    echo "Local Preview: http://localhost:8080/bike-parking/"
fi
