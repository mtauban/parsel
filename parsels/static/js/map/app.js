import {
  loadBoundingBox,
  loadBuildingsByIds,
  mergeFeatures,
  loadParcelsByIds,
  reverseAddress,
  searchAddress
} from './api.js'
import { BUILDING_VISUAL_OPTIONS } from './building-visual.js'
import {
  defaultGroupIdForType,
  getFeatureSubtitle,
  getFeatureTitle,
  getLayerKeyForGroup,
  splitIdsByType
} from './feature-utils.js'
import { buildPdfConversionEnvelope, buildSvgExportArtifacts, downloadTextArtifact } from './export-service.js'
import { LeafletMapManager } from './leaflet-manager.js'
import { parseInitialMapStateFromUrl, updateShareUrl, hasUrlMapState } from './share-url.js'
import { useMapStore } from './store.js'

const { createApp, computed, onBeforeUnmount, onMounted, ref } = Vue

if (!window.Pinia) {
  throw new Error('Pinia global is unavailable. Ensure vue-demi and pinia scripts are loaded before app modules.')
}

const pinia = window.Pinia.createPinia()
const AUTOLOAD_PREFS_KEY = 'parcelleapp_autoload_prefs_v1'
const PROJECTS_STORAGE_KEY = 'parcelleapp_projects_v1'
const PROJECTS_SCHEMA_VERSION = 1
const AUTO_UNLOAD_DELAY_MS = 1800
const BIN_TTL_MS = 5 * 60 * 1000
const MERGE_SCOPE_OPTIONS = [
  { value: 'all', label: 'Tout chargé (sélectionné + non sélectionné)' },
  { value: 'selected', label: 'Sélectionné uniquement' },
  { value: 'nonselected', label: 'Non sélectionné uniquement' }
]
const CORE_GROUPS = [
  {
    id: 'parcels',
    name: 'Parcelles',
    icon: 'fas fa-vector-square',
    loadKind: 'parcels',
    kind: 'parcels'
  },
  {
    id: 'buildings',
    name: 'Bâtiments',
    icon: 'fas fa-building',
    loadKind: 'buildings',
    kind: 'buildings'
  }
]

createApp({
  setup() {
    const store = useMapStore()
    const bootstrap = window.MAP_BOOTSTRAP || {}
    const manager = new LeafletMapManager(store, bootstrap)
    const satellite = ref(false)
    const setupLoading = ref(false)
    const setupLoadingMessage = ref('Mise à jour de la carte...')
    const featureLoading = ref({ parcels: false, buildings: false })
    const featureLoadingCount = { parcels: 0, buildings: 0 }
    const autoloadInFlight = { parcels: false, buildings: false }
    const autoloadLastSignature = { parcels: '', buildings: '' }
    let autoloadMoveTimer = null
    let autoloadCleanupTimer = null
    const autoloadPromptVisible = ref(false)
    const autoloadPromptDraft = ref({ parcels: false, buildings: false })
    const exportBusy = ref(false)
    const exportOptions = ref({
      mode: 'selected',
      includeLegend: true,
      scaleBarMeters: 'auto'
    })
    const newUserGroupName = ref('')
    const mergeDialogVisible = ref(false)
    const mergeDraft = ref({
      sourceGroupId: '',
      sourceGroupName: '',
      sourceScope: 'all',
      targetGroupId: '',
      createNewTargetGroup: false,
      newTargetGroupName: ''
    })
    const binItems = ref([])
    const binClock = ref(Date.now())
    let binTimer = null
    const projects = ref([])
    const selectedProjectId = ref('')
    const activeProjectId = ref('')
    const projectDraftName = ref('')
    const projectBaselineSignature = ref('')
    const panelSections = ref({
      projects: true,
      export: true,
      autoload: true
    })
    const toolbarMenus = ref({
      parcels: false,
      buildings: false,
      userGroups: false
    })

    const allGroupDefs = computed(function() {
      const userGroups = store.userGroups.map(function(group) {
        return {
          id: group.id,
          name: group.name,
          icon: 'fas fa-draw-polygon',
          loadKind: null,
          kind: 'user'
        }
      })
      return CORE_GROUPS.concat(userGroups)
    })

    const featuresByGroup = computed(function() {
      const buckets = {}

      allGroupDefs.value.forEach(function(group) {
        buckets[group.id] = {
          selected: [],
          loaded: []
        }
      })

      store.allFeatures.forEach(function(feature) {
        const groupId = feature.groupId || defaultGroupIdForType(feature.type)
        if (!buckets[groupId]) {
          buckets[groupId] = {
            selected: [],
            loaded: []
          }
        }
        const bucket = feature.selected ? buckets[groupId].selected : buckets[groupId].loaded
        bucket.push(feature)
      })

      Object.values(buckets).forEach(function(bucket) {
        bucket.selected.sort(function(a, b) {
          return getFeatureTitle(a).localeCompare(getFeatureTitle(b))
        })
        bucket.loaded.sort(function(a, b) {
          return getFeatureTitle(a).localeCompare(getFeatureTitle(b))
        })
      })

      return buckets
    })

    const userGroupOptions = computed(function() {
      return store.userGroups.slice()
    })

    const exportableCount = computed(function() {
      if (exportOptions.value.mode === 'selected') {
        return store.selectedFeatures.length
      }
      return store.allFeatures.length
    })

    const buildingLegendHint = computed(function() {
      return manager.getLegendHint()
    })

    const activeProjectName = computed(function() {
      const activeId = activeProjectId.value
      if (!activeId) {
        return ''
      }
      const match = projects.value.find(function(project) {
        return project.id === activeId
      })
      return match ? match.name : ''
    })

    function safeJsonParse(value, fallback) {
      try {
        return JSON.parse(value)
      } catch (error) {
        return fallback
      }
    }

    function normalizeProjectSnapshot(snapshot) {
      const payload = snapshot || {}
      const map = payload.map || {}
      const userGroups = Array.isArray(payload.userGroups) ? payload.userGroups : []
      const layerVisibility = payload.layerVisibility && typeof payload.layerVisibility === 'object' ? payload.layerVisibility : {}
      const features = Array.isArray(payload.features) ? payload.features : []

      return {
        map: {
          lat: Number(map.lat),
          lon: Number(map.lon),
          zoom: Number(map.zoom)
        },
        userGroups: userGroups
          .map(function(group) {
            return {
              id: String(group.id || ''),
              name: String(group.name || '')
            }
          })
          .filter(function(group) {
            return Boolean(group.id)
          })
          .sort(function(a, b) {
            return a.id.localeCompare(b.id)
          }),
        layerVisibility: Object.keys(layerVisibility)
          .sort()
          .reduce(function(acc, key) {
            acc[key] = Boolean(layerVisibility[key])
            return acc
          }, {}),
        buildingVisualMode: payload.buildingVisualMode || 'basic',
        buildingVisualFilterKey: payload.buildingVisualFilterKey || null,
        features: features
          .map(function(feature) {
            return {
              id: String(feature.id || ''),
              type: feature.featureType || feature.type || null,
              selected: Boolean(feature.selected),
              groupId: String(feature.groupId || (feature.properties && feature.properties._groupId) || ''),
              geometry: feature.geometry || null,
              properties: feature.properties || {}
            }
          })
          .filter(function(feature) {
            return Boolean(feature.id) && Boolean(feature.geometry)
          })
          .sort(function(a, b) {
            return a.id.localeCompare(b.id)
          })
      }
    }

    function projectSignature(snapshot) {
      return JSON.stringify(normalizeProjectSnapshot(snapshot))
    }

    function getCurrentMapStateForProject() {
      if (manager.map) {
        const center = manager.getCenter()
        return {
          lat: center.lat,
          lon: center.lng,
          zoom: manager.getZoom()
        }
      }
      return {
        lat: Number(store.map.lat),
        lon: Number(store.map.lon),
        zoom: Number(store.map.zoom)
      }
    }

    function buildCurrentProjectSnapshot() {
      return store.exportProjectSnapshot(getCurrentMapStateForProject())
    }

    function markProjectBaseline(snapshot) {
      projectBaselineSignature.value = projectSignature(snapshot || buildCurrentProjectSnapshot())
    }

    function hasUnsavedProjectChanges() {
      if (!projectBaselineSignature.value) {
        return false
      }
      return projectBaselineSignature.value !== projectSignature(buildCurrentProjectSnapshot())
    }

    function formatProjectDate(value) {
      if (!value) {
        return ''
      }
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) {
        return ''
      }
      return date.toLocaleString('fr-FR')
    }

    function getProjectById(projectId) {
      if (!projectId) {
        return null
      }
      return projects.value.find(function(project) {
        return project.id === projectId
      }) || null
    }

    function getProjectName(projectId) {
      const project = getProjectById(projectId)
      return project ? project.name : ''
    }

    function generateProjectId() {
      return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    }

    function persistProjectsToStorage() {
      const payload = {
        version: PROJECTS_SCHEMA_VERSION,
        projects: projects.value
      }
      try {
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(payload))
      } catch (error) {
        Notiflix.Notify.Failure('Impossible de sauvegarder les projets dans ce navigateur.')
      }
    }

    function loadProjectsFromStorage() {
      let raw = null
      try {
        raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY)
      } catch (error) {
        projects.value = []
        return
      }

      if (!raw) {
        projects.value = []
        return
      }

      const parsed = safeJsonParse(raw, null)
      const projectList = parsed && Array.isArray(parsed.projects) ? parsed.projects : []

      projects.value = projectList
        .filter(function(project) {
          return project && project.id && project.name && project.snapshot
        })
        .map(function(project) {
          return {
            id: String(project.id),
            name: String(project.name),
            createdAt: project.createdAt || new Date().toISOString(),
            updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
            snapshot: normalizeProjectSnapshot(project.snapshot)
          }
        })
        .sort(function(a, b) {
          return String(b.updatedAt).localeCompare(String(a.updatedAt))
        })
    }

    function saveProjectAsNew(name, options) {
      const effectiveOptions = options || {}
      const trimmed = String(name || '').trim()
      if (!trimmed) {
        if (!effectiveOptions.silent) {
          Notiflix.Notify.Warning('Nom du projet requis.')
        }
        return false
      }

      const snapshot = normalizeProjectSnapshot(buildCurrentProjectSnapshot())
      const now = new Date().toISOString()
      const project = {
        id: generateProjectId(),
        name: trimmed,
        createdAt: now,
        updatedAt: now,
        snapshot
      }

      projects.value.unshift(project)
      activeProjectId.value = project.id
      selectedProjectId.value = project.id
      projectDraftName.value = project.name
      persistProjectsToStorage()
      markProjectBaseline(snapshot)
      if (!effectiveOptions.silent) {
        Notiflix.Notify.Success('Projet sauvegardé dans le navigateur.')
      }
      return true
    }

    function saveCurrentProject() {
      const project = getProjectById(activeProjectId.value)
      if (!project) {
        const name = window.prompt('Nom du nouveau projet', projectDraftName.value || 'Nouveau projet')
        if (name === null) {
          return false
        }
        return saveProjectAsNew(name)
      }

      const snapshot = normalizeProjectSnapshot(buildCurrentProjectSnapshot())
      project.snapshot = snapshot
      project.updatedAt = new Date().toISOString()
      projectDraftName.value = project.name
      persistProjectsToStorage()
      markProjectBaseline(snapshot)
      Notiflix.Notify.Success('Projet mis à jour.')
      return true
    }

    function saveProjectFromDraft() {
      return saveProjectAsNew(projectDraftName.value)
    }

    async function confirmProjectSwitchWithUnsavedChanges() {
      if (!hasUnsavedProjectChanges()) {
        return true
      }

      return new Promise(function(resolve) {
        Notiflix.Confirm.Show(
          'Projet non enregistré',
          'Le projet courant a des changements non enregistrés. Sauvegarder en nouveau projet avant de continuer ?',
          'Sauvegarder',
          'Ignorer',
          function() {
            const fallbackName = activeProjectName.value
              ? `${activeProjectName.value} copie`
              : 'Projet non enregistré'
            const proposed = window.prompt('Nom du nouveau projet', fallbackName)
            if (proposed === null) {
              resolve(false)
              return
            }
            resolve(saveProjectAsNew(proposed))
          },
          function() {
            resolve(true)
          }
        )
      })
    }

    async function loadProjectById(projectId) {
      const project = getProjectById(projectId)
      if (!project) {
        Notiflix.Notify.Warning('Projet introuvable.')
        return false
      }

      const allowed = await confirmProjectSwitchWithUnsavedChanges()
      if (!allowed) {
        return false
      }

      const snapshot = normalizeProjectSnapshot(project.snapshot)
      await runSetupTransition('Chargement du projet ...', async function() {
        manager.removeAllFeatureLayers()
        store.restoreProjectSnapshot(snapshot)
        manager.setView(store.map.lat, store.map.lon, store.map.zoom)
        refreshAll()
      })

      binItems.value = []
      activeProjectId.value = project.id
      selectedProjectId.value = project.id
      projectDraftName.value = project.name
      markProjectBaseline(snapshot)
      store.setPanelOpen(true)
      store.setTab('layers')
      await refreshLocation()
      syncShareState()
      Notiflix.Notify.Success(`Projet chargé: ${project.name}`)
      return true
    }

    async function loadSelectedProject() {
      if (!selectedProjectId.value) {
        Notiflix.Notify.Warning('Sélectionnez un projet.')
        return
      }
      await loadProjectById(selectedProjectId.value)
    }

    async function deleteSelectedProject() {
      const project = getProjectById(selectedProjectId.value)
      if (!project) {
        return
      }

      const confirmed = await new Promise(function(resolve) {
        Notiflix.Confirm.Show(
          'Projets',
          `Supprimer le projet "${project.name}" ?`,
          'Supprimer',
          'Annuler',
          function() {
            resolve(true)
          },
          function() {
            resolve(false)
          }
        )
      })

      if (!confirmed) {
        return
      }

      projects.value = projects.value.filter(function(item) {
        return item.id !== project.id
      })
      if (activeProjectId.value === project.id) {
        activeProjectId.value = ''
        markProjectBaseline(buildCurrentProjectSnapshot())
      }
      if (selectedProjectId.value === project.id) {
        selectedProjectId.value = ''
      }
      persistProjectsToStorage()
      Notiflix.Notify.Success('Projet supprimé.')
    }

    function getAutoloadPrefsFromStorage() {
      let raw = null
      try {
        raw = window.localStorage.getItem(AUTOLOAD_PREFS_KEY)
      } catch (error) {
        return null
      }
      if (!raw) {
        return null
      }
      const parsed = safeJsonParse(raw, null)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }
      return {
        parcels: Boolean(parsed.parcels),
        buildings: Boolean(parsed.buildings),
        prompted: true
      }
    }

    function persistAutoloadPrefs() {
      const payload = {
        parcels: Boolean(store.autoload.parcels),
        buildings: Boolean(store.autoload.buildings)
      }
      try {
        window.localStorage.setItem(AUTOLOAD_PREFS_KEY, JSON.stringify(payload))
      } catch (error) {
        // Ignore storage write issues (private browsing / restricted contexts).
      }
    }

    function applyAutoloadPrefsFromStorage() {
      const prefs = getAutoloadPrefsFromStorage()
      if (!prefs) {
        return false
      }
      store.setAutoloadPrefs(prefs.parcels, prefs.buildings)
      store.setAutoloadPrompted(true)
      return true
    }

    function getMoveSignature() {
      const bounds = manager.getBounds()
      return [
        bounds.getSouth().toFixed(4),
        bounds.getWest().toFixed(4),
        bounds.getNorth().toFixed(4),
        bounds.getEast().toFixed(4),
        manager.getZoom()
      ].join(',')
    }

    async function runSetupTransition(message, fn) {
      setupLoadingMessage.value = message || 'Mise à jour de la carte...'
      setupLoading.value = true
      try {
        return await fn()
      } finally {
        setupLoading.value = false
      }
    }

    function setFeatureLoading(kind, delta) {
      if (!(kind in featureLoadingCount)) {
        return
      }
      featureLoadingCount[kind] = Math.max(0, featureLoadingCount[kind] + delta)
      featureLoading.value = {
        ...featureLoading.value,
        [kind]: featureLoadingCount[kind] > 0
      }
    }

    function openAutoloadPrompt() {
      if (store.autoload.prompted || autoloadPromptVisible.value) {
        return
      }
      autoloadPromptDraft.value = {
        parcels: Boolean(store.autoload.parcels),
        buildings: Boolean(store.autoload.buildings)
      }
      autoloadPromptVisible.value = true
    }

    function saveAutoloadPrompt() {
      store.setAutoloadPrefs(autoloadPromptDraft.value.parcels, autoloadPromptDraft.value.buildings)
      store.setAutoloadPrompted(true)
      autoloadPromptVisible.value = false
      persistAutoloadPrefs()
      if (store.autoload.parcels || store.autoload.buildings) {
        queueAutoloadForMove(true)
      }
    }

    function dismissAutoloadPrompt() {
      store.setAutoloadPrefs(false, false)
      store.setAutoloadPrompted(true)
      autoloadPromptVisible.value = false
      persistAutoloadPrefs()
    }

    function syncShareState() {
      updateShareUrl({
        lat: manager.getCenter().lat,
        lon: manager.getCenter().lng,
        zoom: manager.getZoom(),
        selectedIds: store.selectedIds
      })
    }

    async function refreshLocation() {
      try {
        const location = await reverseAddress(store.map.lat, store.map.lon)
        store.setLocation(location)
        if (location && location.city) {
          document.title = `Parcelle.app - ${location.city}`
        }
      } catch (error) {
        console.log('reverse geocoding failed', error)
      }
    }

    function onMapMoved(lat, lon, zoom) {
      store.setMapCenter(lat, lon, zoom)
      refreshLocation()
      syncShareState()
      queueAutoloadForMove(false)
    }

    function refreshAll() {
      manager.refreshAfterStateChange()
    }

    async function loadGroup(kind, options) {
      const effectiveOptions = options || {}
      const silent = Boolean(effectiveOptions.silent)
      const isAutoload = Boolean(effectiveOptions.autoload)

      if (manager.getZoom() < 16) {
        if (!silent) {
          Notiflix.Notify.Failure('La zone demandée est trop vaste et comporte un nombre trop important de parcelles.')
        }
        return false
      }

      if (isAutoload && autoloadInFlight[kind]) {
        return false
      }

      if (isAutoload) {
        autoloadInFlight[kind] = true
      }
      setFeatureLoading(kind, 1)

      try {
        const payload = await loadBoundingBox(kind, manager.getBounds())
        if (!silent && payload.numberMatched > payload.numberReturned) {
          Notiflix.Notify.Warning(`Chargement partiel de ${payload.numberReturned}/${payload.numberMatched} éléments.`)
        }
        store.upsertFeatureCollection(payload, false)
        refreshAll()
        return true
      } catch (error) {
        console.log('IGN Server not available', error)
        if (!silent) {
          Notiflix.Report.Failure('Erreur IGN', 'Serveurs IGN non accessibles. Essayez dans quelques instants.', 'Ok')
        }
        return false
      } finally {
        if (isAutoload) {
          autoloadInFlight[kind] = false
        }
        setFeatureLoading(kind, -1)
      }
    }

    function unloadOutOfViewFeatures(featureType) {
      const defaultGroupId = featureType === 'parcel' ? 'parcels' : 'buildings'
      const bounds = manager.getBounds()
      const idsToRemove = Object.values(store.features)
        .filter(function(feature) {
          if (feature.selected) {
            return false
          }
          if (feature.type !== featureType) {
            return false
          }
          if ((feature.groupId || defaultGroupIdForType(feature.type)) !== defaultGroupId) {
            return false
          }
          return !manager.isFeatureInsideBounds(feature.id, bounds)
        })
        .map(function(feature) {
          return feature.id
        })

      if (!idsToRemove.length) {
        return false
      }

      idsToRemove.forEach(function(id) {
        store.removeFeature(id)
        manager.removeFeatureLayer(id)
      })
      return true
    }

    function runAutoloadCleanup() {
      if (!store.autoload.ready) {
        return
      }
      let changed = false
      if (store.autoload.parcels) {
        changed = unloadOutOfViewFeatures('parcel') || changed
      }
      if (store.autoload.buildings) {
        changed = unloadOutOfViewFeatures('building') || changed
      }
      if (changed) {
        refreshAll()
        syncShareState()
      }
    }

    function queueAutoloadCleanup() {
      if (!(store.autoload.parcels || store.autoload.buildings)) {
        return
      }
      if (autoloadCleanupTimer) {
        window.clearTimeout(autoloadCleanupTimer)
      }
      autoloadCleanupTimer = window.setTimeout(function() {
        runAutoloadCleanup()
      }, AUTO_UNLOAD_DELAY_MS)
    }

    async function runAutoloadForMove(force) {
      if (!store.autoload.ready || !(store.autoload.parcels || store.autoload.buildings)) {
        return
      }
      const signature = getMoveSignature()

      if (store.autoload.parcels && (force || autoloadLastSignature.parcels !== signature)) {
        autoloadLastSignature.parcels = signature
        await loadGroup('parcels', { silent: true, autoload: true })
      }

      if (store.autoload.buildings && (force || autoloadLastSignature.buildings !== signature)) {
        autoloadLastSignature.buildings = signature
        await loadGroup('buildings', { silent: true, autoload: true })
      }

      queueAutoloadCleanup()
    }

    function queueAutoloadForMove(force) {
      if (!store.autoload.ready || !(store.autoload.parcels || store.autoload.buildings)) {
        return
      }
      if (autoloadMoveTimer) {
        window.clearTimeout(autoloadMoveTimer)
      }
      autoloadMoveTimer = window.setTimeout(function() {
        runAutoloadForMove(force)
      }, 350)
    }

    function pruneBin() {
      const now = Date.now()
      binItems.value = binItems.value.filter(function(item) {
        return item.expiresAt > now
      })
    }

    function removeFromBin(id) {
      binItems.value = binItems.value.filter(function(item) {
        return item.id !== id
      })
    }

    function pushToBin(id) {
      if (!id) {
        return
      }
      pruneBin()
      const now = Date.now()
      const expiresAt = now + BIN_TTL_MS
      const existing = binItems.value.find(function(item) {
        return item.id === id
      })
      if (existing) {
        existing.expiresAt = expiresAt
        existing.removedAt = now
        return
      }
      binItems.value.unshift({
        id,
        removedAt: now,
        expiresAt
      })
    }

    function unloadFeature(id) {
      if (!store.features[id]) {
        return
      }
      pushToBin(id)
      store.removeFeature(id)
      manager.removeFeatureLayer(id)
      refreshAll()
      syncShareState()
    }

    function deleteFeature(id) {
      unloadFeature(id)
    }

    function togglePanelSection(sectionKey) {
      if (!Object.prototype.hasOwnProperty.call(panelSections.value, sectionKey)) {
        return
      }
      panelSections.value = {
        ...panelSections.value,
        [sectionKey]: !panelSections.value[sectionKey]
      }
    }

    function closeQuickMenus() {
      toolbarMenus.value = {
        parcels: false,
        buildings: false,
        userGroups: false
      }
    }

    function toggleQuickMenu(menuKey) {
      if (!Object.prototype.hasOwnProperty.call(toolbarMenus.value, menuKey)) {
        return
      }
      const isOpen = toolbarMenus.value[menuKey]
      closeQuickMenus()
      if (!isOpen) {
        toolbarMenus.value = {
          ...toolbarMenus.value,
          [menuKey]: true
        }
      }
    }

    async function loadNonSelectedByGroupId(groupId) {
      if (groupId === 'parcels') {
        await loadGroup('parcels')
        return
      }
      if (groupId === 'buildings') {
        await loadGroup('buildings')
      }
    }

    function unloadNonSelectedByGroupId(groupId) {
      const features = getGroupLoadedFeatures(groupId)
      if (!features.length) {
        return
      }
      features.forEach(function(feature) {
        pushToBin(feature.id)
        store.removeFeature(feature.id)
        manager.removeFeatureLayer(feature.id)
      })
      refreshAll()
      syncShareState()
    }

    function createUserGroupFromPrompt() {
      const suggested = newUserGroupName.value || 'Nouveau groupe utilisateur'
      const input = window.prompt('Nom du nouveau groupe utilisateur', suggested)
      if (input === null) {
        return
      }
      const created = store.createUserGroup(input)
      if (!created) {
        Notiflix.Notify.Warning('Nom de groupe requis.')
        return
      }
      newUserGroupName.value = ''
      refreshAll()
      syncShareState()
      closeQuickMenus()
      Notiflix.Notify.Success('Groupe utilisateur créé.')
    }

    async function deleteAllUserGroups() {
      const deletable = store.userGroups.filter(function(group) {
        return group.id !== 'user-shapes'
      })
      if (!deletable.length) {
        Notiflix.Notify.Info('Aucun groupe utilisateur à supprimer.')
        closeQuickMenus()
        return
      }

      const confirmed = await new Promise(function(resolve) {
        Notiflix.Confirm.Show(
          'Groupes utilisateur',
          'Supprimer tous les groupes utilisateur personnalisés ?',
          'Supprimer',
          'Annuler',
          function() {
            resolve(true)
          },
          function() {
            resolve(false)
          }
        )
      })
      if (!confirmed) {
        return
      }

      deletable.forEach(function(group) {
        store.deleteUserGroup(group.id)
        manager.removeGroupLayersForGroupId(group.id)
      })
      refreshAll()
      syncShareState()
      closeQuickMenus()
      Notiflix.Notify.Success('Groupes utilisateur supprimés.')
    }

    function toggleSelection(id) {
      store.toggleSelected(id)
      refreshAll()
      syncShareState()
    }

    function setSelection(id, selected) {
      store.setSelected(id, selected)
      refreshAll()
      syncShareState()
    }

    function focusFeature(id) {
      manager.focusFeature(id)
      manager.toggleActiveFeature(id)
    }

    function onFeatureHover(id) {
      manager.highlightFeature(id)
    }

    function onFeatureLeave(id) {
      manager.restoreFeatureStyle(id)
    }

    function getGroupSelectedFeatures(groupId) {
      const bucket = featuresByGroup.value[groupId]
      return bucket ? bucket.selected : []
    }

    function getGroupLoadedFeatures(groupId) {
      const bucket = featuresByGroup.value[groupId]
      return bucket ? bucket.loaded : []
    }

    function getGroupFeatureCount(groupId) {
      return getGroupSelectedFeatures(groupId).length + getGroupLoadedFeatures(groupId).length
    }

    function isUserGroup(groupId) {
      return !CORE_GROUPS.some(function(group) {
        return group.id === groupId
      })
    }

    function isGroupVisible(groupId) {
      const loadedKey = getLayerKeyForGroup(groupId, false)
      const selectedKey = getLayerKeyForGroup(groupId, true)
      return Boolean(store.layerVisibility[loadedKey] || store.layerVisibility[selectedKey])
    }

    function toggleGroupVisibility(groupId) {
      const show = !isGroupVisible(groupId)
      manager.setGroupVisibility(getLayerKeyForGroup(groupId, false), show)
      manager.setGroupVisibility(getLayerKeyForGroup(groupId, true), show)
    }

    function isGroupLoading(groupId) {
      if (groupId === 'parcels') {
        return featureLoading.value.parcels
      }
      if (groupId === 'buildings') {
        return featureLoading.value.buildings
      }
      return false
    }

    async function loadGroupById(groupId) {
      if (groupId === 'parcels') {
        await loadGroup('parcels')
        return
      }
      if (groupId === 'buildings') {
        await loadGroup('buildings')
      }
    }

    function unloadGroupToBin(groupId) {
      const ids = store.allFeatures
        .filter(function(feature) {
          return (feature.groupId || defaultGroupIdForType(feature.type)) === groupId
        })
        .map(function(feature) {
          return feature.id
        })

      if (!ids.length) {
        return
      }

      ids.forEach(function(id) {
        pushToBin(id)
        store.removeFeature(id)
        manager.removeFeatureLayer(id)
      })
      refreshAll()
      syncShareState()
    }

    function getTransferTargets(currentGroupId) {
      if (isUserGroup(currentGroupId)) {
        return store.userGroups.filter(function(group) {
          return group.id !== currentGroupId
        })
      }
      return store.userGroups.slice()
    }

    function transferFeature(id, targetGroupId) {
      if (!targetGroupId) {
        return
      }
      const moved = store.moveFeatureToGroup(id, targetGroupId)
      if (!moved) {
        return
      }
      refreshAll()
      syncShareState()
    }

    function removeFromUserGroup(id) {
      const moved = store.moveFeatureToDefaultGroup(id)
      if (!moved) {
        return
      }
      refreshAll()
      syncShareState()
    }

    function renameUserGroup(groupId) {
      const group = store.userGroups.find(function(item) {
        return item.id === groupId
      })
      if (!group) {
        return
      }
      const nextName = window.prompt('Renommer le groupe utilisateur', group.name)
      if (nextName === null) {
        return
      }
      const ok = store.renameUserGroup(groupId, nextName)
      if (!ok) {
        Notiflix.Notify.Warning('Nom invalide.')
        return
      }
      refreshAll()
    }

    async function deleteUserGroup(groupId) {
      const group = store.userGroups.find(function(item) {
        return item.id === groupId
      })
      if (!group) {
        return
      }
      const confirmed = await new Promise(function(resolve) {
        Notiflix.Confirm.Show(
          'Groupes utilisateur',
          `Supprimer le groupe "${group.name}" ? Les entités reviendront dans leur groupe par défaut.`,
          'Supprimer',
          'Annuler',
          function() {
            resolve(true)
          },
          function() {
            resolve(false)
          }
        )
      })
      if (!confirmed) {
        return
      }
      const deleted = store.deleteUserGroup(groupId)
      if (!deleted) {
        return
      }
      manager.removeGroupLayersForGroupId(groupId)
      refreshAll()
      syncShareState()
    }

    function getMergeCandidateFeatures(groupId, scope) {
      const selected = getGroupSelectedFeatures(groupId)
      const loaded = getGroupLoadedFeatures(groupId)
      if (scope === 'selected') {
        return selected
      }
      if (scope === 'nonselected') {
        return loaded
      }
      return selected.concat(loaded)
    }

    function getMergeCandidateCount(groupId, scope) {
      return getMergeCandidateFeatures(groupId, scope).length
    }

    function extractPrimitiveMergeIds(feature) {
      if (!feature || !feature.id) {
        return []
      }
      const props = feature.properties || {}
      const fromMeta = Array.isArray(props.merged_from_ids) ? props.merged_from_ids : []
      if (fromMeta.length) {
        return fromMeta
          .map(function(id) {
            return String(id || '')
          })
          .filter(function(id) {
            return id.startsWith('p') || id.startsWith('b')
          })
      }
      if (feature.id.startsWith('p') || feature.id.startsWith('b')) {
        return [feature.id]
      }
      return []
    }

    function openMergeDialog(group) {
      const fallbackTarget = userGroupOptions.value[0] ? userGroupOptions.value[0].id : ''
      mergeDraft.value = {
        sourceGroupId: group.id,
        sourceGroupName: group.name,
        sourceScope: 'all',
        targetGroupId: fallbackTarget,
        createNewTargetGroup: false,
        newTargetGroupName: ''
      }
      mergeDialogVisible.value = true
    }

    function closeMergeDialog() {
      mergeDialogVisible.value = false
    }

    function buildMergePayload(features) {
      return {
        features: features.map(function(feature) {
          return {
            id: feature.id,
            geometry: feature.geometry,
            properties: {
              merged_from_ids: extractPrimitiveMergeIds(feature)
            }
          }
        })
      }
    }

    async function submitMergeIntent() {
      const sourceGroupId = mergeDraft.value.sourceGroupId
      const sourceScope = mergeDraft.value.sourceScope
      const candidates = getMergeCandidateFeatures(sourceGroupId, sourceScope)
      if (candidates.length < 2) {
        Notiflix.Notify.Warning('Il faut au moins 2 formes dans le périmètre choisi pour préparer une fusion.')
        return
      }

      let targetGroupId = mergeDraft.value.targetGroupId
      if (mergeDraft.value.createNewTargetGroup) {
        const created = store.createUserGroup(mergeDraft.value.newTargetGroupName)
        if (!created) {
          Notiflix.Notify.Warning('Nom de nouveau groupe requis.')
          return
        }
        targetGroupId = created.id
      }

      if (!targetGroupId) {
        Notiflix.Notify.Warning('Choisissez un groupe utilisateur cible.')
        return
      }

      const payload = buildMergePayload(candidates)
      if (!payload.features.length) {
        Notiflix.Notify.Warning('Aucune forme exploitable dans le périmètre choisi.')
        return
      }

      Notiflix.Loading.Circle('Fusion des geometries...')
      try {
        const mergedCollection = await mergeFeatures(payload)
        const mergedFeatures = (mergedCollection.features || []).map(function(feature) {
          return {
            ...feature,
            properties: {
              ...(feature.properties || {}),
              _groupId: targetGroupId
            }
          }
        })

        if (!mergedFeatures.length) {
          Notiflix.Notify.Warning('Aucune fusion geometrique possible pour cette selection.')
          return
        }

        store.upsertFeatureCollection(
          {
            type: 'FeatureCollection',
            features: mergedFeatures
          },
          true
        )
        refreshAll()
        syncShareState()
        closeMergeDialog()
        Notiflix.Notify.Success(`Fusion terminee (${mergedFeatures.length} forme(s) creee(s)).`)
      } catch (error) {
        console.log('merge failed', error)
        Notiflix.Report.Failure('Fusion', 'Impossible de fusionner ces geometries pour le moment.', 'Ok')
      } finally {
        Notiflix.Loading.Remove()
      }
    }

    function formatBinRemaining(expiresAt) {
      const remainingMs = Math.max(0, expiresAt - binClock.value)
      const remainingSeconds = Math.ceil(remainingMs / 1000)
      const minutes = Math.floor(remainingSeconds / 60)
      const seconds = remainingSeconds % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    async function confirmRestore(id) {
      return new Promise(function(resolve) {
        Notiflix.Confirm.Show(
          'Corbeille',
          `Recharger l’élément ${id} depuis l’API IGN ?`,
          'Restaurer',
          'Annuler',
          function() {
            resolve(true)
          },
          function() {
            resolve(false)
          }
        )
      })
    }

    async function restoreBinItem(id) {
      pruneBin()
      const item = binItems.value.find(function(entry) {
        return entry.id === id
      })
      if (!item) {
        return
      }

      const confirmed = await confirmRestore(id)
      if (!confirmed) {
        return
      }

      const kind = id.charAt(0) === 'p' ? 'parcels' : id.charAt(0) === 'b' ? 'buildings' : null
      if (!kind) {
        Notiflix.Notify.Failure('Type inconnu pour cette entité.')
        return
      }

      setFeatureLoading(kind, 1)
      try {
        const payload = kind === 'parcels' ? await loadParcelsByIds([id]) : await loadBuildingsByIds([id])
        if (!payload.features || !payload.features.length) {
          Notiflix.Notify.Warning('Aucune donnée IGN retournée pour cet identifiant.')
          return
        }
        store.upsertFeatureCollection(payload, false)
        removeFromBin(id)
        refreshAll()
        syncShareState()
        Notiflix.Notify.Success('Entité restaurée.')
      } catch (error) {
        console.log('bin restore failed', error)
        Notiflix.Report.Failure('Restauration', 'Impossible de restaurer cette entité pour le moment.', 'Ok')
      } finally {
        setFeatureLoading(kind, -1)
      }
    }

    function purgeBinItem(id) {
      removeFromBin(id)
    }

    function markLocationReady() {
      if (!store.autoload.ready) {
        store.setAutoloadReady(true)
      }
      openAutoloadPrompt()
    }

    function setAutoloadOption(kind, enabled) {
      store.setAutoloadFlag(kind, enabled)
      store.setAutoloadPrompted(true)
      persistAutoloadPrefs()
      if (enabled) {
        markLocationReady()
        queueAutoloadForMove(true)
      } else {
        queueAutoloadCleanup()
      }
    }

    async function loadFromSelectedIds(ids) {
      const split = splitIdsByType(ids)
      split.parcels.forEach(function(id) {
        if (store.features[id]) {
          store.setSelected(id, true)
        }
      })
      split.buildings.forEach(function(id) {
        if (store.features[id]) {
          store.setSelected(id, true)
        }
      })

      if (!split.parcels.length && !split.buildings.length) {
        refreshAll()
        return
      }

      if (split.parcels.length) {
        setFeatureLoading('parcels', 1)
      }
      if (split.buildings.length) {
        setFeatureLoading('buildings', 1)
      }
      try {
        const [parcelPayload, buildingPayload] = await Promise.all([
          loadParcelsByIds(split.parcels),
          loadBuildingsByIds(split.buildings)
        ])
        store.upsertFeatureCollection(parcelPayload, true)
        store.upsertFeatureCollection(buildingPayload, true)
      } catch (error) {
        console.log('IGN Server not available', error)
        Notiflix.Report.Failure('Erreur IGN', 'Serveurs IGN non accessibles. Essayez plus tard.', 'Ok')
      } finally {
        if (split.parcels.length) {
          setFeatureLoading('parcels', -1)
        }
        if (split.buildings.length) {
          setFeatureLoading('buildings', -1)
        }
      }

      split.parcels.concat(split.buildings).forEach(function(id) {
        if (store.features[id]) {
          store.setSelected(id, true)
        }
      })

      refreshAll()
      syncShareState()
    }

    async function handleSearchInput(event) {
      const query = store.search.query
      if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        return
      }
      if (event.code === 'Enter') {
        selectSearchResult(store.search.arrowIndex)
        return
      }

      if (!query || query.length < 3) {
        store.clearSearchResults()
        return
      }

      try {
        const center = manager.getCenter()
        const features = await searchAddress(query, center.lat, center.lng)
        store.setSearchResults(
          features.filter(function(feature) {
            return feature.properties.score >= 0.6
          })
        )
      } catch (error) {
        console.log('address search failed', error)
      }
    }

    function onSearchArrow(event) {
      if (!store.search.results.length) {
        return
      }
      if (event.code === 'ArrowDown') {
        store.search.arrowIndex = (store.search.arrowIndex + 1) % store.search.results.length
        return
      }
      if (event.code === 'ArrowUp') {
        store.search.arrowIndex = (store.search.arrowIndex - 1 + store.search.results.length) % store.search.results.length
      }
    }

    async function selectSearchResult(index) {
      if (index < 0 || index >= store.search.results.length) {
        return
      }
      const feature = store.search.results[index]
      await runSetupTransition('Recentrage sur l’adresse ...', async function() {
        manager.focusGeoJsonResult(feature, 14)
        await manager.waitForNextMoveEnd(6000)
      })
      store.setSearchQuery(feature.properties.label)
      store.clearSearchResults()
      store.setTab('layers')
      markLocationReady()
      queueAutoloadForMove(true)
    }

    function setMapFromInputs() {
      const lat = Number.parseFloat(store.map.lat)
      const lon = Number.parseFloat(store.map.lon)
      const zoom = Number.parseFloat(store.map.zoom)
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) {
        return
      }
      manager.setView(lat, lon, zoom)
      markLocationReady()
    }

    function setBuildingVisualMode(mode) {
      store.setBuildingVisualMode(mode)
      refreshAll()
    }

    function toggleBuildingLegendFilter(key) {
      if (store.buildingVisualFilterKey === key) {
        store.clearBuildingVisualFilter()
      } else {
        store.setBuildingVisualFilterKey(key)
      }
      refreshAll()
    }

    async function copyShareUrl() {
      const text = window.location.href
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const tmp = document.createElement('input')
          tmp.type = 'text'
          tmp.value = text
          document.body.appendChild(tmp)
          tmp.select()
          document.execCommand('Copy')
          document.body.removeChild(tmp)
        }
        Notiflix.Notify.Success('URL du plan copiée dans le presse-papier.')
      } catch (error) {
        Notiflix.Notify.Failure('Impossible de copier automatiquement. Copiez l\'URL depuis la barre du navigateur.')
      }
    }

    function buildCurrentSvgExportArtifacts() {
      const artifacts = buildSvgExportArtifacts(store.allFeatures, {
        ...exportOptions.value,
        buildingVisualMode: store.buildingVisualMode,
        buildingLegendItems: store.buildingLegendItems
      })
      if (!artifacts) {
        Notiflix.Notify.Warning('Aucune geometrie exportable pour ce mode.')
        return null
      }
      return artifacts
    }

    async function exportSvg() {
      if (exportBusy.value) {
        return
      }
      exportBusy.value = true
      try {
        const artifacts = buildCurrentSvgExportArtifacts()
        if (!artifacts) {
          return
        }
        downloadTextArtifact(`${artifacts.fileStem}.svg`, artifacts.svgString, 'image/svg+xml;charset=utf-8')
        Notiflix.Notify.Success(`SVG exporte (${artifacts.payload.features.length} entites).`)
      } catch (error) {
        console.log('SVG export failed', error)
        Notiflix.Report.Failure('Export SVG', 'Impossible de generer le SVG. Verifiez la configuration de projection.', 'Ok')
      } finally {
        exportBusy.value = false
      }
    }

    async function exportMetadataJson() {
      if (exportBusy.value) {
        return
      }
      exportBusy.value = true
      try {
        const artifacts = buildCurrentSvgExportArtifacts()
        if (!artifacts) {
          return
        }
        downloadTextArtifact(`${artifacts.fileStem}.metadata.json`, artifacts.metadataJsonString, 'application/json;charset=utf-8')
        Notiflix.Notify.Success('Sidecar JSON exporte.')
      } catch (error) {
        console.log('JSON sidecar export failed', error)
        Notiflix.Notify.Failure('Export JSON impossible.')
      } finally {
        exportBusy.value = false
      }
    }

    async function exportMetadataCsv() {
      if (exportBusy.value) {
        return
      }
      exportBusy.value = true
      try {
        const artifacts = buildCurrentSvgExportArtifacts()
        if (!artifacts) {
          return
        }
        downloadTextArtifact(`${artifacts.fileStem}.metadata.csv`, artifacts.metadataCsvString, 'text/csv;charset=utf-8')
        Notiflix.Notify.Success('Sidecar CSV exporte.')
      } catch (error) {
        console.log('CSV sidecar export failed', error)
        Notiflix.Notify.Failure('Export CSV impossible.')
      } finally {
        exportBusy.value = false
      }
    }

    function prepareFuturePdfExportEnvelope() {
      const artifacts = buildCurrentSvgExportArtifacts()
      if (!artifacts) {
        return null
      }
      return buildPdfConversionEnvelope(artifacts)
    }

    function toggleSatellite() {
      satellite.value = manager.toggleSatellite()
    }

    function togglePanel() {
      store.setPanelOpen(!store.ui.panelOpen)
    }

    function geolocateAndFocus(radiusMeters) {
      if (!('geolocation' in navigator)) {
        Notiflix.Notify.Failure('La géolocalisation n’est pas disponible sur cet appareil.')
        return Promise.resolve(false)
      }

      store.setGeolocationRequested(true)

      return new Promise(function(resolve) {
        navigator.geolocation.getCurrentPosition(
          async function(position) {
            try {
              const lat = position.coords.latitude
              const lon = position.coords.longitude
              store.setMapCenter(lat, lon, 17)
              store.setGeolocationGranted(true)
              store.setGeolocationDenied(false)

              const geolocFeature = {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [lon, lat]
                },
                properties: {
                  label: 'Votre position'
                }
              }

              manager.focusGeoJsonResult(geolocFeature, 17)
              const center = L.latLng(lat, lon)
              const bounds = center.toBounds(Math.max(100, radiusMeters) * 2)
              manager.fitBounds(bounds, { maxZoom: 18, padding: [20, 20] })
              await manager.waitForNextMoveEnd(6000)
              resolve(true)
            } catch (error) {
              console.log('Geolocation processing failed', error)
              store.setGeolocationDenied(true)
              resolve(false)
            }
          },
          function(error) {
            console.log('Geolocation not available', error)
            store.setGeolocationDenied(true)
            resolve(false)
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          }
        )
      })
    }

    async function requestGeolocation(options) {
      const effectiveOptions = options || {}
      const notifyOnFail = effectiveOptions.notifyOnFail !== false

      let success = false
      try {
        success = await runSetupTransition('Localisation en cours ...', async function() {
          return geolocateAndFocus(500)
        })
      } catch (error) {
        console.log('Geolocation request failed', error)
        success = false
        store.setGeolocationDenied(true)
      }

      if (success) {
        markLocationReady()
        queueAutoloadForMove(true)
      } else if (notifyOnFail) {
        Notiflix.Notify.Warning('Impossible de récupérer votre position. Vous pouvez entrer une adresse.')
      }

      return success
    }

    manager.setCallbacks({
      onMapMoved,
      onLayerToggleSelection: toggleSelection,
      onLayerDeleteFeature: deleteFeature,
      onLayerFocusSelection: function(id) {
        manager.toggleActiveFeature(id)
      }
    })

    onMounted(async function() {
      Notiflix.Notify.Init({ plainText: false })
      Notiflix.Loading.Init({
        customSvgUrl: bootstrap.loadingIconUrl,
        svgSize: '80px'
      })
      pruneBin()
      binTimer = window.setInterval(function() {
        binClock.value = Date.now()
        pruneBin()
      }, 1000)

      const startupHasUrlState = hasUrlMapState()

      manager.initMap()
      loadProjectsFromStorage()
      applyAutoloadPrefsFromStorage()

      const parsed = parseInitialMapStateFromUrl({
        lat: store.map.lat,
        lon: store.map.lon,
        zoom: store.map.zoom
      })

      store.setMapCenter(parsed.lat, parsed.lon, parsed.zoom)
      manager.setView(parsed.lat, parsed.lon, parsed.zoom)

      await refreshLocation()

      if (!startupHasUrlState) {
        store.setPanelOpen(true)
        store.setTab('search')
        const geolocateSuccess = await requestGeolocation({ notifyOnFail: false })
        if (!geolocateSuccess) {
          Notiflix.Notify.Info('Entrez une adresse ou utilisez la cible pour localiser la carte.')
        }
      } else {
        store.setAutoloadReady(true)
      }

      if (parsed.ids.length) {
        await loadFromSelectedIds(parsed.ids)
      }

      refreshAll()
      syncShareState()
      if (store.autoload.parcels || store.autoload.buildings) {
        queueAutoloadForMove(true)
      }
      markProjectBaseline(buildCurrentProjectSnapshot())
    })

    onBeforeUnmount(function() {
      if (autoloadMoveTimer) {
        window.clearTimeout(autoloadMoveTimer)
        autoloadMoveTimer = null
      }
      if (autoloadCleanupTimer) {
        window.clearTimeout(autoloadCleanupTimer)
        autoloadCleanupTimer = null
      }
      if (binTimer) {
        window.clearInterval(binTimer)
        binTimer = null
      }
    })

    return {
      store,
      setupLoading,
      setupLoadingMessage,
      featureLoading,
      loadingIconUrl: bootstrap.loadingIconUrl,
      satellite,
      exportBusy,
      exportOptions,
      exportableCount,
      projects,
      selectedProjectId,
      activeProjectId,
      activeProjectName,
      projectDraftName,
      panelSections,
      toolbarMenus,
      formatProjectDate,
      mergeDialogVisible,
      mergeDraft,
      mergeScopeOptions: MERGE_SCOPE_OPTIONS,
      autoloadPromptVisible,
      autoloadPromptDraft,
      allGroupDefs,
      getGroupSelectedFeatures,
      getGroupLoadedFeatures,
      getGroupFeatureCount,
      isUserGroup,
      isGroupVisible,
      isGroupLoading,
      binItems,
      buildingVisualOptions: BUILDING_VISUAL_OPTIONS,
      buildingLegendHint,
      getFeatureTitle,
      getFeatureSubtitle,
      loadGroup,
      loadGroupById,
      toggleGroupVisibility,
      unloadGroupToBin,
      getTransferTargets,
      transferFeature,
      removeFromUserGroup,
      renameUserGroup,
      deleteUserGroup,
      getMergeCandidateCount,
      openMergeDialog,
      closeMergeDialog,
      submitMergeIntent,
      userGroupOptions,
      setSelection,
      toggleSelection,
      deleteFeature,
      unloadFeature,
      restoreBinItem,
      purgeBinItem,
      formatBinRemaining,
      focusFeature,
      onFeatureHover,
      onFeatureLeave,
      handleSearchInput,
      onSearchArrow,
      selectSearchResult,
      requestGeolocation,
      setMapFromInputs,
      setAutoloadOption,
      saveAutoloadPrompt,
      dismissAutoloadPrompt,
      setBuildingVisualMode,
      toggleBuildingLegendFilter,
      copyShareUrl,
      saveProjectFromDraft,
      saveCurrentProject,
      loadSelectedProject,
      deleteSelectedProject,
      togglePanelSection,
      toggleQuickMenu,
      closeQuickMenus,
      loadNonSelectedByGroupId,
      unloadNonSelectedByGroupId,
      createUserGroupFromPrompt,
      deleteAllUserGroups,
      exportSvg,
      exportMetadataJson,
      exportMetadataCsv,
      prepareFuturePdfExportEnvelope,
      toggleSatellite,
      togglePanel
    }
  },
  template: `
    <div class="map-shell" :class="{ 'setup-active': setupLoading }">
      <div id="mapid" class="map-canvas"></div>

      <div v-if="setupLoading" class="setup-indicator">
        <img :src="loadingIconUrl" alt="" class="setup-indicator-icon" />
        <span>{{ setupLoadingMessage }}</span>
      </div>

      <div class="feature-loading-nuggets">
        <div v-if="featureLoading.parcels" class="loading-nugget">
          <img :src="loadingIconUrl" alt="" class="loading-nugget-icon" />
          Chargement parcelles...
        </div>
        <div v-if="featureLoading.buildings" class="loading-nugget">
          <img :src="loadingIconUrl" alt="" class="loading-nugget-icon" />
          Chargement bâtiments...
        </div>
      </div>

      <button class="btn btn-dark panel-toggle" @click="togglePanel" type="button">
        <i class="fas" :class="store.ui.panelOpen ? 'fa-times' : 'fa-sliders-h'"></i>
      </button>

      <aside class="control-panel" :class="{ open: store.ui.panelOpen }">
        <div class="panel-head">
          <h1>Parcelle.app</h1>
          <div class="btn-group w-100" role="group">
            <button class="btn btn-sm" :class="store.ui.tab === 'search' ? 'btn-dark' : 'btn-outline-dark'" @click="store.setTab('search')">Recherche</button>
            <button class="btn btn-sm" :class="store.ui.tab === 'layers' ? 'btn-dark' : 'btn-outline-dark'" @click="store.setTab('layers')">Couches</button>
          </div>
        </div>

        <div class="panel-body">
          <section v-show="store.ui.tab === 'search'" class="panel-section">
            <label class="form-label">Adresse</label>
            <div class="input-group">
              <input
                id="search_input"
                class="form-control"
                type="text"
                v-model="store.search.query"
                @keyup="handleSearchInput"
                @keydown.down.prevent="onSearchArrow"
                @keydown.up.prevent="onSearchArrow"
                placeholder="117 Rue Cuvier, Lyon"
              />
              <button class="btn btn-outline-dark" type="button" @click="requestGeolocation">
                <i class="fas fa-location-crosshairs"></i>
              </button>
            </div>
            <p class="small text-muted mt-1 mb-0">
              <span v-if="store.geolocation.granted">Position détectée. Vous pouvez relancer la géolocalisation avec le bouton cible.</span>
              <span v-else-if="store.geolocation.denied">Position refusée ou indisponible. Entrez une adresse ou réessayez.</span>
              <span v-else>Utilisez la cible pour centrer la carte sur votre position.</span>
            </p>

            <ul v-if="store.search.open" class="autocomplete-results">
              <li
                v-for="(feature, index) in store.search.results"
                :key="feature.properties.id || feature.properties.label || index"
                class="autocomplete-result"
                :class="{ 'is-active': index === store.search.arrowIndex }"
                @click="selectSearchResult(index)"
              >
                {{ feature.properties.label }}
              </li>
            </ul>

            <div class="mt-3">
              <h2>Coordonnées</h2>
              <p class="small text-muted mb-1">{{ store.location.postcode }} {{ store.location.city }} ({{ store.location.citycode }})</p>
              <label class="form-label">Latitude</label>
              <input class="form-control" v-model="store.map.lat" @change="setMapFromInputs" />
              <label class="form-label mt-2">Longitude</label>
              <input class="form-control" v-model="store.map.lon" @change="setMapFromInputs" />
              <label class="form-label mt-2">Zoom</label>
              <input type="range" min="6" max="20" step="1" class="form-range" v-model="store.map.zoom" @change="setMapFromInputs" />
            </div>

            <div class="d-grid gap-2 mt-3">
              <button class="btn btn-outline-dark" @click="copyShareUrl"><i class="far fa-share-square"></i> Copier le lien</button>
              <button class="btn btn-outline-dark" @click="toggleSatellite"><i class="fas fa-layer-group"></i> Fond satellite</button>
            </div>
          </section>

          <section v-show="store.ui.tab === 'layers'" class="panel-section">
            <article class="group-card mb-3">
              <div class="quick-actions-line">
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': panelSections.projects }"
                  title="Afficher/Masquer Projets"
                  @click="togglePanelSection('projects')"
                >
                  <i class="fas" :class="panelSections.projects ? 'fa-folder-open' : 'fa-folder'"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': panelSections.export }"
                  title="Afficher/Masquer Export"
                  @click="togglePanelSection('export')"
                >
                  <i class="fas fa-file-export"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': panelSections.autoload }"
                  title="Afficher/Masquer Configuration chargement automatique"
                  @click="togglePanelSection('autoload')"
                >
                  <i class="fas fa-sliders-h"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': toolbarMenus.parcels }"
                  title="Actions parcelles"
                  @click="toggleQuickMenu('parcels')"
                >
                  <i class="fas fa-vector-square"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': toolbarMenus.buildings }"
                  title="Actions bâtiments"
                  @click="toggleQuickMenu('buildings')"
                >
                  <i class="fas fa-building"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-dark quick-action-btn"
                  :class="{ 'btn-dark text-white': toolbarMenus.userGroups }"
                  title="Actions groupes utilisateur"
                  @click="toggleQuickMenu('userGroups')"
                >
                  <i class="fas fa-draw-polygon"></i>
                </button>
              </div>

              <div v-if="toolbarMenus.parcels" class="quick-submenu mt-2">
                <span class="quick-submenu-label"><i class="fas fa-vector-square"></i> Parcelles</span>
                <button
                  class="btn btn-sm btn-outline-dark"
                  :disabled="featureLoading.parcels"
                  @click="loadNonSelectedByGroupId('parcels'); closeQuickMenus()"
                >
                  <i class="fas fa-download"></i> Charger non sélectionnés
                </button>
                <button
                  class="btn btn-sm btn-outline-danger"
                  :disabled="getGroupLoadedFeatures('parcels').length === 0"
                  @click="unloadNonSelectedByGroupId('parcels'); closeQuickMenus()"
                >
                  <i class="far fa-trash-alt"></i> Décharger non sélectionnés
                </button>
              </div>

              <div v-if="toolbarMenus.buildings" class="quick-submenu mt-2">
                <span class="quick-submenu-label"><i class="fas fa-building"></i> Bâtiments</span>
                <button
                  class="btn btn-sm btn-outline-dark"
                  :disabled="featureLoading.buildings"
                  @click="loadNonSelectedByGroupId('buildings'); closeQuickMenus()"
                >
                  <i class="fas fa-download"></i> Charger non sélectionnés
                </button>
                <button
                  class="btn btn-sm btn-outline-danger"
                  :disabled="getGroupLoadedFeatures('buildings').length === 0"
                  @click="unloadNonSelectedByGroupId('buildings'); closeQuickMenus()"
                >
                  <i class="far fa-trash-alt"></i> Décharger non sélectionnés
                </button>
              </div>

              <div v-if="toolbarMenus.userGroups" class="quick-submenu mt-2">
                <span class="quick-submenu-label"><i class="fas fa-draw-polygon"></i> Groupes utilisateur</span>
                <button class="btn btn-sm btn-outline-dark" @click="createUserGroupFromPrompt">
                  <i class="fas fa-plus"></i> Créer nouveau
                </button>
                <button class="btn btn-sm btn-outline-danger" @click="deleteAllUserGroups">
                  <i class="fas fa-trash"></i> Supprimer tout
                </button>
              </div>
            </article>

            <article v-show="panelSections.projects" class="group-card mb-3">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <strong>Projets (navigateur)</strong>
                <span class="badge bg-dark">{{ projects.length }}</span>
              </div>

              <div class="input-group input-group-sm mb-2">
                <input
                  class="form-control"
                  type="text"
                  placeholder="Nom du nouveau projet"
                  v-model="projectDraftName"
                  @keyup.enter="saveProjectFromDraft"
                />
                <button class="btn btn-outline-dark" type="button" @click="saveProjectFromDraft">Sauver nouveau</button>
              </div>

              <div class="d-grid mb-2">
                <button class="btn btn-dark btn-sm" @click="saveCurrentProject">Mettre à jour le projet actif</button>
              </div>

              <label class="form-label mb-1">Projets enregistrés</label>
              <select class="form-select form-select-sm" v-model="selectedProjectId">
                <option value="">Choisir...</option>
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }} - {{ formatProjectDate(project.updatedAt) }}
                </option>
              </select>

              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-outline-dark btn-sm flex-grow-1" :disabled="!selectedProjectId" @click="loadSelectedProject">
                  Charger
                </button>
                <button class="btn btn-outline-danger btn-sm flex-grow-1" :disabled="!selectedProjectId" @click="deleteSelectedProject">
                  Supprimer
                </button>
              </div>

              <p class="small text-muted mt-2 mb-0">
                <span v-if="activeProjectId">Projet actif: {{ activeProjectName }}</span>
                <span v-else>Aucun projet actif.</span>
              </p>
            </article>

            <article v-show="panelSections.export" class="group-card mb-3">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <strong>Export vectoriel</strong>
                <span class="badge bg-dark">{{ exportableCount }}</span>
              </div>

              <label class="form-label mb-1">Mode</label>
              <select class="form-select form-select-sm mb-2" v-model="exportOptions.mode">
                <option value="selected">Selection uniquement</option>
                <option value="loaded">Tout chargé (sélectionné + non sélectionné)</option>
              </select>

              <div class="form-check form-switch mb-2">
                <input id="export-legend" class="form-check-input" type="checkbox" v-model="exportOptions.includeLegend">
                <label class="form-check-label" for="export-legend">Inclure la legende dans le SVG</label>
              </div>

              <label class="form-label mb-1">Barre d'echelle</label>
              <select class="form-select form-select-sm mb-3" v-model="exportOptions.scaleBarMeters">
                <option value="auto">Auto (1/10 largeur)</option>
                <option value="100">100 m</option>
                <option value="200">200 m</option>
                <option value="500">500 m</option>
                <option value="1000">1000 m</option>
              </select>

              <div class="d-grid gap-2">
                <button class="btn btn-dark btn-sm" :disabled="exportBusy || exportableCount === 0" @click="exportSvg">
                  <i class="far fa-file-code"></i> Export SVG
                </button>
                <button class="btn btn-outline-dark btn-sm" :disabled="exportBusy || exportableCount === 0" @click="exportMetadataJson">
                  <i class="far fa-file-alt"></i> Sidecar JSON
                </button>
                <button class="btn btn-outline-dark btn-sm" :disabled="exportBusy || exportableCount === 0" @click="exportMetadataCsv">
                  <i class="far fa-file-excel"></i> Sidecar CSV
                </button>
              </div>
            </article>

            <article v-show="panelSections.autoload" class="group-card mb-3">
              <strong>Chargement automatique pendant le déplacement</strong>
              <p class="small text-muted mb-2">Ces options s’appliquent lorsque la carte bouge et que le zoom est suffisant.</p>
              <div class="d-flex align-items-center justify-content-between mb-2">
                <label class="form-check-label" for="autoload-parcels">Autoload parcelles</label>
                <div class="form-check form-switch m-0">
                  <input
                    id="autoload-parcels"
                    class="form-check-input"
                    type="checkbox"
                    :checked="store.autoload.parcels"
                    @change="setAutoloadOption('parcels', $event.target.checked)"
                  >
                </div>
              </div>
              <div class="d-flex align-items-center justify-content-between">
                <label class="form-check-label" for="autoload-buildings">Autoload bâtiments</label>
                <div class="form-check form-switch m-0">
                  <input
                    id="autoload-buildings"
                    class="form-check-input"
                    type="checkbox"
                    :checked="store.autoload.buildings"
                    @change="setAutoloadOption('buildings', $event.target.checked)"
                  >
                </div>
              </div>
            </article>

            <div class="tree-root">
              <article v-for="group in allGroupDefs" :key="group.id" class="tree-group">
                <div class="tree-group-header">
                  <div class="tree-group-title">
                    <i :class="group.icon"></i>
                    <strong>{{ group.name }}</strong>
                    <span class="badge bg-dark">{{ getGroupFeatureCount(group.id) }}</span>
                  </div>
                  <div class="tree-group-controls">
                    <button class="btn btn-sm btn-outline-dark" :title="isGroupVisible(group.id) ? 'Masquer' : 'Afficher'" @click="toggleGroupVisibility(group.id)">
                      <i class="far" :class="isGroupVisible(group.id) ? 'fa-eye-slash' : 'fa-eye'"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-dark" :disabled="!group.loadKind || isGroupLoading(group.id)" title="Charger visibles" @click="loadGroupById(group.id)">
                      <i class="fas fa-download"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" :disabled="getGroupFeatureCount(group.id) === 0" title="Décharger tout (corbeille 5 min)" @click="unloadGroupToBin(group.id)">
                      <i class="far fa-trash-alt"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-primary" :disabled="getGroupFeatureCount(group.id) < 2" title="Préparer une fusion" @click="openMergeDialog(group)">
                      <i class="fas fa-object-group"></i>
                    </button>
                    <button v-if="isUserGroup(group.id)" class="btn btn-sm btn-outline-dark" title="Renommer le groupe" @click="renameUserGroup(group.id)">
                      <i class="far fa-edit"></i>
                    </button>
                    <button v-if="isUserGroup(group.id)" class="btn btn-sm btn-outline-danger" title="Supprimer le groupe" @click="deleteUserGroup(group.id)">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                </div>

                <div v-if="group.id === 'buildings'" class="mt-2">
                  <label class="form-label">Visualisation bâtiments</label>
                  <select class="form-select form-select-sm" :value="store.buildingVisualMode" @change="setBuildingVisualMode($event.target.value)">
                    <option v-for="option in buildingVisualOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                  <div class="legend-box mt-2">
                    <div class="fw-bold mb-1">{{ buildingLegendHint }}</div>
                    <a
                      v-for="item in store.buildingLegendItems.slice(0, 16)"
                      :key="item.key"
                      href="#"
                      class="legend-item"
                      :class="{ active: item.key === store.buildingVisualFilterKey }"
                      @click.prevent="toggleBuildingLegendFilter(item.key)"
                    >
                      <span class="legend-swatch" :style="{ background: item.color }"></span>
                      {{ item.label }} <span class="text-muted">({{ item.count }})</span>
                    </a>
                  </div>
                </div>

                <details class="tree-branch">
                  <summary>Sélectionnés ({{ getGroupSelectedFeatures(group.id).length }})</summary>
                  <div v-if="!getGroupSelectedFeatures(group.id).length" class="tree-empty">Aucune entité sélectionnée</div>
                  <article
                    v-for="feature in getGroupSelectedFeatures(group.id)"
                    :key="feature.id"
                    class="tree-feature"
                    @mouseenter="onFeatureHover(feature.id)"
                    @mouseleave="onFeatureLeave(feature.id)"
                  >
                    <label class="tree-feature-main">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        :checked="feature.selected"
                        @change="setSelection(feature.id, $event.target.checked)"
                      />
                      <span class="tree-feature-text">
                        <span class="tree-feature-title">{{ getFeatureTitle(feature) }}</span>
                        <span class="tree-feature-subtitle">{{ getFeatureSubtitle(feature) }}</span>
                      </span>
                    </label>
                    <div class="tree-feature-actions">
                      <select
                        class="form-select form-select-sm tree-transfer-select"
                        :disabled="getTransferTargets(group.id).length === 0"
                        @change="transferFeature(feature.id, $event.target.value); $event.target.value=''"
                      >
                        <option value="">Déplacer…</option>
                        <option v-for="target in getTransferTargets(group.id)" :key="target.id" :value="target.id">{{ target.name }}</option>
                      </select>
                      <button v-if="isUserGroup(group.id)" class="btn btn-sm btn-outline-secondary" title="Sortir vers groupe d'origine" @click="removeFromUserGroup(feature.id)">
                        <i class="fas fa-share"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-dark" title="Localiser" @click="focusFeature(feature.id)">
                        <i class="far fa-compass"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-danger" title="Décharger vers corbeille" @click="unloadFeature(feature.id)">
                        <i class="far fa-trash-alt"></i>
                      </button>
                    </div>
                  </article>
                </details>

                <details class="tree-branch">
                  <summary>Non sélectionnés ({{ getGroupLoadedFeatures(group.id).length }})</summary>
                  <div v-if="!getGroupLoadedFeatures(group.id).length" class="tree-empty">Aucune entité non sélectionnée</div>
                  <article
                    v-for="feature in getGroupLoadedFeatures(group.id)"
                    :key="feature.id"
                    class="tree-feature"
                    @mouseenter="onFeatureHover(feature.id)"
                    @mouseleave="onFeatureLeave(feature.id)"
                  >
                    <label class="tree-feature-main">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        :checked="feature.selected"
                        @change="setSelection(feature.id, $event.target.checked)"
                      />
                      <span class="tree-feature-text">
                        <span class="tree-feature-title">{{ getFeatureTitle(feature) }}</span>
                        <span class="tree-feature-subtitle">{{ getFeatureSubtitle(feature) }}</span>
                      </span>
                    </label>
                    <div class="tree-feature-actions">
                      <select
                        class="form-select form-select-sm tree-transfer-select"
                        :disabled="getTransferTargets(group.id).length === 0"
                        @change="transferFeature(feature.id, $event.target.value); $event.target.value=''"
                      >
                        <option value="">Déplacer…</option>
                        <option v-for="target in getTransferTargets(group.id)" :key="target.id" :value="target.id">{{ target.name }}</option>
                      </select>
                      <button v-if="isUserGroup(group.id)" class="btn btn-sm btn-outline-secondary" title="Sortir vers groupe d'origine" @click="removeFromUserGroup(feature.id)">
                        <i class="fas fa-share"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-dark" title="Localiser" @click="focusFeature(feature.id)">
                        <i class="far fa-compass"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-danger" title="Décharger vers corbeille" @click="unloadFeature(feature.id)">
                        <i class="far fa-trash-alt"></i>
                      </button>
                    </div>
                  </article>
                </details>
              </article>

              <article class="tree-group mt-3">
                <details class="tree-branch" :open="binItems.length > 0">
                  <summary>Corbeille temporaire ({{ binItems.length }})</summary>
                  <div v-if="!binItems.length" class="tree-empty">Vide. Les éléments supprimés manuellement restent 5 minutes.</div>
                  <article v-for="item in binItems" :key="item.id" class="bin-item">
                    <div class="bin-item-main">
                      <strong>{{ item.id }}</strong>
                      <span class="text-muted">expire dans {{ formatBinRemaining(item.expiresAt) }}</span>
                    </div>
                    <div class="tree-feature-actions">
                      <button class="btn btn-sm btn-outline-dark" title="Restaurer depuis API" @click="restoreBinItem(item.id)">
                        <i class="fas fa-undo"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-danger" title="Supprimer de la corbeille" @click="purgeBinItem(item.id)">
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                  </article>
                </details>
              </article>
            </div>

            <p class="small text-muted mt-2">Surface sélectionnée : {{ store.selectedArea }} m2</p>
          </section>
        </div>
      </aside>

      <div v-if="mergeDialogVisible" class="map-overlay map-overlay-soft">
        <div class="merge-dialog-card">
          <h2>Fusionner des formes</h2>
          <p class="small text-muted mb-3">
            Source: <strong>{{ mergeDraft.sourceGroupName }}</strong>. La fusion crée une ou plusieurs formes dans le groupe utilisateur cible.
          </p>

          <label class="form-label">Périmètre source</label>
          <select class="form-select form-select-sm mb-2" v-model="mergeDraft.sourceScope">
            <option v-for="scope in mergeScopeOptions" :key="scope.value" :value="scope.value">{{ scope.label }}</option>
          </select>
          <p class="small text-muted mb-3">
            Formes candidates: {{ getMergeCandidateCount(mergeDraft.sourceGroupId, mergeDraft.sourceScope) }}
          </p>

          <div class="form-check form-switch mb-2">
            <input id="merge-create-target-group" class="form-check-input" type="checkbox" v-model="mergeDraft.createNewTargetGroup">
            <label class="form-check-label" for="merge-create-target-group">Créer un nouveau groupe cible</label>
          </div>

          <div v-if="mergeDraft.createNewTargetGroup" class="mb-3">
            <label class="form-label">Nom du nouveau groupe</label>
            <input class="form-control form-control-sm" v-model="mergeDraft.newTargetGroupName" placeholder="Ex: Fusion quartier nord" />
          </div>

          <div v-else class="mb-3">
            <label class="form-label">Groupe utilisateur cible</label>
            <select class="form-select form-select-sm" v-model="mergeDraft.targetGroupId">
              <option value="">Choisir...</option>
              <option v-for="target in userGroupOptions" :key="target.id" :value="target.id">{{ target.name }}</option>
            </select>
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-dark btn-sm flex-grow-1" @click="submitMergeIntent">Fusionner</button>
            <button class="btn btn-outline-dark btn-sm flex-grow-1" @click="closeMergeDialog">Annuler</button>
          </div>
        </div>
      </div>

      <div v-if="autoloadPromptVisible" class="map-overlay map-overlay-soft">
        <div class="autoload-prompt-card">
          <h2>Chargement automatique</h2>
          <p class="small text-muted mb-3">Choisissez ce qui doit se charger automatiquement pendant vos déplacements sur la carte.</p>

          <div class="d-flex align-items-center justify-content-between mb-2">
            <label class="form-check-label" for="prompt-autoload-parcels">Autoload parcelles</label>
            <div class="form-check form-switch m-0">
              <input
                id="prompt-autoload-parcels"
                class="form-check-input"
                type="checkbox"
                v-model="autoloadPromptDraft.parcels"
              >
            </div>
          </div>

          <div class="d-flex align-items-center justify-content-between mb-3">
            <label class="form-check-label" for="prompt-autoload-buildings">Autoload bâtiments</label>
            <div class="form-check form-switch m-0">
              <input
                id="prompt-autoload-buildings"
                class="form-check-input"
                type="checkbox"
                v-model="autoloadPromptDraft.buildings"
              >
            </div>
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-dark btn-sm flex-grow-1" @click="saveAutoloadPrompt">Appliquer</button>
            <button class="btn btn-outline-dark btn-sm flex-grow-1" @click="dismissAutoloadPrompt">Plus tard</button>
          </div>
        </div>
      </div>
    </div>
  `
})
  .use(pinia)
  .mount('#map-app')
