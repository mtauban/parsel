import { defaultGroupIdForType, getGroupKeyForFeature, getLayerKeyForGroup, toViewFeature } from './feature-utils.js'

const piniaGlobal = window.Pinia

if (!piniaGlobal) {
  throw new Error('Pinia global is unavailable. Ensure vue-demi and pinia scripts are loaded before app modules.')
}

const { defineStore } = piniaGlobal

function defaultLayerVisibility() {
  return {
    [getLayerKeyForGroup('parcels', false)]: true,
    [getLayerKeyForGroup('parcels', true)]: true,
    [getLayerKeyForGroup('buildings', false)]: true,
    [getLayerKeyForGroup('buildings', true)]: true,
    [getLayerKeyForGroup('user-shapes', false)]: true,
    [getLayerKeyForGroup('user-shapes', true)]: true
  }
}

function defaultUserGroups() {
  return [
    {
      id: 'user-shapes',
      name: 'Formes utilisateur'
    }
  ]
}

function generateUserGroupId() {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function defaultMapState() {
  return {
    lat: 45.764043,
    lon: 4.835659,
    zoom: 5
  }
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return fallback
  }
}

function sanitizeUserGroups(inputGroups) {
  const seen = new Set()
  const output = []

  ;(Array.isArray(inputGroups) ? inputGroups : []).forEach(function(group) {
    if (!group || !group.id) {
      return
    }
    const id = String(group.id)
    const name = String(group.name || '').trim() || id
    if (id === 'parcels' || id === 'buildings' || seen.has(id)) {
      return
    }
    seen.add(id)
    output.push({ id, name })
  })

  if (!seen.has('user-shapes')) {
    output.unshift({ id: 'user-shapes', name: 'Formes utilisateur' })
  }

  return output
}

export const useMapStore = defineStore('mapStore', {
  state: function() {
    return {
      map: defaultMapState(),
      location: {
        city: '',
        citycode: '',
        postcode: ''
      },
      ui: {
        panelOpen: false,
        tab: 'search'
      },
      search: {
        query: '',
        results: [],
        open: false,
        arrowIndex: -1
      },
      geolocation: {
        requested: false,
        granted: false,
        denied: false
      },
      autoload: {
        parcels: false,
        buildings: false,
        prompted: false,
        ready: false
      },
      features: {},
      activeFeatureId: null,
      layerVisibility: defaultLayerVisibility(),
      userGroups: defaultUserGroups(),
      buildingVisualMode: 'basic',
      buildingVisualFilterKey: null,
      buildingLegendItems: [],
      buildingLegendKind: 'none'
    }
  },
  getters: {
    allFeatures: function(state) {
      return Object.values(state.features)
    },
    selectedIds: function(state) {
      return Object.values(state.features)
        .filter(function(feature) {
          return feature.selected
        })
        .map(function(feature) {
          return feature.id
        })
    },
    selectedArea: function(state) {
      const total = Object.values(state.features).reduce(function(sum, feature) {
        if (!feature.selected) {
          return sum
        }
        return sum + Number(feature.properties.contenance || 0)
      }, 0)
      return total.toFixed(0)
    },
    selectedFeatures: function(state) {
      return Object.values(state.features).filter(function(feature) {
        return feature.selected
      })
    },
    loadedFeatures: function(state) {
      return Object.values(state.features).filter(function(feature) {
        return !feature.selected
      })
    },
    groupCounts: function(state) {
      const counts = {
        parcelsLoaded: 0,
        parcelsSelected: 0,
        buildingsLoaded: 0,
        buildingsSelected: 0
      }
      Object.values(state.features).forEach(function(feature) {
        const key = getGroupKeyForFeature(feature)
        if (key) {
          counts[key] += 1
        }
      })
      return counts
    },
    allGroups: function(state) {
      const base = [
        { id: 'parcels', name: 'Parcelles', system: true, kind: 'parcels' },
        { id: 'buildings', name: 'Bâtiments', system: true, kind: 'buildings' }
      ]
      const custom = state.userGroups.map(function(group) {
        return {
          id: group.id,
          name: group.name,
          system: false,
          kind: 'user'
        }
      })
      return base.concat(custom)
    }
  },
  actions: {
    setMapCenter: function(lat, lon, zoom) {
      this.map.lat = lat
      this.map.lon = lon
      this.map.zoom = zoom
    },
    setLocation: function(location) {
      if (!location) {
        return
      }
      this.location.city = location.city || ''
      this.location.citycode = location.citycode || ''
      this.location.postcode = location.postcode || ''
    },
    setSearchResults: function(results) {
      this.search.results = results
      this.search.open = results.length > 0
      this.search.arrowIndex = results.length > 0 ? 0 : -1
    },
    clearSearchResults: function() {
      this.search.results = []
      this.search.open = false
      this.search.arrowIndex = -1
    },
    setSearchQuery: function(query) {
      this.search.query = query
    },
    setTab: function(tab) {
      this.ui.tab = tab
    },
    setPanelOpen: function(open) {
      this.ui.panelOpen = open
    },
    setGeolocationRequested: function(requested) {
      this.geolocation.requested = requested
    },
    setGeolocationGranted: function(granted) {
      this.geolocation.granted = granted
      if (granted) {
        this.geolocation.denied = false
      }
    },
    setGeolocationDenied: function(denied) {
      this.geolocation.denied = denied
      if (denied) {
        this.geolocation.granted = false
      }
    },
    setAutoloadPrefs: function(parcels, buildings) {
      this.autoload.parcels = Boolean(parcels)
      this.autoload.buildings = Boolean(buildings)
    },
    setAutoloadFlag: function(kind, enabled) {
      if (kind !== 'parcels' && kind !== 'buildings') {
        return
      }
      this.autoload[kind] = Boolean(enabled)
    },
    setAutoloadPrompted: function(prompted) {
      this.autoload.prompted = Boolean(prompted)
    },
    setAutoloadReady: function(ready) {
      this.autoload.ready = Boolean(ready)
    },
    ensureLayerVisibilityKey: function(groupKey, visible) {
      if (!Object.prototype.hasOwnProperty.call(this.layerVisibility, groupKey)) {
        this.layerVisibility[groupKey] = visible !== false
      }
    },
    ensureGroupLayerVisibility: function(groupId) {
      this.ensureLayerVisibilityKey(getLayerKeyForGroup(groupId, false), true)
      this.ensureLayerVisibilityKey(getLayerKeyForGroup(groupId, true), true)
    },
    createUserGroup: function(name) {
      const trimmed = String(name || '').trim()
      if (!trimmed) {
        return null
      }
      const created = {
        id: generateUserGroupId(),
        name: trimmed
      }
      this.userGroups.push(created)
      this.ensureGroupLayerVisibility(created.id)
      return created
    },
    renameUserGroup: function(groupId, name) {
      const group = this.userGroups.find(function(item) {
        return item.id === groupId
      })
      if (!group) {
        return false
      }
      const trimmed = String(name || '').trim()
      if (!trimmed) {
        return false
      }
      group.name = trimmed
      return true
    },
    deleteUserGroup: function(groupId) {
      const index = this.userGroups.findIndex(function(item) {
        return item.id === groupId
      })
      if (index < 0) {
        return false
      }

      Object.values(this.features).forEach(function(feature) {
        if (feature.groupId !== groupId) {
          return
        }
        const fallbackGroupId = defaultGroupIdForType(feature.type)
        feature.groupId = fallbackGroupId
        feature.properties._groupId = fallbackGroupId
      })

      this.userGroups.splice(index, 1)
      delete this.layerVisibility[getLayerKeyForGroup(groupId, false)]
      delete this.layerVisibility[getLayerKeyForGroup(groupId, true)]
      return true
    },
    moveFeatureToGroup: function(id, groupId) {
      const feature = this.features[id]
      if (!feature || !groupId) {
        return false
      }
      feature.groupId = groupId
      feature.properties._groupId = groupId
      this.ensureGroupLayerVisibility(groupId)
      return true
    },
    moveFeatureToDefaultGroup: function(id) {
      const feature = this.features[id]
      if (!feature) {
        return false
      }
      const target = defaultGroupIdForType(feature.type)
      return this.moveFeatureToGroup(id, target)
    },
    upsertFeatureCollection: function(collection, selected) {
      const insertedIds = []
      ;(collection.features || []).forEach(
        function(raw) {
          const existing = this.features[raw.id]
          if (existing) {
            if (selected) {
              existing.selected = true
              existing.properties._selected = true
            }
            if (!existing.groupId) {
              existing.groupId = defaultGroupIdForType(existing.type)
              existing.properties._groupId = existing.groupId
            }
            return
          }

          const viewFeature = toViewFeature(raw, selected)
          this.ensureGroupLayerVisibility(viewFeature.groupId)
          this.features[viewFeature.id] = viewFeature
          insertedIds.push(viewFeature.id)
        }.bind(this)
      )
      return insertedIds
    },
    setSelected: function(id, selected) {
      const feature = this.features[id]
      if (!feature) {
        return
      }
      feature.selected = selected
      feature.properties._selected = selected
      if (!selected && this.activeFeatureId === id) {
        this.activeFeatureId = null
      }
    },
    toggleSelected: function(id) {
      const feature = this.features[id]
      if (!feature) {
        return
      }
      this.setSelected(id, !feature.selected)
    },
    removeFeature: function(id) {
      if (!this.features[id]) {
        return
      }
      delete this.features[id]
      if (this.activeFeatureId === id) {
        this.activeFeatureId = null
      }
    },
    clearGroup: function(groupKey) {
      const ids = Object.values(this.features)
        .filter(function(feature) {
          return getGroupKeyForFeature(feature) === groupKey
        })
        .map(function(feature) {
          return feature.id
        })
      ids.forEach(
        function(id) {
          this.removeFeature(id)
        }.bind(this)
      )
      return ids
    },
    setActiveFeature: function(id) {
      this.activeFeatureId = id
    },
    setGroupVisibility: function(groupKey, visible) {
      this.ensureLayerVisibilityKey(groupKey, Boolean(visible))
      this.layerVisibility[groupKey] = visible
    },
    exportProjectSnapshot: function(mapState) {
      const center = mapState || this.map
      return {
        map: {
          lat: Number(center.lat),
          lon: Number(center.lon),
          zoom: Number(center.zoom)
        },
        userGroups: cloneJson(this.userGroups, defaultUserGroups()),
        layerVisibility: cloneJson(this.layerVisibility, defaultLayerVisibility()),
        buildingVisualMode: this.buildingVisualMode || 'basic',
        buildingVisualFilterKey: this.buildingVisualFilterKey || null,
        features: Object.values(this.features).map(function(feature) {
          return {
            type: 'Feature',
            id: feature.id,
            geometry: cloneJson(feature.geometry, null),
            properties: cloneJson(feature.properties || {}, {}),
            selected: Boolean(feature.selected),
            groupId: feature.groupId || defaultGroupIdForType(feature.type),
            featureType: feature.type || null
          }
        })
      }
    },
    restoreProjectSnapshot: function(snapshot) {
      const payload = snapshot || {}
      const map = payload.map || {}

      this.map.lat = Number.isFinite(Number(map.lat)) ? Number(map.lat) : defaultMapState().lat
      this.map.lon = Number.isFinite(Number(map.lon)) ? Number(map.lon) : defaultMapState().lon
      this.map.zoom = Number.isFinite(Number(map.zoom)) ? Number(map.zoom) : defaultMapState().zoom

      this.features = {}
      this.activeFeatureId = null

      this.userGroups = sanitizeUserGroups(payload.userGroups)
      this.layerVisibility = defaultLayerVisibility()

      const incomingVisibility = payload.layerVisibility && typeof payload.layerVisibility === 'object'
        ? payload.layerVisibility
        : {}

      Object.keys(incomingVisibility).forEach(
        function(key) {
          this.layerVisibility[key] = Boolean(incomingVisibility[key])
        }.bind(this)
      )

      this.buildingVisualMode = payload.buildingVisualMode || 'basic'
      this.buildingVisualFilterKey = payload.buildingVisualFilterKey || null
      this.buildingLegendItems = []
      this.buildingLegendKind = 'none'

      const knownGroups = new Set(['parcels', 'buildings'])
      this.userGroups.forEach(function(group) {
        knownGroups.add(group.id)
        this.ensureGroupLayerVisibility(group.id)
      }.bind(this))

      ;['parcels', 'buildings'].forEach(
        function(groupId) {
          this.ensureGroupLayerVisibility(groupId)
        }.bind(this)
      )

      ;(Array.isArray(payload.features) ? payload.features : []).forEach(
        function(raw) {
          if (!raw || !raw.id || !raw.geometry) {
            return
          }
          const rawType = raw.featureType || null
          const selected = Boolean(raw.selected || (raw.properties && raw.properties._selected))
          const groupIdRaw = raw.groupId || (raw.properties && raw.properties._groupId) || defaultGroupIdForType(rawType)
          const groupId = String(groupIdRaw)

          if (!knownGroups.has(groupId) && groupId !== 'parcels' && groupId !== 'buildings') {
            const created = {
              id: groupId,
              name: groupId
            }
            this.userGroups.push(created)
            knownGroups.add(groupId)
          }

          const viewFeature = toViewFeature(
            {
              id: raw.id,
              geometry: raw.geometry,
              properties: {
                ...(raw.properties || {}),
                _groupId: groupId
              }
            },
            selected
          )
          viewFeature.groupId = groupId
          viewFeature.properties._groupId = groupId
          this.ensureGroupLayerVisibility(groupId)
          this.features[viewFeature.id] = viewFeature
        }.bind(this)
      )
    },
    setBuildingVisualMode: function(mode) {
      this.buildingVisualMode = mode || 'basic'
      this.buildingVisualFilterKey = null
    },
    setBuildingVisualFilterKey: function(key) {
      this.buildingVisualFilterKey = key
    },
    clearBuildingVisualFilter: function() {
      this.buildingVisualFilterKey = null
    },
    setBuildingLegend: function(legendItems, legendKind) {
      this.buildingLegendItems = legendItems
      this.buildingLegendKind = legendKind
    }
  }
})
