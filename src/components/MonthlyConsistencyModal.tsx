/**
 * MonthlyConsistencyModal.tsx — Vista modale fluttuante con calendario mensile completo,
 * colorazione dei giorni allenati, selezione del giorno e accesso ai riepiloghi.
 */
import React, { useState, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Flame,
  Clock,
  Dumbbell,
  ArrowRight,
} from 'lucide-react';
import { hapticLight, hapticMedium } from '../utils/haptics';
import WorkoutSessionRecapModal, { type RecapWorkoutSession } from './WorkoutSessionRecapModal';

export interface MonthlyWorkoutRun {
  id_workout: number | string;
  id_scheda?: number | string | null;
  workout_name_snapshot?: string | null;
  exercises_snapshot?: any;
  data_esecuzione: string;
  durata_totale_secondi?: number | null;
  schede?: { id_scheda?: number | string; nome?: string } | null;
  note_workout?: Array<{ testo?: string; created_at?: string }> | null;
}

interface MonthlyConsistencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  runs: MonthlyWorkoutRun[];
}

const WEEKDAY_NAMES = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

const toLocalDateKey = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const MonthlyConsistencyModal: React.FC<MonthlyConsistencyModalProps> = ({
  isOpen,
  onClose,
  runs = [],
}) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDateIso, setSelectedDateIso] = useState<string>(() => toLocalDateKey(new Date()));
  const [activeRecapSession, setActiveRecapSession] = useState<RecapWorkoutSession | null>(null);

  // Mappa di tutte le sessioni raggruppate per data locale 'YYYY-MM-DD'
  const runsByDate = useMemo(() => {
    const map = new Map<string, MonthlyWorkoutRun[]>();
    for (const r of runs) {
      if (!r.data_esecuzione) continue;
      // Considera sessioni valide (es. durata > 0 o snapshot presente)
      const dateKey = toLocalDateKey(r.data_esecuzione);
      if (!dateKey) continue;
      const list = map.get(dateKey) || [];
      list.push(r);
      map.set(dateKey, list);
    }
    return map;
  }, [runs]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  // Nome del mese e anno in italiano
  const monthLabel = useMemo(() => {
    const d = new Date(year, month, 1);
    const mName = d.toLocaleDateString('it-IT', { month: 'long' });
    return `${mName.charAt(0).toUpperCase() + mName.slice(1)} ${year}`;
  }, [year, month]);

  // Calcolo dei giorni del mese con offset lunedì
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const numDays = lastDayOfMonth.getDate();

    // In JS: 0 = Domenica, 1 = Lunedì...
    // In Italia: Lunedì = 0, Domenica = 6
    const firstDayWeekday = (firstDayOfMonth.getDay() + 6) % 7;

    const days: Array<{
      dayNum: number | null;
      iso: string;
      hasWorkout: boolean;
      workoutCount: number;
      isToday: boolean;
    }> = [];

    // Spazi vuoti per i giorni precedenti al 1° del mese
    for (let i = 0; i < firstDayWeekday; i++) {
      days.push({
        dayNum: null,
        iso: `empty-${i}`,
        hasWorkout: false,
        workoutCount: 0,
        isToday: false,
      });
    }

    const todayIso = toLocalDateKey(new Date());

    for (let day = 1; day <= numDays; day++) {
      const d = new Date(year, month, day);
      const iso = toLocalDateKey(d);
      const dayRuns = runsByDate.get(iso) || [];
      const hasWorkout = dayRuns.length > 0;

      days.push({
        dayNum: day,
        iso,
        hasWorkout,
        workoutCount: dayRuns.length,
        isToday: iso === todayIso,
      });
    }

    return days;
  }, [year, month, runsByDate]);

  // Allenamenti del mese corrente (conteggio)
  const monthWorkoutsCount = useMemo(() => {
    let count = 0;
    for (const d of calendarDays) {
      if (d.dayNum !== null && d.hasWorkout) {
        count += d.workoutCount;
      }
    }
    return count;
  }, [calendarDays]);

  // Allenamenti per la data attualmente selezionata
  const selectedDayRuns = useMemo(() => {
    return runsByDate.get(selectedDateIso) || [];
  }, [runsByDate, selectedDateIso]);

  const selectedDateFormatted = useMemo(() => {
    const [y, m, d] = selectedDateIso.split('-').map(Number);
    if (!y || !m || !d) return selectedDateIso;
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [selectedDateIso]);

  if (!isOpen) return null;

  const handlePrevMonth = () => {
    void hapticLight();
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    void hapticLight();
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleSelectDay = (iso: string) => {
    void hapticLight();
    setSelectedDateIso(iso);
  };

  const handleOpenRecap = (run: MonthlyWorkoutRun) => {
    void hapticMedium();
    const workoutName =
      run.workout_name_snapshot ||
      run.schede?.nome ||
      (run.id_scheda ? `Workout #${run.id_scheda}` : `Workout #${run.id_workout}`);

    const notesList = (run.note_workout || []).map((n) => ({
      text: String(n.testo || ''),
      createdAt: n.created_at,
    }));

    setActiveRecapSession({
      id: run.id_workout,
      workoutName,
      executedAt: run.data_esecuzione,
      totalDurationSeconds: run.durata_totale_secondi,
      exercisesSnapshot: run.exercises_snapshot || [],
      notes: notesList,
      schedaId: run.id_scheda,
    });
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-2xl animate-fade-in"
        onClick={() => {
          void hapticLight();
          onClose();
        }}
      >
        <div
          className="w-full max-w-md max-h-[90vh] flex flex-col rounded-3xl bg-[#1C1C1E] border border-white/10 shadow-2xl overflow-hidden relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Modale */}
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center text-brand-orange">
                <CalendarIcon size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-tight flex items-center gap-1.5">
                  Costanza Mensile
                </h2>
                <p className="text-[11px] font-semibold text-brand-grey/70">
                  <strong className="text-brand-orange">{monthWorkoutsCount}</strong> sessioni questo mese
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void hapticLight();
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Chiudi"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigatore Mese */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] border-b border-white/5 shrink-0">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Mese precedente"
            >
              <ChevronLeft size={20} />
            </button>

            <span className="text-sm font-black text-white tracking-wide">
              {monthLabel}
            </span>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Mese successivo"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Griglia Calendario (Intestazione giorni + giorni del mese) */}
          <div className="p-3.5 sm:p-4 bg-white/[0.01] shrink-0 border-b border-white/10">
            {/* Header Lun - Dom */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {WEEKDAY_NAMES.map((d, i) => (
                <span key={i} className="text-[11px] font-black text-brand-grey/50">
                  {d}
                </span>
              ))}
            </div>

            {/* Griglia giorni */}
            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day, idx) => {
                if (day.dayNum === null) {
                  return <div key={idx} className="w-full aspect-square" />;
                }

                const isSelected = day.iso === selectedDateIso;

                return (
                  <button
                    key={day.iso}
                    type="button"
                    onClick={() => handleSelectDay(day.iso)}
                    className={`w-full aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all cursor-pointer select-none ${
                      isSelected
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1C1C1E] scale-105 z-10'
                        : 'hover:scale-102'
                    } ${
                      day.hasWorkout
                        ? 'bg-brand-orange text-black font-black shadow-[0_0_12px_rgba(255,94,0,0.4)]'
                        : day.isToday
                        ? 'bg-white/10 border-2 border-white/30 text-white font-bold'
                        : 'bg-white/5 text-brand-grey/70 hover:bg-white/10 font-medium'
                    }`}
                  >
                    <span className="text-xs sm:text-sm font-bold">
                      {day.dayNum}
                    </span>

                    {/* Checkmark discreto per i giorni completati */}
                    {day.hasWorkout && (
                      <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-black/80" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sezione Allenamenti del Giorno Selezionato */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold text-brand-grey/80 capitalize">
                {selectedDateFormatted}
              </h3>
              <span className="text-[10px] font-semibold text-brand-orange uppercase tracking-wider">
                {selectedDayRuns.length} {selectedDayRuns.length === 1 ? 'sessione' : 'sessioni'}
              </span>
            </div>

            {selectedDayRuns.length === 0 ? (
              <div className="text-center py-6 px-4 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
                <CalendarIcon size={24} className="mx-auto text-brand-grey/40 mb-1.5" />
                <p className="text-xs font-semibold text-brand-grey/60">
                  Nessun allenamento registrato in questo giorno.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayRuns.map((run) => {
                  const name =
                    run.workout_name_snapshot ||
                    run.schede?.nome ||
                    (run.id_scheda ? `Workout #${run.id_scheda}` : `Workout #${run.id_workout}`);

                  const timeStr = new Date(run.data_esecuzione).toLocaleTimeString('it-IT', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  const durationSecs = run.durata_totale_secondi;
                  const durationLabel = durationSecs
                    ? `${Math.floor(durationSecs / 60)} min`
                    : 'Completato';

                  const exercisesCount = Array.isArray(run.exercises_snapshot)
                    ? run.exercises_snapshot.length
                    : 0;

                  return (
                    <div
                      key={run.id_workout}
                      onClick={() => handleOpenRecap(run)}
                      role="button"
                      tabIndex={0}
                      className="p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-brand-orange/40 transition-all flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.985]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center text-brand-orange shrink-0 group-hover:scale-105 transition-transform">
                          <Flame size={20} className="fill-brand-orange" />
                        </div>

                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-white group-hover:text-brand-orange transition-colors truncate">
                            {name}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-brand-grey/70 mt-0.5">
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {timeStr} • {durationLabel}
                            </span>
                            {exercisesCount > 0 && (
                              <span className="flex items-center gap-1">
                                • <Dumbbell size={11} />
                                {exercisesCount} es.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 text-brand-orange text-xs font-bold">
                        <span className="hidden sm:inline">Riepilogo</span>
                        <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal di Riepilogo Dettagliato Sessione */}
      <WorkoutSessionRecapModal
        workout={activeRecapSession}
        isOpen={Boolean(activeRecapSession)}
        onClose={() => setActiveRecapSession(null)}
      />
    </>
  );
};

export default MonthlyConsistencyModal;
