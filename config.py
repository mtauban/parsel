"""Flask configuration variables."""
from os import environ, path

from dotenv import load_dotenv

basedir = path.abspath(path.dirname(__file__))
load_dotenv(path.join(basedir, ".env"))


def env(name, default=None, required=False):
    value = environ.get(name, default)
    if required and value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def normalize_database_uri(uri):
    if uri.startswith("postgresql://") and "+psycopg" not in uri and "+psycopg2" not in uri:
        return uri.replace("postgresql://", "postgresql+psycopg://", 1)
    return uri


class Config:
    """Set Flask configuration from environment variables."""

    # General config
    # General config
    SECRET_KEY = env("SECRET_KEY", required=True)
    FLASK_APP = env("FLASK_APP")
    FLASK_DEBUG = env("FLASK_DEBUG", "0")
    DEBUG_MODE = FLASK_DEBUG == "1"

    SECURITY_PASSWORD_SALT = env("SECURITY_PASSWORD_SALT", required=True)
    SECURITY_SEND_REGISTER_EMAIL = False

    # Database
    SQLALCHEMY_DATABASE_URI = normalize_database_uri(env("DATABASE_URI", required=True))
    SQLALCHEMY_ECHO = False
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    SECURITY_MSG_LOGIN = ("L'accès à cette page nécessite d'être enregistré.", "error")
    SECURITY_MSG_INVALID_PASSWORD = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_MSG_PASSWORD_NOT_PROVIDED = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_MSG_USER_DOES_NOT_EXIST = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_RECOVERABLE = True
    SECURITY_CHANGEABLE = True
    SECURITY_REGISTERABLE = True

    # Mail
    MAIL_SERVER = env("MAIL_SERVER", "ssl0.ovh.net")
    MAIL_PORT = int(env("MAIL_PORT", "587"))
    MAIL_USE_TLS = env("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USE_SSL = env("MAIL_USE_SSL", "false").lower() == "true"
    MAIL_USERNAME = env("MAIL_USERNAME")
    MAIL_PASSWORD = env("MAIL_PASSWORD")
    MAIL_DEFAULT_SENDER = env("MAIL_DEFAULT_SENDER", "no-reply@parcelle.app")

    # External services
    IGN_API_KEY = env("IGN_API_KEY")
    IGN_USER_AGENT = env("IGN_USER_AGENT", "parcelle-recs")
    GEOCODE_API_KEY = env("GEOCODE_API_KEY")
    MAPBOX_ACCESS_TOKEN = env("MAPBOX_ACCESS_TOKEN", "")

    # Flask-Caching
    # Flask-Caching
    CACHE_TYPE = "NullCache" if DEBUG_MODE else env("CACHE_TYPE", "filesystem")
    CACHE_DEFAULT_TIMEOUT = int(env("CACHE_DEFAULT_TIMEOUT", "300"))
    CACHE_DIR = env("CACHE_DIR", "/tmp/")
