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
import React, { useEffect, useState, useCallback } from 'react';
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
import { getSyncQueue, subscribeToSyncQueue } from '../lib/workoutSyncManager';
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

    try {
      let profileRes: any = { data: null };
      let runsRes: any = { data: [] };
      let schedeRes: any = { data: [], count: null };

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
            .select(`
              id_workout,
              id_scheda,
              workout_name_snapshot,
              exercises_snapshot,
              data_esecuzione,
              durata_totale_secondi,
              schede ( id_scheda, nome ),
              note_workout ( testo, created_at )
            `)
            .eq('id_utente', user.id)
            .order('data_esecuzione', { ascending: false })
            .limit(100),
          supabase
            .from('schede')
            .select('id_scheda, nome, data_creazione', { count: 'exact' })
            .eq('id_utente', user.id)
            .order('data_creazione', { ascending: false }),
        ]);
        profileRes = p;
        runsRes = r;
        schedeRes = s;
      } catch (cloudErr) {
        console.warn('[HomePage] Chiamate cloud non disponibili (offline):', cloudErr);
      }
    }

    // 1. Profilo utente
    if (profileRes.data?.username) {
      setUserName(profileRes.data.username);
    } else {
      setUserName(user.email?.split('@')[0] || 'Atleta');
    }

    const cloudRuns = (runsRes.data as MonthlyWorkoutRun[]) || [];
    // Integra le sessioni completate offline presenti nella coda locale
    const localQueue = getSyncQueue(user.id);
    const offlineRuns: MonthlyWorkoutRun[] = localQueue
      .filter((q) => q.status === 'completed')
      .map((q) => ({
        id_workout: q.remote_workout_run_id || 0,
        id_scheda: q.id_scheda,
        workout_name_snapshot: q.workout_name_snapshot,
        exercises_snapshot: q.exercises_snapshot,
        data_esecuzione: q.executed_at,
        durata_totale_secondi: q.durata_totale_secondi,
        schede: q.id_scheda ? { id_scheda: q.id_scheda, nome: q.workout_name_snapshot } : null,
        note_workout: (q.notes || []).map((n) => ({ testo: n.text, created_at: q.executed_at })),
      }));

    // Combina senza duplicazioni se una run è già sincronizzata con ID remoto
    const mergedRuns = [
      ...offlineRuns.filter((o) => !cloudRuns.some((c) => c.id_workout && c.id_workout === o.id_workout)),
      ...cloudRuns,
    ];
    setAllRuns(mergedRuns);

    const offlineSchedeList = getOfflineSchede(user.id);
    if (schedeRes.count !== null && schedeRes.count !== undefined) {
      setSchedeCount(schedeRes.count);
    } else if (offlineSchedeList.length > 0) {
      setSchedeCount(offlineSchedeList.length);
    }

    const runs = mergedRuns;
    const schede = schedeRes.data?.length ? schedeRes.data : offlineSchedeList;

      // 2. Filtro sessioni valide (durata >= 15s per evitare avviamenti rapidi o test annullati)
      const validCompletedRuns = runs.filter((r) => {
        if (r.durata_totale_secondi !== null && r.durata_totale_secondi !== undefined) {
          return r.durata_totale_secondi >= 15;
        }
        return true;
      });

      // Calcolo date attive in orario locale e calcolo Streak
      if (validCompletedRuns.length > 0) {
        const dates = validCompletedRuns.map((r) => toLocalDateKey(r.data_esecuzione)).filter(Boolean);
        const uniqueDates = Array.from(new Set(dates));
        setActiveDates(uniqueDates);

        let streak = 0;
        const checkDate = new Date();
        checkDate.setHours(0, 0, 0, 0);

        for (let i = 0; i < 60; i++) {
          const iso = toLocalDateKey(checkDate);
          if (uniqueDates.includes(iso)) {
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

      if (runs.length > 0 && schede.length > 0) {
        const firstRun = runs[0];
        const lastRunSchedaId = firstRun.id_scheda || (firstRun.schede as any)?.id_scheda;
        const lastRunName = firstRun.workout_name_snapshot
          || (firstRun.schede as any)?.nome
          || `Workout #${firstRun.id_workout}`;

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
      />

      {/* 5. Floating Bottom Navigation */}
      <BottomNavigation hidden={quickStartModalSchedaId != null || isCalendarModalOpen} />
    </div>
  );
};

export default HomePage;
