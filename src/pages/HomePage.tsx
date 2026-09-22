/**
 * HomePage.tsx — Dashboard principale in stile Apple Bento Grid per app nativa iPhone.
 *
 * Include:
 *  - HomeHeader: Saluto dinamico, data in italiano, badge Streak e mini logo.
 *  - QuickStartHeroCard: Avvio rapido in 1 tap dell'ultima scheda o ripresa workout interrotto.
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
import QuickStartHeroCard from '../components/QuickStartHeroCard';
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

interface LastWorkoutData {
  id_scheda?: number;
  nome: string;
  dataLabel?: string;
}

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

  // Carica i dati dell'utente, storico e schede
  useEffect(() => {
    if (!user?.id) return;

    let isMounted = true;

    const loadDashboardData = async () => {
      try {
        // 1. Profilo utente
        const { data: profile } = await supabase
          .from('profili')
          .select('username')
          .eq('id_utente', user.id)
          .maybeSingle();

        if (isMounted) {
          if (profile?.username) {
            setUserName(profile.username);
          } else {
            setUserName(user.email?.split('@')[0] || 'Atleta');
          }
        }

        // 2. Storico sessioni per calcolo Streak e Weekly Consistency
        const { data: runs } = await supabase
          .from('workout_run')
          .select('id_workout, id_scheda, workout_name_snapshot, data_esecuzione, schede(id_scheda, nome)')
          .eq('id_utente', user.id)
          .order('data_esecuzione', { ascending: false })
          .limit(30);

        if (isMounted && runs && runs.length > 0) {
          // Date uniche ISO YYYY-MM-DD
          const dates = runs.map(r => r.data_esecuzione.split('T')[0]);
          const uniqueDates = Array.from(new Set(dates));
          setActiveDates(uniqueDates);

          // Calcolo streak di giorni consecutivi
          let streak = 0;
          const checkDate = new Date();
          checkDate.setHours(0, 0, 0, 0);

          for (let i = 0; i < 30; i++) {
            const iso = checkDate.toISOString().split('T')[0];
            if (uniqueDates.includes(iso)) {
              streak++;
              checkDate.setDate(checkDate.getDate() - 1);
            } else if (i === 0) {
              // Se oggi non ti sei ancora allenato, controlla se ti sei allenato ieri
              checkDate.setDate(checkDate.getDate() - 1);
            } else {
              break;
            }
          }
          setStreakDays(streak);

          // Ultima sessione eseguita
          const firstRun = runs[0];
          const name = firstRun.workout_name_snapshot
            || (firstRun.schede as any)?.nome
            || `Workout #${firstRun.id_workout}`;
          
          const runDate = new Date(firstRun.data_esecuzione);
          const isToday = runDate.toDateString() === new Date().toDateString();
          const dataLabel = isToday ? 'Oggi' : runDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

          setLastWorkout({
            id_scheda: firstRun.id_scheda || (firstRun.schede as any)?.id_scheda,
            nome: name,
            dataLabel,
          });
        }

        // 3. Conteggio schede dell'utente (e fallback per ultima scheda se nessuno storico)
        const { data: schede, count } = await supabase
          .from('schede')
          .select('id_scheda, nome, data_creazione', { count: 'exact' })
          .eq('id_utente', user.id)
          .order('data_creazione', { ascending: false });

        if (isMounted) {
          if (count !== null) setSchedeCount(count);

          // Se non c'è una sessione completata, usa la scheda creata più recentemente come suggerita
          if ((!runs || runs.length === 0) && schede && schede.length > 0) {
            setLastWorkout({
              id_scheda: schede[0].id_scheda,
              nome: schede[0].nome,
              dataLabel: 'Nuova Scheda',
            });
          }
        }
      } catch (err) {
        console.error('Errore nel caricamento dei dati della Home:', err);
      }
    };

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  return (
    <div className="safe-pb-nav flex flex-col items-center relative min-h-screen bg-black text-white selection:bg-brand-orange selection:text-black">
      {/* 1. Header con Saluto, Data, Streak & Logo */}
      <HomeHeader userName={userName} streakDays={streakDays} />

      {/* 2. Contenuto principale Dashboard */}
      <main className="w-full max-w-md mx-auto px-4 flex flex-col gap-4 mt-1">
        {/* Hero Card: Avvio Rapido / Riprendi Workout */}
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
