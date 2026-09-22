/**
 * WeeklyConsistencyBar.tsx — Widget settimanale stile Apple Fitness.
 *
 * Mostra i 7 giorni della settimana corrente (Lunedì - Domenica)
 * evidenziando con anello pieno arancione i giorni in cui l'utente si è allenato,
 * e con un bordo luminoso il giorno odierno.
 */
import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { hapticLight } from '../utils/haptics';

interface WeeklyConsistencyBarProps {
  /** Array di date ISO (YYYY-MM-DD) in cui c'è stato un workout completato */
  activeDates?: string[];
}

const DAYS_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

const WeeklyConsistencyBar: React.FC<WeeklyConsistencyBarProps> = ({ activeDates = [] }) => {
  const activeSet = useMemo(() => new Set(activeDates), [activeDates]);

  // Calcola i 7 giorni della settimana corrente (da lunedì a domenica)
  const weekDays = useMemo(() => {
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0 = Domenica, 1 = Lunedì, ...
    // Distanza da Lunedì (Lunedì = 0, Domenica = 6)
    const diffToMonday = (currentDayOfWeek + 6) % 7;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const todayIso = today.toISOString().split('T')[0];

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const isToday = iso === todayIso;
      const isPast = d < today && !isToday;
      const hasWorkout = activeSet.has(iso);

      return {
        letter: DAYS_LETTERS[i],
        dayNum: d.getDate(),
        iso,
        isToday,
        isPast,
        hasWorkout,
      };
    });
  }, [activeSet]);

  const completedCount = useMemo(() => {
    return weekDays.filter(d => d.hasWorkout).length;
  }, [weekDays]);

  return (
    <div className="w-full bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-4 shadow-lg flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
          Costanza Settimanale
        </span>
        <span className="text-[11px] font-semibold text-brand-grey/60">
          <strong className="text-brand-orange">{completedCount}</strong>/7 sessioni
        </span>
      </div>

      {/* Griglia a 7 cerchi */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day) => {
          return (
            <div
              key={day.iso}
              onClick={() => void hapticLight()}
              className="flex flex-col items-center gap-1.5 select-none cursor-pointer"
            >
              <span className={`text-[10px] font-bold ${day.isToday ? 'text-brand-orange' : 'text-brand-grey/50'}`}>
                {day.letter}
              </span>

              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all ${
                  day.hasWorkout
                    ? 'bg-brand-orange text-black font-black shadow-[0_0_12px_rgba(255,94,0,0.4)]'
                    : day.isToday
                    ? 'bg-transparent border-2 border-brand-orange text-brand-orange font-bold'
                    : 'bg-white/5 text-brand-grey/40 font-medium'
                }`}
              >
                {day.hasWorkout ? (
                  <Check size={16} strokeWidth={3} />
                ) : (
                  <span className="text-xs">{day.dayNum}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(WeeklyConsistencyBar);
