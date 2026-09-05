import React, { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'

import { C, RULE } from '../../src/theme/tokens'
import { body, disp, label as labelType, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronLeft } from '../../src/components/icons'
import { MapPicker, type Pin } from '../../src/components/MapPicker'
import { Button, T, Tap } from '../../src/components/ui'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'
import { goBack } from '../../src/lib/nav'

/** Personal data: photo, name, phone and the saved delivery address. */
export default function ProfileEdit() {
  const router = useRouter()
  const { user, signedIn, phoneVerified, updateProfile, uploadAvatar } = useAuth()
  const { flash } = useToast()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [pin, setPin] = useState<Pin | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    setName(user.name ?? [user.first_name, user.last_name].filter(Boolean).join(' '))
    setPhone(user.phone ?? '')
    if (user.location_preset) {
      try {
        const p = JSON.parse(user.location_preset) as { address?: string; lat?: number; lng?: number }
        if (p.address) setAddress(p.address)
        if (typeof p.lat === 'number' && typeof p.lng === 'number') setPin({ lat: p.lat, lng: p.lng, address: p.address })
      } catch {
        // malformed preset — start blank
      }
    }
  }, [user])

  if (!signedIn) {
    router.replace('/login')
    return null
  }

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      flash('Нужен доступ к фото')
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
      flash('Фото больше 2 МБ — выберите поменьше')
      return
    }
    setAvatarBusy(true)
    try {
      await uploadAvatar(a.uri, a.mimeType ?? 'image/jpeg')
      flash('Фото обновлено')
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setAvatarBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await updateProfile({
        name: name.trim() || null,
        // A Telegram-verified number is the one the courier calls; the field is
        // read-only in that case so it cannot drift from the verified value.
        ...(phoneVerified ? {} : { phone: phone.trim() || null }),
        location_preset: address.trim()
          ? { address: address.trim(), lat: pin?.lat, lng: pin?.lng }
          : null,
      })
      flash('Сохранено')
      goBack(router)
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const initial = (name || user?.email || 'L').trim().charAt(0).toUpperCase()

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      <AppBar title="ПРОФИЛЬ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Tap style={styles.back} onPress={() => goBack(router)}>
          <ChevronLeft size={13} width={2.4} color={C.i55} />
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>Назад</T>
        </Tap>
        <T style={[disp(28, 1, { ls: -0.03 }), { marginBottom: 18 }]}>
          Личные данные<T style={{ color: C.coral }}>/</T>
        </T>

        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 26, color: C.white }}>{initial}</T>
            )}
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Button title={avatarBusy ? 'Загружаем…' : 'Сменить фото'} variant="outline" size={11.5} vPad={11} loading={avatarBusy} onPress={pickAvatar} />
            <T style={body(11, 1.5, { color: C.i38 })}>PNG, JPG или WebP до 2 МБ</T>
          </View>
        </View>

        <Field label="Имя" value={name} onChange={setName} placeholder="Как к вам обращаться" />
        <Field
          label={phoneVerified ? 'Телефон · подтверждён в Telegram' : 'Телефон'}
          value={phone}
          onChange={setPhone}
          placeholder="+998 90 123-45-67"
          keyboard="phone-pad"
          disabled={phoneVerified}
        />
        {user?.email && !user.email.endsWith('@oauth.loom') ? (
          <Field label="Email" value={user.email} onChange={() => {}} disabled />
        ) : null}

        <T style={[labelType(9.5, { color: C.i70 }), { marginTop: 8, marginBottom: 6 }]}>Адрес доставки</T>
        <MapPicker
          value={pin}
          onChange={(next) => {
            setPin(next)
            if (next.address && !address.trim()) setAddress(next.address)
          }}
        />
        <Field label="Улица, дом" value={address} onChange={setAddress} placeholder="Ташкент, ул. Навои 12" />

        <Button title="Сохранить" vPad={16} loading={busy} style={{ marginTop: 8 }} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  keyboard?: 'default' | 'phone-pad' | 'email-address'
  disabled?: boolean
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.i38}
        keyboardType={keyboard ?? 'default'}
        editable={!disabled}
        style={[styles.input, disabled && { color: C.i55, backgroundColor: C.paper }]}
        allowFontScaling={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 32 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 14 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  avatar: {
    width: 72,
    height: 72,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
})
