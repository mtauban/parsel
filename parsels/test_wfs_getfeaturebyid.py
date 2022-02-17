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

response = wfs11.getfeature(typename='CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',outputFormat='application/json', featureid=['parcelle.75964254'])
t = (response.read())
print(t)
