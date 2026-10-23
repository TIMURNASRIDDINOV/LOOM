import React, { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useIsFocused } from 'expo-router'

import { C } from '../theme/tokens'
import { parsePageMessage } from '../lib/scene3d'
import { DEFAULT_MODEL_URL, buildSceneHtml } from '../lib/scene-html'
import type { Model3DProps } from './Model3D'
import { Scene3DChrome, useScene3D } from './Scene3DChrome'

// Web build of the 3D preview: react-native-webview has no browser
// implementation, so the same scene page runs in an <iframe> and talks over
// postMessage. Used by `expo start --web` demos and for checking the scene
// without a device. State, watchdog, error view and diagnostics are the same
// code as the native host (Scene3DChrome, lib/scene3d).

export function Model3D({ glbUrl, printArea, fabric, design, view, paused, inScroll, photo, onReady }: Model3DProps) {
  const focused = useIsFocused()
  const [scene, dispatch] = useScene3D(focused)
  const frame = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const initialView = useRef(view)

  const modelUrl = glbUrl ?? DEFAULT_MODEL_URL
  const html = useMemo(
    () => buildSceneHtml({ glbUrl: modelUrl, background: C.paper, view: initialView.current, autoRotate: true, printArea, fabric, inScroll }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelUrl, fabric, inScroll],
  )

  const designJson = JSON.stringify(design)
  const post = (m: unknown) => {
    if (!readyRef.current) return
    frame.current?.contentWindow?.postMessage(JSON.stringify(m), '*')
  }
  useEffect(() => post({ type: 'update', design }), [designJson, scene.status])
  useEffect(() => post({ type: 'view', view }), [view])
  useEffect(() => post({ type: paused ? 'pause' : 'resume' }), [paused])
  useEffect(() => {
    if (!focused) readyRef.current = false
  }, [focused])

  // The listener outlives frame remounts (Retry, refocus); it reads the latest closure through a ref.
  const latest = useRef({ designJson, paused, onReady })
  latest.current = { designJson, paused, onReady }
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const msg = parsePageMessage(e.data)
      if (!msg) return
      dispatch({ type: 'page', msg })
      if (msg.type === 'ready') {
        readyRef.current = true
        const printable = (msg as { printable?: boolean }).printable !== false
        latest.current.onReady?.({ printable })
        const w = frame.current?.contentWindow
        w?.postMessage(JSON.stringify({ type: 'update', design: JSON.parse(latest.current.designJson) }), '*')
        if (latest.current.paused) w?.postMessage(JSON.stringify({ type: 'pause' }), '*')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [dispatch])

  return (
    <View style={styles.wrap}>
      {focused && scene.status !== 'error' ? (
        <iframe
          key={scene.attempt}
          ref={frame}
          srcDoc={html}
          title="3D preview"
          style={{ border: 0, width: '100%', height: '100%', background: C.paper, display: 'block' }}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : null}
      <Scene3DChrome
        s={scene}
        photo={photo}
        onRetry={() => {
          readyRef.current = false
          dispatch({ type: 'retry' })
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', overflow: 'hidden' },
})
