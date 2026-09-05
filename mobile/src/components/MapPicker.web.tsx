import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { C, RULE } from '../theme/tokens'
import { mono } from '../theme/type'
import { buildMapHtml, type Pin } from './map-html'
import { T } from './ui'
import { useT } from '../i18n'

// Web build of the delivery-pin picker: the Leaflet page runs in an <iframe>
// (react-native-webview has no browser implementation).

export type { Pin }

export function MapPicker({
  value,
  onChange,
  height = 200,
}: {
  value: Pin | null
  onChange: (pin: Pin) => void
  height?: number
}) {
  const [ready, setReady] = useState(false)
  const t = useT()
  const frame = useRef<HTMLIFrameElement>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml(value), [])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      let m: { type: string; lat?: number; lng?: number; address?: string }
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m.type === 'ready') setReady(true)
      if (m.type === 'pin' && typeof m.lat === 'number' && typeof m.lng === 'number') {
        onChange({ lat: m.lat, lng: m.lng, address: m.address })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onChange])

  return (
    <View style={[styles.wrap, { height }]}>
      <iframe
        ref={frame}
        srcDoc={html}
        title="Delivery map"
        style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        sandbox="allow-scripts allow-same-origin"
      />
      {!ready ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.coral} size="small" />
        </View>
      ) : null}
      <View style={styles.hint} pointerEvents="none">
        <T style={mono(8.5, 1.3, { ls: 0.12, upper: true, color: C.i55 })}>
          {t('map.hint')}
        </T>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderWidth: RULE, borderColor: C.ink, backgroundColor: '#ebe8e1', overflow: 'hidden', marginBottom: 10 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ebe8e1',
  },
  hint: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: 'rgba(244,242,237,.92)',
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: C.line,
  },
})
