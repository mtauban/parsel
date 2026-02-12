# Deployment Guide (VPS)

## Current topology

- Nginx reverse proxy
- Gunicorn app server
- Supervisor process manager
- App path: `/home/mtauban/parcelle.app/parcelleapp`

## 1. Sync code and create venv

```bash
cd /home/mtauban/parcelle.app/parcelleapp
python3.12 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

## 2. Configure environment

Create/update `.env` in app root from `.env.example`.

Important:
- Keep secrets only in `.env`
- Do not keep secrets in Supervisor config

## 3. Install Supervisor program file

```bash
sudo cp deploy/parcelleapp.supervisor.conf.example /etc/supervisor/conf.d/parcelleapp.conf
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl restart parcelleapp
```

## 4. Install Nginx site file

TCP variant (aligned with current VPS):

```bash
sudo cp deploy/nginx.parcelleapp.tcp.conf.example /etc/nginx/sites-available/parcelleapp
sudo ln -sf /etc/nginx/sites-available/parcelleapp /etc/nginx/sites-enabled/parcelleapp
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Verify

```bash
sudo supervisorctl status parcelleapp
curl -I https://parcelle.app
```

## Optional

If you prefer systemd over Supervisor, use:
- `deploy/parcelleapp.service.example`
- `deploy/nginx.parcelleapp.conf.example`
