import {
  formatFeatureDetails,
  getFeatureAreaLabel,
  getFeatureSubtitle,
  getFeatureTitle,
  getLayerKeyForGroup,
  getGroupKeyForFeature,
  isBuilding
} from './feature-utils.js'
import {
  BUILDING_VISUAL_MODE_LABELS,
  computeBuildingLegendItems,
  computeBuildingVisualScale,
  getBuildingLayerStyle,
  isBuildingHiddenByFilter
} from './building-visual.js'

export class LeafletMapManager {
  constructor(store, bootstrap) {
    this.store = store
    this.bootstrap = bootstrap
    this.map = null
    this.searchMarker = null
    this.featureLayers = new Map()
    this.groupLayers = {}
    this.streetLayer = null
    this.satelliteLayer = null
    this.satelliteEnabled = false
    this.callbacks = {
      onMapMoved: function() {},
      onLayerToggleSelection: function() {},
      onLayerDeleteFeature: function() {},
      onLayerFocusSelection: function() {}
    }
    this.buildingScale = { kind: 'none', min: null, max: null, breaks: [], categories: [] }
  }

  setCallbacks(callbacks) {
    this.callbacks = {
      ...this.callbacks,
      ...callbacks
    }
  }

  initMap() {
    this.map = L.map('mapid', { attributionControl: false, zoomControl: false })

    this.streetLayer = this.createStreetLayer()
    this.satelliteLayer = this.createSatelliteLayer()
    this.streetLayer.addTo(this.map)

    this.createGroupLayers()
    this.createControls()

    this.map.on('moveend', () => {
      this.callbacks.onMapMoved(this.map.getCenter().lat, this.map.getCenter().lng, this.map.getZoom())
    })
  }

  createStreetLayer() {
    const token = this.bootstrap.mapboxAccessToken
    const layerUrl = token
      ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}{r}?access_token=${token}`
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

    const options = token
      ? { tileSize: 512, zoomOffset: -1, attribution: 'Mapbox', maxZoom: 20, minZoom: 1 }
      : { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20, minZoom: 1, subdomains: 'abcd' }

    return L.tileLayer(layerUrl, options)
  }

  createSatelliteLayer() {
    const token = this.bootstrap.mapboxAccessToken
    const url = token
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${token}`
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

    return L.tileLayer(url, {
      attribution: token ? 'Mapbox' : 'Tiles &copy; Esri',
      maxZoom: 20,
      minZoom: 1
    })
  }

  createControls() {
    L.control.attribution({ position: 'bottomright' }).addTo(this.map)
    L.control.zoom({ position: 'bottomright' }).addTo(this.map)

    const iconUrl = this.bootstrap.iconUrl
    const WatermarkControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create('div')
        div.innerHTML = `<object width="50" height="50" id="micon" type="image/svg+xml" data="${iconUrl}"></object>`
        return div
      }
    })

    L.control.watermark = function(opts) {
      return new WatermarkControl(opts)
    }

    L.control.watermark({ position: 'topright' }).addTo(this.map)
  }

  createGroupLayers() {
    this.groupLayers = {}
    this.ensureGroupLayer(getLayerKeyForGroup('parcels', false))
    this.ensureGroupLayer(getLayerKeyForGroup('parcels', true))
    this.ensureGroupLayer(getLayerKeyForGroup('buildings', false))
    this.ensureGroupLayer(getLayerKeyForGroup('buildings', true))
    this.ensureGroupLayer(getLayerKeyForGroup('user-shapes', false))
    this.ensureGroupLayer(getLayerKeyForGroup('user-shapes', true))
  }

  ensureGroupLayer(groupKey) {
    if (this.groupLayers[groupKey]) {
      return this.groupLayers[groupKey]
    }
    const options = groupKey.endsWith(':selected') || groupKey.endsWith('Selected') ? { attribution: 'ign.fr' } : {}
    const groupLayer = new L.FeatureGroup([], options)
    groupLayer.addTo(this.map)
    this.groupLayers[groupKey] = groupLayer
    this.store.ensureLayerVisibilityKey(groupKey, true)
    return groupLayer
  }

  removeGroupLayersForGroupId(groupId) {
    const keys = [getLayerKeyForGroup(groupId, false), getLayerKeyForGroup(groupId, true)]
    keys.forEach(groupKey => {
      const groupLayer = this.groupLayers[groupKey]
      if (!groupLayer) {
        return
      }
      groupLayer.clearLayers()
      this.map.removeLayer(groupLayer)
      delete this.groupLayers[groupKey]
    })
  }

  setView(lat, lon, zoom) {
    this.map.setView([lat, lon], zoom)
  }

  flyToBounds(bounds) {
    this.map.flyToBounds(bounds)
  }

  fitBounds(bounds, options) {
    this.map.fitBounds(bounds, options)
  }

  getBounds() {
    return this.map.getBounds()
  }

  getZoom() {
    return this.map.getZoom()
  }

  getCenter() {
    return this.map.getCenter()
  }

  waitForNextMoveEnd(timeoutMs) {
    const timeout = Number.isFinite(timeoutMs) ? timeoutMs : 7000
    if (!this.map) {
      return Promise.resolve(false)
    }

    return new Promise(resolve => {
      let settled = false
      const done = function(result) {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      const timer = window.setTimeout(() => {
        done(false)
      }, timeout)

      this.map.once('moveend', () => {
        window.clearTimeout(timer)
        done(true)
      })
    })
  }

  isFeatureInsideBounds(id, bounds) {
    const layer = this.featureLayers.get(id)
    if (!layer) {
      return false
    }

    const targetBounds = bounds || this.getBounds()
    if (!targetBounds) {
      return false
    }

    if (typeof layer.getBounds === 'function') {
      const layerBounds = layer.getBounds()
      if (layerBounds && typeof layerBounds.isValid === 'function' && layerBounds.isValid()) {
        return targetBounds.intersects(layerBounds)
      }
    }

    if (typeof layer.getLatLng === 'function') {
      return targetBounds.contains(layer.getLatLng())
    }

    return false
  }

  toggleSatellite() {
    if (this.satelliteEnabled) {
      this.map.removeLayer(this.satelliteLayer)
      this.streetLayer.addTo(this.map)
      this.satelliteEnabled = false
      this.updateWatermarkTone(false)
      return false
    }

    this.map.removeLayer(this.streetLayer)
    this.satelliteLayer.addTo(this.map)
    this.satelliteEnabled = true
    this.updateWatermarkTone(true)
    return true
  }

  updateWatermarkTone(satellite) {
    const icon = document.querySelector('#micon')
    if (!icon) {
      return
    }
    icon.setAttribute('style', satellite ? 'filter:invert(100%);' : 'filter:invert(0%);')
  }

  focusGeoJsonResult(geojson, defaultZoom) {
    if (this.searchMarker) {
      this.map.removeLayer(this.searchMarker)
    }

    let zoomLevel = defaultZoom || 14
    const zoomByType = {
      housenumber: 20,
      street: 18,
      locality: 16,
      municipality: 13
    }

    if (geojson && geojson.properties && geojson.properties.type && zoomByType[geojson.properties.type]) {
      zoomLevel = zoomByType[geojson.properties.type]
    }

    const icon = L.icon({
      iconUrl: this.bootstrap.iconUrl,
      iconSize: [32, 37],
      iconAnchor: [16, 37],
      popupAnchor: [0, -28]
    })

    this.searchMarker = L.geoJSON(geojson, {
      pointToLayer: function(feature, latlng) {
        return L.marker(latlng, { icon })
      }
    })

    this.map.flyTo(this.searchMarker.getBounds().getCenter(), zoomLevel)
    this.searchMarker.addTo(this.map)
  }

  syncAllFeatures() {
    Object.values(this.store.features).forEach(feature => {
      this.syncFeatureLayer(feature.id)
    })
  }

  removeFeatureLayer(id) {
    const layer = this.featureLayers.get(id)
    if (!layer) {
      return
    }
    Object.values(this.groupLayers).forEach(group => {
      group.removeLayer(layer)
    })
    this.featureLayers.delete(id)
  }

  removeAllFeatureLayers() {
    Array.from(this.featureLayers.keys()).forEach(id => {
      this.removeFeatureLayer(id)
    })
  }

  refreshFeatureStyles() {
    Object.values(this.store.features).forEach(feature => {
      this.applyFeatureStyle(feature.id)
    })
  }

  updateBuildingVisualContext() {
    const buildings = Object.values(this.store.features).filter(feature => feature.type === 'building')
    this.buildingScale = computeBuildingVisualScale(buildings, this.store.buildingVisualMode)

    const legend = computeBuildingLegendItems(
      buildings,
      this.store.buildingVisualMode,
      this.buildingScale,
      this.store.buildingVisualFilterKey
    )

    this.store.setBuildingLegend(legend.items, legend.kind)
  }

  shouldHideBuildingByVisualFilter(feature) {
    if (!isBuilding(feature)) {
      return false
    }
    return isBuildingHiddenByFilter(feature, this.store.buildingVisualMode, this.buildingScale, this.store.buildingVisualFilterKey)
  }

  syncFeatureLayer(id) {
    const feature = this.store.features[id]
    if (!feature) {
      this.removeFeatureLayer(id)
      return
    }

    const layer = this.ensureLeafletLayer(feature)

    Object.values(this.groupLayers).forEach(group => {
      group.removeLayer(layer)
    })

    const targetGroupKey = getGroupKeyForFeature(feature)
    if (!targetGroupKey) {
      return
    }

    const targetLayer = this.ensureGroupLayer(targetGroupKey)

    if (!this.store.layerVisibility[targetGroupKey]) {
      return
    }

    if (this.shouldHideBuildingByVisualFilter(feature)) {
      return
    }

    targetLayer.addLayer(layer)
    this.applyFeatureStyle(id)
    this.refreshPopup(id)
  }

  ensureLeafletLayer(feature) {
    if (this.featureLayers.has(feature.id)) {
      return this.featureLayers.get(feature.id)
    }

    const layer = L.geoJSON(
      {
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties: feature.properties
      },
      {}
    )

    layer.on('click', () => {
      this.callbacks.onLayerFocusSelection(feature.id)
    })

    layer.on('popupopen', event => {
      const root = event.popup.getElement()
      if (!root) {
        return
      }
      root.querySelectorAll('[data-feature-action]').forEach(node => {
        node.addEventListener('click', evt => {
          evt.preventDefault()
          evt.stopPropagation()
          const action = node.getAttribute('data-feature-action')
          if (action === 'toggle') {
            this.callbacks.onLayerToggleSelection(feature.id)
          }
          if (action === 'delete') {
            this.callbacks.onLayerDeleteFeature(feature.id)
          }
        })
      })
    })

    if (feature.type === 'building') {
      layer.bindTooltip(formatFeatureDetails(feature), {
        sticky: true,
        direction: 'top',
        opacity: 0.9
      })
    }

    this.featureLayers.set(feature.id, layer)
    this.refreshPopup(feature.id)

    return layer
  }

  refreshPopup(id) {
    const feature = this.store.features[id]
    const layer = this.featureLayers.get(id)
    if (!feature || !layer) {
      return
    }

    const icon = feature.type === 'parcel' ? '<i class="fas fa-vector-square"></i>' : '<i class="far fa-building"></i>'
    const area = getFeatureAreaLabel(feature)
    const title = getFeatureTitle(feature)
    const subtitle = getFeatureSubtitle(feature)
    const details = formatFeatureDetails(feature)

    const toggleClass = feature.selected ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary'
    const toggleIcon = feature.selected ? '<i class="far fa-trash-alt"></i> Retirer' : '<i class="far fa-plus-square"></i> Ajouter'

    const html = `
      <div class="map-popup">
        <div class="fw-bold">${icon} ${title}</div>
        <div class="small text-muted">${subtitle}</div>
        <div class="small mt-1">${area}</div>
        <div class="small mt-1">${details}</div>
        <div class="mt-2 d-flex gap-2">
          <a href="#" class="${toggleClass}" data-feature-action="toggle">${toggleIcon}</a>
          <a href="#" class="btn btn-sm btn-outline-danger" data-feature-action="delete"><i class="far fa-trash-alt"></i> Supprimer</a>
        </div>
      </div>
    `

    layer.bindPopup(html)

    if (feature.type === 'building') {
      layer.bindTooltip(formatFeatureDetails(feature), {
        sticky: true,
        direction: 'top',
        opacity: 0.9
      })
    }
  }

  applyFeatureStyle(id) {
    const feature = this.store.features[id]
    const layer = this.featureLayers.get(id)
    if (!feature || !layer) {
      return
    }

    if (this.store.activeFeatureId === id && typeof window.styleSelected === 'function') {
      layer.setStyle(window.styleSelected())
      return
    }

    if (feature.type === 'building' && this.store.buildingVisualMode !== 'basic') {
      layer.setStyle(getBuildingLayerStyle(feature, this.store.buildingVisualMode, this.buildingScale, feature.selected))
      return
    }

    if (feature.selected && typeof window.styleActive === 'function') {
      layer.setStyle(window.styleActive())
      return
    }

    if (typeof window.styleNotActive === 'function') {
      layer.setStyle(window.styleNotActive())
    }
  }

  highlightFeature(id) {
    const layer = this.featureLayers.get(id)
    if (!layer || typeof window.styleHighlighted !== 'function') {
      return
    }
    layer.setStyle(window.styleHighlighted())
  }

  restoreFeatureStyle(id) {
    this.applyFeatureStyle(id)
  }

  toggleActiveFeature(id) {
    if (!this.store.features[id]) {
      return
    }
    const previous = this.store.activeFeatureId
    if (previous === id) {
      this.store.setActiveFeature(null)
      this.applyFeatureStyle(id)
      return
    }
    this.store.setActiveFeature(id)
    if (previous) {
      this.applyFeatureStyle(previous)
    }
    this.applyFeatureStyle(id)
  }

  focusFeature(id) {
    const layer = this.featureLayers.get(id)
    if (!layer) {
      return
    }
    this.flyToBounds(layer.getBounds())
  }

  setGroupVisibility(groupKey, visible) {
    this.store.setGroupVisibility(groupKey, visible)
    this.syncAllFeatures()
  }

  refreshAfterStateChange() {
    this.updateBuildingVisualContext()
    this.syncAllFeatures()
    this.refreshFeatureStyles()
  }

  getLegendHint() {
    if (this.store.buildingVisualMode === 'basic') {
      return 'Mode standard: pointillé.'
    }
    if (this.store.buildingLegendKind === 'none') {
      return 'Aucune donnée exploitable sur les bâtiments chargés.'
    }
    return BUILDING_VISUAL_MODE_LABELS[this.store.buildingVisualMode] || this.store.buildingVisualMode
  }
}
