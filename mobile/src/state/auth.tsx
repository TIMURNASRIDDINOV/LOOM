import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, setToken, getToken, ApiError } from '../api/client'
import type { Me, TelegramStart, TelegramStatus } from '../api/types'

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
      setUser(res.user)
    },
    [],
  )

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
      const res = await api<TelegramStatus>(
        `/api/auth/telegram/status?session_id=${encodeURIComponent(sessionId)}`,
      )
      if (res.status === 'verified' && res.token) {
        // Native has no cookie jar, so the body token is the session. The
        // backend marks it single-use on this first `verified` poll.
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
