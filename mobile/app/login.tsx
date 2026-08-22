import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'

import { C, RULE } from '../src/theme/tokens'
import { body, disp, label as labelType, mono } from '../src/theme/type'
import { Close, DotsIcon, Telegram } from '../src/components/icons'
import { SocialButton } from '../src/components/SocialButtons'
import { Button, T, Tap, Toast, Wordmark } from '../src/components/ui'
import { useAuth } from '../src/state/auth'
import { useToast } from '../src/state/toast'
import { CLIENT_IDS, OAuthCancelled, fetchProviders, type ProviderId } from '../src/api/oauth'

const SESSION_SECONDS = 600

type Mode = 'phone' | 'wait' | 'email'

export default function Login() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { startTelegram, pollTelegram, stopPolling, signInWithEmail, signInWithOAuth } = useAuth()
  const { message, flash } = useToast()

  const [step, setStep] = useState<Mode>('phone')
  // Which providers the Worker actually holds credentials for. Anything absent
  // still renders, greyed out with «скоро», so the sheet does not silently
  // shrink between deployments.
  const [live, setLive] = useState<ProviderId[]>([])
  const [more, setMore] = useState(false)
  const [oauthBusy, setOauthBusy] = useState<ProviderId | null>(null)
  const [register, setRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [deepLink, setDeepLink] = useState('')
  const [left, setLeft] = useState(SESSION_SECONDS)
  const session = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchProviders()
      .then((ps) => alive && setLive(ps.map((p) => p.id)))
      .catch(() => {
        // Offline or an old Worker — every social button just shows «скоро».
      })
    return () => {
      alive = false
    }
  }, [])

  const close = () => {
    stopPolling()
    router.back()
  }

  const social = async (provider: ProviderId) => {
    const clientId = CLIENT_IDS[provider]
    if (!clientId) {
      flash('Этот способ входа ещё не настроен')
      return
    }
    setOauthBusy(provider)
    try {
      await signInWithOAuth(provider, clientId)
      flash('Вы вошли')
      router.back()
    } catch (e) {
      // Backing out of the browser sheet is not an error worth shouting about.
      if (!(e instanceof OAuthCancelled)) flash((e as Error).message)
    } finally {
      setOauthBusy(null)
    }
  }

  const start = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 9) {
      flash('Введите номер полностью')
      return
    }
    setBusy(true)
    try {
      const res = await startTelegram(digits)
      session.current = res.session_id
      setDeepLink(res.telegram_deep_link)
      setLeft(SESSION_SECONDS)
      setStep('wait')
      // Hand the user straight to the bot — the whole point of this flow.
      WebBrowser.openBrowserAsync(res.telegram_deep_link).catch(() => {})
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitEmail = async () => {
    // The backend rejects anything under 8 characters (routes/auth.ts), so
    // validating at 6 here just turned a fixable field error into a server
    // error the user could not act on.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      flash('Введите корректный email')
      return
    }
    if (password.length < 8) {
      flash('Пароль — минимум 8 символов')
      return
    }
    setBusy(true)
    try {
      await signInWithEmail(
        { email: email.trim(), password, name: name.trim() || undefined },
        register,
      )
      flash(register ? 'Аккаунт создан' : 'Вы вошли')
      router.back()
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Poll every 2s while waiting, exactly like the web flow.
  useEffect(() => {
    if (step !== 'wait' || !session.current) return
    let alive = true

    const tick = async () => {
      if (!alive || !session.current) return
      try {
        const res = await pollTelegram(session.current)
        if (!alive) return
        if (res.status === 'verified') {
          flash('Вы вошли — номер подтверждён')
          router.back()
          return
        }
        if (res.status === 'failed' || res.status === 'expired') {
          flash('Сессия истекла — попробуйте ещё раз')
          setStep('phone')
          return
        }
      } catch {
        // A transient network blip shouldn't end the wait.
      }
    }

    const poll = setInterval(tick, 2000)
    const countdown = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000)
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(countdown)
    }
  }, [step, pollTelegram, router, flash])

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  const progress = left / SESSION_SECONDS

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 30 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Tap style={styles.close} onPress={close} hitSlop={8}>
          <Close />
        </Tap>

        {step === 'phone' ? (
          <View style={styles.center}>
            <Wordmark size={17} />
            <T style={[disp(36, 0.98, { ls: -0.035 }), { marginTop: 22, marginBottom: 8 }]}>
              Вход в аккаунт
            </T>
            <T style={[body(15, 1.6, { color: C.i55 }), { marginBottom: 28 }]}>
              Войдите, чтобы отслеживать заказы
            </T>

            <T style={[labelType(10.5, { color: C.i70 }), { marginBottom: 8 }]}>Номер телефона</T>
            <View style={styles.phoneField}>
              <View style={styles.prefix}>
                <T style={{ fontFamily: 'IBMPlexMono_500Medium', fontSize: 16, color: C.ink }}>
                  +998
                </T>
              </View>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="90 123 45 67"
                placeholderTextColor={C.i38}
                keyboardType="number-pad"
                style={styles.phoneInput}
                allowFontScaling={false}
                maxLength={12}
              />
            </View>

            <Tap haptic style={styles.tgBtn} onPress={busy ? undefined : start}>
              <Telegram />
              <T style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13.1, color: C.white, letterSpacing: 0.5 }}>
                {busy ? 'Открываем Telegram…' : 'Продолжить через Telegram'}
              </T>
            </Tap>
            <T style={[body(11.8, 1.5, { color: C.i38, align: 'center' }), { marginTop: 10 }]}>
              Подтвердим ваш номер через Telegram — быстро и без пароля.
            </T>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <T style={body(11.5, 1, { ls: 0.06, color: C.i38 })}>или</T>
              <View style={styles.dividerLine} />
            </View>

            {/* Google rides above the fold with Telegram; Facebook, Discord and
                email sit behind the overflow row so the sheet stays two-choice. */}
            <SocialButton
              kind="google"
              disabled={!live.includes('google')}
              busy={oauthBusy === 'google'}
              onPress={() => social('google')}
            />

            {more ? (
              <>
                <SocialButton
                  kind="facebook"
                  disabled={!live.includes('facebook')}
                  busy={oauthBusy === 'facebook'}
                  onPress={() => social('facebook')}
                />
                <SocialButton
                  kind="discord"
                  disabled={!live.includes('discord')}
                  busy={oauthBusy === 'discord'}
                  onPress={() => social('discord')}
                />
                <SocialButton kind="email" onPress={() => setStep('email')} />
              </>
            ) : (
              <Tap haptic style={styles.moreRow} onPress={() => setMore(true)} hitSlop={6}>
                <DotsIcon color={C.i55} />
                <T style={body(12.5, 1, { color: C.i55 })}>Другие способы входа</T>
              </Tap>
            )}

            <T style={[body(12.5, 1.5, { color: C.i55, align: 'center' }), { marginTop: 18 }]}>
              Нет аккаунта?{' '}
              <T
                style={{ color: C.deep }}
                onPress={() => {
                  setRegister(true)
                  setStep('email')
                }}
              >
                Зарегистрироваться
              </T>
            </T>
          </View>
        ) : step === 'email' ? (
          <View style={styles.center}>
            <Wordmark size={17} />
            <T style={[disp(34, 0.98, { ls: -0.035 }), { marginTop: 22, marginBottom: 8 }]}>
              {register ? 'Регистрация' : 'Вход по email'}
            </T>
            <T style={[body(15, 1.6, { color: C.i55 }), { marginBottom: 24 }]}>
              {register
                ? 'Телефон можно подтвердить позже — он нужен только для заказа.'
                : 'Введите email и пароль от вашего аккаунта LOOM.'}
            </T>

            {register ? (
              <Field label="Имя" value={name} onChange={setName} placeholder="Темурбек" />
            ) : null}
            <Field
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              keyboard="email-address"
            />
            <Field
              label="Пароль"
              value={password}
              onChange={setPassword}
              placeholder="Минимум 8 символов"
              secure
            />

            <Button
              title={register ? 'Создать аккаунт' : 'Войти'}
              variant="ink"
              size={13}
              vPad={16}
              loading={busy}
              style={{ marginTop: 6 }}
              onPress={submitEmail}
            />
            <T
              style={[body(12.5, 1.5, { color: C.deep, align: 'center' }), { marginTop: 18 }]}
              onPress={() => setRegister(!register)}
            >
              {register ? 'У меня уже есть аккаунт' : 'Создать аккаунт'}
            </T>
            <T
              style={[body(12.5, 1.5, { color: C.i55, align: 'center' }), { marginTop: 14 }]}
              onPress={() => setStep('phone')}
            >
              ← Войти через Telegram
            </T>
          </View>
        ) : (
          <View style={[styles.center, { alignItems: 'center' }]}>
            <Spinner />
            <T style={[disp(26, 1.05, { ls: -0.03, align: 'center' }), { marginTop: 24, marginBottom: 10 }]}>
              Ожидаем подтверждение
            </T>
            <T style={[body(14.5, 1.6, { color: C.i55, align: 'center' }), styles.waitCopy]}>
              Перейдите в Telegram и нажмите «Поделиться номером телефона».
            </T>

            <Tap
              haptic
              style={[styles.tgBtn, { marginBottom: 26 }]}
              onPress={() => WebBrowser.openBrowserAsync(deepLink).catch(() => {})}
            >
              <Telegram />
              <T style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13.1, color: C.white, letterSpacing: 0.5 }}>
                Открыть Telegram бот
              </T>
            </Tap>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <T style={[mono(10.5, 1.4, { ls: 0.14, upper: true, color: C.i38 }), { marginTop: 8, marginBottom: 26 }]}>
              {`+998 ${phone} · осталось ${mmss}`}
            </T>

            <Tap
              onPress={() => {
                stopPolling()
                setStep('phone')
              }}
              style={{ paddingVertical: 12, paddingHorizontal: 8 }}
            >
              <T style={[body(12.5, 1, { color: C.i55 }), { textDecorationLine: 'underline' }]}>
                Отменить
              </T>
            </Tap>
          </View>
        )}

        <T style={[mono(10.5, 1.6, { ls: 0.06, color: C.i38, align: 'center' })]}>
          Входя, вы соглашаетесь с условиями LOOM
        </T>
      </ScrollView>
      <Toast message={message} bottom={60} />
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard,
  secure,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  keyboard?: 'default' | 'email-address'
  secure?: boolean
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <T style={[labelType(10.5, { color: C.i70 }), { marginBottom: 8 }]}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.i38}
        keyboardType={keyboard ?? 'default'}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.textField}
        allowFontScaling={false}
      />
    </View>
  )
}

/** The coral-topped ring from the design's waiting state. */
function Spinner() {
  const spin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  return (
    <Animated.View
      style={[
        styles.spinner,
        { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  page: { flexGrow: 1, paddingHorizontal: 24 },
  close: { width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center' },

  phoneField: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    marginBottom: 12,
  },
  prefix: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRightWidth: RULE,
    borderRightColor: C.ink,
    backgroundColor: C.paper,
  },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 15,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },
  tgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8.8,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: RULE,
    borderColor: C.telegram,
    backgroundColor: C.telegram,
  },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.i09 },
  textField: {
    paddingHorizontal: 14,
    paddingVertical: 15,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 14,
  },
  waitCopy: { maxWidth: 260, marginBottom: 24 },
  spinner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: 'rgba(19,19,17,.16)',
    borderTopColor: C.coral,
  },
  progressTrack: { width: '100%', height: 3, backgroundColor: 'rgba(19,19,17,.09)' },
  progressFill: { height: '100%', backgroundColor: C.coral },
})
