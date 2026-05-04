import {
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import type { Session, User } from '@supabase/supabase-js'

import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from '@/features/auth/auth-shared'
import { isSupabaseConfigured } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

async function fetchProfile(userId: string) {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as Profile | null) ?? null
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'anonymous')
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(
    isSupabaseConfigured ? null : 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para autenticar.',
  )

  const refreshProfile = async (userId?: string) => {
    if (!userId) {
      setProfile(null)
      return
    }

    const nextProfile = await fetchProfile(userId)

    if (!nextProfile) {
      setProfile(null)
      setError('No se encontro un profile asociado al usuario autenticado.')
      return
    }

    if (!nextProfile.is_active) {
      setError('Tu usuario esta inactivo. Contacta a administracion.')
    } else {
      setError(null)
    }

    setProfile(nextProfile)
  }

  useEffect(() => {
    if (!supabase) {
      return
    }

    const client = supabase

    let isMounted = true

    const bootstrap = async () => {
      const {
        data: { session: currentSession },
        error: sessionError,
      } = await client.auth.getSession()

      if (!isMounted) {
        return
      }

      if (sessionError) {
        setError(sessionError.message)
        setStatus('anonymous')
        return
      }

      setSession(currentSession)
      setUser(currentSession?.user ?? null)

      if (currentSession?.user) {
        try {
          await refreshProfile(currentSession.user.id)
          setStatus('authenticated')
        } catch (profileError) {
          const message = profileError instanceof Error ? profileError.message : 'No fue posible cargar el profile.'
          setError(message)
          setStatus('authenticated')
        }
      } else {
        setProfile(null)
        setStatus('anonymous')
      }
    }

    void bootstrap()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (!nextSession?.user) {
        setProfile(null)
        setStatus('anonymous')
        return
      }

      setStatus('authenticated')
      void refreshProfile(nextSession.user.id).catch((profileError) => {
        const message = profileError instanceof Error ? profileError.message : 'No fue posible actualizar el profile.'
        setError(message)
      })
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: isSupabaseConfigured,
      status,
      session,
      user,
      profile,
      error,
      signIn: async (email, password) => {
        if (!supabase) {
          throw new Error('Supabase no esta configurado.')
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) {
          throw signInError
        }
      },
      signOut: async () => {
        if (!supabase) {
          return
        }

        const { error: signOutError } = await supabase.auth.signOut()

        if (signOutError) {
          throw signOutError
        }
      },
      refreshProfile,
    }),
    [error, profile, session, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}