FROM python:3.12-slim
# 1. Permanent System Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/bike-parking \
    AIRFLOW_HOME=/bike-parking/airflow \
    AIRFLOW__CORE__DAGS_FOLDER=/bike-pipeline/data_pipeline/dags \
    PATH="/root/.local/bin/:/bike-parking/.venv/bin:$PATH"

# 2. Heavy Lifting (Cached unless base image changes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh

# 3. Project Setup
WORKDIR /bike-parking

# 4. Dependency Cache (Only runs if dependencies change)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# 5. Application Code (Runs every push, but it's just a file copy - fast!)
COPY . .

# Default command
CMD ["fastapi", "run", "app/current.py", "--port", "40502", "--host", "0.0.0.0"]
