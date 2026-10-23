import React, { useEffect, useReducer, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native'

import { C, RULE } from '../theme/tokens'
import { body, disp, mono, monoSemi } from '../theme/type'
import { INITIAL_SCENE, SCENE_WATCHDOG_MS, sceneReducer, type SceneAction, type SceneState } from '../lib/scene3d'
import { T, Tap } from './ui'
import { useT } from '../i18n'

// What the 3D stage shows around the scene page, shared by the native WebView
// host (Model3D.tsx) and the web iframe host (Model3D.web.tsx): the loading
// state, the error state (product picture, message, Retry), the "no print yet"
// note, the "3D · 360°" caption and the diagnostics overlay behind its long press.

/** The scene state machine plus its 20 s watchdog. `active` is false while the screen is unfocused. */
export function useScene3D(active: boolean): [SceneState, (a: SceneAction) => void] {
  const [s, dispatch] = useReducer(sceneReducer, INITIAL_SCENE)
  useEffect(() => {
    if (!active || s.status !== 'loading') return
    const id = setTimeout(
      () => dispatch({ type: 'fail', reason: `timeout: no ready in ${SCENE_WATCHDOG_MS / 1000} s` }),
      SCENE_WATCHDOG_MS,
    )
    return () => clearTimeout(id)
  }, [active, s.status, s.attempt])
  useEffect(() => {
    if (!active) dispatch({ type: 'reset' })
  }, [active])
  return [s, dispatch]
}

export function Scene3DChrome({ s, photo, onRetry }: { s: SceneState; photo?: ImageSourcePropType; onRetry: () => void }) {
  const t = useT()
  const [diagOpen, setDiagOpen] = useState(false)

  return (
    <>
      {s.status === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.coral} />
          <T style={[mono(12, 1.4, { ls: 0.16, upper: true, color: C.i38 }), { marginTop: 10 }]}>
            {s.pct > 0 && s.pct < 100 ? t('st.loading3dPct', { pct: s.pct }) : t('st.loading3d')}
          </T>
        </View>
      ) : null}

      {s.status === 'error' ? (
        <View style={[styles.overlay, styles.errorBox]}>
          {photo ? <Image source={photo} style={styles.photo} resizeMode="contain" /> : null}
          <T style={body(14, 1.4, { color: C.i70, align: 'center' })}>
            {s.kind === 'unavailable' ? t('st.unavail3d') : t('st.err3d')}
          </T>
          <Tap style={styles.retry} onPress={onRetry} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <T style={disp(13, 1.2, { ls: 0.1, upper: true })}>{t('common.retry')}</T>
          </Tap>
        </View>
      ) : null}

      {s.status === 'ready' && !s.printable ? (
        <View style={styles.note} pointerEvents="none">
          <T style={mono(12, 1.3, { ls: 0.14, upper: true, color: C.i55 })}>{t('st.noPrint3d')}</T>
        </View>
      ) : null}

      {/* A long press (800 ms) opens the diagnostics; a short tap does nothing. */}
      <Pressable style={styles.caption} hitSlop={12} delayLongPress={800} onLongPress={() => setDiagOpen(true)}>
        <T style={mono(12, 16 / 12, { ls: 0.14, upper: true, color: C.i70 })}>3D · 360°</T>
      </Pressable>

      {diagOpen ? <DiagOverlay s={s} onClose={() => setDiagOpen(false)} /> : null}
    </>
  )
}

function DiagOverlay({ s, onClose }: { s: SceneState; onClose: () => void }) {
  const t = useT()
  const d = s.diag
  const yn = (v: boolean | null) => (v == null ? '—' : v ? t('st.diagYes') : t('st.diagNo'))
  const n = (v: number | null) => (v == null ? '—' : String(v))
  const rows: [string, string][] = [
    ['WebGL2', yn(d.webgl2)],
    ['GPU', d.gpu ?? '—'],
    ['MAX_TEXTURE_SIZE', n(d.maxTex)],
    ['devicePixelRatio', d.dpr == null ? '—' : String(Math.round(d.dpr * 100) / 100)],
    [t('st.diagCanvas'), d.w == null ? '—' : `${d.w}×${d.h} css` + (d.canvas ? ` · ${d.canvas[0]}×${d.canvas[1]} px` : '')],
    [t('st.diagEnv'), yn(d.env)],
    [t('st.diagTimes'), t('st.diagTimesVal', { a: n(d.tScripts), b: n(d.tGlb), c: n(d.tFirst) })],
    [t('st.diagError'), d.lastError ?? t('st.diagNone')],
  ]
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* A tap on the card itself must not close it. */}
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <T style={disp(16, 1.2)}>{t('st.diagTitle')}</T>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <T style={[mono(12, 1.35, { color: C.i55 }), styles.rowKey]}>{k}</T>
              <T style={[monoSemi(12, 1.35), styles.rowVal]}>{v}</T>
            </View>
          ))}
          <Tap style={styles.close} onPress={onClose} accessibilityRole="button">
            <T style={disp(13, 1.2, { ls: 0.1, upper: true })}>{t('common.close')}</T>
          </Tap>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
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
  errorBox: { gap: 10, padding: 16 },
  photo: { flex: 1, width: '100%', minHeight: 60 },
  retry: {
    minHeight: 44,
    minWidth: 140,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.paper,
  },
  note: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: 'rgba(244,242,237,.92)',
    borderWidth: 1,
    borderColor: C.line,
  },
  caption: { position: 'absolute', left: 16, top: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(19,19,17,.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, gap: 8, padding: 16, backgroundColor: C.paper, borderWidth: RULE, borderColor: C.ink },
  row: { flexDirection: 'row', gap: 10 },
  rowKey: { width: 124 },
  rowVal: { flex: 1 },
  close: { minHeight: 44, marginTop: 6, alignItems: 'center', justifyContent: 'center', borderWidth: RULE, borderColor: C.ink },
})
