/**
 * SettingsPage.tsx — Pagina impostazioni utente.
 *
 * Permette all'utente di:
 *  1. Visualizzare e modificare il proprio username (tabella `profili` su Supabase)
 *  2. Attivare/disattivare l'assistente vocale durante il workout
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * PROFILO UTENTE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Al caricamento della pagina viene letto il profilo dalla tabella `profili`.
 * Se il profilo non esiste ancora (primo accesso), `ensureProfileExists` lo crea
 * generando automaticamente un username dalla parte locale dell'email.
 *
 * Il salvataggio dello username usa un upsert Supabase per gestire sia la
 * creazione che l'aggiornamento in un'unica chiamata.
 * In caso di conflitto unicità (codice PostgreSQL 23505), viene mostrato un
 * errore leggibile ("username già in uso").
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * VOICE ASSISTANCE TOGGLE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Il flag viene letto/scritto su due storage in parallelo:
 *  - `localStorage` (chiave `voice_assistance_enabled`): lettura immediata, offline-first.
 *    Questo è il valore letto da `utils/voice.ts` durante il workout.
 *  - Tabella `profili` (colonna `voice_assistant`): sincronizzazione cross-device.
 *
 * Flusso ottimistico: lo state UI e il localStorage vengono aggiornati
 * immediatamente (senza aspettare la risposta Supabase), e in caso di errore
 * DB si fa rollback al valore precedente mostrando `voiceSyncError`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GENERAZIONE USERNAME UNICA
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `buildProfileUsernameCandidate` tenta fino a 6 varianti con suffisso numerico
 * casuale per evitare conflitti di unicità senza richiedere input all'utente.
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, User, Edit2, X, Check, Brain, Trash2, ChevronDown, ChevronUp, Bell, BellRing } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import HeaderLogo from '../components/HeaderLogo';
import { supabase } from '../lib/supabase';
import {
  loadCorrectionRules,
  deleteCorrectionRule,
  clearAllCorrectionRules,
  type UserCorrectionRule,
} from '../utils/userCorrectionsManager';
import {
  getNotificationPermission,
  requestNotificationPermission,
  testPushNotification,
  isNativeApp,
  type NotificationPermissionStatus,
} from '../utils/workoutNotifications';

const SettingsPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const VOICE_ASSIST_KEY = 'voice_assistance_enabled';

  const [userName, setUserName] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceAssistanceEnabled, setVoiceAssistanceEnabled] = useState(true);
  const [voiceSyncError, setVoiceSyncError] = useState<string | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);

  // Regole di correzione apprese dall'Active Feedback Loop
  const [correctionRules, setCorrectionRules] = useState<UserCorrectionRule[]>([]);
  const [showRulesList, setShowRulesList] = useState(false);

  useEffect(() => {
    setCorrectionRules(loadCorrectionRules(user?.id));
  }, [user?.id]);

  const handleDeleteRule = (ruleId: string) => {
    deleteCorrectionRule(ruleId, user?.id);
    setCorrectionRules(loadCorrectionRules(user?.id));
  };

  const handleClearAllRules = () => {
    if (window.confirm('Sei sicuro di voler eliminare tutte le regole di correzione apprese?')) {
      clearAllCorrectionRules(user?.id);
      setCorrectionRules([]);
    }
  };

  // Stato e gestione notifiche
  const [notificationPerm, setNotificationPerm] = useState<NotificationPermissionStatus>('unsupported');
  const [notificationTesting, setNotificationTesting] = useState(false);
  const [notificationTestFeedback, setNotificationTestFeedback] = useState<string | null>(null);

  useEffect(() => {
    setNotificationPerm(getNotificationPermission());
  }, []);

  const handleRequestNotification = async () => {
    const granted = await requestNotificationPermission();
    setNotificationPerm(getNotificationPermission());
    if (granted) {
      setNotificationTestFeedback('Notifiche attivate con successo!');
      setTimeout(() => setNotificationTestFeedback(null), 4000);
    }
  };

  const handleTestNotification = async () => {
    setNotificationTesting(true);
    setNotificationTestFeedback('⏳ Invio notifica di test al server (5s)...');
    const result = await testPushNotification(5);
    setNotificationTesting(false);
    setNotificationTestFeedback(result.message);
    setTimeout(() => setNotificationTestFeedback(null), 12000);
  };

  const getProfileMailValue = () => {
    const normalizedEmail = String(user?.email || '').trim().toLowerCase();
    if (normalizedEmail.length > 0) return normalizedEmail;
    return `${String(user?.id || 'user')}@noexcuses.local`;
  };

  const getProfileUsernameBase = (mailValue: string) => {
    const localPart = String(mailValue.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const safe = localPart.length > 0 ? localPart : 'user';
    return safe.slice(0, 40);
  };

  const buildProfileUsernameCandidate = (base: string, attempt: number) => {
    if (attempt === 0) return base;
    const suffix = `_${Math.floor(Math.random() * 9000) + 1000}`;
    const safeBase = base.slice(0, Math.max(1, 50 - suffix.length));
    return `${safeBase}${suffix}`;
  };

  const ensureProfileExists = async (voiceSetting: boolean) => {
    if (!user?.id) {
      throw new Error('User not authenticated.');
    }

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from('profili')
      .select('id_utente')
      .eq('id_utente', user.id)
      .maybeSingle();

    if (existingProfileError) throw existingProfileError;
    if (existingProfile?.id_utente) return;

    const mailValue = getProfileMailValue();
    const usernameBase = getProfileUsernameBase(mailValue);
    let lastInsertError: { code?: string; message?: string } | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const username = buildProfileUsernameCandidate(usernameBase, attempt);
      const { error: insertError } = await supabase
        .from('profili')
        .insert([
          {
            id_utente: user.id,
            username,
            mail: mailValue,
            voice_assistant: voiceSetting,
            updated_at: new Date().toISOString(),
          },
        ]);

      if (!insertError) return;

      lastInsertError = insertError;
      const duplicateConflict = String(insertError.code || '') === '23505'
        || /duplicate key|unique/i.test(String(insertError.message || ''));
      if (!duplicateConflict) throw insertError;
    }

    throw lastInsertError || new Error('Unable to initialize profile for voice settings.');
  };

  useEffect(() => {
    const saved = localStorage.getItem(VOICE_ASSIST_KEY);
    if (saved !== null) {
      setVoiceAssistanceEnabled(saved === 'true');
    }
  }, []);

  const handleToggleVoiceAssistance = async () => {
    if (!user || voiceSaving) return;

    const previous = voiceAssistanceEnabled;
    const next = !voiceAssistanceEnabled;

    setVoiceSyncError(null);
    setVoiceAssistanceEnabled(next);
    localStorage.setItem(VOICE_ASSIST_KEY, String(next));
    setVoiceSaving(true);

    try {
      await ensureProfileExists(next);

      const { error: updateError } = await supabase
        .from('profili')
        .update({
          voice_assistant: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id_utente', user.id);

      if (updateError) throw updateError;
    } catch (toggleError) {
      console.error('Error syncing voice assistance preference:', toggleError);
      setVoiceAssistanceEnabled(previous);
      localStorage.setItem(VOICE_ASSIST_KEY, String(previous));
      setVoiceSyncError('Unable to sync this setting across devices. Please try again.');
    } finally {
      setVoiceSaving(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      setProfileLoading(true);
      const { data, error } = await supabase
        .from('profili')
        .select('username, voice_assistant')
        .eq('id_utente', user.id)
        .maybeSingle();

      if (!error && data?.username) {
        setUserName(data.username);
      } else {
        setUserName(user.email?.split('@')[0] || 'User');
      }

      if (!error && typeof data?.voice_assistant === 'boolean') {
        setVoiceAssistanceEnabled(data.voice_assistant);
        localStorage.setItem(VOICE_ASSIST_KEY, String(data.voice_assistant));
      }

      setProfileLoading(false);
    };
    fetchProfile();
  }, [user]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newName === userName) {
      setIsEditing(false);
      return;
    }
    
    // basic validation
    if (newName.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: upsertError } = await supabase
        .from('profili')
        .upsert({
          id_utente: user!.id,
          username: newName.trim(),
          mail: user?.email || `${user!.id}@local.invalid`,
          updated_at: new Date().toISOString()
        });
        
      if (upsertError) {
        if (upsertError.code === '23505') {
          throw new Error('This username is already taken. Please choose another one.');
        }
        throw upsertError;
      }
      
      setUserName(newName.trim());
      setSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error saving username.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <HeaderLogo />

      <main className="flex-1 w-full flex flex-col items-center px-6 mt-6">
        {/* User Info Section */}
        <div className="bg-brand-darkGrey/40 w-full max-w-sm rounded-3xl p-6 flex flex-col items-center border border-brand-grey/20 relative">
          <div className="bg-brand-orange/20 p-4 rounded-full mb-4">
            <User className="text-brand-orange" size={40} />
          </div>
          
          {!isEditing ? (
            <>
              <div className="flex items-center gap-2">
                {profileLoading ? (
                  <div className="h-8 w-44 rounded-md bg-brand-grey/20 animate-pulse" />
                ) : (
                  <>
                    <h2 className="text-2xl font-bold text-white capitalize">{userName}</h2>
                    <button onClick={() => { setIsEditing(true); setNewName(userName); setError(null); }} className="text-brand-grey hover:text-white transition-colors">
                      <Edit2 size={16} />
                    </button>
                  </>
                )}
              </div>
              {profileLoading ? (
                <div className="h-4 w-52 rounded-md bg-brand-grey/20 animate-pulse mt-1" />
              ) : (
                <p className="text-sm text-brand-grey mt-1">{user?.email}</p>
              )}
            </>
          ) : (
            <form onSubmit={handleSaveName} className="w-full flex flex-col items-center">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New username"
                className="w-full bg-black/50 border-2 border-brand-orange/50 rounded-xl px-4 py-2 text-white text-center focus:border-brand-orange focus:outline-none mb-3"
                autoFocus
                maxLength={20}
              />
              {error && <p className="text-xs text-red-500 font-bold mb-3 text-center">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setIsEditing(false)} disabled={saving} className="p-2 rounded-xl bg-red-500/20 text-red-500 hover:bg-red-500/40 transition-colors">
                  <X size={20} />
                </button>
                <button type="submit" disabled={saving} className="p-2 rounded-xl bg-green-500/20 text-green-500 hover:bg-green-500/40 transition-colors disabled:opacity-50">
                  <Check size={20} />
                </button>
              </div>
            </form>
          )}

          {success && <p className="text-xs text-green-400 mt-3 absolute -bottom-6 font-bold">Username updated!</p>}
        </div>

        {/* Spazio per future impostazioni */}
        <div className="w-full max-w-sm mt-8 space-y-4">
          <div className="bg-brand-darkGrey/20 border border-brand-grey/10 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">Voice Assistance</p>
                <p className="text-brand-grey/60 text-xs mt-1">Countdown and workout voice cues</p>
              </div>
              <button
                onClick={handleToggleVoiceAssistance}
                disabled={voiceSaving || profileLoading}
                className={`relative w-12 h-7 rounded-full overflow-hidden transition-colors ${voiceAssistanceEnabled ? 'bg-brand-orange' : 'bg-brand-grey/30'}`}
                aria-label="Toggle voice assistance"
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${voiceAssistanceEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>
            {voiceSyncError && (
              <p className="text-red-400 text-xs mt-2">{voiceSyncError}</p>
            )}
          </div>

          {/* Notifiche di Recupero & Schermo Spento */}
          <div className="bg-brand-darkGrey/20 border border-brand-grey/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/15 text-blue-400">
                  <Bell size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-bold text-sm">Notifiche di Recupero</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                      notificationPerm === 'granted'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : notificationPerm === 'ios_pwa_required'
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-red-500/20 text-red-400 border-red-500/30'
                    }`}>
                      {notificationPerm === 'granted'
                        ? (isNativeApp() ? 'Attive (iOS Nativo)' : 'Attive (PWA)')
                        : notificationPerm === 'ios_pwa_required'
                          ? 'Richiede PWA'
                          : 'Non attive'}
                    </span>
                  </div>
                  <p className="text-brand-grey/60 text-xs mt-0.5">
                    {isNativeApp()
                      ? "Sveglia hardware programmata sul chip dell'iPhone (100% offline)"
                      : "Avviso a fine pausa anche a schermo spento"}
                  </p>
                </div>
              </div>
            </div>

            {notificationPerm !== 'granted' && notificationPerm !== 'ios_pwa_required' && (
              <button
                type="button"
                onClick={handleRequestNotification}
                className="w-full py-2 px-3 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black text-xs font-bold transition-all shadow cursor-pointer"
              >
                Attiva Notifiche
              </button>
            )}

            {!isNativeApp() && notificationPerm === 'ios_pwa_required' && (
              <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                💡 Su iPhone Web le notifiche a schermo spento richiedono di aggiungere l&apos;app alla schermata Home (tasto Condividi di Safari → &quot;Aggiungi a schermata Home&quot;).
              </p>
            )}

            <div className="text-[11px] text-brand-grey/60 bg-white/5 rounded-xl p-2.5 space-y-1">
              <p className="font-semibold text-white/80">
                {isNativeApp() ? '📱 App Nativa iOS:' : '⏱️ Recuperi lunghi (es. 3-5 minuti):'}
              </p>
              <p>
                {isNativeApp()
                  ? "Su questa versione nativa, i timer di recupero sono gestiti direttamente dal processore del telefono: funzionano con qualsiasi durata anche a schermo bloccato e senza connessione internet."
                  : "L'app mantiene lo schermo acceso automaticamente con Wake Lock durante il workout. Se blocchi lo schermo, la notifica push serverless ti avvisa al termine del recupero."}
              </p>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-[11px] text-brand-grey/70">Testa il funzionamento</span>
              <button
                type="button"
                disabled={notificationTesting}
                onClick={handleTestNotification}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <BellRing size={13} />
                <span>
                  {notificationTesting
                    ? 'Programmazione...'
                    : (isNativeApp() ? 'Prova Sveglia Nativa (5s)' : 'Prova Notifica (5s)')}
                </span>
              </button>
            </div>

            {notificationTestFeedback && (
              <p className="text-center text-[11px] text-blue-400 font-semibold bg-blue-500/10 border border-blue-500/20 rounded-xl p-2 animate-in fade-in duration-200">
                {notificationTestFeedback}
              </p>
            )}
          </div>

          {/* Memoria Correzioni OCR & Parser */}
          <div className="bg-brand-darkGrey/20 border border-brand-grey/10 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
                  <Brain size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-bold text-sm">Memoria Parser & OCR</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {correctionRules.length}
                    </span>
                  </div>
                  <p className="text-brand-grey/60 text-xs mt-0.5">
                    Regole apprese dalle tue correzioni
                  </p>
                </div>
              </div>
              {correctionRules.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRulesList(!showRulesList)}
                  className="text-brand-grey hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Mostra o nascondi elenco regole"
                >
                  {showRulesList ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              )}
            </div>

            {correctionRules.length === 0 ? (
              <p className="text-[11px] text-brand-grey/50 mt-3 pt-3 border-t border-white/5 italic">
                Nessuna regola personalizzata memorizzata. Correggendo gli esercizi scansionati o dettati, il sistema memorizzerà qui le tue preferenze.
              </p>
            ) : showRulesList ? (
              <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-brand-grey/60 uppercase font-bold tracking-wider">
                    Regole Attive ({correctionRules.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleClearAllRules}
                    className="text-[10px] text-red-400/80 hover:text-red-400 font-semibold transition-colors"
                  >
                    Cancella tutte
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {correctionRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-2.5 bg-black/40 border border-white/5 rounded-xl flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] text-brand-grey/70 bg-white/5 px-1.5 py-0.5 rounded truncate max-w-[130px]">
                            &quot;{rule.rawInputSignature}&quot;
                          </span>
                          <span className="text-brand-grey/40 text-[10px]">→</span>
                          <span className="font-bold text-white text-[11px] truncate">
                            {rule.correctedResult.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-brand-grey/60">
                          <span>
                            {rule.correctedResult.modality === 'isometry'
                              ? `${rule.correctedResult.setsOrRounds}x${rule.correctedResult.durationSeconds || 30}s`
                              : `${rule.correctedResult.setsOrRounds}x${rule.correctedResult.repsTarget || '10'}`}
                            {' • '}{rule.correctedResult.restSeconds}s
                          </span>
                          <span className="text-amber-400/90 font-medium">
                            🎯 {rule.hitCount} {rule.hitCount === 1 ? 'uso' : 'usi'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-brand-grey/40 hover:text-red-400 p-1.5 rounded-lg transition-colors shrink-0"
                        title="Elimina regola"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Logout Button pushed to the end */}
        <div className="mt-auto w-full max-w-sm pt-12 mb-24">
          <button 
            onClick={signOut}
            className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-red-500/5"
          >
            <LogOut size={24} className="mr-2" />
            SIGN OUT
          </button>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
};

export default SettingsPage;
