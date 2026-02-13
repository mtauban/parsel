import {
  BUILDING_VISUAL_MODE_LABELS,
  computeBuildingLegendItems,
  computeBuildingVisualScale,
  getBuildingFilterDescriptor
} from './building-visual.js'
import { getFeatureTitle, getFeatureSubtitle } from './feature-utils.js'

const CRS_WGS84 = 'EPSG:4326'
const CRS_LAMBERT93 = 'EPSG:2154'
const LAMBERT93_DEF = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'

const GROUP_ORDER = ['parcelsSelected', 'parcelsLoaded', 'buildingsSelected', 'buildingsLoaded', 'userSelected', 'userLoaded']
const GROUP_SVG_IDS = {
  parcelsSelected: 'parcels-selected',
  parcelsLoaded: 'parcels-loaded',
  buildingsSelected: 'buildings-selected',
  buildingsLoaded: 'buildings-loaded',
  userSelected: 'user-selected',
  userLoaded: 'user-loaded'
}

const GROUP_LABELS = {
  parcelsSelected: 'Parcels selected',
  parcelsLoaded: 'Parcels loaded',
  buildingsSelected: 'Buildings selected',
  buildingsLoaded: 'Buildings loaded',
  userSelected: 'User selected',
  userLoaded: 'User loaded'
}

const GROUP_BASE_STYLES = {
  parcelsSelected: { stroke: '#c08a00', strokeWidth: 1.8, fill: '#f4d35e', fillOpacity: 0.45, strokeDasharray: '' },
  parcelsLoaded: { stroke: '#4b5563', strokeWidth: 1.4, fill: 'none', fillOpacity: 0, strokeDasharray: '4 3' },
  buildingsSelected: { stroke: '#9a3412', strokeWidth: 1.8, fill: '#fb923c', fillOpacity: 0.58, strokeDasharray: '' },
  buildingsLoaded: { stroke: '#155e75', strokeWidth: 1.2, fill: '#8ecae6', fillOpacity: 0.25, strokeDasharray: '' },
  userSelected: { stroke: '#4a2f84', strokeWidth: 1.8, fill: '#b49bff', fillOpacity: 0.4, strokeDasharray: '' },
  userLoaded: { stroke: '#5b4b8a', strokeWidth: 1.3, fill: '#d8cff2', fillOpacity: 0.2, strokeDasharray: '5 3' }
}

const SCALE_BAR_OPTIONS_METERS = [20, 50, 100, 200, 500, 1000, 2000, 5000]
const VIEWPORT_MAX_WIDTH_PX = 1500
const VIEWPORT_MAX_HEIGHT_PX = 900
const LEGEND_PANEL_WIDTH = 340
const LEGEND_MAX_ITEMS = 11
const PADDING_X = 28
const PADDING_Y = 28
const NORTH_ARROW_HEIGHT = 42
const NORTH_ARROW_WIDTH = 14

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'feature'
}

function asFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundForExport(value, digits) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }
  const factor = Math.pow(10, digits || 2)
  return Math.round(numeric * factor) / factor
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return '{}'
  }
}

function ensureProj4Ready() {
  if (!window.proj4) {
    throw new Error('proj4 is unavailable in this page. SVG export needs coordinate reprojection support.')
  }

  const hasDefinition = Boolean(window.proj4.defs(CRS_LAMBERT93))
  if (!hasDefinition) {
    window.proj4.defs(CRS_LAMBERT93, LAMBERT93_DEF)
  }
}

function reprojectCoordinate(coordinate) {
  const lon = asFiniteNumber(coordinate && coordinate[0])
  const lat = asFiniteNumber(coordinate && coordinate[1])

  if (lon === null || lat === null) {
    return [NaN, NaN]
  }

  const projected = window.proj4(CRS_WGS84, CRS_LAMBERT93, [lon, lat])
  return [projected[0], projected[1]]
}

function mapCoordinatesDeep(coordinates, mapper) {
  if (!Array.isArray(coordinates)) {
    return coordinates
  }

  if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    return mapper(coordinates)
  }

  return coordinates.map(function(item) {
    return mapCoordinatesDeep(item, mapper)
  })
}

function reprojectGeometry(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return null
  }

  return {
    type: geometry.type,
    coordinates: mapCoordinatesDeep(geometry.coordinates, reprojectCoordinate)
  }
}

function visitGeometryCoordinates(geometry, visitor) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return
  }

  mapCoordinatesDeep(geometry.coordinates, function(coordinate) {
    visitor(coordinate)
    return coordinate
  })
}

function geometryHasFiniteCoordinates(geometry) {
  let valid = false
  visitGeometryCoordinates(geometry, function(coordinate) {
    if (Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])) {
      valid = true
    }
  })
  return valid
}

function updateBounds(bounds, geometry) {
  visitGeometryCoordinates(geometry, function(coordinate) {
    const x = coordinate[0]
    const y = coordinate[1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxY = Math.max(bounds.maxY, y)
  })
}

function createInitialBounds() {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  }
}

function normalizeBounds(bounds) {
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      width: 1,
      height: 1
    }
  }

  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width,
    height
  }
}

function flattenValue(value) {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'object') {
    return stringifyJson(value)
  }
  return String(value)
}

function csvEscape(value) {
  const text = flattenValue(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return text
}

function selectFeaturesForMode(features, mode) {
  if (mode === 'selected') {
    return features.filter(function(feature) {
      return Boolean(feature.selected)
    })
  }
  return features.slice()
}

function closestFromList(target, list) {
  return list.reduce(function(best, candidate) {
    if (best === null) {
      return candidate
    }
    return Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  }, null)
}

function resolveScaleBarMeters(boundsWidthMeters, scaleBarMetersOption) {
  if (scaleBarMetersOption !== 'auto') {
    const parsed = Number(scaleBarMetersOption)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  const target = Math.max(20, boundsWidthMeters / 10)
  const snapped = closestFromList(target, SCALE_BAR_OPTIONS_METERS)
  return snapped || 100
}

function resolveSvgScale(bounds) {
  const byWidth = VIEWPORT_MAX_WIDTH_PX / bounds.width
  const byHeight = VIEWPORT_MAX_HEIGHT_PX / bounds.height
  return Math.max(0.02, Math.min(byWidth, byHeight))
}

function toSvgPoint(projectedCoordinate, bounds, pxPerMeter) {
  const x = PADDING_X + (projectedCoordinate[0] - bounds.minX) * pxPerMeter
  const y = PADDING_Y + (bounds.maxY - projectedCoordinate[1]) * pxPerMeter
  return [roundForExport(x, 2), roundForExport(y, 2)]
}

function ringToPath(ring, bounds, pxPerMeter) {
  if (!Array.isArray(ring) || !ring.length) {
    return ''
  }

  const points = ring
    .map(function(projectedCoordinate) {
      return toSvgPoint(projectedCoordinate, bounds, pxPerMeter)
    })
    .filter(function(point) {
      return Number.isFinite(point[0]) && Number.isFinite(point[1])
    })

  if (!points.length) {
    return ''
  }

  const commands = []
  points.forEach(function(point, index) {
    const cmd = index === 0 ? 'M' : 'L'
    commands.push(`${cmd}${point[0]} ${point[1]}`)
  })
  commands.push('Z')
  return commands.join(' ')
}

function geometryToPathD(geometry, bounds, pxPerMeter) {
  if (!geometry || !geometry.type) {
    return ''
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(function(ring) {
      return ringToPath(ring, bounds, pxPerMeter)
    }).filter(Boolean).join(' ')
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map(function(polygon) {
        return polygon
          .map(function(ring) {
            return ringToPath(ring, bounds, pxPerMeter)
          })
          .filter(Boolean)
          .join(' ')
      })
      .filter(Boolean)
      .join(' ')
  }

  return ''
}

function deriveFeatureState(feature) {
  return feature.selected ? 'selected' : 'loaded'
}

function resolveExportGroupKey(feature) {
  const stateSuffix = feature && feature.selected ? 'Selected' : 'Loaded'
  const groupId = feature && feature.groupId ? String(feature.groupId) : ''

  if (groupId === 'parcels') {
    return `parcels${stateSuffix}`
  }
  if (groupId === 'buildings') {
    return `buildings${stateSuffix}`
  }

  if (feature.type === 'parcel') {
    return `parcels${stateSuffix}`
  }
  if (feature.type === 'building') {
    return `buildings${stateSuffix}`
  }

  return `user${stateSuffix}`
}

function summarizeGroups(features) {
  return GROUP_ORDER.reduce(function(acc, groupKey) {
    acc[groupKey] = features.filter(function(feature) {
      return feature.groupKey === groupKey
    }).length
    return acc
  }, {})
}

function resolveBuildingVisualContext(rawFeatures, effectiveOptions) {
  const mode = effectiveOptions.buildingVisualMode || 'basic'
  if (mode === 'basic') {
    return {
      mode,
      scale: { kind: 'none', min: null, max: null, breaks: [], categories: [] },
      legendItems: [],
      colorByKey: {},
      labelByKey: {}
    }
  }

  const buildingFeatures = rawFeatures.filter(function(feature) {
    return feature.type === 'building'
  })

  const scale = computeBuildingVisualScale(buildingFeatures, mode)
  const computedLegend = computeBuildingLegendItems(buildingFeatures, mode, scale, null).items
  const providedLegend = Array.isArray(effectiveOptions.buildingLegendItems) ? effectiveOptions.buildingLegendItems : []
  const effectiveLegend = providedLegend.length ? providedLegend : computedLegend

  const colorByKey = {}
  const labelByKey = {}
  effectiveLegend.forEach(function(item) {
    if (!item || !item.key) {
      return
    }
    colorByKey[item.key] = item.color
    labelByKey[item.key] = item.label
  })

  return {
    mode,
    scale,
    legendItems: effectiveLegend,
    colorByKey,
    labelByKey
  }
}

function createExportFeatureRecord(feature, projectedGeometry, buildingVisualContext) {
  const groupKey = resolveExportGroupKey(feature)
  const record = {
    id: feature.id,
    type: feature.type || 'user',
    state: deriveFeatureState(feature),
    groupKey,
    groupId: feature.groupId || '',
    title: getFeatureTitle(feature),
    subtitle: getFeatureSubtitle(feature),
    geometry: projectedGeometry,
    properties: feature.properties || {},
    visualClassKey: null,
    visualClassLabel: null
  }

  if (feature.type === 'building' && buildingVisualContext.mode !== 'basic') {
    const descriptor = getBuildingFilterDescriptor(feature.properties || {}, buildingVisualContext.mode, buildingVisualContext.scale)
    record.visualClassKey = descriptor.key
    record.visualClassLabel = buildingVisualContext.labelByKey[descriptor.key] || descriptor.label
  }

  return record
}

function getFeatureSvgStyle(feature, visualContext) {
  const fallback = GROUP_BASE_STYLES[feature.groupKey] || GROUP_BASE_STYLES.parcelsLoaded

  if (feature.type !== 'building' || visualContext.mode === 'basic') {
    return fallback
  }

  const color = visualContext.colorByKey[feature.visualClassKey] || '#9aa0a6'
  return {
    stroke: color,
    strokeWidth: feature.state === 'selected' ? 1.8 : 1.2,
    fill: color,
    fillOpacity: feature.state === 'selected' ? 0.62 : 0.38,
    strokeDasharray: feature.visualClassKey === '__missing__' ? '4 2' : ''
  }
}

function buildSvgLegendMarkup(payload, options) {
  if (!options.includeLegend) {
    return ''
  }

  const legendX = payload.layout.legendX
  const legendY = payload.layout.legendY
  const legendWidth = payload.layout.legendWidth

  let items = []
  let title = 'Legend'

  if (payload.visual.mode !== 'basic' && payload.visual.legendItems.length) {
    title = `Buildings ${BUILDING_VISUAL_MODE_LABELS[payload.visual.mode] || payload.visual.mode}`
    items = payload.visual.legendItems.map(function(item) {
      return {
        color: item.color,
        label: item.label,
        count: item.count
      }
    })
  } else {
    items = GROUP_ORDER
      .filter(function(groupKey) {
        return payload.groupCounts[groupKey] > 0
      })
      .map(function(groupKey) {
        return {
          color: GROUP_BASE_STYLES[groupKey].fill === 'none' ? GROUP_BASE_STYLES[groupKey].stroke : GROUP_BASE_STYLES[groupKey].fill,
          label: GROUP_LABELS[groupKey],
          count: payload.groupCounts[groupKey]
        }
      })
  }

  if (!items.length) {
    return ''
  }

  const visibleItems = items.slice(0, LEGEND_MAX_ITEMS)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)

  const rows = visibleItems.map(function(item, index) {
    const y = legendY + 26 + index * 16
    return [
      `<rect x="${legendX + 8}" y="${y - 9}" width="10" height="10" fill="${escapeXml(item.color)}" stroke="#444" stroke-width="0.6" />`,
      `<text x="${legendX + 24}" y="${y}" font-size="11" fill="#111">${escapeXml(item.label)} (${escapeXml(item.count)})</text>`
    ].join('')
  }).join('\n')

  const overflowRow = hiddenCount
    ? `<text x="${legendX + 8}" y="${legendY + 26 + visibleItems.length * 16}" font-size="11" fill="#6b7280">+${hiddenCount} classes</text>`
    : ''

  const panelHeight = hiddenCount
    ? 44 + (visibleItems.length + 1) * 16
    : 36 + visibleItems.length * 16

  return [
    '<g id="legend-reference">',
    `<rect x="${legendX}" y="${legendY}" width="${legendWidth}" height="${panelHeight}" fill="#ffffff" fill-opacity="0.88" stroke="#d1d5db" stroke-width="1" rx="6" ry="6" />`,
    `<text x="${legendX + 8}" y="${legendY + 14}" font-size="12" fill="#111" font-weight="600">${escapeXml(title)}</text>`,
    rows,
    overflowRow,
    '</g>'
  ].join('\n')
}

function buildNorthArrowMarkup(payload) {
  const baseX = roundForExport(PADDING_X + payload.layout.featureAreaWidth - 22, 2)
  const baseY = roundForExport(PADDING_Y + 14, 2)
  const tipY = roundForExport(baseY + NORTH_ARROW_HEIGHT, 2)
  const wingY = roundForExport(baseY + 16, 2)
  const leftWingX = roundForExport(baseX - NORTH_ARROW_WIDTH / 2, 2)
  const rightWingX = roundForExport(baseX + NORTH_ARROW_WIDTH / 2, 2)
  const labelY = roundForExport(baseY - 2, 2)

  return [
    '<g id="north-arrow" aria-label="north reference">',
    `<text x="${baseX}" y="${labelY}" text-anchor="middle" font-size="12" font-weight="700" fill="#111">N</text>`,
    `<line x1="${baseX}" y1="${tipY}" x2="${baseX}" y2="${wingY}" stroke="#111" stroke-width="1.6" />`,
    `<polygon points="${baseX},${baseY} ${leftWingX},${wingY} ${rightWingX},${wingY}" fill="#111" />`,
    `<circle cx="${baseX}" cy="${tipY}" r="1.7" fill="#111" />`,
    '</g>'
  ].join('\n')
}

function buildSvgMarkup(payload, options) {
  const svgWidth = payload.layout.svgWidth
  const svgHeight = payload.layout.svgHeight
  const metadataJson = escapeXml(stringifyJson(payload.machineMetadata))

  const groupContent = GROUP_ORDER.map(function(groupKey) {
    const svgGroupId = GROUP_SVG_IDS[groupKey]

    const paths = payload.features
      .filter(function(feature) {
        return feature.groupKey === groupKey
      })
      .map(function(feature) {
        const d = geometryToPathD(feature.geometry, payload.bounds, payload.layout.pxPerMeter)
        if (!d) {
          return ''
        }

        const style = getFeatureSvgStyle(feature, payload.visual)
        const featureId = sanitizeId(feature.id)
        const featureData = escapeXml(stringifyJson({
          id: feature.id,
          type: feature.type,
          state: feature.state,
          group: feature.groupKey,
          groupId: feature.groupId || '',
          visualClassKey: feature.visualClassKey,
          visualClassLabel: feature.visualClassLabel,
          properties: feature.properties
        }))

        const styleAttrs = [
          `fill="${style.fill}"`,
          `fill-opacity="${style.fillOpacity}"`,
          `stroke="${style.stroke}"`,
          `stroke-width="${style.strokeWidth}"`,
          style.strokeDasharray ? `stroke-dasharray="${style.strokeDasharray}"` : ''
        ].filter(Boolean).join(' ')

        return [
          `<path id="feature-${featureId}"`,
          ` d="${escapeXml(d)}"`,
          ` data-feature-id="${escapeXml(feature.id)}"`,
          ` data-feature-type="${escapeXml(feature.type || '')}"`,
          ` data-feature-state="${escapeXml(feature.state)}"`,
          ` data-feature-group="${escapeXml(feature.groupKey || '')}"`,
          ` data-feature-class-key="${escapeXml(feature.visualClassKey || '')}"`,
          ` data-feature-class-label="${escapeXml(feature.visualClassLabel || '')}"`,
          ' data-source="IGN"',
          ` ${styleAttrs}`,
          ' fill-rule="evenodd">',
          `<title>${escapeXml(feature.title || feature.id)}</title>`,
          `<desc>${featureData}</desc>`,
          '</path>'
        ].join('')
      })
      .join('\n')

    return `<g id="${svgGroupId}">${paths}</g>`
  }).join('\n')

  const scaleBarStartX = payload.layout.scaleStartX
  const scaleBarY = payload.layout.scaleBarY
  const scaleBarEndX = payload.layout.scaleEndX

  const scaleLayer = [
    '<g id="scale-reference">',
    `<line x1="${scaleBarStartX}" y1="${scaleBarY}" x2="${scaleBarEndX}" y2="${scaleBarY}" stroke="#111" stroke-width="2" />`,
    `<line x1="${scaleBarStartX}" y1="${scaleBarY - 5}" x2="${scaleBarStartX}" y2="${scaleBarY + 5}" stroke="#111" stroke-width="2" />`,
    `<line x1="${scaleBarEndX}" y1="${scaleBarY - 5}" x2="${scaleBarEndX}" y2="${scaleBarY + 5}" stroke="#111" stroke-width="2" />`,
    `<text x="${scaleBarStartX}" y="${scaleBarY - 8}" font-size="12" fill="#111">0 m</text>`,
    `<text x="${scaleBarEndX + 8}" y="${scaleBarY + 4}" font-size="12" fill="#111">${payload.layout.scaleBarMeters} m</text>`,
    `<text x="${scaleBarStartX}" y="${scaleBarY + 20}" font-size="12" fill="#111">1:${payload.layout.scaleDenominator} (bar ${payload.layout.scaleBarMeters}m)</text>`,
    '</g>'
  ].join('\n')

  const legendLayer = buildSvgLegendMarkup(payload, options)
  const northArrowLayer = buildNorthArrowMarkup(payload)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" version="1.1" data-export-crs="${CRS_LAMBERT93}" data-export-mode="${escapeXml(payload.mode)}">`,
    `<metadata id="export-machine-metadata">${metadataJson}</metadata>`,
    '<desc>Parcelle.app vector export (SVG) for Illustrator. Feature list is not rendered as text in this SVG version.</desc>',
    `<rect id="export-feature-frame" x="${PADDING_X}" y="${PADDING_Y}" width="${payload.layout.featureAreaWidth}" height="${payload.layout.featureAreaHeight}" fill="none" stroke="none"/>`,
    northArrowLayer,
    groupContent,
    scaleLayer,
    legendLayer,
    '</svg>'
  ].join('\n')
}

function buildCsv(features) {
  const headers = [
    'feature_id',
    'type',
    'state',
    'group',
    'group_id',
    'visual_class_key',
    'visual_class_label',
    'title',
    'subtitle',
    'surface',
    'commune',
    'section',
    'numero',
    'usage_1',
    'usage_2',
    'hauteur',
    'nombre_d_etages',
    'nombre_de_logements',
    'metadata_json'
  ]

  const lines = [headers.join(',')]

  features.forEach(function(feature) {
    const props = feature.properties || {}
    const row = [
      feature.id,
      feature.type,
      feature.state,
      feature.groupKey,
      feature.groupId || '',
      feature.visualClassKey || '',
      feature.visualClassLabel || '',
      feature.title,
      feature.subtitle,
      props.contenance,
      props.nom_com || props.commune || '',
      props.section || '',
      props.numero || '',
      props.usage_1 || '',
      props.usage_2 || '',
      props.hauteur || '',
      props.nombre_d_etages || '',
      props.nombre_de_logements || '',
      stringifyJson(props)
    ].map(csvEscape)

    lines.push(row.join(','))
  })

  return lines.join('\n')
}

function toIsoTimestampPart(date) {
  return date.toISOString().replace(/[.:]/g, '-').replace('T', '_').replace('Z', '')
}

function buildExportLayout(bounds, options) {
  const pxPerMeter = resolveSvgScale(bounds)
  const featureAreaWidth = roundForExport(bounds.width * pxPerMeter, 2)
  const featureAreaHeight = roundForExport(bounds.height * pxPerMeter, 2)

  const scaleBarMeters = resolveScaleBarMeters(bounds.width, options.scaleBarMeters)
  const scaleBarPx = roundForExport(scaleBarMeters * pxPerMeter, 2)

  const legendWidth = options.includeLegend ? LEGEND_PANEL_WIDTH : 0
  const minWidthForFooter = PADDING_X + scaleBarPx + 40 + legendWidth + PADDING_X
  const svgWidth = roundForExport(Math.max(featureAreaWidth + PADDING_X * 2, minWidthForFooter), 2)

  const footerHeight = options.includeLegend ? 170 : 74
  const svgHeight = roundForExport(featureAreaHeight + PADDING_Y * 2 + footerHeight, 2)

  const meterPerPx = 1 / pxPerMeter
  const groundMetersPerMillimeterAt96dpi = meterPerPx * 3.7795275591
  const scaleDenominator = Math.max(1, Math.round(groundMetersPerMillimeterAt96dpi * 1000))

  const footerStartY = roundForExport(PADDING_Y + featureAreaHeight + 10, 2)
  const scaleStartX = PADDING_X
  const scaleEndX = roundForExport(scaleStartX + scaleBarPx, 2)
  const legendX = options.includeLegend
    ? roundForExport(Math.max(scaleEndX + 24, svgWidth - PADDING_X - LEGEND_PANEL_WIDTH), 2)
    : null

  return {
    pxPerMeter,
    featureAreaWidth,
    featureAreaHeight,
    scaleBarMeters,
    scaleBarPx,
    scaleDenominator,
    svgWidth,
    svgHeight,
    footerStartY,
    scaleStartX,
    scaleBarY: roundForExport(footerStartY + 26, 2),
    scaleEndX,
    legendWidth,
    legendX,
    legendY: options.includeLegend ? roundForExport(footerStartY + 2, 2) : null
  }
}

function buildMachineMetadata(payload) {
  return {
    schemaVersion: 2,
    source: 'parcelle.app',
    generatedAt: payload.generatedAt,
    crs: CRS_LAMBERT93,
    mode: payload.mode,
    counts: payload.groupCounts,
    boundsMeters: {
      minX: roundForExport(payload.bounds.minX, 3),
      minY: roundForExport(payload.bounds.minY, 3),
      maxX: roundForExport(payload.bounds.maxX, 3),
      maxY: roundForExport(payload.bounds.maxY, 3),
      width: roundForExport(payload.bounds.width, 3),
      height: roundForExport(payload.bounds.height, 3)
    },
    scale: {
      pxPerMeter: roundForExport(payload.layout.pxPerMeter, 8),
      meterPerPx: roundForExport(1 / payload.layout.pxPerMeter, 8),
      scaleBarMeters: payload.layout.scaleBarMeters,
      scaleDenominator96dpi: payload.layout.scaleDenominator
    },
    buildingVisualMode: payload.visual.mode,
    buildingLegendClasses: payload.visual.legendItems.map(function(item) {
      return {
        key: item.key,
        label: item.label,
        color: item.color,
        count: item.count
      }
    }),
    note: 'Per-feature metadata is embedded in each SVG path as desc and data-* attributes.'
  }
}

function buildDetailedMetadataSidecar(payload) {
  return {
    ...payload.machineMetadata,
    features: payload.features.map(function(feature) {
      return {
        id: feature.id,
        type: feature.type,
        state: feature.state,
        group: feature.groupKey,
        groupId: feature.groupId || '',
        visualClassKey: feature.visualClassKey,
        visualClassLabel: feature.visualClassLabel,
        title: feature.title,
        subtitle: feature.subtitle,
        properties: feature.properties,
        geometry: feature.geometry
      }
    })
  }
}

export function buildSvgExportArtifacts(rawFeatures, options) {
  ensureProj4Ready()

  const mode = options && options.mode === 'selected' ? 'selected' : 'loaded'
  const effectiveOptions = {
    mode,
    includeLegend: options ? options.includeLegend !== false : true,
    scaleBarMeters: options && options.scaleBarMeters ? options.scaleBarMeters : 'auto',
    buildingVisualMode: options && options.buildingVisualMode ? options.buildingVisualMode : 'basic',
    buildingLegendItems: options && Array.isArray(options.buildingLegendItems) ? options.buildingLegendItems : []
  }

  const selectedFeatures = selectFeaturesForMode(rawFeatures || [], mode)
  const visual = resolveBuildingVisualContext(selectedFeatures, effectiveOptions)

  const projectedFeatures = selectedFeatures
    .map(function(feature) {
      const projectedGeometry = reprojectGeometry(feature.geometry)
      if (!projectedGeometry || !geometryHasFiniteCoordinates(projectedGeometry)) {
        return null
      }
      const record = createExportFeatureRecord(feature, projectedGeometry, visual)
      if (!record.groupKey) {
        return null
      }
      return record
    })
    .filter(Boolean)

  if (!projectedFeatures.length) {
    return null
  }

  const rawBounds = createInitialBounds()
  projectedFeatures.forEach(function(feature) {
    updateBounds(rawBounds, feature.geometry)
  })

  const bounds = normalizeBounds(rawBounds)
  const layout = buildExportLayout(bounds, effectiveOptions)

  const generatedAt = new Date().toISOString()
  const payload = {
    mode,
    generatedAt,
    bounds,
    layout,
    features: projectedFeatures,
    groupCounts: summarizeGroups(projectedFeatures),
    visual
  }

  payload.machineMetadata = buildMachineMetadata(payload)

  const svgString = buildSvgMarkup(payload, effectiveOptions)
  const metadataJsonString = JSON.stringify(buildDetailedMetadataSidecar(payload), null, 2)
  const metadataCsvString = buildCsv(projectedFeatures)

  const fileStem = `parcelle-export-${mode}-${toIsoTimestampPart(new Date())}`

  return {
    payload,
    svgString,
    metadataJsonString,
    metadataCsvString,
    fileStem
  }
}

export function buildPdfConversionEnvelope(artifacts) {
  if (!artifacts) {
    return null
  }

  return {
    format: 'pdf',
    sourceFormat: 'svg',
    generator: 'parcelle.app-web',
    generatedAt: new Date().toISOString(),
    metadata: artifacts.payload.machineMetadata,
    svg: artifacts.svgString
  }
}

export function downloadTextArtifact(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
