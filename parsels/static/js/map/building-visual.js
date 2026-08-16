import { hasMeaningfulValue } from './feature-utils.js'

const numericPalette = ['#0d3b66', '#1d4e89', '#2e6f95', '#4ea8de', '#76c893', '#ffd166', '#f8961e', '#ef476f']
const quantilePalette = ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b']
const categoryPalette = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ab']

export const BUILDING_VISUAL_MODE_LABELS = {
  basic: 'Affichage pointillé (base)',
  year: 'Année de construction',
  cad_mod_date: 'Date dernière modification cadastrale',
  logements: 'Nombre de logements',
  usage_primary: 'Usage principal',
  usage_mix: 'Usages (principal + secondaire)',
  height_quantile: 'Hauteur (classes quantiles)',
  floors_quantile: 'Etages (classes quantiles)',
  ceiling_height_quantile: 'Hauteur moyenne sous plafond (quantiles)',
  housing_surface_quantile: 'Surface moyenne logement (quantiles)',
  historic_period: 'Périodes historiques',
  match_grade: 'Fiabilité foncière (classe A/B/C)',
  match_score: 'Fiabilité foncière (score)',
  floors: 'Nombre d\'étages',
  height: 'Hauteur',
  roof_type: 'Type de toiture',
  wall_type: 'Type de murs',
  roof_delta: 'Différence alt. toit (max-min)'
}

export const BUILDING_VISUAL_OPTIONS = Object.entries(BUILDING_VISUAL_MODE_LABELS).map(function(entry) {
  return { value: entry[0], label: entry[1] }
})

function normalizeUsage(value) {
  if (!hasMeaningfulValue(value)) {
    return null
  }
  const normalized = String(value).trim()
  if (!normalized || normalized === '00') {
    return null
  }
  const lowered = normalized.toLowerCase()
  if (['nc', 'n.c.', 'non renseigne', 'non renseigné', 'inconnu'].includes(lowered)) {
    return null
  }
  return normalized
}

function extractYear(value) {
  if (!hasMeaningfulValue(value)) {
    return null
  }
  const match = String(value).match(/^(\d{4})/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

function historicPeriod(year) {
  if (!Number.isFinite(year)) {
    return null
  }
  if (year < 1850) {
    return 'Avant 1850'
  }
  if (year <= 1914) {
    return '1850-1914'
  }
  if (year <= 1945) {
    return '1915-1945'
  }
  if (year <= 1974) {
    return '1946-1974'
  }
  if (year <= 1999) {
    return '1975-1999'
  }
  return '2000+'
}

function parseFiscalMatch(value) {
  if (!hasMeaningfulValue(value)) {
    return { grade: null, score: null }
  }
  const text = String(value).trim()
  const match = text.match(/^([A-Za-z])(?:\s+([0-9]+(?:[.,][0-9]+)?))?/) || []
  const grade = match[1] ? String(match[1]).toUpperCase() : null
  let score = null
  if (hasMeaningfulValue(match[2])) {
    score = Number(String(match[2]).replace(',', '.'))
    if (!Number.isFinite(score)) {
      score = null
    }
  }
  return { grade, score }
}

function quantileAt(sortedValues, q) {
  if (!sortedValues.length) {
    return null
  }
  if (sortedValues.length === 1) {
    return sortedValues[0]
  }
  const pos = (sortedValues.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) {
    return sortedValues[lower]
  }
  const weight = pos - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight
}

function metricValue(props, mode) {
  if (!props) {
    return null
  }
  if (mode === 'year') {
    return extractYear(props.date_d_apparition)
  }
  if (mode === 'cad_mod_date') {
    return extractYear(props.date_modification)
  }
  if (mode === 'logements') {
    return Number(props.nombre_de_logements)
  }
  if (mode === 'usage_primary') {
    return normalizeUsage(props.usage_1)
  }
  if (mode === 'usage_mix') {
    const primary = normalizeUsage(props.usage_1)
    const secondary = normalizeUsage(props.usage_2)
    if (!hasMeaningfulValue(primary)) {
      return null
    }
    if (!hasMeaningfulValue(secondary) || secondary === primary) {
      return primary
    }
    return `${primary}||${secondary}`
  }
  if (mode === 'height_quantile' || mode === 'height') {
    return Number(props.hauteur)
  }
  if (mode === 'floors_quantile' || mode === 'floors') {
    return Number(props.nombre_d_etages)
  }
  if (mode === 'ceiling_height_quantile') {
    const height = Number(props.hauteur)
    const floors = Number(props.nombre_d_etages)
    if (!Number.isFinite(height) || !Number.isFinite(floors) || floors <= 0) {
      return null
    }
    return height / floors
  }
  if (mode === 'housing_surface_quantile') {
    const footprint = Number(props.contenance)
    const floors = Number(props.nombre_d_etages)
    const housing = Number(props.nombre_de_logements)
    if (!Number.isFinite(footprint) || !Number.isFinite(floors) || !Number.isFinite(housing) || floors <= 0 || housing <= 0) {
      return null
    }
    return (footprint * floors) / housing
  }
  if (mode === 'historic_period') {
    return historicPeriod(extractYear(props.date_d_apparition))
  }
  if (mode === 'match_grade') {
    return parseFiscalMatch(props.appariement_fichiers_fonciers).grade
  }
  if (mode === 'match_score') {
    return parseFiscalMatch(props.appariement_fichiers_fonciers).score
  }
  if (mode === 'roof_delta') {
    return Number(props.altitude_maximale_toit) - Number(props.altitude_minimale_toit)
  }
  if (mode === 'roof_type') {
    if (!hasMeaningfulValue(props.materiaux_de_la_toiture)) {
      return null
    }
    return (window.dmatto || {})[props.materiaux_de_la_toiture] || props.materiaux_de_la_toiture
  }
  if (mode === 'wall_type') {
    if (!hasMeaningfulValue(props.materiaux_des_murs)) {
      return null
    }
    return (window.dmatgm || {})[props.materiaux_des_murs] || props.materiaux_des_murs
  }
  return null
}

function isNumericMode(mode) {
  return ['year', 'cad_mod_date', 'logements', 'floors', 'height', 'roof_delta', 'match_score'].includes(mode)
}

function isQuantileMode(mode) {
  return ['height_quantile', 'floors_quantile', 'ceiling_height_quantile', 'housing_surface_quantile'].includes(mode)
}

function formatLegendNumber(mode, value) {
  if (!Number.isFinite(value)) {
    return 'n.d.'
  }
  if (['year', 'cad_mod_date', 'logements', 'floors', 'floors_quantile'].includes(mode)) {
    return String(Math.round(value))
  }
  return String(Math.round(value * 10) / 10)
}

function orderedCategories(mode, categories) {
  const ordered = categories.slice()
  if (mode === 'historic_period') {
    const rank = {
      'Avant 1850': 1,
      '1850-1914': 2,
      '1915-1945': 3,
      '1946-1974': 4,
      '1975-1999': 5,
      '2000+': 6
    }
    return ordered.sort(function(a, b) {
      const ra = rank[a] || 999
      const rb = rank[b] || 999
      if (ra !== rb) {
        return ra - rb
      }
      return String(a).localeCompare(String(b))
    })
  }
  if (mode === 'match_grade') {
    const gradeRank = { A: 1, B: 2, C: 3, D: 4 }
    return ordered.sort(function(a, b) {
      const ra = gradeRank[a] || 999
      const rb = gradeRank[b] || 999
      if (ra !== rb) {
        return ra - rb
      }
      return String(a).localeCompare(String(b))
    })
  }
  return ordered.sort(function(a, b) {
    return String(a).localeCompare(String(b))
  })
}

export function computeBuildingVisualScale(buildingFeatures, mode) {
  if (mode === 'basic') {
    return { kind: 'none', min: null, max: null, breaks: [], categories: [] }
  }

  const values = []
  const categories = []
  const seen = {}

  buildingFeatures.forEach(function(feature) {
    const value = metricValue(feature.properties, mode)
    if (!hasMeaningfulValue(value)) {
      return
    }

    if (isNumericMode(mode) || isQuantileMode(mode)) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        values.push(numeric)
      }
      return
    }

    if (mode === 'usage_mix') {
      String(value)
        .split('||')
        .forEach(function(part) {
          const key = String(part)
          if (!seen[key]) {
            seen[key] = true
            categories.push(key)
          }
        })
      return
    }

    const key = String(value)
    if (!seen[key]) {
      seen[key] = true
      categories.push(key)
    }
  })

  if (isQuantileMode(mode)) {
    if (!values.length) {
      return { kind: 'none', min: null, max: null, breaks: [], categories: [] }
    }
    const sorted = values.slice().sort(function(a, b) {
      return a - b
    })
    const breaks = []
    for (let idx = 1; idx < quantilePalette.length; idx += 1) {
      const threshold = quantileAt(sorted, idx / quantilePalette.length)
      if (Number.isFinite(threshold) && (breaks.length === 0 || threshold > breaks[breaks.length - 1])) {
        breaks.push(threshold)
      }
    }
    return {
      kind: 'quantile',
      min: sorted[0],
      max: sorted[sorted.length - 1],
      breaks,
      categories: []
    }
  }

  if (isNumericMode(mode)) {
    if (!values.length) {
      return { kind: 'none', min: null, max: null, breaks: [], categories: [] }
    }
    return {
      kind: 'numeric',
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      breaks: [],
      categories: []
    }
  }

  return {
    kind: categories.length ? 'category' : 'none',
    min: null,
    max: null,
    breaks: [],
    categories: orderedCategories(mode, categories)
  }
}

function colorFromNumeric(value, scale) {
  if (scale.kind !== 'numeric') {
    return '#7a7a7a'
  }
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max)) {
    return '#7a7a7a'
  }
  if (scale.max <= scale.min) {
    return numericPalette[Math.floor(numericPalette.length / 2)]
  }
  let ratio = (value - scale.min) / (scale.max - scale.min)
  ratio = Math.max(0, Math.min(1, ratio))
  const index = Math.round(ratio * (numericPalette.length - 1))
  return numericPalette[index]
}

function colorFromQuantile(value, scale) {
  if (scale.kind !== 'quantile' || !Number.isFinite(value)) {
    return '#7a7a7a'
  }
  let idx = 0
  while (idx < scale.breaks.length && value > scale.breaks[idx]) {
    idx += 1
  }
  return quantilePalette[Math.min(idx, quantilePalette.length - 1)]
}

function colorFromCategory(value, scale) {
  if (scale.kind !== 'category') {
    return '#7a7a7a'
  }
  const index = scale.categories.indexOf(String(value))
  if (index < 0) {
    return '#7a7a7a'
  }
  return categoryPalette[index % categoryPalette.length]
}

function numericBinIndex(value, scale) {
  if (scale.kind !== 'numeric') {
    return null
  }
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max) || scale.max <= scale.min) {
    return Math.floor((numericPalette.length - 1) / 2)
  }
  const bins = numericPalette.length
  const ratio = (value - scale.min) / (scale.max - scale.min)
  const idx = Math.floor(Math.max(0, Math.min(0.999999, ratio)) * bins)
  return Math.max(0, Math.min(bins - 1, idx))
}

function quantileBinIndex(value, scale) {
  if (scale.kind !== 'quantile' || !Number.isFinite(value)) {
    return null
  }
  let idx = 0
  while (idx < scale.breaks.length && value > scale.breaks[idx]) {
    idx += 1
  }
  return Math.max(0, Math.min(quantilePalette.length - 1, idx))
}

function numericBinLabel(mode, idx, scale) {
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max)) {
    return 'n.d.'
  }
  if (scale.max <= scale.min) {
    return formatLegendNumber(mode, scale.min)
  }
  const bins = numericPalette.length
  const start = scale.min + ((scale.max - scale.min) * (idx / bins))
  const end = scale.min + ((scale.max - scale.min) * ((idx + 1) / bins))
  return `${formatLegendNumber(mode, start)} - ${formatLegendNumber(mode, end)}`
}

function quantileBinLabel(mode, idx, scale) {
  if (scale.kind !== 'quantile') {
    return 'n.d.'
  }
  let lower = scale.min
  let upper = scale.max
  if (idx > 0 && idx - 1 < scale.breaks.length) {
    lower = scale.breaks[idx - 1]
  }
  if (idx < scale.breaks.length) {
    upper = scale.breaks[idx]
  }
  return `${formatLegendNumber(mode, lower)} - ${formatLegendNumber(mode, upper)}`
}

export function getBuildingFilterDescriptor(properties, mode, scale) {
  const value = metricValue(properties, mode)
  if (!hasMeaningfulValue(value)) {
    return { key: '__missing__', label: 'Non disponible', color: '#9aa0a6' }
  }

  if (mode === 'usage_mix') {
    const category = String(value).split('||')[0]
    return {
      key: `cat:${category}`,
      label: `Principal: ${category}`,
      color: colorFromCategory(category, scale)
    }
  }

  if (isQuantileMode(mode)) {
    const idx = quantileBinIndex(Number(value), scale)
    if (!Number.isFinite(idx)) {
      return { key: '__missing__', label: 'Non disponible', color: '#9aa0a6' }
    }
    return {
      key: `qbin:${idx}`,
      label: quantileBinLabel(mode, idx, scale),
      color: quantilePalette[idx]
    }
  }

  if (isNumericMode(mode)) {
    const idx = numericBinIndex(Number(value), scale)
    if (!Number.isFinite(idx)) {
      return { key: '__missing__', label: 'Non disponible', color: '#9aa0a6' }
    }
    return {
      key: `nbin:${idx}`,
      label: numericBinLabel(mode, idx, scale),
      color: numericPalette[idx]
    }
  }

  const category = String(value)
  return {
    key: `cat:${category}`,
    label: category,
    color: colorFromCategory(category, scale)
  }
}

export function computeBuildingLegendItems(features, mode, scale, activeFilterKey) {
  if (mode === 'basic') {
    return { kind: 'none', items: [] }
  }

  const itemMap = {}
  features.forEach(function(feature) {
    const descriptor = getBuildingFilterDescriptor(feature.properties, mode, scale)
    if (!itemMap[descriptor.key]) {
      itemMap[descriptor.key] = {
        ...descriptor,
        count: 0,
        selected: descriptor.key === activeFilterKey
      }
    }
    itemMap[descriptor.key].count += 1
  })

  const items = Object.values(itemMap).sort(function(a, b) {
    if (a.key === '__missing__' && b.key !== '__missing__') {
      return -1
    }
    if (b.key === '__missing__' && a.key !== '__missing__') {
      return 1
    }
    if (a.key.startsWith('qbin:') && b.key.startsWith('qbin:')) {
      return Number(a.key.split(':')[1]) - Number(b.key.split(':')[1])
    }
    if (a.key.startsWith('nbin:') && b.key.startsWith('nbin:')) {
      return Number(a.key.split(':')[1]) - Number(b.key.split(':')[1])
    }
    return String(a.label).localeCompare(String(b.label))
  })

  return {
    kind: scale.kind,
    items
  }
}

export function isBuildingHiddenByFilter(feature, mode, scale, activeFilterKey) {
  if (mode === 'basic' || !hasMeaningfulValue(activeFilterKey)) {
    return false
  }
  const descriptor = getBuildingFilterDescriptor(feature.properties, mode, scale)
  return descriptor.key !== activeFilterKey
}

export function getBuildingVisualColor(feature, mode, scale) {
  const value = metricValue(feature.properties, mode)
  if (!hasMeaningfulValue(value)) {
    return null
  }

  if (mode === 'usage_mix') {
    const key = String(value).split('||')[0]
    return colorFromCategory(key, scale)
  }

  if (isQuantileMode(mode)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return null
    }
    return colorFromQuantile(numeric, scale)
  }

  if (isNumericMode(mode)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return null
    }
    return colorFromNumeric(numeric, scale)
  }

  return colorFromCategory(value, scale)
}

export function getBuildingLayerStyle(feature, mode, scale, isSelected) {
  const color = getBuildingVisualColor(feature, mode, scale)
  const missingData = !hasMeaningfulValue(color)
  const effectiveColor = missingData ? '#9aa0a6' : color

  return {
    fillColor: effectiveColor,
    weight: isSelected ? 4 : 2,
    opacity: 1,
    color: missingData ? '#7d8590' : effectiveColor,
    dashArray: missingData ? '4' : isSelected ? null : '2',
    fillOpacity: missingData ? (isSelected ? 0.5 : 0.2) : isSelected ? 0.75 : 0.45
  }
}
