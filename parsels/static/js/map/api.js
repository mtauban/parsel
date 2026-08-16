async function assertOk(response) {
  if (!response.ok) {
    let details = ''
    try {
      const payload = await response.clone().json()
      details = payload.text || payload.error || JSON.stringify(payload)
    } catch (error) {
      try {
        details = await response.clone().text()
      } catch (innerError) {
        details = ''
      }
    }
    throw new Error(`HTTP ${response.status}${details ? ` - ${details}` : ''}`)
  }
  return response
}

export async function searchAddress(query, lat, lon) {
  const params = new URLSearchParams({
    limit: '8',
    autocomplete: '1',
    q: query,
    lat: String(lat),
    lon: String(lon)
  })

  const response = await fetch(`https://api-adresse.data.gouv.fr/search/?${params.toString()}`)
  const payload = await (await assertOk(response)).json()
  return payload.features || []
}

export async function reverseAddress(lat, lon) {
  const response = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`)
  const payload = await (await assertOk(response)).json()
  const feature = payload.features && payload.features[0]
  if (!feature) {
    return null
  }
  return {
    city: feature.properties.city,
    citycode: feature.properties.citycode,
    postcode: feature.properties.postcode
  }
}

export async function loadBoundingBox(kind, bounds) {
  const endpoint = kind === 'parcels' ? 'parcels' : 'buildings'
  const url = `/api/ign/get-${endpoint}-boundingbox/${bounds.getSouth()}/${bounds.getWest()}/${bounds.getNorth()}/${bounds.getEast()}`
  const response = await fetch(url)
  const payload = await (await assertOk(response)).json()
  return payload
}

export async function loadParcelsByIds(ids) {
  if (!ids.length) {
    return { type: 'FeatureCollection', features: [] }
  }
  const response = await fetch(`/api/ign/get-parcels/${ids.join(':')}`)
  return (await assertOk(response)).json()
}

export async function loadBuildingsByIds(ids) {
  if (!ids.length) {
    return { type: 'FeatureCollection', features: [] }
  }
  const response = await fetch(`/api/ign/get-buildings/${ids.join(',')}`)
  return (await assertOk(response)).json()
}

export async function mergeFeatures(payload) {
  const response = await fetch('/api/merge-features', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  })
  return (await assertOk(response)).json()
}
