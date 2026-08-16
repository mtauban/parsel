# Déploiement sur Coolify

Le projet est déployable comme une application **Dockerfile**. Le conteneur
exécute Gunicorn sur le port `8000` (ou la valeur de `PORT`) et expose une sonde
HTTP non authentifiée sur `/health`.

## Créer l'application

1. Dans Coolify, créez une application à partir du dépôt GitHub et choisissez
   la branche `ign`.
2. Sélectionnez le build pack **Dockerfile**, avec le répertoire de base `/` et
   le Dockerfile `Dockerfile`.
3. Dans *Network*, exposez le port `8000` et associez le domaine à ce port
   (par exemple `https://parcelle.app:8000`). Le proxy Coolify sert ensuite le
   domaine en HTTPS standard.
4. Activez la vérification de santé sur `GET /health`, port `8000`, avec le code
   attendu `200`. Le `HEALTHCHECK` du Dockerfile fournit la même vérification.

## Variables d'environnement

Ajoutez ces variables dans Coolify comme variables **runtime** uniquement. Ne
committez jamais le fichier `.env` ou les secrets.

```dotenv
FLASK_DEBUG=0
SECRET_KEY=<secret-long-et-aleatoire>
SECURITY_PASSWORD_SALT=<secret-long-et-aleatoire>
DATABASE_URI=postgresql+psycopg://<user>:<password>@<host>:5432/<database>

MAIL_SERVER=ssl0.ovh.net
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USE_SSL=false
MAIL_USERNAME=<adresse-expediteur>
MAIL_PASSWORD=<mot-de-passe>
MAIL_DEFAULT_SENDER=<adresse-expediteur>

IGN_API_KEY=
IGN_USER_AGENT=parcelle-recs
GEOCODE_API_KEY=
MAPBOX_ACCESS_TOKEN=

CACHE_TYPE=filesystem
CACHE_DEFAULT_TIMEOUT=300
CACHE_DIR=/tmp/
GUNICORN_WORKERS=2
GUNICORN_THREADS=2
```

La base PostgreSQL doit disposer de l'extension PostGIS avant l'initialisation :

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

`init_database.py` crée les tables mais importe également le jeu de données
local `assets/cadastre-71-parcelles.json`. Pour une base déjà existante, il n'a
pas à être lancé au déploiement. Préparez cette base séparément (ou attachez le
jeu de données de manière explicite) avant le premier trafic.

## Déployer et vérifier

Cliquez sur **Deploy** dans Coolify. Après le premier déploiement, vérifiez les
journaux Gunicorn, la sonde `/health`, puis l'application derrière son domaine.

## Ancien déploiement manuel

Les fichiers `deploy/` et les instructions Supervisor/Nginx correspondaient au
déploiement VPS manuel précédent. Coolify remplace ces composants par Docker,
Gunicorn et son proxy intégré.
