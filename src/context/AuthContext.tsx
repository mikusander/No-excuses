/**
 * AuthContext.tsx — Context React per la gestione globale dell'autenticazione.
 *
 * Espone attraverso `AuthProvider` lo stato di sessione Supabase a tutta l'app.
 * All'avvio controlla se esiste una sessione attiva e poi rimane in ascolto
 * di qualsiasi cambio di stato auth (login, logout, recupero password).
 *
 * Valori esposti dal context:
 *  - session            : oggetto sessione Supabase (null se non loggato)
 *  - user               : oggetto utente Supabase (null se non loggato)
 *  - signOut            : funzione asincrona per il logout
 *  - loading            : true finché lo stato auth iniziale non è noto
 *  - isPasswordRecovery : true quando l'utente arriva tramite link di recupero password
 *  - setIsPasswordRecovery : setter manuale (usato da ResetPasswordModal per chiudersi)
 *
 * Hook esportato: `useAuth()` — da usare in qualsiasi componente figlio di AuthProvider.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '../lib/supabase';

/** Forma del context */
interface AuthContextType {
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
  loading: boolean;
  isPasswordRecovery: boolean;
  setIsPasswordRecovery: (val: boolean) => void;
}

/** Valori di default (usati prima che AuthProvider si monti o se usato fuori dal provider) */
const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  signOut: async () => {},
  loading: true,
  isPasswordRecovery: false,
  setIsPasswordRecovery: () => {},
});

/**
 * AuthProvider — Provider del context da montare nella radice dell'app (main.tsx).
 *
 * Al montaggio:
 *  1. Se la config Supabase è mancante, imposta loading=false e restituisce i figli senza fare chiamate.
 *  2. Altrimenti, recupera la sessione corrente (getSession) e si iscrive agli eventi auth
 *     (onAuthStateChange) per tenere sincronizzato lo stato React con Supabase.
 *  3. Rileva l'evento PASSWORD_RECOVERY per mostrare il modal di reset password.
 *  4. Al cleanup dell'effect, annulla la subscription per evitare memory leak.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    // Se Supabase non è configurato, non fare chiamate di rete
    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      // Attivato quando l'utente clicca il link "Reset Password" dalla mail
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
    });

    // Annulla la sottoscrizione quando il provider viene smontato
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (supabaseConfigError) return;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, signOut, loading, isPasswordRecovery, setIsPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
};

/** Hook di convenienza per leggere il context auth in qualsiasi componente */
export const useAuth = () => useContext(AuthContext);
