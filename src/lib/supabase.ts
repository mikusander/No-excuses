/**
 * supabase.ts — Inizializzazione e validazione del client Supabase.
 *
 * Legge le variabili d'ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY,
 * le valida e crea il client singleton `supabase` usato in tutta l'app per
 * autenticazione, lettura e scrittura dati (database Postgres via PostgREST).
 *
 * Pattern chiave:
 *  - Se le env sono assenti/invalide, `supabaseConfigError` è una stringa con il messaggio
 *    di errore; i componenti che lo controllano (App.tsx, AuthContext) evitano chiamate di rete.
 *  - Vengono usati valori di fallback (URL/key fittizi) solo per creare il client senza crash:
 *    tutte le chiamate con quei valori fallirebbero, ma l'app può mostrare l'errore all'utente.
 */
import { createClient } from '@supabase/supabase-js';

/**
 * Rimuove eventuali virgolette singole o doppie che circondano il valore
 * (può succedere in alcuni ambienti di deploy che avvolgono le env in virgolette).
 */
const stripWrappingQuotes = (value: string) => value.replace(/^['"]|['"]$/g, '').trim();

const rawSupabaseUrl = stripWrappingQuotes((import.meta.env.VITE_SUPABASE_URL || '').trim());
const rawSupabaseAnonKey = stripWrappingQuotes((import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim());

/** Verifica che il valore sia un URL http/https ben formato */
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

/**
 * `supabaseConfigError` — null se la configurazione è valida, stringa di errore altrimenti.
 * Viene esportata e controllata in App.tsx e AuthContext per bloccare le chiamate
 * a Supabase quando le credenziali non sono disponibili.
 */
export const supabaseConfigError =
  !hasValidUrl || !hasAnonKey
    ? 'Supabase configuration is invalid. Verify VITE_SUPABASE_URL (must start with http/https) and VITE_SUPABASE_ANON_KEY.'
    : null;

// Fallback usati solo per evitare crash durante la costruzione del client
const fallbackUrl = 'https://example.supabase.co';
const fallbackAnonKey = 'missing-anon-key';

const supabaseUrl = hasValidUrl ? rawSupabaseUrl : fallbackUrl;
const supabaseAnonKey = hasAnonKey ? rawSupabaseAnonKey : fallbackAnonKey;

/**
 * `supabase` — Client Supabase singleton.
 * Da importare in tutti i file che necessitano di accesso al database o all'auth.
 */
export const supabase = createClient(
  supabaseUrl || fallbackUrl,
  supabaseAnonKey || fallbackAnonKey,
);
