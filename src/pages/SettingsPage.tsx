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
import { LogOut, User, Edit2, X, Check, Brain, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import AppHeader from '../components/AppHeader';
import { hapticLight, hapticMedium, hapticHeavy } from '../utils/haptics';
import { supabase } from '../lib/supabase';
import {
  loadCorrectionRules,
  deleteCorrectionRule,
  clearAllCorrectionRules,
  type UserCorrectionRule,
} from '../utils/userCorrectionsManager';

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

    void hapticLight();
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

    void hapticMedium();
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
    <div className="min-h-screen bg-brand-dark flex flex-col safe-pb-nav relative">
      <AppHeader
        title="Impostazioni"
        subtitle="Profilo & Preferenze"
      />

      <main className="flex-1 w-full max-w-md mx-auto px-4 sm:px-6 mt-4 flex flex-col items-center space-y-5">
        {/* User Info Section - Inset Grouped */}
        <div className="bg-[#1C1C1E] w-full rounded-3xl p-6 flex flex-col items-center border border-white/10 shadow-xl relative">
          <div className="bg-brand-orange/15 border border-brand-orange/30 p-4 rounded-full mb-3 shadow-lg shadow-brand-orange/10">
            <User className="text-brand-orange" size={36} />
          </div>
          
          {!isEditing ? (
            <>
              <div className="flex items-center gap-2">
                {profileLoading ? (
                  <div className="h-8 w-44 rounded-md bg-white/10 animate-pulse" />
                ) : (
                  <>
                    <h2 className="text-xl font-bold text-white capitalize">{userName}</h2>
                    <button
                      onClick={() => {
                        void hapticLight();
                        setIsEditing(true);
                        setNewName(userName);
                        setError(null);
                      }}
                      className="text-brand-grey/60 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                      title="Modifica username"
                    >
                      <Edit2 size={15} />
                    </button>
                  </>
                )}
              </div>
              {profileLoading ? (
                <div className="h-4 w-52 rounded-md bg-white/10 animate-pulse mt-1" />
              ) : (
                <p className="text-xs text-brand-grey/60 mt-1">{user?.email}</p>
              )}
            </>
          ) : (
            <form onSubmit={handleSaveName} className="w-full flex flex-col items-center">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nuovo username"
                className="w-full bg-black/60 border border-brand-orange/60 rounded-xl px-4 py-2.5 text-white text-center focus:border-brand-orange focus:outline-none mb-3 text-sm font-semibold"
                autoFocus
                maxLength={20}
              />
              {error && <p className="text-xs text-red-400 font-semibold mb-3 text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void hapticLight();
                    setIsEditing(false);
                  }}
                  disabled={saving}
                  className="p-2 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Check size={18} />
                </button>
              </div>
            </form>
          )}

          {success && <p className="text-xs text-emerald-400 mt-2 font-bold animate-in fade-in">Username aggiornato!</p>}
        </div>

        {/* Impostazioni Grouped Card */}
        <div className="w-full space-y-4">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">Assistente Vocale</p>
                <p className="text-brand-grey/60 text-xs mt-0.5">Countdown e avvisi vocali durante l'allenamento</p>
              </div>
              <button
                onClick={handleToggleVoiceAssistance}
                disabled={voiceSaving || profileLoading}
                className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 select-none ${
                  voiceAssistanceEnabled ? 'bg-brand-orange' : 'bg-white/20'
                }`}
                aria-label="Toggle assistente vocale"
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform shadow-md ${
                    voiceAssistanceEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {voiceSyncError && (
              <p className="text-red-400 text-xs mt-2">{voiceSyncError}</p>
            )}
          </div>



          {/* Memoria Correzioni OCR & Parser */}
          <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/25">
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
                  onClick={() => {
                    void hapticLight();
                    setShowRulesList(!showRulesList);
                  }}
                  className="text-brand-grey/70 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
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
                    className="text-[10px] text-red-400/80 hover:text-red-400 font-semibold transition-colors cursor-pointer"
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
                        className="text-brand-grey/40 hover:text-red-400 p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer"
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

        {/* Logout Button */}
        <div className="w-full pt-4 pb-8">
          <button 
            onClick={() => {
              void hapticHeavy();
              void signOut();
            }}
            className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 font-bold text-sm py-3.5 rounded-2xl flex items-center justify-center transition-all cursor-pointer active:scale-98 shadow-lg shadow-red-500/5"
          >
            <LogOut size={18} className="mr-2" />
            ESCI DALL'ACCOUNT
          </button>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
};

export default SettingsPage;
