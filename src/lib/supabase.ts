import { createClient } from '@supabase/supabase-js';

const stripWrappingQuotes = (value: string) => value.replace(/^['"]|['"]$/g, '').trim();

const rawSupabaseUrl = stripWrappingQuotes((import.meta.env.VITE_SUPABASE_URL || '').trim());
const rawSupabaseAnonKey = stripWrappingQuotes((import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim());

const isValidHttpUrl = (value: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const hasValidUrl = isValidHttpUrl(rawSupabaseUrl);
const hasAnonKey = rawSupabaseAnonKey.length > 0;

export const supabaseConfigError =
  !hasValidUrl || !hasAnonKey
    ? 'Supabase configuration is invalid. Verify VITE_SUPABASE_URL (must start with http/https) and VITE_SUPABASE_ANON_KEY.'
    : null;

const fallbackUrl = 'https://example.supabase.co';
const fallbackAnonKey = 'missing-anon-key';

const supabaseUrl = hasValidUrl ? rawSupabaseUrl : fallbackUrl;
const supabaseAnonKey = hasAnonKey ? rawSupabaseAnonKey : fallbackAnonKey;

export const supabase = createClient(
  supabaseUrl || fallbackUrl,
  supabaseAnonKey || fallbackAnonKey,
);
