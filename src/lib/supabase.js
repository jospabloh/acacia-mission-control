import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth & data will not work')
}

// Client-side Supabase: anon key + the signed-in user's JWT. RLS applies.
export const supabase = createClient(url ?? '', anonKey ?? '')
