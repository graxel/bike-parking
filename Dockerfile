FROM python:3.12-slim
# 1. Permanent System Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/bike-parking \
    AIRFLOW_HOME=/bike-parking/airflow \
    AIRFLOW__CORE__DAGS_FOLDER=/bike-parking/data_pipeline/dags \
    PATH="/root/.local/bin/:/bike-parking/.venv/bin:$PATH"

# 2. Heavy Lifting (Cached unless base image changes)
# We use BuildKit cache mounts to persist downloaded apt packages across builds
RUN rm -f /etc/apt/apt.conf.d/docker-clean; echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -LsSf https://astral.sh/uv/install.sh | sh

# 3. Project Setup
WORKDIR /bike-parking

# 4. Dependency Cache (Only runs if dependencies change)
COPY pyproject.toml uv.lock ./
# We use a BuildKit cache mount for uv to instantly reuse downloaded Python packages
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# 5. Application Code (Runs every push, but it's just a file copy - fast!)
COPY . .

# Default command
CMD ["fastapi", "run", "app/main.py", "--port", "40501", "--host", "0.0.0.0"]
