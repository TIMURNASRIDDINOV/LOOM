import React, { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, HAIR, RULE, noShadow, offset } from '../../src/theme/tokens'
import { disp, dispExtra, kicker, mono } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Button, Input, T, Tap } from '../../src/components/ui'
import { Camera, Lock } from '../../src/components/account/icons'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'
import { goBack } from '../../src/lib/nav'
import { useT } from '../../src/i18n'

// The saved delivery address lives in `users.location_preset` (free JSON). W35
// adds the four detail fields; they use the keys of an order's `address_details`.
type Preset = { address?: string; lat?: number; lng?: number; entrance?: string; apartment?: string; floor?: string; intercom?: string }
const DETAILS = ['entrance', 'apartment', 'floor', 'intercom'] as const

function parsePreset(raw: string | null | undefined): Preset {
  if (!raw) return {}
  try {
    const p: unknown = JSON.parse(raw)
    return p && typeof p === 'object' ? (p as Preset) : {}
  } catch {
    return {}
  }
}

/** W35 personal data: photo, name, phone and the saved delivery address. */
export default function ProfileEdit() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signedIn, loading: authLoading, phoneVerified, updateProfile, uploadAvatar } = useAuth()
  const { flash } = useToast()
  const t = useT()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saved, setSaved] = useState<Preset>({})
  const [street, setStreet] = useState('')
  const [details, setDetails] = useState<Record<(typeof DETAILS)[number], string>>({ entrance: '', apartment: '', floor: '', intercom: '' })
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    setName(user.name ?? [user.first_name, user.last_name].filter(Boolean).join(' '))
    setPhone(user.phone ?? '')
    const p = parsePreset(user.location_preset)
    setSaved(p)
    setStreet(p.address ?? '')
    setDetails({ entrance: p.entrance ?? '', apartment: p.apartment ?? '', floor: p.floor ?? '', intercom: p.intercom ?? '' })
  }, [user])

  // While the session is still being read at launch, `signedIn` is false for a moment.
  if (authLoading) return <View style={{ flex: 1, backgroundColor: C.paper }} />
  if (!signedIn) return <Redirect href="/login" />

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      flash(t('pe.photoPerm'))
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    })
    if (res.canceled || !res.assets?.length) return
    const a = res.assets[0]
    if (a.fileSize && a.fileSize > 2 * 1024 * 1024) {
      flash(t('pe.photoBig'))
      return
    }
    setAvatarBusy(true)
    try {
      await uploadAvatar(a.uri, a.mimeType ?? 'image/jpeg')
      flash(t('pe.photoDone'))
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setAvatarBusy(false)
    }
  }

  const save = async () => {
    const address = street.trim()
    const extra = Object.fromEntries(DETAILS.map((k) => [k, details[k].trim()]).filter(([, v]) => v))
    // The map pin belongs to the street it was set for: edit the street and it is dropped.
    const pin = address && address === saved.address && typeof saved.lat === 'number' && typeof saved.lng === 'number'
      ? { lat: saved.lat, lng: saved.lng }
      : {}
    setBusy(true)
    try {
      await updateProfile({
        name: name.trim() || null,
        // A Telegram-verified number is the one the courier calls; the field is
        // read-only in that case so it cannot drift from the verified value.
        ...(phoneVerified ? {} : { phone: phone.trim() || null }),
        // auth.tsx types the preset as {address, lat, lng}; the server stores any JSON object.
        location_preset: address || Object.keys(extra).length ? ({ address, ...pin, ...extra } as { address: string }) : null,
      })
      flash(t('pe.saved'))
      goBack(router)
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const initial = (name || user?.email || 'L').trim().charAt(0).toUpperCase()
  const realEmail = user?.email && !user.email.endsWith('@oauth.loom') ? user.email : null

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <BackHeader title={t('pe.title')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarRow}>
          <View style={[styles.avatar, offset(3)]}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <T style={dispExtra(36, 1)}>{initial}</T>
            )}
          </View>
          <View style={{ flex: 1, gap: 6, alignItems: 'flex-start' }}>
            <Tap
              accessibilityRole="button"
              accessibilityState={{ busy: avatarBusy, disabled: avatarBusy }}
              disabled={avatarBusy}
              onPress={pickAvatar}
              style={[styles.photoBtn, offset(2)]}
            >
              <Camera size={16} width={2.4} />
              <T style={disp(13, 1)}>{avatarBusy ? t('pe.uploading') : t('pe.changePhoto')}</T>
            </Tap>
            <T style={mono(12, 4 / 3, { color: C.i70 })}>{t('pe.photoHint')}</T>
          </View>
        </View>

        <Input label={t('pe.name')} value={name} onChangeText={setName} placeholder={t('pe.namePh')} />

        <View>
          <Input
            label={phoneVerified ? t('pe.phoneVerified') : t('pe.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="+998 90 123-45-67"
            keyboardType="phone-pad"
            editable={!phoneVerified}
            style={phoneVerified ? [styles.locked, { fontFamily: 'IBMPlexMono_400Regular', paddingRight: 44 }] : undefined}
          />
          {phoneVerified ? (
            <View pointerEvents="none" style={styles.lock}>
              <Lock size={18} width={2.2} />
            </View>
          ) : null}
        </View>

        {realEmail ? <Input label="Email" value={realEmail} editable={false} style={styles.locked} /> : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          <T style={[kicker(), styles.legend]}>{t('pe.address')}</T>
          <Input label={t('pe.street')} value={street} onChangeText={setStreet} placeholder={t('co.addressPh')} />
          <View style={styles.grid}>
            {DETAILS.map((k) => (
              <View key={k} style={styles.cell}>
                <Input
                  label={t(`pe.${k}`)}
                  value={details[k]}
                  onChangeText={(v) => setDetails((d) => ({ ...d, [k]: v }))}
                  style={{ fontFamily: 'IBMPlexMono_400Regular' }}
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 30 + insets.bottom }]}>
        <Button title={t('common.save')} size={14} loading={busy} onPress={save} />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 14 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 84,
    height: 84,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  locked: { backgroundColor: C.paper2, borderColor: 'rgba(19,19,17,0.3)', color: C.ink, ...noShadow },
  lock: { position: 'absolute', right: 14, bottom: 17 },
  legend: { paddingBottom: 6, borderBottomWidth: HAIR, borderBottomColor: C.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 10 },
  cell: { width: '47%', flexGrow: 1, minWidth: 0 },
  footer: { paddingTop: 12, paddingHorizontal: 16, backgroundColor: C.paper, borderTopWidth: RULE, borderTopColor: C.ink },
})
