import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { C } from '../theme/tokens'
import { body, mono } from '../theme/type'
import type { SceneDesign } from '../lib/print'
import { DEFAULT_MODEL_URL, SITE_ORIGIN, buildSceneHtml } from '../lib/scene-html'
import { T } from './ui'
import { useT } from '../i18n'

// Real 3D preview, rendered by the same three.js pipeline the website uses.
//
// The web configurator paints the print onto a canvas and feeds it to the GLB
// as a texture. Rebuilding that natively would mean a second implementation of
// the print pipeline — and any drift between the two would show up as a
// mis-printed garment, not just a wrong preview. So the app hosts a port of
// the identical code in a WebView (see lib/scene-html.ts) and streams the
// design into it.
//
// The page loads once per model. Colour, layers and the front/back flip are
// pushed with injectJavaScript, so nothing is re-downloaded on a keystroke.

export type Model3DProps = {
  /** `glb_url` from the product API. Falls back to the web's default garment. */
  glbUrl: string | null
  design: SceneDesign
  view: 'front' | 'back'
  /** Reported once the mesh is on screen; `printable` is false for garments
   *  whose mesh has no Body_Front/Body_Back nodes (the design cannot be shown). */
  onReady?: (info: { printable: boolean }) => void
}

type Status = 'loading' | 'ready' | 'error'

export function Model3D({ glbUrl, design, view, onReady }: Model3DProps) {
  const [status, setStatus] = useState<Status>('loading')
  const t = useT()
  const [pct, setPct] = useState(0)
  const [printable, setPrintable] = useState(true)
  const webRef = useRef<WebView>(null)
  const readyRef = useRef(false)
  const initialView = useRef(view)

  const modelUrl = glbUrl ?? DEFAULT_MODEL_URL

  // Only the model and the initial view are baked into the page.
  const html = useMemo(
    () =>
      buildSceneHtml({
        glbUrl: modelUrl,
        background: C.paper,
        view: initialView.current,
        autoRotate: true,
      }),
    [modelUrl],
  )

  const send = (js: string) => {
    if (!readyRef.current) return
    webRef.current?.injectJavaScript(`${js}; true;`)
  }

  // Push the design whenever it changes (and once, right after `ready`).
  const designJson = JSON.stringify(design)
  useEffect(() => {
    send(`window.__loom && window.__loom.update(${designJson})`)
  }, [designJson, status])

  useEffect(() => {
    send(`window.__loom && window.__loom.setView(${JSON.stringify(view)})`)
  }, [view])

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        // The base URL gives the document loomdesign.uz as its origin, so the
        // vendored three.js loads from our own edge and the model/artwork
        // fetches carry an Origin the API allows.
        source={{ html, baseUrl: SITE_ORIGIN }}
        style={styles.web}
        containerStyle={{ backgroundColor: C.paper }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        onMessage={(e) => {
          let msg: { type: string; pct?: number; printable?: boolean; message?: string }
          try {
            msg = JSON.parse(e.nativeEvent.data)
          } catch {
            return // not our protocol
          }
          if (msg.type === 'progress' && typeof msg.pct === 'number') setPct(msg.pct)
          if (msg.type === 'ready') {
            readyRef.current = true
            setStatus('ready')
            setPrintable(msg.printable !== false)
            onReady?.({ printable: msg.printable !== false })
            // The page had no design when it booted — hand it the current one.
            webRef.current?.injectJavaScript(`window.__loom.update(${designJson}); true;`)
          }
          if (msg.type === 'error') {
            setStatus('error')
            if (__DEV__) console.warn('[Model3D]', msg.message)
          }
        }}
        onError={() => setStatus('error')}
      />

      {status === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.coral} />
          <T style={[mono(9.5, 1.4, { ls: 0.16, upper: true, color: C.i38 }), { marginTop: 10 }]}>
            {pct > 0 && pct < 100 ? t('st.loading3dPct', { pct }) : t('st.loading3d')}
          </T>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.overlay} pointerEvents="none">
          <T style={body(12.5, 1.6, { color: C.i55, align: 'center' })}>
            {t('st.err3d')}
          </T>
        </View>
      ) : null}

      {status === 'ready' && !printable ? (
        <View style={styles.note} pointerEvents="none">
          <T style={mono(8.5, 1.3, { ls: 0.14, upper: true, color: C.i55 })}>
            {t('st.noPrint3d')}
          </T>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: C.paper,
  },
  note: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: 'rgba(244,242,237,.92)',
    borderWidth: 1,
    borderColor: C.line,
  },
})
