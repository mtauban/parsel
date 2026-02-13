function hasValue(value) {
  return !(value === null || value === undefined || value === '')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, function(letter) {
    return letter.toUpperCase()
  })
}

function safeMaterialLabel(dictionary, code) {
  if (!hasValue(code)) {
    return null
  }
  const raw = dictionary[code]
  if (!hasValue(raw)) {
    return code
  }
  const lowered = String(raw).toLowerCase()
  return lowered.charAt(0).toUpperCase() + lowered.slice(1)
}

function addDetailLine(lines, label, value) {
  if (!hasValue(value)) {
    return
  }
  lines.push(`${label} : ${escapeHtml(value)}`)
}

export function getFeatureType(feature) {
  if (!feature || !feature.properties) {
    return null
  }
  const aType = feature.properties.a_type
  if (typeof aType === 'string' && aType.charAt(0) === 'p') {
    return 'parcel'
  }
  if (typeof aType === 'string' && aType.charAt(0) === 'b') {
    return 'building'
  }
  if (typeof feature.id === 'string' && feature.id.charAt(0) === 'p') {
    return 'parcel'
  }
  if (typeof feature.id === 'string' && feature.id.charAt(0) === 'b') {
    return 'building'
  }
  return null
}

export function defaultGroupIdForType(type) {
  if (type === 'parcel') {
    return 'parcels'
  }
  if (type === 'building') {
    return 'buildings'
  }
  return 'user-shapes'
}

export function getLayerKeyForGroup(groupId, selected) {
  if (groupId === 'parcels') {
    return selected ? 'parcelsSelected' : 'parcelsLoaded'
  }
  if (groupId === 'buildings') {
    return selected ? 'buildingsSelected' : 'buildingsLoaded'
  }
  return `${groupId}:${selected ? 'selected' : 'loaded'}`
}

export function toViewFeature(feature, selected = false) {
  const type = getFeatureType(feature)
  const groupId = feature && feature.properties && feature.properties._groupId
    ? String(feature.properties._groupId)
    : defaultGroupIdForType(type)

  return {
    id: feature.id,
    type,
    groupId,
    selected,
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      _selected: selected,
      _groupId: groupId
    }
  }
}

export function getFeatureTitle(feature) {
  if (!feature || !feature.properties) {
    return 'Inconnu'
  }
  if (feature.type === 'parcel') {
    return `${feature.properties.section || ''} ${feature.properties.numero || ''}`.trim()
  }
  if (typeof window.format_batiment_id === 'function') {
    return String(window.format_batiment_id(feature.id))
  }
  return feature.id
}

export function getFeatureSubtitle(feature) {
  if (!feature || !feature.properties) {
    return ''
  }
  if (feature.type === 'parcel') {
    return feature.properties.nom_com || feature.properties.commune || ''
  }
  return feature.properties.usage_1 || 'Bâtiment'
}

export function getFeatureAreaLabel(feature) {
  if (!feature || !feature.properties) {
    return 'n.d.'
  }
  if (feature.type === 'parcel' && typeof window.contenance_format === 'function') {
    return window.contenance_format(feature.properties.contenance)
  }
  if (feature.type === 'building' && typeof window.contenance_format_building === 'function') {
    return window.contenance_format_building(feature.properties.contenance)
  }
  return 'n.d.'
}

export function formatFeatureDetails(feature) {
  const props = feature && feature.properties ? feature.properties : {}
  const details = []
  const usedKeys = new Set()

  if (hasValue(props.date_d_apparition)) {
    addDetailLine(details, 'Année enregistrement', String(props.date_d_apparition).split('-')[0])
    usedKeys.add('date_d_apparition')
  }

  if (hasValue(props.contenance) && typeof window.contenance_format_building === 'function') {
    addDetailLine(details, 'Surface au sol', window.contenance_format_building(props.contenance))
    usedKeys.add('contenance')
  }

  if (hasValue(props.altitude_minimale_sol)) {
    addDetailLine(details, 'Altitude', props.altitude_minimale_sol)
    usedKeys.add('altitude_minimale_sol')
  }

  if (hasValue(props.hauteur)) {
    addDetailLine(details, 'Hauteur', props.hauteur)
    usedKeys.add('hauteur')
  }

  if (hasValue(props.usage_1)) {
    addDetailLine(details, 'Usage principal', props.usage_1)
    usedKeys.add('usage_1')
  }

  if (hasValue(props.usage_2)) {
    addDetailLine(details, 'Usage secondaire', props.usage_2)
    usedKeys.add('usage_2')
  }

  if (hasValue(props.nombre_de_logements)) {
    addDetailLine(details, 'Nombre de logements', props.nombre_de_logements)
    usedKeys.add('nombre_de_logements')
  }

  if (hasValue(props.nombre_d_etages)) {
    addDetailLine(details, 'Nombre d\'étages', props.nombre_d_etages)
    usedKeys.add('nombre_d_etages')
  }

  if (hasValue(props.materiaux_des_murs)) {
    addDetailLine(details, 'Murs', safeMaterialLabel(window.dmatgm || {}, props.materiaux_des_murs))
    usedKeys.add('materiaux_des_murs')
  }

  if (hasValue(props.materiaux_de_la_toiture)) {
    addDetailLine(details, 'Toiture', safeMaterialLabel(window.dmatto || {}, props.materiaux_de_la_toiture))
    usedKeys.add('materiaux_de_la_toiture')
  }

  Object.keys(props).sort().forEach(function(key) {
    const value = props[key]
    if (usedKeys.has(key) || !hasValue(value)) {
      return
    }
    if (typeof value === 'object') {
      addDetailLine(details, humanizeKey(key), JSON.stringify(value))
      return
    }
    addDetailLine(details, humanizeKey(key), value)
  })

  return details.join('<br />')
}

export function hasMeaningfulValue(value) {
  return hasValue(value)
}

export function getGroupKeyForFeature(feature) {
  if (!feature) {
    return null
  }
  const groupId = feature.groupId || defaultGroupIdForType(feature.type)
  return getLayerKeyForGroup(groupId, feature.selected)
}

export function isBuilding(feature) {
  return feature && feature.type === 'building'
}

export function isParcel(feature) {
  return feature && feature.type === 'parcel'
}

export function splitIdsByType(ids) {
  return ids.reduce(
    function(acc, id) {
      if (id.charAt(0) === 'p') {
        acc.parcels.push(id)
      } else if (id.charAt(0) === 'b') {
        acc.buildings.push(id)
      }
      return acc
    },
    { parcels: [], buildings: [] }
  )
}

export function getBadgeRows(feature) {
  const rows = []
  if (!feature || !feature.properties) {
    return rows
  }

  rows.push(getFeatureAreaLabel(feature))

  if (feature.type === 'building') {
    if (hasValue(feature.properties.hauteur)) {
      rows.push(`hauteur ${feature.properties.hauteur} m`)
    }
    if (hasValue(feature.properties.nombre_d_etages)) {
      rows.push(`Etages ${feature.properties.nombre_d_etages}`)
    }
    if (hasValue(feature.properties.nombre_de_logements)) {
      rows.push(`Logements ${feature.properties.nombre_de_logements}`)
    }
    if (hasValue(feature.properties.usage_1)) {
      rows.push(`Usage principal ${feature.properties.usage_1}`)
    }
  }

  return rows
}
