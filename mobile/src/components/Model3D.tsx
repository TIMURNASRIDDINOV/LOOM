import React, { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View, type ImageSourcePropType } from 'react-native'
import { useIsFocused } from 'expo-router'
import { WebView } from 'react-native-webview'

import { C } from '../theme/tokens'
import type { SceneDesign } from '../lib/print'
import type { PrintArea } from '../api/types'
import { parsePageMessage } from '../lib/scene3d'
import { DEFAULT_MODEL_URL, SITE_ORIGIN, buildSceneHtml, type FabricKey } from '../lib/scene-html'
import { Scene3DChrome, useScene3D } from './Scene3DChrome'

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
//
// Failure handling (LOOM-262): the page reports its own failures; the host adds
// a 20 s watchdog, HTTP errors and a lost render process. Every one of them ends
// in the same state (picture, message, Retry) and is written to the diagnostics
// the long-press overlay shows. The WebView is unmounted when the screen loses
// focus, and the page's render loop is paused while the layer is hidden.

export type Model3DProps = {
  /** `glb_url` from the product API. Falls back to the web's default garment. */
  glbUrl: string | null
  /** The product's print area (config.print_area); baked into the page. */
  printArea?: PrintArea
  /** Cloth preset (sheen, weave scale) — `fabricForProduct(product)`; jersey when absent. */
  fabric?: FabricKey
  design: SceneDesign
  view: 'front' | 'back'
  /** The layer is hidden behind another view: the page stops drawing frames. */
  paused?: boolean
  /** The stage sits inside a vertical scroller: a vertical swipe scrolls it, only a horizontal drag rotates. */
  inScroll?: boolean
  /** Shown in the error state, instead of an empty box. */
  photo?: ImageSourcePropType
  /** Reported once the mesh is on screen; `printable` is false for garments
   *  whose mesh has no Body_Front/Body_Back nodes (the design cannot be shown). */
  onReady?: (info: { printable: boolean }) => void
}

/** chrome://inspect works for dev builds and the EAS preview profile (eas.json), never for production. */
const WEBVIEW_DEBUGGING = __DEV__ || process.env.EXPO_PUBLIC_BUILD_PROFILE === 'preview'

export function Model3D({ glbUrl, printArea, fabric, design, view, paused, inScroll, photo, onReady }: Model3DProps) {
  const focused = useIsFocused()
  const [scene, dispatch] = useScene3D(focused)
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
        printArea,
        fabric,
        inScroll,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelUrl, fabric, inScroll],
  )

  const send = (js: string) => {
    if (!readyRef.current) return
    webRef.current?.injectJavaScript(`${js}; true;`)
  }

  // Push the design whenever it changes (and once, right after `ready`).
  const designJson = JSON.stringify(design)
  useEffect(() => {
    send(`window.__loom && window.__loom.update(${designJson})`)
  }, [designJson, scene.status])

  useEffect(() => {
    send(`window.__loom && window.__loom.setView(${JSON.stringify(view)})`)
  }, [view])

  useEffect(() => {
    send(`window.__loom && window.__loom.${paused ? 'pause' : 'resume'}()`)
  }, [paused])

  const fail = (reason: string, kind: 'load' | 'unavailable' = 'load') => {
    readyRef.current = false
    dispatch({ type: 'fail', reason, kind })
  }
  const retry = () => {
    readyRef.current = false
    dispatch({ type: 'retry' })
  }
  // The WebView is gone while the screen is unfocused: nothing to talk to.
  useEffect(() => {
    if (!focused) readyRef.current = false
  }, [focused])

  return (
    <View style={styles.wrap}>
      {focused && scene.status !== 'error' ? (
        <WebView
          key={scene.attempt}
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
          nestedScrollEnabled={!!inScroll}
          setSupportMultipleWindows={false}
          mixedContentMode="always"
          webviewDebuggingEnabled={WEBVIEW_DEBUGGING}
          onMessage={(e) => {
            const msg = parsePageMessage(e.nativeEvent.data)
            if (!msg) return // not our protocol
            dispatch({ type: 'page', msg })
            if (msg.type === 'ready') {
              readyRef.current = true
              const printable = (msg as { printable?: boolean }).printable !== false
              onReady?.({ printable })
              // The page had no design when it booted — hand it the current one, and
              // the pause it missed if the layer was hidden while it loaded.
              webRef.current?.injectJavaScript(`window.__loom.update(${designJson}); ${paused ? 'window.__loom.pause();' : ''} true;`)
            }
            if (msg.type === 'error' && __DEV__) console.warn('[Model3D]', (msg as { message?: string }).message)
          }}
          onError={(e) => fail(`load: ${e.nativeEvent.description || 'error'}`)}
          // A 4xx/5xx for the page itself. (On Android the page's own GLB and script
          // requests are reported by the page; see scene-html.ts.)
          onHttpError={(e) => fail(`HTTP ${e.nativeEvent.statusCode} ${e.nativeEvent.url}`)}
          // The renderer process died (killed for memory, or crashed). Android reports it
          // here, iOS as "content process terminated". Without a handler the view stays blank.
          onRenderProcessGone={(e) => fail(e.nativeEvent.didCrash ? 'render process crashed' : 'render process killed (low memory)', 'unavailable')}
          onContentProcessDidTerminate={() => fail('content process terminated', 'unavailable')}
        />
      ) : null}

      <Scene3DChrome s={scene} photo={photo} onRetry={retry} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: 'transparent' },
})
