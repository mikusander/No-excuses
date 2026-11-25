/**
 * WorkoutSessionRecapModal.tsx — Vista modale fluttuante per il riepilogo rapido
 * di una sessione di allenamento completata.
 *
 * Mostra:
 *  - Nome del workout, data e ora di svolgimento
 *  - Statistiche chiave: Durata totale ed Esercizi completati
 *  - Lista degli esercizi eseguiti con serie, reps/secondi, peso e note
 *  - Tasto di navigazione diretta alla pagina di dettaglio storico (/workout-history/:id)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Dumbbell, ArrowRight, FileText, CheckCircle2, Pencil, Loader2 } from 'lucide-react';
import { hapticLight, hapticMedium } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { toSnapshotExercises, type UiExercise } from '../lib/workoutSchemaAdapter';
import {
  updateQueuedWorkoutNotes,
  replaceRemoteWorkoutNotes,
  enqueuePendingNoteUpdate,
} from '../lib/workoutSyncManager';

export interface RecapWorkoutSession {
  id: string | number;
  workoutName: string;
  executedAt: string;
  totalDurationSeconds?: number | null;
  exercisesSnapshot?: any[];
  notes?: Array<{ text: string; createdAt?: string }>;
  schedaId?: string | number | null;
}

interface WorkoutSessionRecapModalProps {
  workout: RecapWorkoutSession | null;
  isOpen: boolean;
  onClose: () => void;
  onNotesUpdated?: (
    workoutId: string | number,
    updatedNotes: Array<{ text: string; createdAt?: string }>
  ) => void;
}

const normalizeNoteKey = (value: string) => value.trim().toLowerCase();

const parseTaggedNote = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
  if (!match) {
    return { orderIndex: null, exerciseName: '', text: trimmed };
  }

  const tag = match[1].trim();
  const text = match[2].trim();

  const orderMatch = /^(\d+)\.\s*(.*)$/.exec(tag);
  if (orderMatch) {
    return {
      orderIndex: parseInt(orderMatch[1], 10) - 1,
      exerciseName: orderMatch[2].trim(),
      text,
    };
  }

  return {
    orderIndex: null,
    exerciseName: tag,
    text,
  };
};

const isGeneralNoteTag = (tagName: string) => {
  const key = normalizeNoteKey(tagName);
  return !key || key === 'scheda' || key === 'generale' || key === 'general' || key === 'workout';
};

const formatItalianDate = (isoString: string) => {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const formatTime = (isoString: string) => {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (totalSecs?: number | null) => {
  if (totalSecs == null || !Number.isFinite(totalSecs) || totalSecs <= 0) {
    return 'Non registrata';
  }
  const s = Math.max(0, Math.trunc(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (h > 0) return `${h}h ${m}m ${remSec}s`;
  if (m > 0) return `${m}m ${remSec}s`;
  return `${remSec}s`;
};

const formatCompactDuration = (totalSecs: number) => {
  const s = Math.max(0, Math.trunc(totalSecs));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

const formatRecapExerciseLines = (
  ex: UiExercise
): { primary: string; secondary?: string } => {
  const subs = ex.subExercises || [];
  if (ex.type === 'superset') {
    const names = subs.map((s) => s.name).filter(Boolean).join(' + ');
    return {
      primary: `${ex.sets} round • ${subs.length} esercizi`,
      secondary: names || undefined,
    };
  }
  if (ex.type === 'circuit') {
    const names = subs.map((s) => s.name).filter(Boolean).join(' + ');
    const totalLabel =
      ex.total_circuit_duration_seconds && ex.total_circuit_duration_seconds > 0
        ? ` • ${formatCompactDuration(ex.total_circuit_duration_seconds)}`
        : '';
    return {
      primary: `${ex.sets} giri • ${subs.length} esercizi${totalLabel}`,
      secondary: names || undefined,
    };
  }
  if (ex.type === 'emom') {
    const roundsCount = ex.emom_rounds || 1;
    const roundsLabel = ex.sets > 1 ? `${ex.sets}×${roundsCount} round` : `${roundsCount} round`;
    const roundDur = ex.emom_round_duration || ex.duration_seconds || 60;
    const names = subs.map((s) => s.name).filter(Boolean).join(' + ');
    return {
      primary: `${roundsLabel} • ${roundDur}s/round${subs.length > 0 ? ` • ${subs.length} es.` : ''}`,
      secondary: names || undefined,
    };
  }
  if (ex.type === 'pyramid') {
    const steps = ex.pyramid_steps || [];
    const repsPreview = steps.map((s) => (s.reps === 0 ? 'MAX' : String(s.reps))).join('-');
    const maxW = steps.reduce((acc, s) => Math.max(acc, Number(s.weight_kg || 0)), 0);
    return {
      primary: `Piramide (${steps.length} step${repsPreview ? `: ${repsPreview}` : ''})`,
      secondary: maxW > 0 ? `Carico fino a ${maxW} kg` : 'Corpo libero',
    };
  }

  const recorded = (ex.completed_sets_records || []).filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0
  );

  if (ex.type === 'isometry' || ex.type === 'cardio') {
    const durLabel =
      recorded.length > 0
        ? recorded.map((v) => `${v}s`).join(', ')
        : ex.duration_seconds === 0
          ? 'MAX'
          : formatCompactDuration(ex.duration_seconds);
    const weightPart =
      ex.type === 'isometry' && ex.weight_kg && ex.weight_kg > 0 ? ` • ${ex.weight_kg} kg` : '';
    return {
      primary: `${ex.sets} serie • ${durLabel}${weightPart}`,
    };
  }

  const repsLabel =
    recorded.length > 0
      ? `${recorded.join(', ')} rip`
      : ex.reps === 0
        ? 'MAX'
        : `${ex.reps} rip`;
  const weightLabel = ex.weight_kg && ex.weight_kg > 0 ? `${ex.weight_kg} kg` : 'Corpo libero';
  return {
    primary: `${ex.sets} serie • ${repsLabel} • ${weightLabel}`,
  };
};

export const WorkoutSessionRecapModal: React.FC<WorkoutSessionRecapModalProps> = ({
  workout,
  isOpen,
  onClose,
  onNotesUpdated,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [isEditingGeneralNote, setIsEditingGeneralNote] = useState(false);
  const [generalNoteDraft, setGeneralNoteDraft] = useState('');
  const [isSavingGeneralNote, setIsSavingGeneralNote] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setIsEditingGeneralNote(false);
    setGeneralNoteDraft('');
    setSaveError(null);
  }, [workout?.id, isOpen]);

  const exercises = useMemo<UiExercise[]>(
    () => toSnapshotExercises(workout?.exercisesSnapshot),
    [workout?.exercisesSnapshot]
  );

  const rawNoteStrings = useMemo(() => {
    if (!Array.isArray(workout?.notes)) return [];
    return workout.notes
      .map((n) => (typeof n === 'string' ? n : String(n?.text || '')).trim())
      .filter((text) => text.length > 0);
  }, [workout?.notes]);

  const parsedNotes = useMemo(() => {
    const notesMap = new Map<string, string[]>();
    const legacyMap = new Map<string, string[]>();
    const genericNotes: string[] = [];

    for (const noteText of rawNoteStrings) {
      const parsed = parseTaggedNote(noteText);
      if (!parsed) {
        genericNotes.push(noteText);
        continue;
      }

      if (parsed.orderIndex !== null) {
        const key = `${parsed.orderIndex}_${normalizeNoteKey(parsed.exerciseName)}`;
        const current = notesMap.get(key) || [];
        current.push(parsed.text);
        notesMap.set(key, current);
      } else if (isGeneralNoteTag(parsed.exerciseName)) {
        genericNotes.push(parsed.text);
      } else {
        const key = normalizeNoteKey(parsed.exerciseName);
        const current = legacyMap.get(key) || [];
        current.push(parsed.text);
        legacyMap.set(key, current);
      }
    }

    return { notesMap, legacyMap, genericNotes };
  }, [rawNoteStrings]);

  if (!isOpen || !workout) return null;

  const exerciseCount = exercises.length;

  const getNotesForExercise = (name: string, idx: number): string[] => {
    const cleanName = normalizeNoteKey(name);
    const key = `${idx}_${cleanName}`;
    const specificNotes = parsedNotes.notesMap.get(key);
    if (specificNotes && specificNotes.length > 0) return specificNotes;

    const countWithName = exercises.filter(
      (ex: any, exIdx: number) =>
        normalizeNoteKey(String(ex?.name || `Esercizio ${exIdx + 1}`)) === cleanName
    ).length;
    if (countWithName <= 1) {
      return parsedNotes.legacyMap.get(cleanName) || [];
    }
    return [];
  };

  const handleStartEditingGeneralNote = () => {
    void hapticLight();
    setSaveError(null);
    setGeneralNoteDraft(parsedNotes.genericNotes.join('\n\n'));
    setIsEditingGeneralNote(true);
  };

  const handleCancelEditingGeneralNote = () => {
    if (isSavingGeneralNote) return;
    void hapticLight();
    setSaveError(null);
    setIsEditingGeneralNote(false);
    setGeneralNoteDraft('');
  };

  const handleSaveGeneralNote = async () => {
    if (!user?.id || isSavingGeneralNote) return;

    try {
      setIsSavingGeneralNote(true);
      setSaveError(null);

      const exerciseNotesOnly = rawNoteStrings.filter((raw) => {
        const parsed = parseTaggedNote(raw);
        if (!parsed) return false;
        return parsed.orderIndex !== null || !isGeneralNoteTag(parsed.exerciseName);
      });

      const trimmedDraft = generalNoteDraft.trim();
      const nextNoteStrings = trimmedDraft
        ? [`[Scheda] ${trimmedDraft}`, ...exerciseNotesOnly]
        : exerciseNotesOnly;

      const numericId = Number(workout.id);
      const hasRemoteId = !Number.isNaN(numericId) && numericId > 0;

      if (hasRemoteId) {
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;
        if (isOnline) {
          try {
            await replaceRemoteWorkoutNotes(numericId, nextNoteStrings);
          } catch (remoteErr) {
            console.warn('[WorkoutSessionRecapModal] Errore sync immediato note, salvo in coda offline:', remoteErr);
            enqueuePendingNoteUpdate(user.id, numericId, nextNoteStrings);
          }
        } else {
          enqueuePendingNoteUpdate(user.id, numericId, nextNoteStrings);
        }
      }

      const updatedQueue = updateQueuedWorkoutNotes(user.id, workout.id, nextNoteStrings);
      if (!hasRemoteId && !updatedQueue) {
        throw new Error('Sessione non trovata per il salvataggio.');
      }

      const nowIso = new Date().toISOString();
      const nextNotesObjects = nextNoteStrings.map((text) => ({
        text,
        createdAt: nowIso,
      }));

      onNotesUpdated?.(workout.id, nextNotesObjects);
      setIsEditingGeneralNote(false);
      setGeneralNoteDraft('');
      void hapticMedium();
    } catch (err) {
      console.error('Errore salvataggio note generali riepilogo:', err);
      setSaveError('Impossibile salvare la nota. Riprova.');
    } finally {
      setIsSavingGeneralNote(false);
    }
  };

  const handleOpenFullDetail = () => {
    void hapticMedium();
    onClose();
    navigate(`/workout-history/${workout.id}`);
  };

  const handleClose = () => {
    void hapticLight();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-3xl bg-[#1C1C1E] border border-white/10 shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow arancione in alto a destra */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-orange/15 blur-3xl pointer-events-none" />

        {/* Header Modale */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3 shrink-0 relative">
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-center gap-1.5 text-brand-orange text-xs font-black uppercase tracking-wider mb-1">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span>Sessione Completata</span>
            </div>
            <h2 className="text-xl font-black text-white tracking-tight truncate">
              {workout.workoutName || 'Allenamento'}
            </h2>
            <p className="text-xs text-brand-grey/80 capitalize mt-0.5">
              {formatItalianDate(workout.executedAt)} • {formatTime(workout.executedAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            title="Chiudi riepilogo"
          >
            <X size={18} />
          </button>
        </div>

        {/* Statistiche in pill */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-white/[0.02] border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-9 h-9 rounded-xl bg-brand-orange/15 flex items-center justify-center shrink-0 text-brand-orange">
              <Clock size={18} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Durata</span>
              <span className="text-sm font-black text-white truncate block">
                {formatDuration(workout.totalDurationSeconds)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-9 h-9 rounded-xl bg-brand-orange/15 flex items-center justify-center shrink-0 text-brand-orange">
              <Dumbbell size={18} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Esercizi</span>
              <span className="text-sm font-black text-white truncate block">
                {exerciseCount} {exerciseCount === 1 ? 'esercizio' : 'esercizi'}
              </span>
            </div>
          </div>
        </div>

        {/* Lista Esercizi Svolti */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {/* Note Generali Scheda */}
          {isEditingGeneralNote ? (
            <div className="p-3.5 rounded-2xl border border-brand-orange/40 bg-brand-orange/10 mb-3">
              <div className="flex items-center gap-1.5 mb-2 text-brand-orange text-xs font-black uppercase tracking-wider">
                <FileText size={14} />
                <span>Note Generali Scheda</span>
              </div>
              <textarea
                value={generalNoteDraft}
                onChange={(e) => setGeneralNoteDraft(e.target.value)}
                placeholder="Scrivi le note generali riferite all'intera scheda di allenamento..."
                className="w-full min-h-[100px] bg-black/50 border border-brand-orange/30 rounded-xl px-3 py-2.5 text-white text-xs sm:text-sm leading-relaxed focus:border-brand-orange outline-none resize-none mb-2.5"
                disabled={isSavingGeneralNote}
                autoFocus
              />
              {saveError && (
                <p className="text-[11px] text-red-400 font-semibold mb-2">{saveError}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancelEditingGeneralNote}
                  disabled={isSavingGeneralNote}
                  className="px-3 py-1.5 rounded-xl border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveGeneralNote();
                  }}
                  disabled={isSavingGeneralNote}
                  className="px-3.5 py-1.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-xs font-black active:scale-95 shadow-md cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  {isSavingGeneralNote ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Salvataggio...</span>
                    </>
                  ) : (
                    <span>Salva Nota</span>
                  )}
                </button>
              </div>
            </div>
          ) : parsedNotes.genericNotes.length > 0 ? (
            <div className="p-3.5 rounded-2xl border border-brand-orange/40 bg-brand-orange/10 mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-brand-orange text-xs font-black uppercase tracking-wider">
                  <FileText size={14} />
                  <span>Note Generali Scheda</span>
                </div>
                <button
                  type="button"
                  onClick={handleStartEditingGeneralNote}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                >
                  <Pencil size={11} />
                  <span>Modifica</span>
                </button>
              </div>
              <div className="space-y-1.5">
                {parsedNotes.genericNotes.map((text, nIdx) => (
                  <p key={nIdx} className="text-xs text-zinc-100 whitespace-pre-wrap break-words leading-relaxed">
                    {text}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleStartEditingGeneralNote}
              className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-zinc-400 hover:text-white hover:border-brand-orange/40 hover:bg-brand-orange/5 transition-all text-xs font-semibold cursor-pointer"
            >
              <FileText size={14} className="text-brand-orange" />
              <span>Aggiungi note alla scheda</span>
            </button>
          )}

          <h3 className="text-xs font-bold text-brand-grey/70 uppercase tracking-wider px-1">
            Esercizi eseguiti
          </h3>

          {exercises.length === 0 ? (
            <div className="text-center py-8 text-brand-grey/50 text-xs">
              Nessun dettaglio esercizio registrato in questa sessione.
            </div>
          ) : (
            exercises.map((ex: UiExercise, idx: number) => {
              const name = String(ex.name || `Esercizio ${idx + 1}`);
              const summary = formatRecapExerciseLines(ex);
              const exerciseNotes = getNotesForExercise(name, idx);
              const fallbackNote = typeof ex.instruction_note === 'string' ? ex.instruction_note.trim() : '';
              const displayNotes = exerciseNotes.length > 0 ? exerciseNotes : fallbackNote ? [fallbackNote] : [];

              return (
                <div
                  key={`${ex.id}:${idx}`}
                  className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-start gap-3 select-none"
                >
                  <div className="w-6 h-6 rounded-lg bg-brand-orange/15 border border-brand-orange/30 text-brand-orange flex items-center justify-center text-xs font-black shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white truncate leading-snug">
                        {name}
                      </h4>
                      {ex.type && ex.type !== 'reps' && (
                        <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-brand-orange/20 text-brand-orange shrink-0">
                          {ex.type}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-brand-grey/70 mt-0.5">
                      {summary.primary}
                    </p>
                    {summary.secondary && (
                      <p className="text-[11px] text-brand-grey/55 truncate mt-0.5">
                        {summary.secondary}
                      </p>
                    )}

                    {/* Note dell'esercizio (se presenti) */}
                    {displayNotes.length > 0 && (
                      <div className="mt-2 text-[11px] text-brand-grey/90 bg-white/5 border border-white/5 rounded-xl p-2 flex items-start gap-1.5">
                        <FileText size={12} className="text-brand-orange shrink-0 mt-0.5" />
                        <div className="space-y-1 min-w-0 flex-1">
                          {displayNotes.map((noteText, noteIdx) => (
                            <p key={noteIdx} className="whitespace-pre-wrap break-words leading-relaxed">
                              {noteText}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Azioni */}
        <div className="p-4 border-t border-white/10 bg-[#171719] flex gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer text-center"
          >
            Chiudi
          </button>
          <button
            type="button"
            onClick={handleOpenFullDetail}
            className="flex-1 py-3 px-4 rounded-xl bg-brand-orange hover:bg-brand-lightOrange active:scale-95 text-black text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-brand-orange/20 transition-all cursor-pointer"
          >
            <span>Dettaglio Storico</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutSessionRecapModal;
