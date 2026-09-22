/**
 * HomePage.tsx — Dashboard principale in stile Apple Bento Grid per app nativa iPhone.
 *
 * Include:
 *  - HomeHeader: Saluto dinamico, data in italiano, badge Streak e mini logo.
 *  - QuickStartHeroCard: Avvio rapido sequenziale:
 *      * Se workout in corso -> Riprendi sessione
 *      * Se l'ultimo workout appartiene a una cartella -> Avvia il prossimo workout in sequenza (ciclico)
 *      * Altrimenti -> Ultima scheda eseguita o scheda consigliata
 *  - WeeklyConsistencyBar: Striscia dei 7 giorni della settimana con anelli di completamento.
 *  - BentoGrid: 4 tessere modulari (Scegli Scheda, Free Mode, Storico, Nuova Scheda).
 *  - BottomNavigation: Barra Instagram-style con liquid glass e supporto safe-area.
 *
 * Ottimizzazione termica ed energetica per iPhone:
 *  - Sfondo OLED nero puro (#000000) per azzerare calore e consumi del display.
 *  - Nessun re-render continuo o loop ad alta frequenza nel ciclo di vita della Home.
 */
import React, { useEffect, useState, useCallback } from 'react';
import HomeHeader from '../components/HomeHeader';
import QuickStartHeroCard, { type LastWorkoutData } from '../components/QuickStartHeroCard';
import WeeklyConsistencyBar from '../components/WeeklyConsistencyBar';
import BentoGrid from '../components/BentoGrid';
import BottomNavigation from '../components/BottomNavigation';
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

const HomePage: React.FC = () => {
  const { user } = useAuth();

  const [userName, setUserName] = useState<string>('');
  const [streakDays, setStreakDays] = useState<number>(0);
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [lastWorkout, setLastWorkout] = useState<LastWorkoutData | null>(null);
  const [schedeCount, setSchedeCount] = useState<number>(0);
  const [activeCheckpoint, setActiveCheckpoint] = useState<WorkoutProgressCheckpointMeta | null>(null);

  // Sincronizza lo stato del checkpoint (workout in sospeso)
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
    const unsubscribe = subscribeToWorkoutProgress(() => {
      refreshCheckpoint();
    });
    return unsubscribe;
  }, [refreshCheckpoint]);

  // Carica i dati dell'utente, storico e schede con risoluzione del prossimo workout in sequenza
  const loadDashboardData = useCallback(async () => {
    if (!user?.id) return;

    try {
      // Caricamento in parallelo per massima reattività
      const [profileRes, runsRes, schedeRes] = await Promise.all([
        supabase
          .from('profili')
          .select('username')
          .eq('id_utente', user.id)
          .maybeSingle(),
        supabase
          .from('workout_run')
          .select('id_workout, id_scheda, workout_name_snapshot, data_esecuzione, schede(id_scheda, nome)')
          .eq('id_utente', user.id)
          .order('data_esecuzione', { ascending: false })
          .limit(30),
        supabase
          .from('schede')
          .select('id_scheda, nome, data_creazione', { count: 'exact' })
          .eq('id_utente', user.id)
          .order('data_creazione', { ascending: false }),
      ]);

      // 1. Profilo utente
      if (profileRes.data?.username) {
        setUserName(profileRes.data.username);
      } else {
        setUserName(user.email?.split('@')[0] || 'Atleta');
      }

      const runs = runsRes.data || [];
      const schede = schedeRes.data || [];
      if (schedeRes.count !== null && schedeRes.count !== undefined) {
        setSchedeCount(schedeRes.count);
      }

      // 2. Storico sessioni, calcolo Streak e date della settimana
      if (runs.length > 0) {
        const dates = runs.map((r) => r.data_esecuzione.split('T')[0]);
        const uniqueDates = Array.from(new Set(dates));
        setActiveDates(uniqueDates);

        let streak = 0;
        const checkDate = new Date();
        checkDate.setHours(0, 0, 0, 0);

        for (let i = 0; i < 30; i++) {
          const iso = checkDate.toISOString().split('T')[0];
          if (uniqueDates.includes(iso)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else if (i === 0) {
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
            const folderSchede = schede
              .filter((s) => currentAssignments[s.id_scheda] === folderId)
              .map((s) => ({ id: s.id_scheda, id_scheda: s.id_scheda, nome: s.nome }));

            if (folderSchede.length > 0) {
              const nextResult = getNextSchedaInFolder(folderId, lastRunSchedaId, folderSchede, user.id);
              if (nextResult) {
                nextCandidate = {
                  id_scheda: nextResult.nextScheda.id_scheda,
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
            id_scheda: lastRunSchedaId,
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
    return unsubscribeFolders;
  }, [loadDashboardData]);

  return (
    <div className="safe-pb-nav flex flex-col items-center relative min-h-screen bg-black text-white selection:bg-brand-orange selection:text-black">
      {/* 1. Header con Saluto, Data, Streak & Logo */}
      <HomeHeader userName={userName} streakDays={streakDays} />

      {/* 2. Contenuto principale Dashboard */}
      <main className="w-full max-w-md mx-auto px-4 flex flex-col gap-4 mt-1">
        {/* Hero Card: Avvio Rapido Sequenziale / Riprendi Workout */}
        <QuickStartHeroCard
          activeCheckpoint={activeCheckpoint}
          lastWorkout={lastWorkout}
        />

        {/* Striscia Settimanale con anelli Apple Fitness */}
        <WeeklyConsistencyBar activeDates={activeDates} />

        {/* Bento Grid 2x2 */}
        <BentoGrid schedeCount={schedeCount} />
      </main>

      {/* 3. Floating Bottom Navigation */}
      <BottomNavigation />
    </div>
  );
};

export default HomePage;
