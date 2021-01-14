from owslib.wfs import WebFeatureService
import json


apikey = "7tbcsy3xj9ymeoi4mjdlyayo"
# apikey = "beta"

wfs11 = WebFeatureService(url='https://wxs.ign.fr/'+apikey+'/geoportail/wfs', version='1.1.0', headers={ 'User-Agent': 'parcelle-recs' })

print('ok')
print(wfs11.identification.title)
print([operation.name for operation in wfs11.operations])
print(list(wfs11.contents))

print(wfs11.headers)
response = wfs11.getfeature(typename='CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle', bbox=(4.8363447189331055,45.75274517163593,4.8415718623437,45.75283716884888),outputFormat='application/json')

t = (response.read())
print(t)
a = json.dumps(json.loads(t))


print(a)
