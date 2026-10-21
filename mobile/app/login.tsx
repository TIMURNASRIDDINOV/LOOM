import React, { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'

import { C, F, RULE, offset } from '../src/theme/tokens'
import { body, disp, kicker, label as labelType, monoBold, monoSemi } from '../src/theme/type'
import { BackHeader } from '../src/components/AppBar'
import { Apple, Discord, Facebook, Google, Telegram } from '../src/components/icons'
import { Clock, Phone } from '../src/components/start/glyphs'
import { PhoneField } from '../src/components/start/PhoneField'
import { visibleProviders } from '../src/components/start/providers'
import { Button, Input, T, Tap, Toast } from '../src/components/ui'
import { useAuth } from '../src/state/auth'
import { useToast } from '../src/state/toast'
import { goBack } from '../src/lib/nav'
import { useT } from '../src/i18n'
import type { StringKey } from '../src/i18n/strings'
import {
  OAuthCancelled,
  fetchProviders,
  type ProviderId,
  type ProviderInfo,
} from '../src/api/oauth'

// Used only when the Worker's reply carries no usable `expires_at`.
const SESSION_MS = 10 * 60 * 1000

type Mode = 'phone' | 'wait' | 'email'

// What each provider button says and draws.
const PROVIDER: Record<ProviderId, { label: StringKey; glyph: React.ReactNode }> = {
  apple: { label: 'login.apple', glyph: <Apple size={20} /> },
  google: { label: 'login.google', glyph: <Google size={20} /> },
  facebook: { label: 'login.facebook', glyph: <Facebook size={20} /> },
  discord: { label: 'login.discord', glyph: <Discord size={20} /> },
}

// Telegram-blue button text: white on the brand blue, tracking from the design (.1em).
const TG_TEXT = { color: C.white, letterSpacing: 1.3 }
const OUTLINE_TEXT = { letterSpacing: 1.3 }

type Errors = { phone?: string; email?: string; password?: string; form?: string }

export default function Login() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { startTelegram, pollTelegram, stopPolling, signInWithEmail, signInWithOAuth } = useAuth()
  const { message, flash } = useToast()
  const t = useT()

  const [step, setStep] = useState<Mode>('phone')
  // Which providers the Worker holds credentials for. A provider it does not
  // list is not drawn at all — no «скоро» placeholder in a store build.
  const [live, setLive] = useState<ProviderInfo[]>([])
  const [oauthBusy, setOauthBusy] = useState<ProviderId | null>(null)
  const [register, setRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Errors>({})
  const [deepLink, setDeepLink] = useState('')
  const [endsAt, setEndsAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [expired, setExpired] = useState(false)
  const session = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchProviders()
      .then((ps) => alive && setLive(ps))
      .catch(() => {
        // Offline or an old Worker: Telegram and email still work.
      })
    return () => {
      alive = false
    }
  }, [])

  const go = (mode: Mode) => {
    setErr({})
    setStep(mode)
  }

  const cancelWait = () => {
    stopPolling()
    setExpired(false)
    go('phone')
  }

  const social = async (provider: ProviderId) => {
    const info = live.find((p) => p.id === provider)
    if (!info) return
    setErr({})
    setOauthBusy(provider)
    try {
      await signInWithOAuth(provider, info.clientId)
      flash(t('login.done'))
      goBack(router)
    } catch (e) {
      // Backing out of the browser sheet is not an error worth shouting about.
      if (!(e instanceof OAuthCancelled)) setErr({ form: (e as Error).message })
    } finally {
      setOauthBusy(null)
    }
  }

  const openBot = (link: string) =>
    WebBrowser.openBrowserAsync(link).catch(() => setErr({ form: t('login.errBot') }))

  const start = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 9) {
      setErr({ phone: t('login.errPhone') })
      return
    }
    setErr({})
    setBusy(true)
    try {
      const res = await startTelegram(digits)
      session.current = res.session_id
      setDeepLink(res.telegram_deep_link)
      // The Worker says when the session ends; a reused session may have less than 10 min left.
      const end = Number(res.expires_at)
      setEndsAt(Number.isFinite(end) ? end : Date.now() + SESSION_MS)
      setNow(Date.now())
      setExpired(false)
      setStep('wait')
      // Hand the user straight to the bot — the whole point of this flow.
      openBot(res.telegram_deep_link)
    } catch (e) {
      setErr({ form: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const submitEmail = async () => {
    // The backend rejects anything under 8 characters (routes/auth.ts); both
    // checks run before any request goes out.
    const e: Errors = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = t('login.errEmail')
    if (password.length < 8) e.password = t('login.errPassword')
    setErr(e)
    if (e.email || e.password) return
    setBusy(true)
    try {
      await signInWithEmail(
        { email: email.trim(), password, name: name.trim() || undefined },
        register,
      )
      flash(register ? t('login.created') : t('login.done'))
      goBack(router)
    } catch (x) {
      setErr({ form: (x as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const waiting = step === 'wait' && !expired

  // Poll every 2s while waiting, exactly like the web flow.
  useEffect(() => {
    if (!waiting || !session.current) return
    let alive = true

    const tick = async () => {
      if (!alive || !session.current) return
      try {
        const res = await pollTelegram(session.current)
        if (!alive) return
        if (res.status === 'verified') {
          flash(t('login.doneVerified'))
          goBack(router)
        } else if (res.status === 'failed' || res.status === 'expired') {
          stopPolling()
          setExpired(true)
        }
      } catch (e) {
        // A transient network blip shouldn't end the wait — but a server that
        // verifies without handing back a token never will, so surface that
        // instead of spinning until the countdown runs out.
        const msg = (e as Error)?.message ?? ''
        if (msg === t('login.errNoToken')) {
          stopPolling()
          setErr({ form: msg })
          setStep('phone')
        }
      }
    }

    const poll = setInterval(tick, 2000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [waiting, pollTelegram, stopPolling, router, flash, t])

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000))
  useEffect(() => {
    if (waiting && left === 0) {
      stopPolling()
      setExpired(true)
    }
  }, [waiting, left, stopPolling])

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  const providers = visibleProviders(live, Platform.OS)

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <BackHeader onBack={step === 'phone' ? undefined : step === 'wait' ? cancelWait : () => go('phone')} />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'phone' ? (
          <View style={styles.main}>
            <Heading kick={t('common.signIn')} title={t('login.title')} sub={t('login.subtitle')} compact />

            <View style={{ gap: 12 }}>
              <PhoneField
                label={t('login.phone')}
                value={phone}
                onChange={(v) => {
                  setPhone(v)
                  if (err.phone) setErr({})
                }}
                error={err.phone}
                onSubmit={start}
              />
              <Button
                title={t('login.tgContinue')}
                variant="ink"
                size={13}
                loading={busy}
                icon={<Telegram size={20} />}
                style={{ backgroundColor: C.telegram }}
                textStyle={TG_TEXT}
                onPress={start}
              />
              <T style={body(13, 18 / 13, { color: C.i70 })}>{t('login.tgHint')}</T>
              {err.form ? <T style={body(13, 18 / 13, { color: C.deep })}>{err.form}</T> : null}
            </View>

            {providers.length > 0 ? (
              <>
                <View style={styles.divider}>
                  <View style={styles.rule} />
                  <T style={labelType(12)}>{t('login.or')}</T>
                  <View style={styles.rule} />
                </View>
                <View style={{ gap: 12 }}>
                  {providers.map((id) => (
                    <Button
                      key={id}
                      title={t(PROVIDER[id].label)}
                      variant="outline"
                      size={13}
                      loading={oauthBusy === id}
                      icon={PROVIDER[id].glyph}
                      style={{ backgroundColor: C.white }}
                      textStyle={OUTLINE_TEXT}
                      onPress={() => social(id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Tap accessibilityRole="link" style={styles.more} onPress={() => go('email')}>
              <T style={[monoSemi(13, 1.2, { ls: 0.06 }), styles.underline]}>{t('login.more')} →</T>
            </Tap>
          </View>
        ) : step === 'email' ? (
          <View style={styles.main}>
            <Heading
              kick={t('common.signIn')}
              title={register ? t('login.registerTitle') : t('login.emailTitle')}
              sub={register ? t('login.registerHint') : t('login.emailHint')}
              compact
            />

            <View style={{ gap: 18 }}>
              {register ? (
                <Input
                  label={t('login.name')}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('login.namePh')}
                  autoComplete="name"
                />
              ) : null}
              <Input
                label={t('login.emailLabel')}
                value={email}
                onChangeText={setEmail}
                error={err.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
              <Input
                label={t('login.password')}
                value={password}
                onChangeText={setPassword}
                error={err.password}
                placeholder={t('login.passwordPh')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={register ? 'new-password' : 'current-password'}
                onSubmitEditing={submitEmail}
              />
              {err.form ? <T style={body(13, 18 / 13, { color: C.deep })}>{err.form}</T> : null}
              <Button
                title={register ? t('login.create') : t('common.signIn')}
                loading={busy}
                style={{ marginTop: 6 }}
                onPress={submitEmail}
              />
            </View>

            <Tap accessibilityRole="link" style={styles.more} onPress={() => go('phone')}>
              <T style={[monoSemi(13, 1.2, { ls: 0.06 }), styles.underline]}>{t('login.backToTelegram')}</T>
            </Tap>
          </View>
        ) : (
          <>
            <View style={[styles.main, { paddingTop: 32, gap: 28 }]}>
              <View style={styles.handoff} accessibilityElementsHidden>
                <View style={[styles.square, { backgroundColor: C.white }, offset(2)]}>
                  <Phone />
                </View>
                <View style={styles.dashes}>
                  <View style={styles.dashRow}>
                    {Array.from({ length: 40 }, (_, i) => (
                      <View key={i} style={styles.dash} />
                    ))}
                  </View>
                  <View style={styles.marker} />
                </View>
                <View style={[styles.square, { backgroundColor: C.telegram }, offset(2)]}>
                  <Telegram size={30} />
                </View>
              </View>

              <Heading
                kick={expired ? t('common.signIn') : t('login.tgOpening')}
                title={expired ? t('login.expiredTitle') : t('login.waitTitle')}
                sub={expired ? t('login.expired') : t('login.waitBody')}
              />

              <View style={styles.numberCard}>
                <View style={{ gap: 4, flexShrink: 0 }}>
                  <T style={labelType(12)}>{t('login.phone')}</T>
                  <T style={monoSemi(17, 22 / 17)}>{`+998 ${phone}`}</T>
                </View>
                <View style={[styles.chip, expired && { backgroundColor: C.paper2 }]}>
                  <Clock />
                  <T style={monoBold(12, 16 / 12, { ls: 0.06 })}>{t('login.left', { time: mmss })}</T>
                </View>
              </View>
              {err.form ? <T style={body(13, 18 / 13, { color: C.deep })}>{err.form}</T> : null}
            </View>

            <View style={{ gap: 10, paddingTop: 24 }}>
              {expired ? (
                <Button title={t('common.retry')} loading={busy} onPress={start} />
              ) : (
                <Button
                  title={t('login.openBot')}
                  variant="ink"
                  size={13}
                  icon={<Telegram size={20} />}
                  style={{ backgroundColor: C.telegram }}
                  textStyle={TG_TEXT}
                  onPress={() => openBot(deepLink)}
                />
              )}
              <Tap accessibilityRole="button" style={styles.cancel} onPress={cancelWait}>
                <T style={disp(13, 1, { ls: 0.14, upper: true })}>{t('common.cancel')}</T>
              </Tap>
            </View>
          </>
        )}

        {step !== 'wait' ? (
          <View style={styles.footer}>
            <View style={styles.prompt}>
              <T style={body(14, 20 / 14, { color: C.i70 })}>
                {register && step === 'email' ? '' : `${t('login.noAccount')} `}
              </T>
              <Tap
                accessibilityRole="link"
                style={styles.link}
                onPress={() => {
                  setRegister(step === 'email' ? !register : true)
                  go('email')
                }}
              >
                <T style={[bodyLink, styles.underline]}>
                  {register && step === 'email' ? t('login.haveAccount') : t('login.register')}
                </T>
              </Tap>
            </View>
            {step === 'phone' ? (
              <T style={body(12, 16 / 12, { color: C.i70, align: 'center' })}>{t('login.terms')}</T>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <Toast message={message} bottom={60} />
    </KeyboardAvoidingView>
  )
}

const bodyLink = { fontFamily: F.bodySemi, fontSize: 14, lineHeight: 20, color: C.ink }

/** Kicker, 34px title and a line of copy: the head of every start screen (W06–W08). */
function Heading({ kick, title, sub, compact }: { kick: string; title: string; sub: string; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      <T style={kicker()}>{kick}</T>
      <T style={disp(34, 1, { ls: -0.035 })}>{title}</T>
      <T style={compact ? body(15, 22 / 15, { color: C.i70 }) : body(16, 24 / 16, { color: C.i70 })}>{sub}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  page: { flexGrow: 1, paddingHorizontal: 16 },
  main: { flex: 1, paddingTop: 24, gap: 22 },
  underline: { textDecorationLine: 'underline' },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: 1, backgroundColor: C.line },
  more: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },

  handoff: { flexDirection: 'row', alignItems: 'center', height: 96, paddingHorizontal: 6 },
  square: {
    width: 72,
    height: 72,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashes: { flex: 1, height: 12, marginHorizontal: 10, justifyContent: 'center' },
  dashRow: { flexDirection: 'row', height: 2, overflow: 'hidden' },
  dash: { width: 6, height: 2, marginRight: 6, backgroundColor: C.ink },
  marker: {
    position: 'absolute',
    left: '44%',
    top: 0,
    width: 12,
    height: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
  },

  // The chip drops under the number when a long «осталось 4:52» does not fit beside it.
  numberCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: C.coral,
  },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },

  footer: { alignItems: 'center', gap: 4, paddingTop: 24 },
  prompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
})
