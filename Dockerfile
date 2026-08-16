FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    GUNICORN_WORKERS=2 \
    GUNICORN_THREADS=2

WORKDIR /app

# curl is used by the container health check. Python wheels provide the GEOS and
# PROJ runtimes needed by Shapely and pyproj.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app . .

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-8000}/health" || exit 1

CMD ["gunicorn", "--config", "gunicorn.conf.py", "wsgi:app"]
