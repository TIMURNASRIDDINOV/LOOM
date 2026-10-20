import React, { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LAB_STYLES, generateLab, getLabStatus, labProblem, type LabProblem, type LabResult, type LabStatus, type LabStyle } from '../../src/api/lab'
import { LabGate, LabHeader, LabRunCard, useLabStudio } from '../../src/components/lab/LabShared'
import { Button, ChipRow, Input, OfflineState, Panel, Skeleton, T, Tap, Toast } from '../../src/components/ui'
import { C } from '../../src/theme/tokens'
import { body, disp, dispExtra, label, mono } from '../../src/theme/type'
import { useT } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

type Screen = 'prompt' | 'generating' | 'result' | 'limit' | 'refused' | 'later' | 'failed' | 'offline'
export default function Lab() { return <LabGate><LabFlow /></LabGate> }

function LabFlow() {
  const router = useRouter()
  const t = useT()
  const insets = useSafeAreaInsets()
  const { signedIn, loading: authLoading } = useAuth()
  const { message } = useToast()
  const apply = useLabStudio()
  const [status, setStatus] = useState<LabStatus | null>(null)
  const [statusError, setStatusError] = useState<LabProblem | null>(null)
  const [screen, setScreen] = useState<Screen>('prompt')
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<LabStyle>('minimal')
  const [invalid, setInvalid] = useState(false)
  const [result, setResult] = useState<LabResult | null>(null)
  const request = useRef<AbortController | null>(null)
  const forced = __DEV__ && process.env.EXPO_PUBLIC_LAB === '1'
  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const value = await getLabStatus(signedIn, signal)
      if (signal?.aborted) return
      if (!value.enabled && !forced) { router.replace('/'); return }
      setStatus(value)
      setStatusError(null)
    } catch (error) {
      if (!signal?.aborted) setStatusError(labProblem(error))
    }
  }, [signedIn, forced, router])
  useFocusEffect(useCallback(() => {
    const ctrl = new AbortController()
    refreshStatus(ctrl.signal)
    return () => { ctrl.abort(); request.current?.abort(); request.current = null }
  }, [refreshStatus]))

  const generate = async () => {
    if (authLoading || request.current) return
    if (!signedIn || status?.signedIn === false) { router.push('/login'); return }
    if (!prompt.trim() || prompt.trim().length > 500) { setInvalid(true); setScreen('prompt'); return }
    if (status?.remaining === 0) { setScreen('limit'); return }
    const ctrl = new AbortController()
    request.current = ctrl
    setInvalid(false)
    setScreen('generating')
    try {
      const run = await generateLab(prompt.trim(), style, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(run)
      setStatus({ enabled: true, signedIn: true, remaining: run.remaining })
      setScreen('result')
    } catch (error) {
      if (ctrl.signal.aborted) return
      const problem = labProblem(error)
      if (problem === 'limit') setStatus({ enabled: true, signedIn: true, remaining: 0 })
      if (problem === 'login') { setScreen('prompt'); router.push('/login') }
      else if (problem === 'disabled') router.replace('/')
      else if (problem === 'invalid') { setInvalid(true); setScreen('prompt') }
      else setScreen(problem)
      await refreshStatus()
    } finally {
      if (request.current === ctrl) request.current = null
    }
  }
  const cancel = () => {
    request.current?.abort()
    request.current = null
    setScreen('prompt')
    refreshStatus()
  }
  const steps = [t('lab.step1'), t('lab.step2'), t('lab.step3')]
  const errorScreen = ['limit', 'refused', 'failed', 'later'].includes(screen)
  const edit = () => { setScreen('prompt'); setInvalid(false); refreshStatus() }

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.paper }}>
    <LabHeader remaining={status?.remaining ?? null} close={screen === 'prompt'} onBack={screen === 'generating' ? cancel : screen !== 'prompt' ? edit : undefined} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 20, flexGrow: 1 }}>
      {screen === 'prompt' ? <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T style={dispExtra(28)}>LOOM<T style={{ color: C.coral }}>/</T> Lab</T>
          <Tap accessibilityRole="button" onPress={() => router.push('/lab/history')} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
            <T style={mono(12, 1.4, { color: C.deep })}>{t('lab.history')}</T>
          </Tap>
        </View>
        <T style={disp(32, 1.05, { ls: -0.035 })}>{t('lab.hero')}</T>
        <T style={body(16, 1.5, { color: C.i70 })}>{t('lab.intro')}</T>
        {!status && !statusError ? <Skeleton height={32} lines={[]} /> : null}
        {statusError ? <OfflineState title={statusError === 'offline' ? undefined : t('lab.statusFailed')} onRetry={() => refreshStatus()} /> : null}
        <Input label={t('lab.prompt')} value={prompt} onChangeText={(v) => { setPrompt(v); setInvalid(false) }} multiline maxLength={500}
          placeholder={t('lab.example1')} error={invalid ? t('lab.invalid') : undefined} style={{ minHeight: 112, paddingTop: 14, textAlignVertical: 'top' }} />
        <View>
          {(['lab.example1', 'lab.example2', 'lab.example3'] as const).map((key) => <Tap key={key} accessibilityRole="button" onPress={() => { setPrompt(t(key)); setInvalid(false) }}
            style={{ minHeight: 44, justifyContent: 'center' }}><T style={mono(12, 1.5, { color: C.i70 })}>{t(key)}</T></Tap>)}
        </View>
        <T style={label()}>{t('lab.style')}</T>
        <ChipRow options={LAB_STYLES.map((value) => ({ value, label: t(`lab.style.${value}`) }))} value={style} onChange={setStyle} />
      </> : null}
      {screen === 'generating' ? <>
        <Panel style={{ padding: 16, gap: 12 }}><T style={label()}>{t('lab.prompt')}</T><T style={mono(16, 1.5)}>«{prompt.trim()}»</T><T style={mono(12)}>{t(`lab.style.${style}`)}</T></Panel>
        <View accessibilityRole="progressbar" accessibilityLabel={t('lab.generating')} style={{ paddingVertical: 42, gap: 24 }}>
          <ActivityIndicator size="large" color={C.coral} />
          <T style={disp(28, 1.1)}>{t('lab.generating')}</T>
          {steps.map((text, i) => <T key={text} style={mono(14, 1.5)}>{`0${i + 1}  ${text}`}</T>)}
        </View>
        <T style={body(14, 1.5, { color: C.i70 })}>{t('lab.cancelNote')}</T>
      </> : null}
      {screen === 'result' && result ? <>
        <T style={disp(28, 1.1)}>{t('lab.result')}</T>
        <LabRunCard key={result.runId} run={result} onApply={apply} />
        <T style={body(14, 1.5, { color: C.i70 })}>{t('lab.resultNote')}</T>
        <T style={mono(12, 1.5)}>{t('lab.redrawCost', { n: status?.remaining ?? result.remaining })}</T>
        <Button title={t('lab.history')} variant="outline" onPress={() => router.push('/lab/history')} />
      </> : null}
      {errorScreen ? <View accessibilityRole="alert" style={{ gap: 20, paddingTop: 24 }}>
        <T style={dispExtra(72, 1, { color: C.coral })}>{screen === 'limit' ? '0' : '!'}</T>
        {screen !== 'limit' ? <T style={label(12, { color: C.deep })}>{t('lab.notCounted')}</T> : null}
        <T style={disp(32, 1.05, { ls: -0.035 })}>{t(screen === 'limit' ? 'lab.limitTitle' : screen === 'refused' ? 'lab.refusedTitle' : screen === 'later' ? 'lab.laterTitle' : 'lab.failedTitle')}</T>
        <T style={body(16, 1.5, { color: C.i70 })}>{t(screen === 'limit' ? 'lab.limitBody' : screen === 'refused' ? 'lab.refusedBody' : screen === 'later' ? 'lab.laterBody' : 'lab.failedBody')}</T>
        {screen !== 'limit' ? <Panel style={{ padding: 14, gap: 8 }}><T style={label()}>{t('lab.prompt')}</T><T style={mono(15, 1.5)}>«{prompt.trim()}»</T></Panel> : null}
      </View> : null}
      {screen === 'offline' ? <><OfflineState onRetry={generate} /><T style={body(14, 1.5)}>{t('lab.offlineNote')}</T><Button title={t('lab.history')} variant="outline" onPress={() => router.push('/lab/history')} /></> : null}
    </ScrollView>
    <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), gap: 10 }}>
      {screen === 'prompt' ? <Button title={t('lab.draw')} disabled={authLoading || (!status && signedIn) || !!statusError} onPress={generate} /> : null}
      {screen === 'generating' ? <Button title={t('lab.cancel')} variant="outline" onPress={cancel} /> : null}
      {screen === 'result' ? <Button title={t('lab.redraw')} variant="outline" onPress={generate} /> : null}
      {screen === 'limit' ? <><Button title={t('lab.catalog')} onPress={() => router.push('/catalog')} /><Button title={t('lab.studio')} variant="outline" onPress={() => router.push('/studio')} /></> : null}
      {screen === 'refused' ? <Button title={t('lab.edit')} onPress={edit} /> : null}
      {screen === 'failed' || screen === 'later' ? <Button title={t('common.retry')} onPress={generate} /> : null}
      {screen !== 'prompt' && screen !== 'generating' && screen !== 'limit' ? <Button title={t('common.back')} variant="outline" onPress={edit} /> : null}
    </View>
    <Toast message={message} bottom={30} />
  </KeyboardAvoidingView>
}
