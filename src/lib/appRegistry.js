import { supabase } from './supabase.js'

// Read the app registry (RLS: any member can read). The registry is the source
// of truth for "what apps exist" and drives the auto-generated navigation.
export async function fetchApps() {
  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}
