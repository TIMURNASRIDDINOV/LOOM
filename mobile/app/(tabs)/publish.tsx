import React, { useCallback, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoBold, monoSemi } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Check, Upload } from '../../src/components/icons'
import { BottomBar, CloseBar, StepMeter } from '../../src/components/market/bars'
import { AffixField, CategoryPicker } from '../../src/components/market/fields'
import { ClockIcon, ShieldIcon } from '../../src/components/market/glyphs'
import { Note, SectionLabel, StatGrid, StatusChip, Thumb, WorkRow } from '../../src/components/market/works'
import { Button, Input, OfflineState, Panel, Skeleton, T, isOffline } from '../../src/components/ui'
import { ApiError, uploadFile } from '../../src/api/client'
import {
  fetchArtworkCategories,
  fetchDesignerStats,
  fetchMyArtworks,
  fetchProducts,
  submitArtwork,
  useAsync,
  useRefreshOnFocus,
} from '../../src/api/catalog'
import { productName, statusLabel, useI18n, useT } from '../../src/i18n'
import { goBack } from '../../src/lib/nav'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const HANDLE_RULE = /^[a-z0-9_.]{3,24}$/i
/** Largest markup the server accepts (backend `artworkDetails`). */
const MAX_MARKUP = 200000
const DEFAULT_MARKUP = 20000

/** Designer share of a markup, from the commission the server reports. */
const designerShare = (markup: number, commissionPct: number) => Math.round((markup * (100 - commissionPct)) / 100)

/**
 * Designer publishing (W40–W44). Three gates, in order: signed in → designer
 * account → upload. The home screen only advertises this; the flow itself lives here.
 */
export default function Publish() {
  const { signedIn, isDesigner, user } = useAuth()

  if (!signedIn) return <SignInGate />
  if (!isDesigner) return <DesignerGate />
  return <DesignerHome handle={user?.designer_handle ?? null} />
}

/** Header, scrolling body and an optional pinned bottom action; lifts above the keyboard. */
function Screen({
  header,
  bottom,
  children,
}: {
  header: React.ReactNode
  bottom?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {bottom}
    </KeyboardAvoidingView>
  )
}

// ─── Gate 1: not signed in ───────────────────────────────────────────────────

function SignInGate() {
  const router = useRouter()
  const t = useT()
  return (
    <Screen
      header={<BackHeader onBack={() => goBack(router, '/market')} />}
      bottom={
        <BottomBar>
          <Button title={t('common.signIn')} onPress={() => router.push('/login')} />
        </BottomBar>
      }
    >
      <View style={{ gap: 8 }}>
        <T style={kicker(12)}>{t('pub.kicker')}</T>
        <T style={disp(32, 1, { ls: -0.035 })}>{t('pub.gateTitle')}</T>
        <T style={body(15, 22 / 15, { color: C.i70 })}>{t('pub.gateBody')}</T>
      </View>
    </Screen>
  )
}

// ─── Gate 2: signed in, but not a designer yet (W40) ─────────────────────────

function DesignerGate() {
  const router = useRouter()
  const { applyAsDesigner } = useAuth()
  const { flash } = useToast()
  const t = useT()
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  // The server's own refusal — "handle taken" — stays under the field it concerns.
  const [refused, setRefused] = useState<string | null>(null)

  const clean = handle.trim().replace(/^@/, '')
  const invalid = tried && !HANDLE_RULE.test(clean)

  const apply = async () => {
    setTried(true)
    // The rule is checked here first: a bad handle never costs a request.
    if (!HANDLE_RULE.test(clean)) return
    setBusy(true)
    try {
      await applyAsDesigner(clean, bio.trim() || undefined)
      flash(t('pub.profileCreated'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setRefused(e.message)
      else flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      header={<BackHeader onBack={() => goBack(router, '/market')} />}
      bottom={
        <BottomBar>
          <Button title={t('pub.createProfile')} loading={busy} onPress={apply} />
        </BottomBar>
      }
    >
      <View style={{ gap: 8 }}>
        <T style={kicker(12)}>{t('pub.kicker')}</T>
        <T style={disp(32, 1, { ls: -0.035 })}>{t('pub.becomeTitle')}</T>
        <T style={body(15, 22 / 15, { color: C.i70 })}>{t('pub.becomeBody')}</T>
      </View>

      <View style={styles.how}>
        {(['pub.how1', 'pub.how2', 'pub.how3'] as const).map((k, i) => (
          <View key={k} style={styles.howRow}>
            <T style={[monoBold(12, 18 / 12, { color: C.deep }), { width: 22 }]}>{`0${i + 1}`}</T>
            <T style={[body(13, 18 / 13), { flex: 1 }]}>{t(k)}</T>
          </View>
        ))}
      </View>

      <AffixField
        label={t('pub.handle')}
        prefix="@"
        value={handle}
        onChangeText={(v) => {
          setHandle(v)
          setRefused(null)
        }}
        placeholder="ozod"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={25}
        hint={t('pub.errHandle')}
        error={invalid ? t('pub.errHandle') : refused}
      />

      <Input
        label={t('pub.bio')}
        value={bio}
        onChangeText={setBio}
        placeholder={t('pub.bioPh')}
        multiline
        numberOfLines={2}
        maxLength={280}
        style={{ height: 72, paddingTop: 12, textAlignVertical: 'top' }}
      />

      <View style={styles.assure}>
        <ShieldIcon />
        <T style={[body(12, 16 / 12, { color: C.i70 }), { flex: 1 }]}>{t('pub.moderationNote')}</T>
      </View>
    </Screen>
  )
}

// ─── Gate 3: a designer — their cabinet, and the upload flow ─────────────────

type Picked = { uri: string; name: string; mime: string; w: number; h: number; size: number }

function DesignerHome({ handle }: { handle: string | null }) {
  const router = useRouter()
  const { flash } = useToast()
  const { lang, t } = useI18n()
  const works = useAsync(fetchMyArtworks, [])
  const stats = useAsync(fetchDesignerStats, [])
  const categories = useAsync(fetchArtworkCategories, [])
  const products = useAsync(() => fetchProducts(), [])
  useRefreshOnFocus(categories.reload)
  // Moderation happens elsewhere; coming back to this tab must show the verdict.
  const refreshAll = useCallback(() => {
    works.reload()
    stats.reload()
  }, [works.reload, stats.reload])
  useRefreshOnFocus(refreshAll)

  // 0 cabinet · 1 file (W42) · 2 details (W43) · 3 sent (W44)
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [file, setFile] = useState<Picked | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [markupText, setMarkupText] = useState(String(DEFAULT_MARKUP))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const upload = useRef(0)

  const markup = Number(markupText || 0)
  const markupBad = markup > MAX_MARKUP
  const titleBad = tried && (!title.trim() || title.trim().length > 80)
  const chosen = !!categories.data?.some((cat) => cat.id === categoryId && cat.active)
  const pct = stats.data?.commission_pct
  const product = products.data?.[0]

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

    const picked: Picked = {
      uri: a.uri,
      name: a.fileName ?? 'artwork.png',
      mime: a.mimeType ?? 'image/png',
      w: a.width,
      h: a.height,
      size: a.fileSize ?? 0,
    }
    setFile(picked)
    setTitle(picked.name.replace(/\.[^.]+$/, '').slice(0, 80))

    // Upload straight away so the details step never waits on the network. Only
    // the newest pick may set the key, whatever order the uploads settle in.
    const id = ++upload.current
    setUploading(true)
    setKey(null)
    try {
      const k = await uploadFile(picked.uri, picked.name, picked.mime)
      if (id === upload.current) setKey(k)
    } catch (e) {
      if (id === upload.current) flash((e as Error).message)
    } finally {
      if (id === upload.current) setUploading(false)
    }
  }

  const submit = async () => {
    setTried(true)
    if (!key) {
      flash(t('pub.errNotUploaded'))
      return
    }
    if (!title.trim() || title.trim().length > 80 || markupBad) return
    if (!categoryId || !chosen) {
      flash(t('artwork_category'))
      categories.reload()
      return
    }
    setBusy(true)
    try {
      await submitArtwork({
        category_id: categoryId,
        title: title.trim(),
        tags: tags.trim() || null,
        image_key: key,
        width: file?.w ?? null,
        height: file?.h ?? null,
        markup,
      })
      setStep(3)
      works.reload()
      stats.reload()
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    upload.current++
    setFile(null)
    setKey(null)
    setUploading(false)
    setTitle('')
    setTags('')
    setCategoryId(null)
    setMarkupText(String(DEFAULT_MARKUP))
    setTried(false)
    setStep(0)
  }

  const status = uploading ? t('pub.uploadingFile') : key ? t('pub.fileOk') : t('pub.fileFail')
  const statusColor = uploading ? C.i70 : key ? C.ink : C.deep
  const size = file && file.size ? ` · ${(file.size / 1024 / 1024).toFixed(1)} MB` : ''

  // ── W44 — sent ─────────────────────────────────────────────────────────────
  if (step === 3 && file) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <CloseBar onClose={reset} />
        <ScrollView contentContainerStyle={[styles.page, { paddingTop: 30 }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.done, offset(3)]}>
            <Check size={44} width={2.6} color={C.ink} />
          </View>
          <View style={{ gap: 12 }}>
            <View style={styles.reviewChip}>
              <ClockIcon />
              <T style={monoSemi(12, 4 / 3)}>{t('pub.reviewTime')}</T>
            </View>
            <T style={disp(32, 1.02, { ls: -0.035 })}>{t('pub.sent')}</T>
            <T style={body(15, 22 / 15, { color: C.i70 })}>{t('pub.sentBody')}</T>
          </View>
          <View style={{ gap: 8 }}>
            <SectionLabel>{t('pub.yourWork')}</SectionLabel>
            <Panel style={styles.sentRow}>
              <Thumb uri={file.uri} size={60} />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <T style={disp(15, 1.2)} numberOfLines={1}>
                  {title}
                </T>
                <T style={mono(12, 4 / 3, { color: C.i70 })}>{t('mk.plus', { price: fmt(markup) })}</T>
              </View>
              <StatusChip status="pending" />
            </Panel>
          </View>
        </ScrollView>
        <BottomBar rule={false}>
          <Button title={t('pub.cabinet')} onPress={reset} />
          <Button
            title={t('pub.uploadAnother')}
            variant="outline"
            onPress={() => {
              reset()
              setStep(1)
            }}
          />
        </BottomBar>
      </View>
    )
  }

  // ── W42 — file ─────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <Screen
        header={<BackHeader title={t('pub.publish')} right={<StepMeter step={1} />} onBack={reset} />}
        bottom={
          <BottomBar>
            <Button title={`${t('pub.next')} →`} disabled={!file} onPress={() => setStep(2)} />
          </BottomBar>
        }
      >
        <T style={body(15, 22 / 15, { color: C.i70 })}>{t('pub.step1Body')}</T>

        {file ? (
          <Panel raised raisedColor={C.coral} style={styles.fileCard}>
            <Thumb uri={file.uri} size={64} checker />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <T style={monoSemi(14, 18 / 14)} numberOfLines={1}>
                {file.name}
              </T>
              <T style={mono(12, 4 / 3, { color: C.i70 })}>{`${file.w} × ${file.h} px${size}`}</T>
              <T style={monoBold(12, 4 / 3, { color: statusColor })}>{status}</T>
            </View>
          </Panel>
        ) : null}

        <View style={{ gap: 6 }}>
          <Button
            title={t('pub.pickFile')}
            variant="outline"
            icon={<Upload size={18} color={C.ink} width={2.4} />}
            onPress={pick}
          />
          <T style={mono(12, 4 / 3, { color: C.i70 })}>{t('pub.fileSpec')}</T>
        </View>

        <View style={{ gap: 8 }}>
          <SectionLabel>{t('pub.reqs')}</SectionLabel>
          {([t('pub.req1'), t('pub.req2'), t('pub.req3')] as const).map((r) => (
            <View key={r} style={styles.req}>
              <View style={styles.reqDot} />
              <T style={[body(14, 20 / 14), { flex: 1 }]}>{r}</T>
            </View>
          ))}
        </View>
      </Screen>
    )
  }

  // ── W43 — details ──────────────────────────────────────────────────────────
  if (step === 2 && file) {
    return (
      <Screen
        header={<BackHeader title={t('pub.publish')} right={<StepMeter step={2} />} onBack={() => setStep(1)} />}
      >
        <View style={styles.fileHead}>
          <Thumb uri={file.uri} size={84} checker lifted />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <T style={monoSemi(14, 18 / 14)} numberOfLines={1}>
              {file.name}
            </T>
            <T style={monoBold(12, 4 / 3, { color: statusColor })}>{status}</T>
          </View>
        </View>

        <Input
          label={t('pub.titleField')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('pub.titlePh')}
          maxLength={80}
          error={titleBad ? t('artwork_title') : null}
        />
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
        <Input label={t('pub.tags')} value={tags} onChangeText={setTags} placeholder={t('pub.tagsPh')} maxLength={200} />

        <View style={{ gap: 8 }}>
          <AffixField
            label={t('pub.markup')}
            suffix={t('common.sum')}
            value={markupText ? fmt(markup) : ''}
            onChangeText={(v) => setMarkupText(v.replace(/\D/g, '').slice(0, 7))}
            keyboardType="number-pad"
            inputMode="numeric"
            error={markupBad ? t('artwork_markup') : null}
          />
          <T style={body(13, 18 / 13, { color: C.i70 })}>
            {pct === undefined
              ? t('pub.markupBuyer', { markup: fmt(markup) })
              : t('pub.markupNote', { markup: fmt(markup), share: fmt(designerShare(markup, pct)), pct })}
          </T>
        </View>

        {product ? (
          <View style={styles.preview}>
            <T style={mono(12, 4 / 3, { ls: 0.14, upper: true, color: C.i70 })}>{productName(product, lang)}</T>
            <T style={mono(15, 22 / 15)}>
              {`${fmt(product.price)} + `}
              <T style={{ backgroundColor: C.coral }}>{` ${fmt(markup)} `}</T>
              {' = '}
              <T style={monoBold(15, 22 / 15)}>{`${fmt(product.price + markup)} ${t('common.sum')}`}</T>
            </T>
          </View>
        ) : null}

        <View style={styles.assure}>
          <ShieldIcon />
          <T style={[body(12, 16 / 12, { color: C.i70 }), { flex: 1 }]}>{t('pub.moderationNote')}</T>
        </View>

        <Button title={t('pub.submit')} loading={busy} disabled={uploading || !key || markupBad} onPress={submit} />
      </Screen>
    )
  }

  // ── W41 — cabinet ──────────────────────────────────────────────────────────
  const failed = works.error ?? stats.error
  const list = works.data ?? []
  return (
    <Screen
      header={<BackHeader title={t('pub.cabinet')} onBack={() => goBack(router, '/market')} />}
      bottom={
        <BottomBar>
          <Button
            title={t('pub.upload')}
            icon={<Upload size={18} color={C.ink} width={2.4} />}
            onPress={() => setStep(1)}
          />
        </BottomBar>
      }
    >
      <View style={styles.handleChip}>
        <T style={monoSemi(12, 4 / 3, { ls: 0.06 })}>{t('pub.designerChip', { handle: handle ?? '' })}</T>
      </View>

      {failed && !works.data ? (
        isOffline(failed) ? (
          <OfflineState onRetry={refreshAll} />
        ) : (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i70 })}>{failed.message}</T>
            <Button title={t('common.retry')} variant="ink" onPress={refreshAll} />
          </View>
        )
      ) : (
        <>
          {stats.data ? (
            <>
              <StatGrid
                items={[
                  { label: t('pub.earned'), value: `${fmt(stats.data.earned)} ${t('common.sum')}` },
                  { label: t('pub.payable'), value: `${fmt(stats.data.earned_settled)} ${t('common.sum')}` },
                  { label: t('dz.sold'), value: t('pub.soldUnits', { n: stats.data.units_sold }) },
                  {
                    label: t('pub.inCatalog'),
                    value: t('pub.ofTotal', { a: stats.data.works_approved, b: stats.data.works_total }),
                  },
                ]}
              />
              <Note>{t('pub.shareNote', { pct: 100 - stats.data.commission_pct })}</Note>
            </>
          ) : stats.loading ? (
            <Skeleton height={96} lines={[]} />
          ) : null}

          <View style={{ gap: 8 }}>
            <SectionLabel>{t('dz.works')}</SectionLabel>
            {!works.data ? (
              <Skeleton height={60} lines={['50%']} />
            ) : list.length === 0 ? (
              <T style={body(14, 20 / 14, { color: C.i70 })}>{t('pub.noWorks')}</T>
            ) : (
              list.map((w) => (
                <WorkRow
                  key={w.id}
                  work={w}
                  meta={`${t('mk.plus', { price: fmt(w.markup) })}${w.sold ? ` · ${t('pub.soldTag', { n: w.sold })}` : ''}`}
                />
              ))
            )}
          </View>

          {stats.data?.sales.length ? (
            <View style={{ gap: 8 }}>
              <SectionLabel>{t('pub.recentSales')}</SectionLabel>
              {stats.data.sales.slice(0, 5).map((sale) => (
                <View key={sale.id} style={styles.sale}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <T style={disp(15, 1.2)} numberOfLines={1}>
                      {sale.artwork_title}
                    </T>
                    <T style={mono(12, 4 / 3, { color: C.i70 })}>
                      {t('pub.saleMeta', { id: sale.order_id, n: sale.quantity, status: statusLabel(sale.order_status, t) })}
                    </T>
                  </View>
                  <T style={monoBold(14, 1.3)}>{`+${fmt(sale.designer_share)}`}</T>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 14 },
  how: { borderTopWidth: 1, borderTopColor: C.line },
  howRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  assure: { flexDirection: 'row', gap: 8 },
  handleChip: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  req: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqDot: { width: 8, height: 8, backgroundColor: C.coral },
  preview: {
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  done: {
    width: 84,
    height: 84,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 3,
  },
  reviewChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  sale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
})
