from flask import abort, request, render_template, jsonify, Blueprint, redirect, url_for

from flask_security import current_user, auth_required

from geoalchemy2.shape import to_shape
import shapely

import json
import ujson
import time
import numbers

from . import app, db, cache, csrf
from .models import Parcel, Plan, Association, Token, Map, Feature
from geoalchemy2.functions import ST_DistanceSphere, ST_MakePoint, ST_Centroid, ST_DWithin, ST_SetSRID, ST_AsGeoJSON, ST_Contains, ST_MakeEnvelope
from geoalchemy2.functions import ST_GeomFromGeoJSON

import pyproj
import shapely.ops as ops
from shapely.geometry import shape, GeometryCollection, mapping
from shapely import make_valid, set_precision
from shapely.ops import unary_union
from shapely.strtree import STRtree


from area import area

from functools import partial
import math
import requests
from owslib.wfs import WebFeatureService

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


@app.get('/health')
def health():
    """Liveness probe for the reverse proxy and container platform."""
    return {"status": "ok"}


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
    apikey = app.config.get("GEOCODE_API_KEY")
    if not apikey:
        return jsonify(error=500, text="GEOCODE_API_KEY is not configured"), 500

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
    apikey = app.config.get("GEOCODE_API_KEY")
    if not apikey:
        return jsonify(error=500, text="GEOCODE_API_KEY is not configured"), 500

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
        try:
            app.wfs11 =  WebFeatureService(url='https://data.geopf.fr/wfs/ows', version='2.0.0')
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
@cache.memoize(30 * 24 * 60 * 60)
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



def _extract_merge_primitive_ids(feature_id, properties):
    raw_properties = properties if isinstance(properties, dict) else {}
    raw_ids = raw_properties.get("merged_from_ids", [])
    values = raw_ids if isinstance(raw_ids, list) else []
    if not values and isinstance(feature_id, str) and len(feature_id) > 1 and feature_id[0] in ("p", "b"):
        values = [feature_id]

    out = []
    seen = set()
    for value in values:
        value_str = str(value or "")
        if len(value_str) <= 1 or value_str[0] not in ("p", "b"):
            continue
        if value_str in seen:
            continue
        seen.add(value_str)
        out.append(value_str)
    return out


def _polygonal_geometry(geom):
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        parts = []
        for part in geom.geoms:
            if part.geom_type == "Polygon":
                parts.append(part)
            elif part.geom_type == "MultiPolygon":
                parts.extend(part.geoms)
        if not parts:
            return None
        return unary_union(parts)
    return None


def _should_merge_geometries(geom_a, geom_b):
    if not geom_a.intersects(geom_b):
        return False
    if geom_a.overlaps(geom_b) or geom_a.contains(geom_b) or geom_b.contains(geom_a):
        return True
    boundary_intersection = geom_a.boundary.intersection(geom_b.boundary)
    return boundary_intersection.length > 0


def _candidate_indexes(tree, geom, by_object_id):
    indexes = []
    for candidate in tree.query(geom):
        if isinstance(candidate, numbers.Integral):
            indexes.append(int(candidate))
            continue
        idx = by_object_id.get(id(candidate))
        if idx is not None:
            indexes.append(idx)
    return indexes


def _merge_geometry_payload(raw_features, grid_size):
    prepared = []
    seen_feature_ids = set()
    for index, raw_feature in enumerate(raw_features):
        if not isinstance(raw_feature, dict):
            continue
        geometry = raw_feature.get("geometry")
        if not geometry:
            continue
        try:
            geom = shape(geometry)
            geom = make_valid(geom)
            geom = set_precision(geom, grid_size=grid_size)
            geom = _polygonal_geometry(geom)
        except Exception:
            continue

        if geom is None or geom.is_empty:
            continue

        feature_id = str(raw_feature.get("id") or raw_feature.get("feature_id") or f"source-{index}")
        if feature_id in seen_feature_ids:
            continue
        seen_feature_ids.add(feature_id)
        properties = raw_feature.get("properties") or {}
        primitive_ids = _extract_merge_primitive_ids(feature_id, properties)
        prepared.append(
            {
                "id": feature_id,
                "geom": geom,
                "primitive_ids": primitive_ids
            }
        )

    if len(prepared) < 2:
        return [], prepared

    geoms = [item["geom"] for item in prepared]
    tree = STRtree(geoms)
    object_index = {id(geom): index for index, geom in enumerate(geoms)}

    parent = list(range(len(geoms)))
    rank = [0] * len(geoms)

    def find(value):
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(a_idx, b_idx):
        root_a = find(a_idx)
        root_b = find(b_idx)
        if root_a == root_b:
            return
        if rank[root_a] < rank[root_b]:
            parent[root_a] = root_b
        elif rank[root_a] > rank[root_b]:
            parent[root_b] = root_a
        else:
            parent[root_b] = root_a
            rank[root_a] += 1

    for i, geom in enumerate(geoms):
        for j in _candidate_indexes(tree, geom, object_index):
            if j <= i:
                continue
            if _should_merge_geometries(geom, geoms[j]):
                union(i, j)

    groups = {}
    for i in range(len(geoms)):
        root = find(i)
        groups.setdefault(root, []).append(i)

    merged_components = []
    for member_indexes in groups.values():
        component_geoms = [prepared[idx]["geom"] for idx in member_indexes]
        component_union = unary_union(component_geoms)
        component_union = make_valid(component_union)
        component_union = _polygonal_geometry(component_union)
        if component_union is None or component_union.is_empty:
            continue

        component_parts = [component_union] if component_union.geom_type == "Polygon" else list(component_union.geoms)
        for part in component_parts:
            if part.is_empty:
                continue
            merged_from = []
            merged_from_seen = set()
            source_ids = []
            for idx in member_indexes:
                source_geom = prepared[idx]["geom"]
                if not source_geom.intersects(part):
                    continue
                source_ids.append(prepared[idx]["id"])
                for primitive_id in prepared[idx]["primitive_ids"]:
                    if primitive_id in merged_from_seen:
                        continue
                    merged_from_seen.add(primitive_id)
                    merged_from.append(primitive_id)

            merged_components.append(
                {
                    "geometry": part,
                    "source_ids": source_ids,
                    "primitive_ids": merged_from
                }
            )

    return merged_components, prepared


def _iter_geometry_coordinates(geometry):
    if not isinstance(geometry, dict):
        return
    coordinates = geometry.get("coordinates")
    if coordinates is None:
        return

    stack = [coordinates]
    while stack:
        item = stack.pop()
        if isinstance(item, (list, tuple)):
            if len(item) >= 2 and isinstance(item[0], (int, float)) and isinstance(item[1], (int, float)):
                yield float(item[0]), float(item[1])
                continue
            for child in item:
                stack.append(child)


def _looks_like_geographic_features(raw_features):
    for raw_feature in raw_features:
        geometry = raw_feature.get("geometry") if isinstance(raw_feature, dict) else None
        for x, y in _iter_geometry_coordinates(geometry):
            return abs(x) <= 180.0 and abs(y) <= 90.0
    return True


def _default_merge_grid_size(raw_features):
    # WGS84 coordinates are in degrees: 1e-6 ~= 0.11 m (decimeter scale).
    # Projected metric CRS can use direct meter precision.
    if _looks_like_geographic_features(raw_features):
        return 0.000001
    return 0.1


@app.route('/api/merge-features', methods=['POST'])
@csrf.exempt
def merge_features():
    payload = request.get_json(silent=True) or {}
    raw_features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(raw_features, list):
        return jsonify(error=400, text="Le payload doit contenir une liste 'features'."), 400

    default_grid_size = _default_merge_grid_size(raw_features)
    if payload.get("grid_size") is None:
        raw_grid_size = default_grid_size
    else:
        try:
            raw_grid_size = float(payload.get("grid_size"))
        except Exception:
            raw_grid_size = default_grid_size

    if not math.isfinite(raw_grid_size) or raw_grid_size <= 0:
        raw_grid_size = default_grid_size

    merged_components, prepared = _merge_geometry_payload(raw_features, raw_grid_size)
    stamp = int(time.time() * 1000)
    response_features = []

    for index, component in enumerate(merged_components):
        feature_id = f"u-merge-{stamp}-{index + 1}"
        response_features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "properties": {
                    "id": feature_id,
                    "a_type": "u",
                    "merged_from_ids": component["primitive_ids"],
                    "merged_from_count": len(component["primitive_ids"]),
                    "merged_source_ids": component["source_ids"],
                    "merged_source_count": len(component["source_ids"])
                },
                "geometry": mapping(component["geometry"])
            }
        )

    return jsonify(
        {
            "type": "FeatureCollection",
            "features": response_features,
            "meta": {
                "submitted_count": len(raw_features),
                "accepted_count": len(prepared),
                "merged_count": len(response_features),
                "grid_size": raw_grid_size
            }
        }
    )


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
