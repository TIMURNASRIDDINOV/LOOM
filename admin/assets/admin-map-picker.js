'use strict'
;(function () {
  const DEFAULT_LAT = 41.2995
  const DEFAULT_LNG = 69.2401
  const DEFAULT_ZOOM = 13

  let map = null
  let marker = null
  let pendingLat = null
  let pendingLng = null
  let pendingAddr = null
  let geocoding = false

  function initMap(lat, lng) {
    if (map) {
      map.setView([lat, lng], DEFAULT_ZOOM)
      return
    }
    map = L.map('admin-map-el', { zoomControl: true }).setView([lat, lng], DEFAULT_ZOOM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', async (e) => {
      placeMarker(e.latlng.lat, e.latlng.lng)
      await resolveAddress(e.latlng.lat, e.latlng.lng)
    })
  }

  function placeMarker(lat, lng) {
    if (marker) {
      marker.setLatLng([lat, lng])
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      marker.on('dragend', async () => {
        const pos = marker.getLatLng()
        pendingLat = pos.lat
        pendingLng = pos.lng
        await resolveAddress(pos.lat, pos.lng)
      })
    }
    pendingLat = lat
    pendingLng = lng
  }

  async function resolveAddress(lat, lng) {
    if (geocoding) return
    geocoding = true
    const selectedEl = document.getElementById('admin-map-selected')
    const confirmBtn = document.getElementById('admin-map-confirm-btn')
    selectedEl.textContent = 'Определение адреса…'
    confirmBtn.disabled = true

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`
      const res = await fetch(url)
      const data = await res.json()
      pendingAddr = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    } catch {
      pendingAddr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    } finally {
      geocoding = false
      selectedEl.textContent = pendingAddr
      confirmBtn.disabled = false
    }
  }

  function openModal(currentLat, currentLng, currentAddr) {
    const modal = document.getElementById('admin-map-modal')
    modal.classList.add('open')
    document.body.style.overflow = 'hidden'

    const lat = currentLat || DEFAULT_LAT
    const lng = currentLng || DEFAULT_LNG

    setTimeout(() => {
      initMap(lat, lng)
      map.invalidateSize()
      if (currentLat && currentLng) {
        placeMarker(currentLat, currentLng)
        if (currentAddr) {
          pendingAddr = currentAddr
          document.getElementById('admin-map-selected').textContent = currentAddr
          document.getElementById('admin-map-confirm-btn').disabled = false
        }
      } else {
        document.getElementById('admin-map-selected').textContent = ''
        document.getElementById('admin-map-confirm-btn').disabled = true
      }
    }, 50)
  }

  function closeModal() {
    document.getElementById('admin-map-modal').classList.remove('open')
    document.body.style.overflow = ''
    pendingLat = null
    pendingLng = null
    pendingAddr = null
    if (marker) { marker.remove(); marker = null }
  }

  function confirmSelection() {
    if (!pendingLat || !pendingLng) return

    // Write back into the admin location form via the exposed hook
    if (window._adminMapPickerCallback) {
      window._adminMapPickerCallback(pendingAddr, pendingLat, pendingLng)
    }
    closeModal()
  }

  document.addEventListener('DOMContentLoaded', () => {
    const openBtn   = document.getElementById('admin-open-map-btn')
    const cancelBtn = document.getElementById('admin-map-cancel-btn')
    const confirmBtn = document.getElementById('admin-map-confirm-btn')

    if (!openBtn) return

    openBtn.addEventListener('click', () => {
      // Read current values from the admin location state exposed by user-detail.js
      const state = window._adminLocState ? window._adminLocState() : {}
      openModal(state.lat || null, state.lng || null, state.addr || null)
    })

    cancelBtn.addEventListener('click', closeModal)
    confirmBtn.addEventListener('click', confirmSelection)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('admin-map-modal').classList.contains('open')) {
        closeModal()
      }
    })
  })
})()
