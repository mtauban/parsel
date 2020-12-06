"""Data models."""

from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy_utils import PhoneNumber
from . import db
import utm
from flask_security import UserMixin, RoleMixin

from datetime import datetime

import json

from palettable.mycarta import CubeYF_5 as svgpalette



from geoalchemy2.shape import to_shape
import shapely

import uuid

class RolesUsers(db.Model):
    __tablename__ = 'roles_users'
    id = db.Column(db.Integer(), primary_key=True)
    user_id = db.Column('user_id', db.Integer(), db.ForeignKey('user.id'))
    role_id = db.Column('role_id', db.Integer(), db.ForeignKey('role.id'))


class Role(db.Model, RoleMixin):
    __tablename__ = 'role'
    id = db.Column(db.Integer(), primary_key=True)
    name = db.Column(db.String(80), unique=True)
    description = db.Column(db.String(255))

class User(db.Model, UserMixin):
    __tablename__ = 'user'
    __table_args__ = {'extend_existing': True}

    id =db.Column(db.Integer, primary_key=True)
    email =db.Column(db.String(255), unique=True)
    password =db.Column(db.String(255))
    last_login_at =db.Column(db.DateTime())
    current_login_at =db.Column(db.DateTime())
    last_login_ip =db.Column(db.String(100))
    current_login_ip =db.Column(db.String(100))
    login_count =db.Column(db.Integer)
    active =db.Column(db.Boolean())
    fs_uniquifier =db.Column(db.String(255))
    confirmed_at =db.Column(db.DateTime())

    first_name =db.Column(db.Unicode(100))
    last_name=db.Column(db.Unicode(100))
    _phone_number = db.Column(db.Unicode(20))
    _country_code = db.Column(db.Unicode(8))



    roles = db.relationship('Role', secondary='roles_users',
                         backref=db.backref('users', lazy='dynamic'))
    plans = db.relationship('Plan', backref='user', lazy=True)


class Association(db.Model):
    __table_args__ = {'extend_existing': True}
    __tablename__ = 'parcels'
    parcel_id = db.Column(db.String(15), db.ForeignKey('parcel.id'), primary_key=True)
    plan_id = db.Column( UUID(as_uuid=True),  db.ForeignKey('plan.id'), primary_key=True)
    private_text = db.Column(db.String())
    # color  = db.Column(db.String())
    parcel = db.relationship("Parcel")
    plan = db.relationship("Plan", back_populates="parcels")
    def getGeoJSON(self):
        r = self.parcel.toGeo()
        r['properties']['private_text'] = self.private_text
        return r


class Token(db.Model):
    __table_args__ = {'extend_existing': True}
    id =         db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, unique=True, nullable=False)
    created_on = db.Column(db.DateTime(), default=datetime.utcnow)
    text =       db.Column(db.Text(), nullable=False)


class Plan(db.Model):
    __table_args__ = {'extend_existing': True}
    id =     db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, unique=True, nullable=False)
    created_on = db.Column(db.DateTime(), default=datetime.utcnow)
    updated_on = db.Column(db.DateTime(), default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer(), db.ForeignKey('user.id'), nullable=False)
    private_text = db.Column(db.Text(), default='')
    public_text = db.Column(db.Text(), default='')
    name = db.Column(db.String(), default='Sans titre')
    contenance = db.Column(db.Float(), default=.0)
    commune = db.Column(db.String(80), nullable=True)
    active = db.Column(db.Boolean(), default=True, nullable=False)
    public = db.Column(db.Boolean(), default=False, nullable=False)
    show_contact = db.Column(db.Boolean(), default=False, nullable=False)
    parcels = db.relationship('Association', back_populates="plan", cascade="all, delete")


    def toSVG(self,ssize=256, classes=[]):
        if len(self.parcels)==0:
            return
        colors = ['#000']
        pathCount = 0
        factor = 1
        svg = ''
        if (str(ssize).isnumeric()):
            size = ssize
        else:
            size = 256

        (minx,miny,maxx,maxy)= (0,0,0,0)
        for ida,assoc in enumerate(self.parcels) :
            shapely_geom = to_shape(assoc.parcel.geometry)
            geom = shapely.geometry.mapping(shapely_geom);

            for idp,pol in enumerate(geom['coordinates']):


                svg += '<path   d="' # stroke-width="1" stroke="blue" fill="purple"
                pathCount += 1
                for idx,(lng,lat) in enumerate(pol):

                    x,y,zone, ut = utm.from_latlon(lat, lng)
                    if (ida+idp+idx) == 0:
                        (minx,miny,maxx,maxy) =(x,y,x,y)
                    minx = minx if minx < x else x
                    maxx = maxx if maxx > x else x
                    miny = miny if miny < y else y
                    maxy = maxy if maxy > y else y
                    svg +=('M' if idx==0 else 'L')+' '+str(x*factor)+','+str(-y*factor)+' '
                svg += 'Z'
                svg += '" />'

        svg += '<g transform="scale(1,-1)"></svg>'
        ratio = (maxy-miny)/(maxx-minx)
        sizex = size
        sizey = sizex * ratio

        return '<svg class="'+" ".join(classes)+'" width="'+str(ssize)+'" viewBox="'+str(factor*minx)+' '+str(-factor*maxy)+' '+str(factor*(maxx-minx))+' '+str(factor*(maxy-miny))+'" xmlns="http://www.w3.org/2000/svg">'+svg

#
# class GeoJsonGeometry(Geometry):
#     as_binary = 'ST_AsGeoJson'

class Parcel(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.String(15), primary_key=True)
    geometry = db.Column(Geometry('POLYGON',  srid=4326))
    commune = db.Column(db.String(80), nullable=True)
    prefixe = db.Column(db.String(80), nullable=True)
    section = db.Column(db.String(80), nullable=True)
    numero = db.Column(db.String(80), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    contenance = db.Column(db.Float, nullable=False)
    arpente = db.Column(db.Boolean, nullable=False)
    geom_loc = db.Column(Geometry('POINT',  srid=4326))

    def toGeo(self):
        return {'type': 'Feature',
                'id': self.id,
                'geometry': shapely.geometry.mapping(to_shape(self.geometry)),
                'properties': {
                    'id': self.id,
                    'commune': self.commune,
                    'prefixe': self.prefixe,
                    'section': self.section,
                    'numero': self.numero,
                    'contenance': self.contenance,
                    'arpente': self.arpente
                }
                }

    def __repr__(self):
        return '<Parcel %r>' % self.id
