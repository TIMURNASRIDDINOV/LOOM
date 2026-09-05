import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { C } from '../theme/tokens'
import { body, mono } from '../theme/type'
import { DEFAULT_MODEL_URL, buildSceneHtml } from '../lib/scene-html'
import type { Model3DProps } from './Model3D'
import { T } from './ui'

// Web build of the 3D preview: react-native-webview has no browser
// implementation, so the same scene page runs in an <iframe> and talks over
// postMessage. Used by `expo start --web` demos and for checking the scene
// without a device.

export function Model3D({ glbUrl, design, view, onReady }: Model3DProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pct, setPct] = useState(0)
  const [printable, setPrintable] = useState(true)
  const frame = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const initialView = useRef(view)

  const modelUrl = glbUrl ?? DEFAULT_MODEL_URL
  const html = useMemo(
    () => buildSceneHtml({ glbUrl: modelUrl, background: C.paper, view: initialView.current, autoRotate: true }),
    [modelUrl],
  )

  const designJson = JSON.stringify(design)
  const post = (m: unknown) => {
    if (!readyRef.current) return
    frame.current?.contentWindow?.postMessage(JSON.stringify(m), '*')
  }
  useEffect(() => post({ type: 'update', design }), [designJson, status])
  useEffect(() => post({ type: 'view', view }), [view])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      let msg: { type: string; pct?: number; printable?: boolean }
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'progress' && typeof msg.pct === 'number') setPct(msg.pct)
      if (msg.type === 'ready') {
        readyRef.current = true
        setStatus('ready')
        setPrintable(msg.printable !== false)
        onReady?.({ printable: msg.printable !== false })
        frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'update', design }), '*')
      }
      if (msg.type === 'error') setStatus('error')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={styles.wrap}>
      <iframe
        ref={frame}
        srcDoc={html}
        title="3D preview"
        style={{ border: 0, width: '100%', height: '100%', background: C.paper, display: 'block' }}
        sandbox="allow-scripts allow-same-origin"
      />
      {status === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.coral} />
          <T style={[mono(9.5, 1.4, { ls: 0.16, upper: true, color: C.i38 }), { marginTop: 10 }]}>
            {pct > 0 && pct < 100 ? `Загружаем 3D · ${pct}%` : 'Загружаем 3D'}
          </T>
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={styles.overlay} pointerEvents="none">
          <T style={body(12.5, 1.6, { color: C.i55, align: 'center' })}>3D недоступно. Проверьте соединение.</T>
        </View>
      ) : null}
      {status === 'ready' && !printable ? (
        <View style={styles.note} pointerEvents="none">
          <T style={mono(8.5, 1.3, { ls: 0.14, upper: true, color: C.i55 })}>принт на этой 3D-модели скоро</T>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', overflow: 'hidden' },
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
