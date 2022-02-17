from owslib.wfs import WebFeatureService
import json


ign_apikey = "7tbcsy3xj9ymeoi4mjdlyayo"
# apikey = "beta"

wfs11 = WebFeatureService(url='https://wxs.ign.fr/essentiels/geoportail/wfs', version='2.0.0')

print('ok')
print(wfs11.identification.title)
print([operation.name for operation in wfs11.operations])
print([storedquery.id for storedquery in wfs11.storedqueries])
print(list(wfs11.contents))

print(wfs11.headers)


mf = 500

totalResults = mf
loadedResults = 0

globalfeatures = None
while (loadedResults<totalResults):

    response = wfs11.getfeature(typename='BDTOPO_V3:batiment',
                            bbox=(4.8363447189331055,45.75274517163593,4.8415718623437,45.75283716884888),outputFormat='application/json',
                            maxfeatures=mf,
                            startindex=loadedResults)
    t = (response.read())
    a = json.loads(t)

    #print(json.dumps(a))
    if (loadedResults == 0):
        totalResults = a["totalFeatures"]
        globalfeatures = a
    else:
        print(a)
        globalfeatures["features"] = globalfeatures["features"] + a["features"]

    loadedResults += a["numberReturned"]
    print(t)
print(totalResults,loadedResults)
# a = json.dumps(json.loads(t))

# print(a)
