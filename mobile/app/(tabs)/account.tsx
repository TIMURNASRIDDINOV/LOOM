import React, { useCallback, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import Constants from 'expo-constants'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, dispExtra, mono, monoBold, monoSemi, label as labelType } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { BoxIcon, ChevronRight, Pin, Telegram } from '../../src/components/icons'
import { Button, T, Tap } from '../../src/components/ui'
import { Chat, Doc, Globe, Layers, Logout, Pencil, Person, Shield, SlashMark, Tick } from '../../src/components/account/icons'
import { DeletePanel } from '../../src/components/account/DeletePanel'
import { NavGroup, NavRow } from '../../src/components/account/rows'
import { LANGS, useI18n } from '../../src/i18n'
import { useLabEnabled } from '../../src/lib/flags'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const SITE = 'https://loomdesign.uz'

function open(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {})
}

// W33 account, W34 guest, W36 delete confirmation.
export default function Account() {
  const router = useRouter()
  const { t, lang } = useI18n()
  const { user, signedIn, isDesigner, phoneVerified, signOut, deleteAccount } = useAuth()
  const { flash } = useToast()
  const labOn = useLabEnabled()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // "You signed out" / "Account deleted": shown on the guest view that follows.
  const [notice, setNotice] = useState<string | null>(null)

  // The notice belongs to the moment of signing out, not to later visits.
  useFocusEffect(useCallback(() => () => setNotice(null), []))

  const ordersCount = user?.orders_count ?? 0
  const langName = LANGS.find((l) => l.id === lang)?.label ?? ''

  // Arrays, not fragments: NavGroup draws a rule between the children it is given.
  const help = [
    <NavRow key="support" icon={<Chat />} label={t('acc.support')} onPress={() => open('https://t.me/looom_design_bot')} />,
    <NavRow key="terms" icon={<Doc />} label={t('acc.terms')} onPress={() => open(`${SITE}/privacy.html#terms`)} />,
    <NavRow key="privacy" icon={<Shield />} label={t('acc.privacy')} onPress={() => open(`${SITE}/privacy.html`)} />,
  ]
  const languageRow = (
    <NavRow key="language" icon={<Globe />} label={t('acc.language')} trailing={langName} onPress={() => router.push('/language')} />
  )
  const version = (
    <T style={mono(12, 4 / 3, { ls: 0.06, color: C.i70, align: 'center' })}>
      {t('acc.version', { v: Constants.expoConfig?.version ?? '1.0.0' })}
    </T>
  )

  if (!signedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar />
        <ScrollView contentContainerStyle={[styles.page, { gap: 18, paddingTop: 14 }]} showsVerticalScrollIndicator={false}>
          {notice ? (
            <View accessibilityRole="alert" style={styles.notice}>
              <View style={styles.tick}>
                <Tick size={12} color={C.white} width={3.4} />
              </View>
              <T style={body(14, 20 / 14, { color: C.ink })}>{notice}</T>
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <T style={disp(34, 1, { ls: -0.035 })}>{t('acc.signInTitle')}</T>
            <T style={body(15, 22 / 15, { color: C.i70 })}>{t('acc.signInBody')}</T>
          </View>

          <View style={{ gap: 6 }}>
            <Tap accessibilityRole="button" onPress={() => router.push('/login')} style={[styles.telegram, offset(2)]}>
              <Telegram size={20} />
              <T style={disp(13, 1, { ls: 0.1, upper: true, color: C.white })}>{t('acc.tgContinue')}</T>
            </Tap>
            <Tap accessibilityRole="link" onPress={() => router.push('/login')} style={styles.other}>
              <T style={[monoSemi(13, 1, { ls: 0.06 }), { textDecorationLine: 'underline' }]}>{`${t('acc.otherMethods')} →`}</T>
            </Tap>
          </View>

          <NavGroup>
            {languageRow}
            {help}
          </NavGroup>
          {version}
        </ScrollView>
      </View>
    )
  }

  const displayName = user?.name ?? user?.first_name ?? t('tab.account')
  const initial = displayName.trim().charAt(0).toUpperCase() || 'L'
  const address = addressOf(user?.location_preset)

  const runDelete = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      setConfirming(false)
      setNotice(t('acc.deleted'))
    } catch (e) {
      setConfirming(false)
      flash((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar />
      <ScrollView contentContainerStyle={[styles.page, { gap: 14, paddingTop: 18 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={[styles.avatar, offset(2)]}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <T style={dispExtra(28, 1)}>{initial}</T>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={disp(22, 26 / 22, { ls: -0.02 })} numberOfLines={1}>
              {displayName}
            </T>
            <T style={mono(13, 18 / 13, { color: C.i70 })} numberOfLines={1}>
              {user?.phone ?? user?.email ?? '—'}
            </T>
            {isDesigner && user?.designer_handle ? (
              <T style={mono(12, 4 / 3, { color: C.i70 })} numberOfLines={1}>
                {t('acc.designerChip', { handle: user.designer_handle })}
              </T>
            ) : null}
          </View>
          <Tap accessibilityRole="button" accessibilityLabel={t('acc.personal')} onPress={() => router.push('/profile-edit')} style={styles.edit}>
            <Pencil size={18} width={2.2} />
          </Tap>
        </View>

        {!phoneVerified ? (
          <Tap accessibilityRole="button" onPress={() => router.push('/login')} style={styles.verify}>
            <T style={[monoSemi(12, 16 / 12, { color: C.amber }), { flex: 1 }]}>{t('acc.verifyNotice')}</T>
            <ChevronRight color={C.amber} />
          </Tap>
        ) : null}

        <View style={styles.stats}>
          <View style={[styles.stat, { borderRightWidth: RULE, borderRightColor: C.ink }]}>
            <T style={labelType()}>{t('acc.orders')}</T>
            <T style={disp(24, 28 / 24)}>{String(ordersCount)}</T>
          </View>
          <View style={styles.stat}>
            <T style={labelType()}>{t('acc.spent')}</T>
            <T style={monoBold(18, 28 / 18)} numberOfLines={1}>{`${fmt(user?.total_spent ?? 0)} ${t('common.sum')}`}</T>
          </View>
        </View>

        <NavGroup>
          <NavRow icon={<BoxIcon size={20} />} label={t('acc.myOrders')} onPress={() => router.push('/orders')} />
          <NavRow icon={<Layers />} label={t('acc.myDesigns')} onPress={() => router.push('/studio')} />
          {labOn ? <NavRow icon={<SlashMark width={2.6} />} label={t('acc.labHistory')} onPress={() => router.push('/lab/history')} /> : null}
          <NavRow
            icon={<Pencil />}
            label={isDesigner ? t('acc.designerCabinet') : t('acc.becomeDesigner')}
            badge={isDesigner ? undefined : t('acc.new')}
            onPress={() => router.push('/publish')}
          />
        </NavGroup>

        <NavGroup>
          <NavRow icon={<Pin size={20} width={2} />} label={t('acc.address')} sub={address ?? t('acc.addressNone')} onPress={() => router.push('/profile-edit')} />
          <NavRow icon={<Person />} label={t('acc.personal')} sub={t('acc.personalSub')} onPress={() => router.push('/profile-edit')} />
          {languageRow}
        </NavGroup>

        <NavGroup>{help}</NavGroup>

        <View style={{ gap: 4, marginTop: 4 }}>
          <Button
            title={t('common.signOut')}
            variant="outline"
            size={14}
            icon={<Logout size={18} width={2.4} />}
            style={{ backgroundColor: C.white }}
            onPress={async () => {
              await signOut()
              setNotice(t('acc.signedOut'))
            }}
          />
          <Tap accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.delete}>
            <T style={[body(14, 20 / 14, { color: C.deep }), { fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' }]}>
              {t('acc.delete')}
            </T>
          </Tap>
          <View style={{ marginTop: 6 }}>{version}</View>
        </View>
      </ScrollView>

      <DeletePanel visible={confirming} busy={deleting} onConfirm={runDelete} onCancel={() => setConfirming(false)} />
    </View>
  )
}

function addressOf(preset: string | null | undefined): string | null {
  if (!preset) return null
  try {
    const p = JSON.parse(preset) as { address?: string }
    return p.address || null
  } catch {
    return null
  }
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingBottom: 24 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  edit: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verify: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(161,98,7,.3)',
    backgroundColor: 'rgba(161,98,7,.08)',
  },
  stats: { flexDirection: 'row', borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  stat: { flex: 1, minWidth: 0, gap: 4, paddingVertical: 12, paddingHorizontal: 14 },
  delete: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    ...offset(2),
  },
  tick: { width: 20, height: 20, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  telegram: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.telegram,
  },
  other: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
})
