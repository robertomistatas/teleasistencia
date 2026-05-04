import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

import type { Profile } from '@/lib/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthContextValue = {
  isConfigured: boolean
  status: AuthStatus
  session: Session | null
  user: User | null
  profile: Profile | null
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: (userId?: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)