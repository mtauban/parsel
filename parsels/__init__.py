from flask import Flask
from flask_admin import Admin
from flask_caching import Cache
from flask_mail import Mail
from flask_security import SQLAlchemyUserDatastore, Security
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from owslib.wfs import WebFeatureService
from werkzeug.routing import FloatConverter as BaseFloatConverter


class FloatConverter(BaseFloatConverter):
    regex = r"-?\d+(\.\d+)?"


db = SQLAlchemy()
mail = Mail()
admin = Admin()
csrf = CSRFProtect()
cache = Cache()
security = Security()


def _init_wfs(app):
    try:
        app.wfs11 = WebFeatureService(url="https://data.geopf.fr/wfs/ows", version="2.0.0")
    except Exception:
        app.logger.warning("Problem with IGN WFS initialization")
        app.wfs11 = None


def _securitycss(s):
    return "warning" if s == "error" else s


def create_app(config_object="config.Config"):
    global app
    app = Flask(__name__, instance_relative_config=False)
    app.config.from_object(config_object)
    app.url_map.converters["float"] = FloatConverter

    csrf.init_app(app)
    cache.init_app(app)
    mail.init_app(app)
    db.init_app(app)

    from .models import Role, User

    user_datastore = SQLAlchemyUserDatastore(db, User, Role)
    security.init_app(app, user_datastore)
    app.add_template_filter(_securitycss, "securitycss")

    _init_wfs(app)

    # Compatibility for modules that still import "app" from parsels.
    globals()["app"] = app

    with app.app_context():
        from . import routes

    return app


# Default app object for Gunicorn and Flask CLI (e.g. "wsgi:app")
app = create_app()
