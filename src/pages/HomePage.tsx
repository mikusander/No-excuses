/**
 * HomePage.tsx — Dashboard principale mobile-first per No Excuses.
 *
 * Include:
 *  - HomeHeader: Saluto dinamico, data in italiano, badge Streak e mini logo.
 *  - QuickStartHeroCard: Avvio rapido sequenziale:
 *      * Se workout in corso -> Riprendi sessione
 *      * Se l'ultimo workout appartiene a una cartella -> Avvia il prossimo workout in sequenza (ciclico)
 *      * Altrimenti -> Ultima scheda eseguita o scheda consigliata
 *  - WeeklyConsistencyBar: Striscia dei 7 giorni della settimana con anelli di completamento.
 *  - MonthlyConsistencyModal: Vista modale fluttuante con calendario mensile completo e riepiloghi.
 *  - BentoGrid: 4 tessere modulari (Scegli Scheda, Free Mode, Storico, Nuova Scheda).
 *  - BottomNavigation: Barra di navigazione mobile fluttuante.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import HomeHeader from '../components/HomeHeader';
import ActiveWorkoutBanner from '../components/ActiveWorkoutBanner';
import QuickStartHeroCard, { type LastWorkoutData } from '../components/QuickStartHeroCard';
import WeeklyConsistencyBar from '../components/WeeklyConsistencyBar';
import MonthlyConsistencyModal, { type MonthlyWorkoutRun } from '../components/MonthlyConsistencyModal';
import BentoGrid from '../components/BentoGrid';
import BottomNavigation from '../components/BottomNavigation';
import WorkoutPreviewModal from '../components/WorkoutPreviewModal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  getLatestWorkoutProgressCheckpoint,
  subscribeToWorkoutProgress,
  type WorkoutProgressCheckpointMeta,
} from '../lib/workoutProgressStorage';
import {
  getFolders,
  getFolderAssignments,
  getFolderForScheda,
  getNextSchedaInFolder,
  subscribeToFolderChanges,
} from '../utils/folderManager';
import {
  getSyncQueue,
  subscribeToSyncQueue,
  getPendingWorkoutDeletes,
  getPendingNoteUpdates,
} from '../lib/workoutSyncManager';
import { getOfflineSchede, subscribeToOfflineSchede } from '../lib/offlineSchedeManager';

const toLocalDateKey = (dateStr: string | Date): string => {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const HomePage: React.FC = () => {
  const { user } = useAuth();

  const [userName, setUserName] = useState<string>('');
  const [streakDays, setStreakDays] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [lastWorkout, setLastWorkout] = useState<LastWorkoutData | null>(null);
  const [schedeCount, setSchedeCount] = useState<number>(0);
  const [activeCheckpoint, setActiveCheckpoint] = useState<WorkoutProgressCheckpointMeta | null>(null);

  // Stato per la visualizzazione del calendario mensile fluttuante
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState<boolean>(false);
  const [allRuns, setAllRuns] = useState<MonthlyWorkoutRun[]>([]);

  // Stato per la vista modale di anteprima/modifica parametri con Avvio Rapido
  const [quickStartModalSchedaId, setQuickStartModalSchedaId] = useState<number | null>(null);
  const [quickStartModalName, setQuickStartModalName] = useState<string>('');

  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sincronizza lo stato del checkpoint (workout in sospeso) per la Hero Card
  const refreshCheckpoint = useCallback(() => {
    if (!user?.id) {
      setActiveCheckpoint(null);
      return;
    }
    const cp = getLatestWorkoutProgressCheckpoint(user.id);
    setActiveCheckpoint(cp);
  }, [user?.id]);

  useEffect(() => {
    refreshCheckpoint();
    const unsubProgress = subscribeToWorkoutProgress(() => {
      refreshCheckpoint();
    });
    return unsubProgress;
  }, [refreshCheckpoint]);

  // Carica i dati dell'utente, storico e schede con risoluzione del prossimo workout in sequenza
  const loadDashboardData = useCallback(async () => {
    if (!user?.id) return;
    const seq = ++loadSeqRef.current;

    try {
      let profileRes: any = { data: null };
      let runsRes: any = { data: [], error: null };
      let schedeRes: any = { data: [], count: null };
      let cloudRunsSucceeded = false;

      const runSelectWithDuration = `
        id_workout,
        id_scheda,
        workout_name_snapshot,
        exercises_snapshot,
        data_esecuzione,
        durata_totale_secondi,
        schede ( id_scheda, nome ),
        note_workout ( testo, created_at )
      `;
      const runSelectBase = `
        id_workout,
        id_scheda,
        workout_name_snapshot,
        exercises_snapshot,
        data_esecuzione,
        schede ( id_scheda, nome ),
        note_workout ( testo, created_at )
      `;

      // Caricamento in parallelo per massima reattività se online
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const [p, r, s] = await Promise.all([
            supabase
              .from('profili')
              .select('username')
              .eq('id_utente', user.id)
              .maybeSingle(),
            supabase
              .from('workout_run')
              .select(runSelectWithDuration)
              .eq('id_utente', user.id)
              .order('data_esecuzione', { ascending: false })
              .limit(250),
            supabase
              .from('schede')
              .select('id_scheda, nome, data_creazione', { count: 'exact' })
              .eq('id_utente', user.id)
              .order('data_creazione', { ascending: false }),
          ]);

          profileRes = p;
          runsRes = r;
          schedeRes = s;

          if (runsRes?.error && /durata_totale_secondi/i.test(String(runsRes.error.message || ''))) {
            runsRes = await supabase
              .from('workout_run')
              .select(runSelectBase)
              .eq('id_utente', user.id)
              .order('data_esecuzione', { ascending: false })
              .limit(250);
          }

          if (!runsRes?.error && Array.isArray(runsRes?.data)) {
            cloudRunsSucceeded = true;
          }
        } catch (cloudErr) {
          console.warn('[HomePage] Chiamate cloud non disponibili (offline):', cloudErr);
        }
      }

      if (!isMountedRef.current || seq !== loadSeqRef.current) return;

      // 1. Profilo utente
      if (profileRes.data?.username) {
        setUserName(profileRes.data.username);
      } else {
        setUserName(user.email?.split('@')[0] || 'Atleta');
      }

      const pendingDeletes = new Set(getPendingWorkoutDeletes(user.id));
      const pendingNoteUpdates = getPendingNoteUpdates(user.id);

      const rawCloudRuns = Array.isArray(runsRes?.data) ? (runsRes.data as MonthlyWorkoutRun[]) : [];
      const cloudRuns: MonthlyWorkoutRun[] = rawCloudRuns
        .filter((c) => !pendingDeletes.has(Number(c.id_workout)))
        .map((c) => {
          const override = pendingNoteUpdates[String(c.id_workout)];
          if (!override) return c;
          return {
            ...c,
            note_workout: override.notes.map((text) => ({ testo: text, created_at: c.data_esecuzione })),
          };
        });

      const cloudRemoteIds = new Set<string>(cloudRuns.map((c) => String(c.id_workout)));
      const cloudUuids = new Set<string>();
      for (const c of cloudRuns) {
        if (Array.isArray(c.exercises_snapshot)) {
          for (const ex of c.exercises_snapshot) {
            if (ex?.workout_uuid) cloudUuids.add(String(ex.workout_uuid));
            if (ex?._session_meta?.workout_uuid) cloudUuids.add(String(ex._session_meta.workout_uuid));
          }
        }
      }

      // Integra le sessioni completate offline presenti nella coda locale evitando duplicazioni o resurrezioni
      const localQueue = getSyncQueue(user.id);
      const offlineRuns: MonthlyWorkoutRun[] = localQueue
        .filter((q) => {
          if (q.status !== 'completed') return false;
          if (q.remote_workout_run_id && pendingDeletes.has(Number(q.remote_workout_run_id))) return false;
          const alreadyInCloud =
            (q.remote_workout_run_id != null && cloudRemoteIds.has(String(q.remote_workout_run_id))) ||
            cloudUuids.has(q.workout_uuid);
          if (alreadyInCloud) return false;
          if (cloudRunsSucceeded && q.sync_status === 'synced') return false;
          return true;
        })
        .map((q) => ({
          id_workout: q.remote_workout_run_id || q.workout_uuid,
          id_scheda: q.id_scheda,
          workout_name_snapshot: q.workout_name_snapshot,
          exercises_snapshot: q.exercises_snapshot,
          data_esecuzione: q.executed_at,
          durata_totale_secondi: q.durata_totale_secondi,
          schede: q.id_scheda ? { id_scheda: q.id_scheda, nome: q.workout_name_snapshot } : null,
          note_workout: (q.notes || []).map((n) => ({ testo: n.text, created_at: q.executed_at })),
        }));

      const mergedRuns = [...offlineRuns, ...cloudRuns].sort((a, b) => {
        const timeA = new Date(a.data_esecuzione).getTime() || 0;
        const timeB = new Date(b.data_esecuzione).getTime() || 0;
        return timeB - timeA;
      });

      const offlineSchedeList = getOfflineSchede(user.id);
      if (schedeRes.count !== null && schedeRes.count !== undefined) {
        setSchedeCount(schedeRes.count);
      } else if (offlineSchedeList.length > 0) {
        setSchedeCount(offlineSchedeList.length);
      }

      const schede = schedeRes.data?.length ? schedeRes.data : offlineSchedeList;

      // 2. Filtro sessioni valide (durata >= 15s) condiviso tra barra settimanale e calendario mensile
      const validCompletedRuns = mergedRuns.filter((r) => {
        if (r.durata_totale_secondi !== null && r.durata_totale_secondi !== undefined) {
          return r.durata_totale_secondi >= 15;
        }
        return true;
      });

      setAllRuns(validCompletedRuns);

      // Calcolo date attive in orario locale e calcolo Streak con Set O(1)
      if (validCompletedRuns.length > 0) {
        const dates = validCompletedRuns.map((r) => toLocalDateKey(r.data_esecuzione)).filter(Boolean);
        const uniqueDates = Array.from(new Set(dates));
        const uniqueDateSet = new Set(uniqueDates);
        setActiveDates(uniqueDates);

        let streak = 0;
        const checkDate = new Date();
        checkDate.setHours(0, 0, 0, 0);
        const maxSteps = Math.min(3650, uniqueDateSet.size + 2);

        for (let i = 0; i < maxSteps; i++) {
          const iso = toLocalDateKey(checkDate);
          if (uniqueDateSet.has(iso)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else if (i === 0) {
            // Se oggi non ci si è ancora allenati, verifica la serie da ieri
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
        setStreakDays(streak);
      } else {
        setActiveDates([]);
        setStreakDays(0);
      }

      // 3. Risoluzione intelligente del Prossimo Workout (Sequenziale per Cartella)
      const currentFolders = getFolders(user.id);
      const currentAssignments = getFolderAssignments(user.id);
      const effectiveRuns = validCompletedRuns.length > 0 ? validCompletedRuns : mergedRuns;

      if (effectiveRuns.length > 0 && schede.length > 0) {
        const firstRun = effectiveRuns[0];
        const linkedSchedaObj = Array.isArray(firstRun.schede) ? firstRun.schede[0] : firstRun.schede;
        const lastRunSchedaId = firstRun.id_scheda || linkedSchedaObj?.id_scheda;
        const lastRunName =
          firstRun.workout_name_snapshot ||
          linkedSchedaObj?.nome ||
          `Workout #${firstRun.id_workout}`;

        let nextCandidate: LastWorkoutData | null = null;

        if (lastRunSchedaId) {
          const folderId = getFolderForScheda(lastRunSchedaId, user.id);
          if (folderId) {
            const folder = currentFolders.find((f) => f.id === folderId);
            // Tutte le schede dell'utente attualmente appartenenti a questa cartella
            const folderSchede = (schede as any[])
              .filter((s: any) => currentAssignments[s.id_scheda] === folderId)
              .map((s: any) => ({
                id: s.id_scheda,
                id_scheda: s.id_scheda,
                nome: String(s.nome || ''),
              }));

            if (folderSchede.length > 0) {
              const nextResult = getNextSchedaInFolder<{ id: any; id_scheda: any; nome: string }>(
                folderId,
                lastRunSchedaId,
                folderSchede,
                user.id
              );
              if (nextResult) {
                nextCandidate = {
                  id_scheda: Number(nextResult.nextScheda.id_scheda),
                  nome: nextResult.nextScheda.nome,
                  folderName: folder?.name,
                  folderColor: folder?.color,
                  sequenceLabel: `Scheda #${nextResult.nextIndex + 1} di ${nextResult.total} • Segue: ${lastRunName}`,
                  isNextInSequence: true,
                };
              }
            }
          }
        }

        // Fallback se l'ultimo workout non apparteneva a nessuna cartella valida
        if (!nextCandidate) {
          const runDate = new Date(firstRun.data_esecuzione);
          const isToday = runDate.toDateString() === new Date().toDateString();
          const dataLabel = isToday ? 'Oggi' : runDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

          nextCandidate = {
            id_scheda: lastRunSchedaId ? Number(lastRunSchedaId) : undefined,
            nome: lastRunName,
            dataLabel: `Ultimo eseguito: ${dataLabel}`,
          };
        }

        setLastWorkout(nextCandidate);
      } else if (schede.length > 0) {
        // Nessun workout nello storico: proponi la prima scheda disponibile
        setLastWorkout({
          id_scheda: schede[0].id_scheda,
          nome: schede[0].nome,
          dataLabel: 'Scheda consigliata',
        });
      } else {
        setLastWorkout(null);
      }
    } catch (err) {
      console.error('Errore durante il caricamento della dashboard Home:', err);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboardData();
    const unsubscribeFolders = subscribeToFolderChanges(() => {
      void loadDashboardData();
    });
    const unsubSync = subscribeToSyncQueue(() => {
      void loadDashboardData();
    });
    const unsubSchede = subscribeToOfflineSchede(() => {
      void loadDashboardData();
    });
    return () => {
      unsubscribeFolders();
      unsubSync();
      unsubSchede();
    };
  }, [loadDashboardData]);

  const handleRunNotesUpdated = useCallback(
    (
      workoutId: string | number,
      updatedNotes: Array<{ testo: string; created_at?: string }>
    ) => {
      setAllRuns((prev) =>
        prev.map((run) =>
          String(run.id_workout) === String(workoutId)
            ? { ...run, note_workout: updatedNotes }
            : run
        )
      );
    },
    []
  );

  return (
    <div className="safe-pb-nav flex flex-col items-center relative min-h-screen bg-black text-white selection:bg-brand-orange selection:text-black">
      {/* 1. Header con Saluto, Data, Streak & Logo */}
      <HomeHeader userName={userName} streakDays={streakDays} />

      {/* 2. Contenuto principale Dashboard */}
      <main className="w-full max-w-md mx-auto px-4 flex flex-col gap-4 mt-1">
        {/* Notifica per riprendere il workout in sospeso (in-flow, zero sovrapposizioni) */}
        <ActiveWorkoutBanner />

        {/* Hero Card: Avvio Rapido Sequenziale (visibile quando non c'è una sessione in sospeso) */}
        {!activeCheckpoint && (
          <QuickStartHeroCard
            lastWorkout={lastWorkout}
            onQuickStartScheda={(schedaId, name) => {
              setQuickStartModalSchedaId(schedaId);
              setQuickStartModalName(name || '');
            }}
          />
        )}

        {/* Striscia Settimanale con anelli Apple Fitness (cliccabile per aprire il calendario) */}
        <WeeklyConsistencyBar
          activeDates={activeDates}
          onOpenCalendar={() => setIsCalendarModalOpen(true)}
        />

        {/* Bento Grid 2x2 */}
        <BentoGrid schedeCount={schedeCount} />
      </main>

      {/* 3. Modal Anteprima Scheda Avvio Rapido */}
      {quickStartModalSchedaId != null && (
        <WorkoutPreviewModal
          workoutId={quickStartModalSchedaId}
          initialWorkoutName={quickStartModalName}
          onClose={() => setQuickStartModalSchedaId(null)}
        />
      )}

      {/* 4. Modal Fluttuante Calendario Mensile & Riepiloghi */}
      <MonthlyConsistencyModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        runs={allRuns}
        onRunNotesUpdated={handleRunNotesUpdated}
      />

      {/* 5. Floating Bottom Navigation */}
      <BottomNavigation hidden={quickStartModalSchedaId != null || isCalendarModalOpen} />
    </div>
  );
};

export default HomePage;
