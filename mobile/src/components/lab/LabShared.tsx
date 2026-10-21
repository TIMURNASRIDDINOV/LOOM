import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { fetchLabEnabled, useLabEnabled } from '../../lib/flags'
import { BackHeader } from '../AppBar'
import { Button, Centered, Panel, T } from '../ui'
import { C, RULE } from '../../theme/tokens'
import { body, mono } from '../../theme/type'
import { useI18n } from '../../i18n'
import { labMessage, loadLabImage, releaseLabImage, reportLab, type LabRun, type LabVariant } from '../../api/lab'
import { useStudio } from '../../state/studio'
import { useToast } from '../../state/toast'

export function LabGate({ children }: { children: React.ReactNode }) {
  const enabled = useLabEnabled()
  const [checked, setChecked] = useState(__DEV__ && process.env.EXPO_PUBLIC_LAB === '1')
  useEffect(() => {
    let live = true
    if (!checked) fetchLabEnabled().then(() => live && setChecked(true))
    return () => { live = false }
  }, [checked])
  // Wait for the shared flag check before redirecting a direct link.
  if (!checked) return <Centered><ActivityIndicator color={C.coral} /></Centered>
  if (!enabled) return <Redirect href="/" />
  return <>{children}</>
}

export function LabHeader({ remaining, close, onBack }: { remaining: number | null; close?: boolean; onBack?: () => void }) {
  const { t } = useI18n()
  return <BackHeader title={t('lab.title')} close={close} onBack={onBack}
    right={remaining !== null ? <View style={styles.balance}><T style={mono(12, 1.3)}>{t('lab.balance', { n: remaining })}</T></View> : undefined} />
}

/** setArt writes the active face. Wait for the front-face render (and draft
 * hydration) before applying, so a prior back-face session stays intact. */
export function useLabStudio() {
  const studio = useStudio()
  const router = useRouter()
  const { t } = useI18n()
  const [pending, setPending] = useState<{ variant: LabVariant; uri: string } | null>(null)
  useEffect(() => {
    if (!pending || !studio.hydrated || studio.face !== 'front') return
    studio.setArt({ uri: pending.uri, uploadKey: pending.variant.uploadKey, name: t('lab.artName'), price: 0 })
    setPending(null)
    router.push('/studio')
  }, [pending, studio.hydrated, studio.face, studio.setArt, router, t])
  return (variant: LabVariant, uri: string) => {
    studio.setFace('front')
    setPending({ variant, uri })
  }
}

export function LabRunCard({ run, compact, loadImage = true, onApply }: { run: LabRun; compact?: boolean; loadImage?: boolean; onApply: (variant: LabVariant, uri: string) => void }) {
  const { t, lang } = useI18n()
  const { flash } = useToast()
  const router = useRouter()
  const variant = run.variants[0]
  const [uri, setUri] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [reporting, setReporting] = useState(false)
  const appliedUri = useRef<string | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    let loadedUri: string | null = null
    setUri(null)
    setImageFailed(false)
    if (!loadImage) return
    loadLabImage(variant.url, ctrl.signal).then((value) => {
      loadedUri = value
      if (ctrl.signal.aborted) releaseLabImage(value)
      else setUri(value)
    }).catch(() => { if (!ctrl.signal.aborted) setImageFailed(true) })
    return () => {
      ctrl.abort()
      if (loadedUri && loadedUri !== appliedUri.current) releaseLabImage(loadedUri)
    }
  }, [variant.url, reload, loadImage])
  const report = async () => {
    if (reporting) return
    setReporting(true)
    try { await reportLab(run.runId); flash(t('lab.reported')) }
    catch (error) {
      flash(t(labMessage(error)))
      if (labMessage(error) === 'lab.signIn') router.push('/login')
    }
    finally { setReporting(false) }
  }
  const date = new Date(run.createdAt).toLocaleDateString(lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-RU' : 'en-GB')
  return <Panel style={{ padding: 12, gap: 14 }}>
    {compact ? <T style={mono(12, 1.4, { color: C.i70 })}>{date} · {t(`lab.style.${run.style}`)}</T> : null}
    <T style={mono(15, 1.5)}>«{run.prompt}»</T>
    <View style={[styles.image, { height: compact ? 180 : 260 }]}>
      {uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel={t('lab.artName')} />
        : imageFailed ? <View style={{ padding: 16, gap: 12 }}><T style={body(14, 1.4)}>{t('lab.imageFailed')}</T><Button title={t('common.retry')} variant="outline" onPress={() => setReload((v) => v + 1)} /></View>
          : loadImage ? <ActivityIndicator color={C.coral} /> : null}
    </View>
    {variant.lowQuality ? <View style={styles.quality}><T style={mono(12, 1.4)}>{t('lab.lowQuality')}</T></View> : null}
    <Button title={t('lab.report')} variant="outline" loading={reporting} onPress={report} />
    <Button title={t('lab.apply')} disabled={!uri} onPress={() => {
      if (!uri) return
      appliedUri.current = uri
      onApply(variant, uri)
    }} />
  </Panel>
}

const styles = StyleSheet.create({
  balance: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, paddingHorizontal: 7, paddingVertical: 4 },
  image: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper2, borderWidth: RULE, borderColor: C.ink },
  quality: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.coral, alignSelf: 'flex-start' },
})
