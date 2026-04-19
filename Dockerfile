FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/bike-parking

# Set working directory inside the container
WORKDIR /bike-parking

# # Install uv
# COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*
# Install uv using the standalone installer script
ADD https://astral.sh/uv/install.sh /install.sh
RUN chmod +x /install.sh && /install.sh && rm /install.sh
ENV PATH="/root/.local/bin/:$PATH"

# Copy dependency files FIRST
# Docker Trick: if dependencies don't change, 
# Docker will skip the slow 'install' step and use a cached version.
COPY pyproject.toml uv.lock ./

# Install project dependencies
# --frozen ensures we use the exact versions from uv.lock
# --no-install-project tells uv to only install libraries for now
RUN uv sync --frozen --no-install-project

COPY . .

# Add virtual environment binary to PATH
ENV PATH="/bike-parking/.venv/bin:$PATH"

# Default command (can be overridden by docker-compose)
CMD ["fastapi", "run", "app/main.py", "--port", "8004", "--host", "0.0.0.0"]
