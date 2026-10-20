import React, { useCallback, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { getLabHistory, getLabStatus, labProblem, type LabHistory, type LabProblem } from '../../src/api/lab'
import { LabGate, LabHeader, LabRunCard, useLabStudio } from '../../src/components/lab/LabShared'
import { Button, EmptyState, OfflineState, Skeleton, T, Toast } from '../../src/components/ui'
import { C } from '../../src/theme/tokens'
import { disp } from '../../src/theme/type'
import { useT } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

export default function LabHistoryScreen() { return <LabGate><History /></LabGate> }

function History() {
  const t = useT()
  const router = useRouter()
  const { signedIn, loading: authLoading } = useAuth()
  const { message } = useToast()
  const apply = useLabStudio()
  const [data, setData] = useState<LabHistory | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState<LabProblem | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const retryPage = useRef(1)
  const load = useCallback(async (page = 1) => {
    retryPage.current = page
    request.current?.abort()
    const ctrl = new AbortController()
    request.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const [history, status] = await Promise.all([getLabHistory(page, ctrl.signal), getLabStatus(signedIn, ctrl.signal)])
      if (ctrl.signal.aborted) return
      if (!status.enabled && !(__DEV__ && process.env.EXPO_PUBLIC_LAB === '1')) { router.replace('/'); return }
      setRemaining(status.remaining)
      setData((prev) => {
        const runs = page === 1 ? history.runs : [...(prev?.runs ?? []), ...history.runs]
        const unique = [...new Map(runs.map((run) => [run.runId, run])).values()]
        return { ...history, runs: unique.sort((a, b) => b.createdAt - a.createdAt) }
      })
    } catch (e) {
      if (!ctrl.signal.aborted) {
        const problem = labProblem(e)
        setError(problem)
        if (problem === 'login') router.push('/login')
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [signedIn, router])
  useFocusEffect(useCallback(() => {
    if (signedIn) load()
    else { setData(null); setRemaining(null) }
    return () => request.current?.abort()
  }, [signedIn, load]))
  return <View style={{ flex: 1, backgroundColor: C.paper }}>
    <LabHeader remaining={remaining} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }}>
      <T style={disp(32, 1.05, { ls: -0.035 })}>{t('lab.history')}</T>
      {authLoading || (loading && !data) ? <Skeleton height={180} /> : !signedIn ? <EmptyState title={t('lab.signIn')} action={t('lab.signIn')} onAction={() => router.push('/login')} /> : <>
        {error === 'offline' ? <OfflineState onRetry={() => load(retryPage.current)} /> : error ? <EmptyState title={t('lab.historyFailed')} action={t('common.retry')} onAction={() => load(retryPage.current)} /> : null}
        {data?.runs.length === 0 && !error ? <EmptyState title={t('lab.emptyTitle')} body={t('lab.emptyBody')} action={t('lab.draw')} onAction={() => router.replace('/lab')} /> : null}
        {data?.runs.map((run) => <LabRunCard key={run.runId} run={run} compact onApply={apply} />)}
        {data?.hasMore && !error ? <Button title={t('lab.loadMore')} variant="outline" loading={loading} onPress={() => load(data.page + 1)} /> : null}
      </>}
    </ScrollView>
    <Toast message={message} bottom={30} />
  </View>
}
