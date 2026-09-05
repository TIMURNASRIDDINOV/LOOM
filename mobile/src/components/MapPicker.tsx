import React, { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { C, RULE } from '../theme/tokens'
import { mono } from '../theme/type'
import { buildMapHtml, type Pin } from './map-html'
import { T } from './ui'
import { useT } from '../i18n'

// Delivery pin, using the same Leaflet + OpenStreetMap stack as the website's
// address picker (assets/address-picker.js). The page itself lives in
// map-html.ts and is shared with the web build's <iframe> version.

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

  // Only the first pin seeds the map — later updates come from inside it, and
  // re-keying on every drag would reload the tiles mid-gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml(value), [])

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        source={{ html }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data) as {
              type: string
              lat?: number
              lng?: number
              address?: string
            }
            if (m.type === 'ready') setReady(true)
            if (m.type === 'pin' && typeof m.lat === 'number' && typeof m.lng === 'number') {
              onChange({ lat: m.lat, lng: m.lng, address: m.address })
            }
          } catch {
            // Not our protocol — ignore.
          }
        }}
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
  wrap: {
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: '#ebe8e1',
    overflow: 'hidden',
    marginBottom: 10,
  },
  web: { flex: 1, backgroundColor: '#ebe8e1' },
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
