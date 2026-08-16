const MAP_PATH_PREFIX = '/map/'

function normalizeIds(ids) {
  return ids.filter(Boolean)
}

export function buildSharePath({ lat, lon, zoom, selectedIds }) {
  const ids = normalizeIds(selectedIds || [])
  return `${MAP_PATH_PREFIX}${lat},${lon},${zoom},,${ids.join(':')}`
}

export function updateShareUrl(payload) {
  const path = buildSharePath(payload)
  window.history.replaceState('', '', path)
}

export function parseInitialMapStateFromUrl(defaults) {
  const fallback = {
    lat: defaults.lat,
    lon: defaults.lon,
    zoom: defaults.zoom,
    ids: []
  }

  const raw = window.location.href.split('/').pop()
  if (!raw) {
    return fallback
  }

  const params = raw.split(',')
  if (params.length === 1) {
    return fallback
  }

  const lat = Number.parseFloat(params[0])
  const lon = Number.parseFloat(params[1])
  const zoom = Number.parseFloat(params[2])

  const parsed = {
    lat: Number.isFinite(lat) ? lat : fallback.lat,
    lon: Number.isFinite(lon) ? lon : fallback.lon,
    zoom: Number.isFinite(zoom) ? zoom : fallback.zoom,
    ids: []
  }

  if (params.length > 4 && params[3] === '') {
    const idsRaw = params[4].split('#')[0]
    parsed.ids = normalizeIds(idsRaw.split(':'))
  }

  return parsed
}

export function hasUrlMapState() {
  const raw = window.location.href.split('/').pop()
  if (!raw) {
    return false
  }
  return raw.split(',').length > 1
}
