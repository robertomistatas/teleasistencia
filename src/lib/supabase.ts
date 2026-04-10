import { createClient } from '@supabase/supabase-js'

import { env, isSupabaseConfigured } from '@/lib/env'

export const supabase = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey)
  : null