import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'

import { C, RULE, fmt, noShadow, offset } from '../../src/theme/tokens'
import { body, disp, kicker, label as labelType, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Hatch } from '../../src/components/ArtPattern'
import { ChevronLeft } from '../../src/components/icons'
import { Button, Panel, T, Tap } from '../../src/components/ui'
import { uploadFile } from '../../src/api/client'
import { fetchDesignerStats, fetchMyArtworks, submitArtwork, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
import type { MyArtwork } from '../../src/api/types'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'
import { statusLabel, useT } from '../../src/i18n'

const MARKUPS = [15000, 25000, 35000]

const MOD_LABEL: Record<MyArtwork['status'], { key: 'mod.pending' | 'mod.approved' | 'mod.rejected'; c: string }> = {
  pending: { key: 'mod.pending', c: C.amber },
  approved: { key: 'mod.approved', c: '#22c55e' },
  rejected: { key: 'mod.rejected', c: C.deep },
}

/**
 * Designer publishing. Three gates, in order: signed in → designer account →
 * upload. The home screen only advertises this; the flow itself lives here.
 */
export default function Publish() {
  const { signedIn, isDesigner, user } = useAuth()

  if (!signedIn) return <SignInGate />
  if (!isDesigner) return <DesignerGate />
  return <DesignerHome handle={user?.designer_handle ?? null} />
}

// ─── Gate 1: not signed in ───────────────────────────────────────────────────

function SignInGate() {
  const router = useRouter()
  const t = useT()
  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.design')} />
      <ScrollView contentContainerStyle={styles.page}>
        <T style={kicker()}>{t('pub.kicker')}</T>
        <T style={[disp(30, 0.98, { ls: -0.035 }), { marginTop: 10, marginBottom: 10 }]}>
          {t('pub.gateTitle')}
        </T>
        <T style={[body(14, 1.6, { color: C.i55 }), { marginBottom: 24 }]}>
          {t('pub.gateBody')}
        </T>
        <Button title={t('common.signIn')} variant="ink" size={12.5} vPad={16} onPress={() => router.push('/login')} />
      </ScrollView>
    </View>
  )
}

// ─── Gate 2: signed in, but not a designer yet ───────────────────────────────

function DesignerGate() {
  const { applyAsDesigner } = useAuth()
  const { flash } = useToast()
  const t = useT()
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    const clean = handle.trim().replace(/^@/, '')
    if (!/^[a-z0-9_.]{3,24}$/i.test(clean)) {
      flash(t('pub.errHandle'))
      return
    }
    setBusy(true)
    try {
      await applyAsDesigner(clean, bio.trim() || undefined)
      flash(t('pub.profileCreated'))
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.design')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <T style={kicker()}>{t('pub.kicker')}</T>
        <T style={[disp(30, 0.98, { ls: -0.035 }), { marginTop: 10, marginBottom: 10 }]}>
          {t('pub.becomeTitle')}
        </T>
        <T style={[body(14, 1.6, { color: C.i55 }), { marginBottom: 22 }]}>
          {t('pub.becomeBody')}
        </T>

        <View style={{ marginBottom: 11 }}>
          <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{t('pub.handle')}</T>
          <View style={styles.handleField}>
            <View style={styles.at}>
              <T style={{ fontFamily: 'IBMPlexMono_500Medium', fontSize: 16, color: C.i55 }}>@</T>
            </View>
            <TextInput
              value={handle}
              onChangeText={setHandle}
              placeholder="ozod"
              placeholderTextColor={C.i38}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.handleInput}
              allowFontScaling={false}
              maxLength={24}
            />
          </View>
        </View>

        <Field label={t('pub.bio')} value={bio} onChange={setBio} placeholder={t('pub.bioPh')} />

        <Button
          title={t('pub.createProfile')}
          size={15}
          vPad={17}
          loading={busy}
          style={{ marginTop: 6 }}
          onPress={apply}
        />
        <T style={[body(11, 1.5, { color: C.i38, align: 'center' }), { marginTop: 12 }]}>
          {t('pub.moderationNote')}
        </T>
      </ScrollView>
    </View>
  )
}

// ─── Gate 3: a designer — their works, and the upload flow ───────────────────

function DesignerHome({ handle }: { handle: string | null }) {
  const router = useRouter()
  const { flash } = useToast()
  const t = useT()
  const { data, loading, reload } = useAsync(fetchMyArtworks, [])
  const stats = useAsync(fetchDesignerStats, [])
  // Moderation happens elsewhere; coming back to this tab must show the verdict.
  const refreshAll = useCallback(() => {
    reload()
    stats.reload()
  }, [reload, stats.reload])
  useRefreshOnFocus(refreshAll)

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [file, setFile] = useState<{
    uri: string
    name: string
    mime: string
    w: number
    h: number
    size: number
  } | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [markup, setMarkup] = useState(25000)
  const [busy, setBusy] = useState(false)

  const works = data ?? []

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      flash(t('pub.errPerm'))
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (res.canceled || !res.assets?.length) return
    const a = res.assets[0]
    if (Math.max(a.width, a.height) < 1500) {
      flash(t('pub.errSmall'))
      return
    }

    const picked = {
      uri: a.uri,
      name: a.fileName ?? 'artwork.png',
      mime: a.mimeType ?? 'image/png',
      w: a.width,
      h: a.height,
      size: a.fileSize ?? 0,
    }
    setFile(picked)
    setTitle(picked.name.replace(/\.[^.]+$/, ''))
    setStep(2)

    // Upload straight away so the details step never waits on the network.
    setUploading(true)
    try {
      setKey(await uploadFile(picked.uri, picked.name, picked.mime))
    } catch (e) {
      flash((e as Error).message)
      setKey(null)
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    if (!key) {
      flash(t('pub.errNotUploaded'))
      return
    }
    if (!title.trim()) {
      flash(t('pub.errTitle'))
      return
    }
    setBusy(true)
    try {
      await submitArtwork({
        title: title.trim(),
        tags: tags.trim() || null,
        image_key: key,
        width: file?.w ?? null,
        height: file?.h ?? null,
        markup,
      })
      setStep(3)
      flash(t('pub.sent'))
      reload()
      stats.reload()
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setFile(null)
    setKey(null)
    setTitle('')
    setTags('')
    setStep(0)
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.design')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Tap
          style={styles.back}
          onPress={() => (step > 0 ? reset() : router.push('/market'))}
        >
          <ChevronLeft size={13} width={2.4} color={C.i55} />
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>{t('common.back')}</T>
        </Tap>

        <T style={kicker()}>{handle ?? t('pub.kicker')}</T>
        <T style={[disp(30, 0.98, { ls: -0.035 }), { marginTop: 10, marginBottom: 8 }]}>
          {step === 3 ? t('pub.onModeration') : step === 0 ? t('pub.cabinet') : t('pub.publish')}
        </T>

        {/* Earnings — the promise behind the whole flow, backed by artwork_sales. */}
        {step === 0 && stats.data ? (
          <>
            <View style={styles.statsRow}>
              <Stat label={t('pub.earned')} value={`${fmt(stats.data.earned)} ${t('common.sum')}`} accent />
              <Stat label={t('pub.payable')} value={`${fmt(stats.data.earned_settled)} ${t('common.sum')}`} />
            </View>
            <View style={styles.statsRow}>
              <Stat label={t('dz.sold')} value={t('pub.soldUnits', { n: stats.data.units_sold })} />
              <Stat label={t('pub.inCatalog')} value={t('pub.ofTotal', { a: stats.data.works_approved, b: stats.data.works_total })} />
            </View>
            <T style={[body(10.5, 1.5, { color: C.i38 }), { marginTop: 8 }]}>
              {t('pub.shareNote', { pct: 100 - stats.data.commission_pct })}
            </T>
            {stats.data.sales.length ? (
              <View style={{ marginTop: 14 }}>
                <T style={[labelType(), { marginBottom: 8 }]}>{t('pub.recentSales')}</T>
                {stats.data.sales.slice(0, 5).map((sale) => {
                  return (
                    <View key={sale.id} style={styles.saleRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T style={disp(13, 1.15)} numberOfLines={1}>
                          {sale.artwork_title}
                        </T>
                        <T style={[mono(9.5, 1.3, { color: C.i55 }), { marginTop: 2 }]}>
                          {t('pub.saleMeta', { id: sale.order_id, n: sale.quantity, status: statusLabel(sale.order_status, t) })}
                        </T>
                      </View>
                      <T style={monoSemi(12, 1, { color: C.ink })}>{`+${fmt(sale.designer_share)}`}</T>
                    </View>
                  )
                })}
              </View>
            ) : null}
          </>
        ) : null}

        {step > 0 ? (
          <View style={styles.progress}>
            {[1, 2, 3].map((n) => (
              <View
                key={n}
                style={{
                  width: 22,
                  height: 4,
                  backgroundColor: step >= n ? C.coral : 'rgba(19,19,17,.16)',
                }}
              />
            ))}
          </View>
        ) : null}

        {/* Step 0 — the designer's portfolio and moderation status. */}
        {step === 0 ? (
          <>
            <Button
              title={t('pub.upload')}
              size={15}
              vPad={17}
              style={{ marginTop: 12, marginBottom: 20 }}
              onPress={() => setStep(1)}
            />
            {loading ? (
              <ActivityIndicator color={C.coral} />
            ) : works.length === 0 ? (
              <T style={body(13.5, 1.6, { color: C.i55 })}>
                {t('pub.noWorks')}
              </T>
            ) : (
              works.map((w) => {
                const st = MOD_LABEL[w.status]
                return (
                  <Panel key={w.id} style={styles.workRow}>
                    <Image source={{ uri: w.image_url }} style={styles.workThumb} resizeMode="cover" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T style={disp(14, 1.15)} numberOfLines={1}>
                        {w.title}
                      </T>
                      <T style={[mono(10, 1.3, { color: C.i55 }), { marginTop: 3 }]}>
                        {`${t('mk.plus', { price: fmt(w.markup) })}${w.sold ? ` · ${t('pub.soldTag', { n: w.sold })}` : ''}`}
                      </T>
                      <View style={[styles.statusChip, { borderColor: st.c }]}>
                        <T style={monoSemi(9, 1, { ls: 0.12, upper: true, color: st.c })}>{t(st.key)}</T>
                      </View>
                      {w.status === 'rejected' && w.reject_note ? (
                        <T style={[body(11, 1.5, { color: C.i55 }), { marginTop: 6 }]}>
                          {w.reject_note}
                        </T>
                      ) : null}
                    </View>
                  </Panel>
                )
              })
            )}
          </>
        ) : null}

        {/* Step 1 — choose a file. */}
        {step === 1 ? (
          <>
            <T style={[body(13.5, 1.6, { color: C.i55 }), { marginBottom: 16 }]}>
              {t('pub.step1Body')}
            </T>
            <Tap onPress={pick}>
              <Hatch style={styles.dropzone}>
                <View style={styles.dropPlus}>
                  <T style={{ fontSize: 24, lineHeight: 30, color: C.white }}>+</T>
                </View>
                <T style={disp(14, 1, { ls: 0.06, upper: true })}>{t('pub.pickFile')}</T>
                <T style={mono(10, 1.4, { ls: 0.1, upper: true, color: C.i38 })}>
                  {t('pub.fileSpec')}
                </T>
              </Hatch>
            </Tap>
            <View style={styles.reqs}>
              <T style={[labelType(), { marginBottom: 8 }]}>{t('pub.reqs')}</T>
              {[
                t('pub.req1'),
                t('pub.req2'),
                t('pub.req3'),
              ].map((t) => (
                <T key={t} style={[body(11.5, 1.5, { color: C.i70 }), { marginBottom: 5 }]}>
                  {`— ${t}`}
                </T>
              ))}
            </View>
          </>
        ) : null}

        {/* Step 2 — title, tags, markup. */}
        {step === 2 && file ? (
          <>
            <Panel style={styles.fileCard}>
              <Image source={{ uri: file.uri }} style={styles.filePreview} resizeMode="cover" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={disp(13, 1.2)} numberOfLines={1}>
                  {file.name}
                </T>
                <T style={[mono(10.5, 1.4, { color: C.i55 }), { marginTop: 3 }]}>
                  {`${file.w}×${file.h} · ${(file.size / 1024 / 1024).toFixed(1)} MB`}
                </T>
                <T
                  style={[
                    monoSemi(9.5, 1, {
                      ls: 0.1,
                      upper: true,
                      color: uploading ? C.amber : key ? C.green : C.deep,
                    }),
                    { marginTop: 4 },
                  ]}
                >
                  {uploading ? t('pub.uploadingFile') : key ? t('pub.fileOk') : t('pub.fileFail')}
                </T>
              </View>
            </Panel>

            <Field label={t('pub.titleField')} value={title} onChange={setTitle} placeholder={t('pub.titlePh')} />
            <Field label={t('pub.tags')} value={tags} onChange={setTags} placeholder={t('pub.tagsPh')} />

            <View style={{ marginBottom: 11 }}>
              <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{t('pub.markup')}</T>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {MARKUPS.map((v) => {
                  const on = v === markup
                  return (
                    <Tap
                      key={v}
                      onPress={() => setMarkup(v)}
                      style={[
                        styles.markup,
                        { backgroundColor: on ? C.ink : C.white },
                        on ? offset(2, C.coral) : noShadow,
                      ]}
                    >
                      <T
                        style={{
                          ...mono(12, 1, { color: on ? C.paper : C.i70 }),
                          fontFamily: 'IBMPlexMono_600SemiBold',
                        }}
                      >
                        {fmt(v)}
                      </T>
                    </Tap>
                  )
                })}
              </View>
              <T style={[body(10.5, 1.5, { color: C.i38 }), { marginTop: 8 }]}>
                {t('pub.markupNote', { markup: fmt(markup), share: fmt(Math.round(markup * 0.7)) })}
              </T>
            </View>

            <Button
              title={t('pub.submit')}
              size={16}
              vPad={17}
              loading={busy}
              disabled={uploading || !key}
              onPress={submit}
            />
          </>
        ) : null}

        {/* Step 3 — submitted. */}
        {step === 3 ? (
          <>
            <Panel raised raisedColor={C.coral} style={{ padding: 18, marginBottom: 16 }}>
              <T style={[monoSemi(10, 1, { ls: 0.2, upper: true, color: C.amber }), { marginBottom: 8 }]}>
                {t('pub.reviewTime')}
              </T>
              <T style={[disp(20, 1.1, { ls: -0.02 }), { marginBottom: 6 }]}>{title || t('pub.yourWork')}</T>
              <T style={body(12.5, 1.6, { color: C.i55 })}>
                {t('pub.sentBody')}
              </T>
            </Panel>
            <Button title={t('pub.uploadAnother')} variant="outline" size={12.5} vPad={15} onPress={reset} />
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.stat, accent && { backgroundColor: C.ink }]}>
      <T style={monoSemi(9, 1, { ls: 0.16, upper: true, color: accent ? C.onInk55 : C.i55 })}>{label}</T>
      <T style={[disp(17, 1, { ls: -0.02, color: accent ? C.paper : C.ink }), { marginTop: 5 }]} numberOfLines={1}>
        {value}
      </T>
    </View>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <View style={{ marginBottom: 11 }}>
      <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.i38}
        style={styles.input}
        allowFontScaling={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 14 },
  progress: { flexDirection: 'row', gap: 5, marginTop: 16, marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  stat: { flex: 1, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, padding: 11 },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  dropzone: {
    aspectRatio: 4 / 3,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 14,
  },
  dropPlus: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqs: { borderWidth: 1, borderColor: C.line, backgroundColor: C.white, padding: 13 },
  fileCard: { flexDirection: 'row', gap: 12, padding: 11, marginBottom: 16 },
  filePreview: { width: 68, height: 68, borderWidth: 1, borderColor: C.ink },
  workRow: { flexDirection: 'row', gap: 12, padding: 11, marginBottom: 10 },
  workThumb: { width: 64, height: 64, borderWidth: 1, borderColor: C.line },
  statusChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginTop: 6,
  },
  handleField: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  at: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRightWidth: RULE,
    borderRightColor: C.ink,
    backgroundColor: C.paper,
  },
  handleInput: {
    flex: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },
  input: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },
  markup: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
