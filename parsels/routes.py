from flask import abort, request, render_template, jsonify, Blueprint, redirect, url_for

from flask_security import current_user, auth_required

from geoalchemy2.shape import to_shape
import shapely

from . import app, db
from .models import Parcel, Plan, Association, Token
from geoalchemy2.functions import ST_DistanceSphere, ST_MakePoint, ST_Centroid, ST_DWithin, ST_SetSRID, ST_AsGeoJSON, ST_Contains, ST_MakeEnvelope

import requests

@app.route('/')
def home():
    return  render_template('home.html')


@app.route('/more')
def more():
    return  render_template('more.html')


@app.route('/go')
def goo():
    return  render_template('go.html')




@app.route('/mapedit', methods=['POST'])
@auth_required()
def map_update():
    jmap = (request.json.get('map'))
    p = Plan.query.get(jmap["id"])
    p.name = jmap["name"]
    p.private_text = jmap["private_text"]
    p.public_text = jmap["public_text"]
    p.commune = jmap["commune"]
    p.active = jmap["active"]
    p.public = jmap["public"]
    p.show_contact = jmap["show_contact"]

    contenance = 0

    received_parcels = jmap["parcels"]
    for asso in p.parcels:
        if asso.parcel_id in received_parcels:
            # print("parcel is in the list")
            asso.private_text = received_parcels[asso.parcel_id]["private_text"]
            del received_parcels[asso.parcel_id] # we will not use it anymore
        else:
            # print("parcel is not in the list")
            contenance -= asso.parcel.contenance
            db.session.delete(asso)
    # deal with remaining parcels
    if (len(received_parcels)>0):
        a = db.session.query(Parcel).filter(Parcel.id.in_(received_parcels.keys())).all()
        for parcel in a:
            a = Association()
            a.parcel = parcel
            p.parcels.append(a)
            contenance += a.parcel.contenance

    p.contenance += contenance
    print (received_parcels)
    db.session.commit()
    return jsonify({ 'status' : 'success'})


# @app.route('/createmap/<ids>' )
# @auth_required()
# def create_map(ids):
#     seq = ids.split(':')
#     a = db.session.query(Parcel).filter(Parcel.id.in_(seq)).all()
#     p = Plan()
#     p.user_id = current_user.id
#     for parcel in a:
#         a = Association()
#         a.parcel = parcel
#         p.parcels.append(a)
#     db.session.add(p)
#     db.session.commit()
#     return redirect(url_for('map_list'))

@app.route('/user' )
@auth_required()
def user_detail():
    return render_template('user.html')




@app.route('/mymaps' )
@auth_required()
def map_list():
    a = db.session.query(Plan).filter(Plan.user_id == current_user.id).all()
    # print(a)
    return render_template('mymaps.html', plan_liste=a)


@app.route('/mapcreate/<uid>' )
@auth_required()
def map_create(uid):
    tok = Token.query.get(uid)
    seq = tok.text.split(':')
    a = db.session.query(Parcel).filter(Parcel.id.in_(seq)).all()
    p = Plan()
    p.user_id = current_user.id
    contenance = 0
    for parcel in a:
        a = Association()
        a.parcel = parcel
        p.parcels.append(a)
        contenance += a.parcel.contenance
        if p.commune == None :
            p.commune = a.parcel.commune
    p.name = "Plan sans titre à "+p.commune
    p.contenance = contenance
    db.session.add(p)
    db.session.commit()

    return redirect(url_for('map_edit', mapid = p.id))



@app.route('/mapdelete/<uid>' , methods=['DELETE'])
@auth_required()
def map_delete(uid):
    p = Plan.query.get(uid)
    if (p.user_id == current_user.id):
        db.session.delete(p)
        db.session.commit()
        return jsonify({ 'status' : 'success'})
    else:
        return jsonify({ 'status' : 'failure'}),500



@app.route('/mapedit/<mapid>' )
@auth_required()
def map_edit(mapid):
    return render_template('mapedit.html', mapid=mapid)



@app.route('/mapview/<mapid>' )
def map_view(mapid):

    return render_template('mapview.html', mapid=mapid)


@app.route('/map' , methods=['POST'])
def from_address():

    text = (request.form['addr'])
    if len(text)<5:
        return redirect(url_for('goo'))
    apikey = "0c8829b0-2371-11eb-9681-61367c5fb30c"

    headers = { "apikey": apikey }

    params = (
        ("text",text),
        ("size","1"),
        ("boundary.country", "FR")
    );

    response = requests.get('https://app.geocodeapi.io/api/v1/search', headers=headers, params=params);

    output = (response.json())

    ll = output["features"][0]["geometry"]["coordinates"]
    lat = ll[1]
    lon = ll[0]
    return redirect(url_for('vmap', lat=lat, lon=lon))


@app.route('/map')
def naked_map():
    return render_template('map.html')


@app.route('/map/<float:lat>/<float:lon>/<ids>')
def ar_vmap(lat, lon, ids=""):
    return render_template('map.html', lat=lat, lon=lon, ids=ids)


@app.route('/map/<float:lat>/<float:lon>/')
@app.route('/map/<float:lat>/<float:lon>')
def vmap(lat, lon, ids=""):
    return render_template('map.html', lat=lat, lon=lon, ids=ids)

#
# @app.route('/')
# def home():
#     return render_template('home.html')


@app.route('/api/parcellesearch',  methods=['POST'])
def parcellesearch():
    text = (request.values.get('text')).replace(' ', '').upper()
    lat =  float(request.values.get('lat'))
    lon =  float(request.values.get('lng'))

    section = ""
    numero  = ""

    for c in text:
        if (c.isdigit()):
            numero += c
        else:
            section += c

    if numero  != '':
        numero = str(int(numero))
    # print(section, numero)

    delta = 0.02
    l_limit = 10

    a = db.session.query(Parcel).filter(ST_DWithin(Parcel.geom_loc, 'SRID=4326;POINT('+str(lon)+' '+str(lat)+')', delta, use_spheroid = False))


    if (section != ""):
        a = a.filter(Parcel.section.like("%{}%".format(section)))
    if (numero  != ""):
        a = a.filter(Parcel.numero.like("%{}%".format(numero)))

    a = a.limit(l_limit)
    # print(a)
    # Returns HTTP Response with {"hello": "world"}
    response = jsonify({"type": "FeatureCollection", "features": [p.toGeo() for (p) in a]})

    # response =  jsonify( { "type":"FeatureCollection","features": [v.toGeo() for v in a]})# Returns HTTP Response with {"hello": "world"}
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/autocomplete',  methods=['POST'])
def autocomplete():
    text = (request.values.get('text'))
    apikey = "0c8829b0-2371-11eb-9681-61367c5fb30c"
    headers = { "apikey": apikey }
    params = (
        ("text",text),
        ("size","5"),
        ("boundary.country", "FR")
    );
    response = requests.get('https://app.geocodeapi.io/api/v1/autocomplete', headers=headers, params=params);
    output = (response.json())
    return jsonify([i["properties"]["label"] for i in output["features"] ])

# for searching the number of a parcel
# close to a given location
@app.route('/api/lookup',  methods=['POST'])
def parcel_lookup():
    text = (request.values.get('text'))
    lat  = float(request.values.get('lat'))
    lon  = float(request.values.get('lon'))
    radius  = 1.


@app.route('/api/get-map/<mapid>')
def getmap(mapid):


    plan =  db.session.query((Plan)).filter(Plan.id == mapid).first();
    if (plan == None):
        abort(404, description="Resource not found")
    if ((not(current_user.is_authenticated)) and  (not(plan.public and plan.active))):
        abort(403, description="You need to login to have access")
    elif ((plan.user_id != current_user.id) and  (not(plan.public and plan.active)))   :
        abort(404, description="You do not have the right to get this map")

    # response = jsonify({"type": "FeatureCollection", "features": [ {'type': 'Feature', 'properties': {},   'geometry' : shapely.geometry.mapping(to_shape(ass.parcel.geometry)) } for ass in (plan.parcels)]})
    properties = { 'id' : plan.id,
                    'public_text' : plan.public_text,
                    'private_text' : plan.private_text,
                    'name' : plan.name,
                    "commune" : plan.commune,
                    'user_email' : plan.user.email,
                    "public" : plan.public,
                    "active" : plan.active,
                    "show_contact" : plan.show_contact
                    }
    response = jsonify({"type": "FeatureCollection", "features": [ ass.getGeoJSON()  for ass in (plan.parcels)], "properties" : properties})
    return response


# SELECT parcel.latitude
# FROM   parcel
# WHERE
#     ST_MakeEnvelope (
#         (4.328567-0.005),   (44.6245507-0.005),  -- bounding
#         (4.328567+0.005),   (44.6245507+0.005),  -- box limits
#         4326)
# 	  ~ -- contains, gets same fewer rows
# 			parcel.geom_loc ;

@app.route('/api/get-parcels-disk/<lat>/<lon>/<delta>')
def getparcelsdisk(lat, lon, delta=0.005):
    delta = float(delta)
    lat = float(lat)
    lon = float(lon)


    a = db.session.query(Parcel).filter(ST_DWithin(Parcel.geom_loc, 'SRID=4326;POINT('+str(lon)+' '+str(lat)+')', delta, use_spheroid = False))

    a = a.all()
    # Returns HTTP Response with {"hello": "world"}
    response = jsonify({"type": "FeatureCollection", "features": [p.toGeo() for (p) in a]})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/get-parcels/<lat>/<lon>/<delta>')
def getparcels(lat, lon, delta=0.005):
    delta = float(delta)
    lat = float(lat)
    lon = float(lon)

    box = [lon-delta,lat-delta,lon+delta,lat+delta]
    a = db.session.query(Parcel).filter(Parcel.geom_loc.intersects(ST_MakeEnvelope(*box))).all()

    # Returns HTTP Response with {"hello": "world"}
    response = jsonify({"type": "FeatureCollection", "features": [p.toGeo() for (p) in a]})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/get-parcels-from-token/<uid>')
def getparcelfromtoken(uid):
    tok = Token.query.get(uid)
    seq = tok.text.split(':')
    # session.query(Record).filter(Record.id.in_(seq)).all()
    a = db.session.query(Parcel).filter(Parcel.id.in_(seq)).all()
    # Returns HTTP Response with {"hello": "world"}
    response = jsonify({"type": "FeatureCollection", "features": [p.toGeo() for (p) in a]})
    # response =  jsonify( { "type":"FeatureCollection","features": [v.toGeo() for v in a]})# Returns HTTP Response with {"hello": "world"}
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/get-parcels/<ids>')
def getparcelfromids(ids):
    seq = ids.split(':')
    # session.query(Record).filter(Record.id.in_(seq)).all()
    a = db.session.query(Parcel).filter(Parcel.id.in_(seq)).all()

    # Returns HTTP Response with {"hello": "world"}
    response = jsonify({"type": "FeatureCollection", "features": [p.toGeo() for (p) in a]})

    # response =  jsonify( { "type":"FeatureCollection","features": [v.toGeo() for v in a]})# Returns HTTP Response with {"hello": "world"}
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response



@app.route('/token', methods=['POST'])
def newtoken():
    if not(request.is_json):
        return

    tok = Token()
    tok.text = (request.json.get('text'))
    db.session.add(tok)
    db.session.commit()
    return jsonify({ 'token' : tok.id, 'text' : tok.text })

@app.route('/token/<uid>', methods=['GET'])
def gettoken(uid):
    tok = Token.query.get(uid)
    return jsonify({ 'token' : tok.id, 'text' : tok.text })



@app.route('/legal', methods=['GET'])
def legal():
    return render_template('legal.html')
