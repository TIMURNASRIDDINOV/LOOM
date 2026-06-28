'use strict'
;(function () {
  // Default center: Tashkent
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
    map = L.map('map-el', { zoomControl: true }).setView([lat, lng], DEFAULT_ZOOM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', async (e) => {
      const { lat, lng } = e.latlng
      placeMarker(lat, lng)
      await resolveAddress(lat, lng)
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
    const selectedEl = document.getElementById('map-picker-selected')
    const confirmBtn = document.getElementById('map-confirm-btn')
    selectedEl.textContent = 'Определение адреса…'
    confirmBtn.disabled = true

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`
      const res = await fetch(url)
      const data = await res.json()
      pendingAddr = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      selectedEl.textContent = pendingAddr
      confirmBtn.disabled = false
    } catch {
      pendingAddr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      selectedEl.textContent = pendingAddr
      confirmBtn.disabled = false
    } finally {
      geocoding = false
    }
  }

  function openModal(currentLat, currentLng) {
    const modal = document.getElementById('map-picker-modal')
    modal.classList.add('open')
    document.body.style.overflow = 'hidden'

    const lat = currentLat || DEFAULT_LAT
    const lng = currentLng || DEFAULT_LNG

    // Leaflet needs the container to be visible before init
    setTimeout(() => {
      initMap(lat, lng)
      map.invalidateSize()
      if (currentLat && currentLng) {
        placeMarker(currentLat, currentLng)
        // Pre-fill selected label if we already have an address
        const addrEl = document.getElementById('loc-address')
        if (addrEl && addrEl.value) {
          pendingAddr = addrEl.value
          document.getElementById('map-picker-selected').textContent = pendingAddr
          document.getElementById('map-confirm-btn').disabled = false
        }
      } else {
        document.getElementById('map-picker-selected').textContent = ''
        document.getElementById('map-confirm-btn').disabled = true
      }
    }, 50)
  }

  function closeModal() {
    const modal = document.getElementById('map-picker-modal')
    modal.classList.remove('open')
    document.body.style.overflow = ''
    pendingLat = null
    pendingLng = null
    pendingAddr = null
  }

  function confirmSelection() {
    if (!pendingLat || !pendingLng) return

    // Write back into the account form fields
    const addrInput = document.getElementById('loc-address')
    const latInput = document.getElementById('loc-lat')
    const lngInput = document.getElementById('loc-lng')
    if (addrInput) addrInput.value = pendingAddr || ''
    if (latInput)  latInput.value = pendingLat
    if (lngInput)  lngInput.value = pendingLng

    // Trigger the geocode-result display via account.js helper if available
    if (window._mapPickerCallback) {
      window._mapPickerCallback(pendingAddr, pendingLat, pendingLng)
    }

    closeModal()
  }

  document.addEventListener('DOMContentLoaded', () => {
    const openBtn    = document.getElementById('open-map-btn')
    const cancelBtn  = document.getElementById('map-cancel-btn')
    const confirmBtn = document.getElementById('map-confirm-btn')

    if (!openBtn) return

    openBtn.addEventListener('click', () => {
      const lat = parseFloat(document.getElementById('loc-lat')?.value) || null
      const lng = parseFloat(document.getElementById('loc-lng')?.value) || null
      openModal(lat, lng)
    })

    cancelBtn.addEventListener('click', closeModal)
    confirmBtn.addEventListener('click', confirmSelection)

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('map-picker-modal').classList.contains('open')) {
        closeModal()
      }
    })
  })
})()
