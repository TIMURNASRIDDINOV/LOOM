import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { API_BASE, api, setToken, getToken, ApiError } from '../api/client'
import type { Me, TelegramStart, TelegramStatus } from '../api/types'
import { signInWithProvider, type ProviderId } from '../api/oauth'
import { tStatic } from '../i18n'

type AuthState = {
  user: Me | null
  loading: boolean
  signedIn: boolean
  /** True once the user has a Telegram-verified phone — required to order. */
  phoneVerified: boolean
  refresh: () => Promise<void>
  /** Email/password fallback for users without Telegram. */
  signInWithEmail: (
    creds: { email: string; password: string; name?: string },
    register: boolean,
  ) => Promise<void>
  /** Social sign-in. Throws OAuthCancelled if the user backs out. */
  signInWithOAuth: (provider: ProviderId, clientId: string) => Promise<void>
  /** True once the user has opted in as a designer — gates artwork upload. */
  isDesigner: boolean
  /** Claim a designer handle; resolves with the updated profile. */
  applyAsDesigner: (handle: string, bio?: string) => Promise<void>
  /** Name / phone / saved delivery address. */
  updateProfile: (patch: {
    name?: string | null
    phone?: string | null
    location_preset?: { address: string; lat?: number; lng?: number } | null
  }) => Promise<void>
  /** Upload a new avatar from a local image URI. */
  uploadAvatar: (uri: string, mime: string) => Promise<void>
  /** Permanently delete the account (store-policy requirement). */
  deleteAccount: () => Promise<void>
  startTelegram: (phone: string) => Promise<TelegramStart>
  pollTelegram: (sessionId: string) => Promise<TelegramStatus>
  stopPolling: () => void
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const polling = useRef(true)

  const refresh = useCallback(async () => {
    const token = await getToken()
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await api<Me>('/api/auth/me', { auth: true })
      setUser(me)
    } catch (e) {
      // A 401 means the stored JWT expired or was revoked — drop it so the app
      // falls back to the signed-out state instead of retrying forever.
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        await setToken(null)
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const signInWithEmail = useCallback<AuthState['signInWithEmail']>(
    async (creds, register) => {
      const res = await api<{ token: string; user: Me }>(
        register ? '/api/auth/register' : '/api/auth/login',
        { method: 'POST', body: creds },
      )
      await setToken(res.token)
      // register/login return only {id,email,name}. Storing that as the whole
      // user left `telegram_user_id` undefined, so checkout wrongly demanded
      // phone verification from an already-verified account. Refetch /me.
      await refresh()
    },
    [refresh],
  )

  const signInWithOAuth = useCallback<AuthState['signInWithOAuth']>(
    async (provider, clientId) => {
      const res = await signInWithProvider(provider, clientId)
      await setToken(res.token)
      await refresh()
    },
    [refresh],
  )

  const applyAsDesigner = useCallback<AuthState['applyAsDesigner']>(
    async (handle, bio) => {
      await api('/api/designer/apply', { method: 'POST', auth: true, body: { handle, bio } })
      await refresh()
    },
    [refresh],
  )

  const updateProfile = useCallback<AuthState['updateProfile']>(
    async (patch) => {
      await api('/api/auth/profile', { method: 'PATCH', auth: true, body: patch })
      await refresh()
    },
    [refresh],
  )

  const uploadAvatar = useCallback<AuthState['uploadAvatar']>(
    async (uri, mime) => {
      const form = new FormData()
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
      form.append('avatar', { uri, name: `avatar.${ext}`, type: mime } as unknown as Blob)
      const token = await getToken()
      const res = await fetch(`${API_BASE}/api/auth/avatar`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        throw new ApiError(d?.error ?? tStatic('common.photoFailed'), res.status)
      }
      await refresh()
    },
    [refresh],
  )

  const deleteAccount = useCallback(async () => {
    await api('/api/auth/account', { method: 'DELETE', auth: true })
    await setToken(null)
    setUser(null)
  }, [])

  const startTelegram = useCallback(async (phone: string) => {
    polling.current = true
    // The backend requires E.164.
    const e164 = phone.startsWith('+') ? phone : `+998${phone.replace(/\D/g, '')}`
    return api<TelegramStart>('/api/auth/telegram/start', {
      method: 'POST',
      body: { phone: e164 },
    })
  }, [])

  const pollTelegram = useCallback(
    async (sessionId: string) => {
      if (!polling.current) return { status: 'pending' } as TelegramStatus
      // `client=app` is what asks for the token in the body. Native has no
      // cookie jar, so without it the poll returns `verified` and nothing else
      // and the app stays signed out while the bot says otherwise.
      const res = await api<TelegramStatus>(
        `/api/auth/telegram/status?session_id=${encodeURIComponent(sessionId)}&client=app`,
      )
      if (res.status === 'verified') {
        if (!res.token) {
          // Verified but nothing to store — never report this as a success.
          throw new Error(tStatic('login.errNoToken'))
        }
        // The backend marks the token single-use on this first `verified` poll.
        await setToken(res.token)
        await refresh()
      }
      return res
    },
    [refresh],
  )

  const stopPolling = useCallback(() => {
    polling.current = false
  }, [])

  const signOut = useCallback(async () => {
    polling.current = false
    try {
      await api('/api/auth/logout', { method: 'POST', auth: true })
    } catch {
      // Clearing the local token is what actually signs the app out.
    }
    await setToken(null)
    setUser(null)
  }, [])

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        signedIn: !!user,
        phoneVerified: !!user?.telegram_user_id,
        refresh,
        signInWithEmail,
        signInWithOAuth,
        isDesigner: !!user?.is_designer,
        applyAsDesigner,
        updateProfile,
        uploadAvatar,
        deleteAccount,
        startTelegram,
        pollTelegram,
        stopPolling,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
