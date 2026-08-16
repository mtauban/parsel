# Codex Manifest

Last updated: February 12, 2026

## App Summary

- Name: `parcel` / `parcelle.app` codebase
- Type: Flask web application with server-rendered templates and JSON APIs
- Main domain logic:
  - Parcel and map management
  - Geospatial querying (PostgreSQL + PostGIS via GeoAlchemy)
  - IGN WFS data fetch/integration
  - Authenticated user map workflows

## Stack

- Backend: Python + Flask
- ORM: SQLAlchemy / Flask-SQLAlchemy
- Geospatial: GeoAlchemy2, Shapely, pyproj
- DB: PostgreSQL (via SSH tunnel in local dev), PostGIS expected
- Auth: Flask-Security-Too + Flask-Login
- Templates: Jinja2
- Frontend libs: static JS/CSS in `parsels/static`

## Project Layout

- App entry: `wsgi.py`
- Config: `config.py` + `.env`
- Main package: `parsels/`
  - `parsels/__init__.py`: app factory + extension bootstrap
  - `parsels/models.py`: DB models
  - `parsels/routes.py`: HTTP/API routes
  - `parsels/templates/`: Jinja pages
  - `parsels/static/`: JS/CSS/assets
- Data bootstrap script: `init_database.py`

## Local Dev Runbook

1. Start SSH tunnel (if not already running):

```bash
ssh -p 2203 -f -N -L 5433:127.0.0.1:5432 mtauban@vps654021.ovh.net
```

2. Start Flask dev server:

```bash
cd /Users/mtauban/Work/parcel
source venv/bin/activate
FLASK_APP=wsgi.py FLASK_DEBUG=1 flask run --port 5555
```

3. App URL:

- `http://127.0.0.1:5555`

## Current VPS Baseline (Starting Point)

Checked on: February 12, 2026

- SSH access:
  - `ssh -p 2203 mtauban@vps654021.ovh.net`
- App code path on VPS:
  - `/home/mtauban/parcelle.app/parcelleapp`
- Current production venv path on VPS (legacy layout):
  - `/home/mtauban/parcelle.app/parcellevenv`
- Current runtime/process manager:
  - Supervisor manages Gunicorn
  - Active program config file: `/etc/supervisor/conf.d/parcelleapp.conf`
  - Current Gunicorn bind observed: `0.0.0.0:8082`
  - Current app target observed: `wsgi_prod:app`
- Current reverse proxy:
  - Nginx site file: `/etc/nginx/sites-available/parcelleapp`
  - Nginx proxies `parcelle.app` -> `http://127.0.0.1:8082`
  - TLS currently managed by certbot on VPS

Local-to-VPS database pattern:

- Local dev uses SSH tunnel:
  - local `5433` -> VPS `127.0.0.1:5432`
- Local `.env` should point `DATABASE_URI` to local tunnel host/port (not direct public DB host).

Operational notes:

- Prefer `.env` for secrets; avoid embedding secrets in Supervisor `environment=` entries.
- If migrating from legacy `parcellevenv` to in-repo `venv`, update Supervisor command/path accordingly.

## Environment Configuration

- Real secrets must live only in `.env` (never hardcoded in Python files).
- Template for required/optional variables: `.env.example`
- Key required vars:
  - `SECRET_KEY`
  - `SECURITY_PASSWORD_SALT`
  - `DATABASE_URI`
- External keys used by routes:
  - `GEOCODE_API_KEY`
  - `IGN_API_KEY` (if/when needed by upstream integrations)

## Python 3.12 Rebuild

```bash
cd /Users/mtauban/Work/parcel
rm -rf venv
python3.12 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

## Testing Strategy (Current)

No formal pytest/unittest suite is configured in this repository.

Current practical checks:

1. Syntax sanity check:

```bash
python -m py_compile config.py parsels/__init__.py parsels/routes.py
```

2. Run app locally and validate critical flows manually:
- Home/login pages load
- Auth flow works
- Map pages render (`/map`, `/mapedit/<id>`, `/mapview/<id>`)
- Core APIs respond (`/api/get-parcels/...`, `/api/get-map/<id>`)

3. Optional integration smoke scripts:
- `parsels/test_wfs.py`
- `parsels/test_wfs_buildings.py`
- `parsels/test_wfs_getfeaturebyid.py`

## Production (Gunicorn + Nginx)

- WSGI app import target: `wsgi:app`
- Gunicorn config: `gunicorn.conf.py`
- Example service file: `deploy/parcelleapp.service.example`
- Example nginx site file: `deploy/nginx.parcelleapp.conf.example`
- VPS-compatible Supervisor file: `deploy/parcelleapp.supervisor.conf.example`
- VPS-compatible nginx TCP proxy file: `deploy/nginx.parcelleapp.tcp.conf.example`

Start manually for smoke test:

```bash
cd /home/mtauban/parcelle.app/parcelleapp
source venv/bin/activate
gunicorn --config gunicorn.conf.py wsgi:app
```

Notes:
- App now follows an application-factory pattern (`create_app`) and avoids `db.create_all()` at import time.
- Schema creation/migrations should be explicit (not server-start side effects).
- Current VPS (checked Feb 12, 2026) runs `parcelleapp` via Supervisor + Gunicorn and nginx proxies to `127.0.0.1:8082`.

## Change Tracking Protocol

For each Codex task, track:

1. Goal
2. Files changed
3. Behavior impact
4. Verification run
5. Follow-up risks

Recommended command set:

```bash
git status --short
git diff --stat
git diff
```

Suggested commit message style:

- `feat: ...`
- `fix: ...`
- `chore: ...`
- `refactor: ...`

## Codex Working Rules For This Repo

- Preserve unrelated local changes.
- Do not commit secrets or `.env`.
- Prefer minimal, verifiable changes.
- After edits, run at least syntax or targeted runtime checks.
- If dependency/runtime upgrades are in scope, update docs and `.env.example` in the same change.
