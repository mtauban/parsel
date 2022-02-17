"""Flask configuration variables."""
from os import environ, path
from dotenv import load_dotenv

basedir = path.abspath(path.dirname(__file__))
load_dotenv(path.join(basedir, '.env'))


class Config:
    """Set Flask configuration from .env file."""

    # General Config
    SECRET_KEY = environ.get("SECRET_KEY", 'pf9Wkove4IKEAXvy-cQkeDPhv9Cb3Ag-wyJILbq_dFw')
    FLASK_APP = environ.get('FLASK_APP')
    FLASK_ENV = environ.get('FLASK_ENV')

    SECURITY_PASSWORD_SALT = environ.get("SECURITY_PASSWORD_SALT")
    SECURITY_SEND_REGISTER_EMAIL = False
    # Database
    SQLALCHEMY_DATABASE_URI = environ.get('DATABASE_URI')


    SQLALCHEMY_ECHO = False
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    SECURITY_MSG_LOGIN = ("L'accès à cette page nécessite d'être enregistré.", "error")
    SECURITY_MSG_INVALID_PASSWORD = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_MSG_PASSWORD_NOT_PROVIDED = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_MSG_USER_DOES_NOT_EXIST = ("Mauvais email ou mauvais mot de passe.", "error")
    SECURITY_RECOVERABLE = True
    SECURITY_CHANGEABLE = True
    SECURITY_REGISTERABLE = True

    MAIL_SERVER = 'ssl0.ovh.net'
    MAIL_PORT = 587
    MAIL_USE_TLS = True
    MAIL_USE_SSL = False
    MAIL_USERNAME = 'contact@parcelle.app'
    MAIL_PASSWORD = 'vvA8X2wG3HZBh'
    MAIL_DEFAULT_SENDER = 'no-reply@parcelle.app'

    IGN_API_KEY = "7tbcsy3xj9ymeoi4mjdlyayo"
    IGN_USER_AGENT = "parcelle-recs"


    CACHE_TYPE = "filesystem" # Flask-Caching related configs
    CACHE_DEFAULT_TIMEOUT = 300
    CACHE_DIR	= "/tmp/"
