# Multi-stage build for Python agent
FROM python:3.13-slim as base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=random \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    postgresql-client \
    libleveldb-dev \
    libleveldb1d \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install Python dependencies
COPY requirements.lock pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.lock

FROM base as development

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
# Copy source code
COPY . .

# Create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

# Change ownership of the app directory
RUN chown -R appuser:appuser /usr/src/app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]