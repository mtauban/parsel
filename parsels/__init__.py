from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from flask_security import Security,  SQLAlchemyUserDatastore
from flask_mail import Mail
from flask_admin import Admin
from flask_admin.contrib.sqla import ModelView
from flask_security import current_user



from werkzeug.routing import FloatConverter as BaseFloatConverter

class FloatConverter(BaseFloatConverter):
    regex = r'-?\d+(\.\d+)?'

db = SQLAlchemy()
mail = Mail()
admin = Admin()

csrf = CSRFProtect()
"""Construct the core application."""
app = Flask(__name__, instance_relative_config=False)
csrf.init_app(app)
app.config.from_object('config.Config')
app.url_map.converters['float'] = FloatConverter


mail.init_app(app)
db.init_app(app)

from .models import User, Role, Plan, Parcel


# class UserModelView(ModelView):
#   column_display_pk = True
#   page_size = 20
#   can_view_details = True
#   can_export = True
#   def is_accessible(self):
#     return (current_user.is_active and
#             current_user.is_authenticated and current_user.has_role("admin"))
#   def _handle_view(self, name):
#     if not self.is_accessible():
#       return redirect(url_for('security.login'))
# 
# admin.init_app(app)
# admin.add_view(UserModelView(User, db.session))
# admin.add_view(UserModelView(Role, db.session))
# admin.add_view(UserModelView(Plan, db.session))
# admin.add_view(UserModelView(Parcel, db.session))
# 
# Setup Flask-Security
user_datastore = SQLAlchemyUserDatastore(db, User, Role)
security = Security(app, user_datastore)


@app.template_filter()
def securitycss(s):
    if s == "error":
        return "warning"
    else:
        return s


# from .main_bp import main_bp

with app.app_context():
    from . import routes  # Import routes
    # Register Blueprints
    # app.register_blueprint(main_bp, url_prefix='/home')
    # Create Database Models
    db.create_all()
