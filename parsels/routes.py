from flask import abort, request, render_template, jsonify, Blueprint, redirect, url_for

from flask_security import current_user, auth_required

from geoalchemy2.shape import to_shape
import shapely

import json
import ujson

from . import app, db, cache
from .models import Parcel, Plan, Association, Token, Map, Feature
from geoalchemy2.functions import ST_DistanceSphere, ST_MakePoint, ST_Centroid, ST_DWithin, ST_SetSRID, ST_AsGeoJSON, ST_Contains, ST_MakeEnvelope
from geoalchemy2.functions import ST_GeomFromGeoJSON

import pyproj
import shapely.ops as ops
from shapely.geometry import shape, GeometryCollection


from area import area

from functools import partial
import math
import requests

#
# def getAreafromGeometry(polygon):
#     geom_area = ops.transform(
#     partial(
#         pyproj.transform,
#         pyproj.Proj('EPSG:4326'),
#         pyproj.Proj(
#             proj='aea',
#             lat_1=polygon.bounds[1],
#             lat_2=polygon.bounds[3])),
#     polygon)
#     return geom_area.area


@app.route('/')
def entrypoint():
    if ((current_user.is_authenticated)):
        return redirect(url_for('map_list'))
    else:
        return redirect(url_for('home'))


@app.route('/home')
def home():
    return  render_template('home.html')

@app.route('/more')
def more():
    return  render_template('more.html')


@app.route('/go')
def goo():
    return  render_template('go.html')


@app.route('/donate')
def donate():
    return  render_template('donate.html')

@app.route('/thankyou')
def thankyou():
    return  render_template('thankyou.html')



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



@app.route('/user' )
@auth_required()
def user_detail():
    return render_template('user.html')




@app.route('/mymaps' )
@auth_required()
def map_list():
    a = db.session.query(Map).filter(Map.user_id == current_user.id).all()
    # print(a)
    return render_template('mymaps.html', plan_liste=a)



@app.route('/mapcreate/<uid>' )
@auth_required()
def map_create(uid):
    tok = Token.query.get(uid)
    seq = tok.text.split(':')

    requested_parcels = [ 'parcelle.'+p[1:] for p in seq if p[0] == 'p' ]
    #@TODO: we should check that the list contains only ids !!!
    response = app.wfs11.getfeature(typename='CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
                                outputFormat='application/json',
                                featureid=requested_parcels)
    t = (response.read())
    data = json.loads(t)
    data = ign_posttreatment_parcels(data)

    requested_buildings = [ 'batiment.'+p[1:] for p in seq if p[0] == 'b' ]
    response = app.wfs11.getfeature(typename='BDTOPO_V3:batiment',
                                    outputFormat='application/json',
                                    featureid=requested_buildings)
    t = (response.read())
    data_b = json.loads(t)
    data_b = ign_posttreatment_buildings(data_b)

    print(data)
    print(data_b)


    m = Map(user_id = current_user.id, properties = {})
    db.session.add(m)
    db.session.commit()
    print(m.id)


    for p in data['features']:
        print(p['id'])
        print(json.dumps(p['properties'],  sort_keys=True))
        f = Feature(id_ign = p['id'],
                    geometry = ST_GeomFromGeoJSON(ujson.dumps(p['geometry'])),
                    properties = p['properties'],
                    )
        m.features.append(f)
    for p in data_b['features']:
        print(p['id'])
        print(json.dumps(p['properties'],  sort_keys=True))
        f = Feature(id_ign = p['id'],
                    geometry = ST_GeomFromGeoJSON(ujson.dumps(p['geometry'])),
                    properties = p['properties'],
                    )
        m.features.append(f)
    db.session.commit()

    return jsonify({ 'status' : 'success', 'map_id' : m.id})


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

@app.route('/map', defaults={'u_path': ''})
@app.route('/map/', defaults={'u_path': ''})
@app.route('/map/<path:u_path>')
def vmap(u_path):
    return render_template('map.html')

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
    if (not(current_user.is_authenticated)):
        if (not(plan.public and plan.active)):
            abort(403, description="You need to login to have access")
    elif ((plan.user_id != current_user.id) and (not(plan.public and plan.active)))   :
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


def ign_posttreatment_buildings(data):
    for feature in data["features"]:
        # print(feature)
        feature["id"] = "b"+feature["id"].split(".")[1]


        feature["properties"]["contenance"] = area((feature["geometry"]))
        feature["properties"]["id"] = feature["id"]
        feature["properties"]["a_type"] = "b" + ('0' if feature["properties"]["construction_legere"] == False else '1')
    return data

def ign_posttreatment_parcels(data):
    for feature in data["features"]:
        feature["id"] = "p"+feature["id"].split(".")[1] # feature["properties"]["idu"]
        # this part assumes that the id is composed of "parcelle." + the actual math monkey id.
        feature["properties"]["contenance"] = area((feature["geometry"]))
        feature["properties"]["commune"] = feature["properties"].pop('code_insee')
        feature["properties"]["prefixe"] = feature["properties"].pop('com_abs')
        feature["properties"]["id"] = feature["properties"].pop('idu')
        feature["properties"]["a_type"] = "p"
    return data


def ign_checkwfs(app):
    if app.wfs11 == None:
        # ign wfs11
        ign_apikey = "7tbcsy3xj9ymeoi4mjdlyayo"
        # apikey = "beta"
        try:
            app.wfs11 =  WebFeatureService(url='https://wxs.ign.fr/essentiels/geoportail/wfs', version='2.0.0')

            # app.wfs11 = WebFeatureService(url='https://wxs.ign.fr/'+ign_apikey+'/geoportail/wfs', version='1.1.0', headers={ 'User-Agent': 'parcelle-recs' })
        except:
            print ("Timeout occurred")
            app.wfs11 = None
    return app.wfs11

#ign support for bounding box
@app.route('/api/ign/get-parcels-boundingbox/<float:lad>/<float:lod>/<float:lam>/<float:lom>')
@cache.memoize(30 * 24 * 60 * 60)
def ign_getparcels_boundingbox(lod,lad,lom,lam):
    if (ign_checkwfs(app) == None):
        return jsonify(error=500, text="Impossible de communiquer avec les serveurs de l'IGN"), 500
    headers = {
       'User-Agent': app.config['IGN_USER_AGENT']
     }

    if (lod>lom):
        a = lod
        lod = lom
        lom = a

    if (lad>lam):
        a = lad
        lad = lam
        lam = a

    box = (lod,lad,lom,lam)
    mf = 1000
    featuresLimit = 2000 # we do not provide more than mf features !
    totalResults = mf
    loadedResults = 0
    data = None
    while ((loadedResults<totalResults) and (loadedResults<featuresLimit)):

        response = app.wfs11.getfeature(typename='CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
                                bbox=box,outputFormat='application/json',
                                maxfeatures=mf,
                                startindex=loadedResults)
        t = (response.read())
        a = json.loads(t)

        #print(json.dumps(a))
        if (loadedResults == 0):
            totalResults = a["totalFeatures"]
            data = a
        else:
            print(a)
            data["features"] = data["features"] + a["features"]
            data["numberReturned"] += a["numberReturned"]

        loadedResults += a["numberReturned"]
        #print(t)
    #print(totalResults,loadedResults)

    data = ign_posttreatment_parcels(data)
    return jsonify(data)





#ign support for bounding box
@app.route('/api/ign/get-buildings-boundingbox/<float:lad>/<float:lod>/<float:lam>/<float:lom>')
@cache.memoize(30 * 24 * 60 * 60)
def ign_getbuildings_boundingbox(lod,lad,lom,lam):
    if (ign_checkwfs(app) == None):
        return jsonify(error=500, text="Impossible de communiquer avec les serveurs de l'IGN"), 500
    headers = {
       'User-Agent': app.config['IGN_USER_AGENT']
     }

    if (lod>lom):
        a = lod
        lod = lom
        lom = a

    if (lad>lam):
        a = lad
        lad = lam
        lam = a

    box = (lod,lad,lom,lam)
    mf = 1000
    featuresLimit = 2000 # we do not provide more than mf features !
    totalResults = mf
    loadedResults = 0
    data = None
    while ((loadedResults<totalResults) and (loadedResults<featuresLimit)):
        response = app.wfs11.getfeature(typename='BDTOPO_V3:batiment',
                                bbox=box,outputFormat='application/json',
                                maxfeatures=mf,
                                startindex=loadedResults)
        t = (response.read())
        a = json.loads(t)

        #print(json.dumps(a))
        if (loadedResults == 0):
            totalResults = a["totalFeatures"]
            data = a
        else:
            print(a)
            data["features"] = data["features"] + a["features"]
            data["numberReturned"] += a["numberReturned"]

        loadedResults += a["numberReturned"]
        #print(t)
    #print(totalResults,loadedResults)

    data = ign_posttreatment_buildings(data)
    return jsonify(data)




@app.route('/api/ign/get-parcels/<ids>')
@cache.memoize(30 * 24 * 60 * 60)
def ign_getparcelfromids(ids):
    if (ign_checkwfs(app) == None):
        return jsonify(error=500, text="Impossible de communiquer avec les serveurs de l'IGN"), 500
    requested_parcels = [ 'parcelle.'+p[1:] for p in ids.split(':') if p[0] == 'p' ]
    #@TODO: we should check that the list contains only ids !!!
    response = app.wfs11.getfeature(typename='CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
                                outputFormat='application/json',
                                featureid=requested_parcels)
    t = (response.read())
    data = json.loads(t)
    data = ign_posttreatment_parcels(data)

    return jsonify(data)


@app.route('/api/ign/get-buildings/<ids>')
# @cache.memoize(30 * 24 * 60 * 60)
def ign_getbuildingsfromids(ids):
    if (ign_checkwfs(app) == None):
        return jsonify(error=500, text="Impossible de communiquer avec les serveurs de l'IGN"), 500
    print(ids)
    requested_buildings = [ 'batiment.'+p[1:] for p in ids.split(',') if p[0] == 'b' ]
    print(requested_buildings)
    response = app.wfs11.getfeature(typename='BDTOPO_V3:batiment',
                                    outputFormat='application/json',
                                    featureid=requested_buildings)
    t = (response.read())
    data_b = json.loads(t)
    data_b = ign_posttreatment_buildings(data_b)
    return jsonify(data_b)



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
        print('not in json')
        return
    tok = Token(text = ujson.dumps(request.json.get('text')))
    print(tok.text)
    db.session.add(tok)
    db.session.commit()
    return jsonify({ 'token' : tok.id, 'text' : tok.text })


@app.route('/api/createnplan', methods=['POST'])
def new_nplan():
    if not(request.is_json):
        print('not in json')
        return jsonify({ 'status' : 'error'})
    # print(request.json)
    nplan = request.json.get('nplan')

    for p in nplan['parcels']:
        print(p['id'])



    m = Map(user_id = current_user.id, properties = {})
    db.session.add(m)
    db.session.commit()
    print(m.id)


    for p in nplan['parcels']:
        print(p['id'])
        f = Feature(id_ign = p['id'],
                    geometry = ST_GeomFromGeoJSON(ujson.dumps(p['geometry'])),
                    properties = (p['properties']),
                    )
        m.features.append(f)
    db.session.commit()
    return jsonify({ 'nplan' : { 'id' : (m.id)}})




@app.route('/api/getnplan/<uid>', methods=['GET'])
def get_nplan(uid):
    nplan = Map.query.get(uid)
    return jsonify({
        'id' : nplan.id,
        'properties' : nplan.properties,
        'parcels' : {
            "type": "FeatureCollection",
            "features" : [f.toGeo() for f in nplan.features]
            }
    })


@app.route('/token/<uid>', methods=['GET'])
def gettoken(uid):
    tok = Token.query.get(uid)
    return jsonify({ 'token' : tok.id, 'text' : tok.text })



@app.route('/legal', methods=['GET'])
def legal():
    return render_template('legal.html')
