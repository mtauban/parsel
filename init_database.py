from parsels import app, db
from parsels.models import Parcel
import ujson

from geoalchemy2.functions import ST_GeomFromGeoJSON

import numpy as np

if __name__ == "__main__":



    with app.app_context():
        db.create_all()

        with open('./assets/cadastre-69-parcelles.json') as file:
            ln = 0
            for line in file:
                ln += 1
                if (ln == 1):
                    continue
                # print(line[:-2])
                parcel = ujson.loads(line[:-2])

                #print(parcel['id'])
                (lo,la)=(parcel['geometry']['coordinates'][0][0])
                contenance = parcel['properties'].get('contenance')
                if not(contenance):
                    contenance = 0
                P1 = Parcel(
                     id =parcel['id'],
                     geometry= ST_GeomFromGeoJSON(ujson.dumps(parcel['geometry'])),
                     commune=parcel['properties']['commune'],
                     prefixe=parcel['properties']['prefixe'],
                     section=parcel['properties']['section'],
                     numero=parcel['properties']['numero'],
                     latitude = la,
                     longitude = lo,
                     contenance= contenance,
                     arpente = parcel['properties']['arpente'],
                 )

                db.session.add(P1)
                if (ln % 5000) == 0:
                    print("partial commit")
                    db.session.commit()
            db.session.commit()
