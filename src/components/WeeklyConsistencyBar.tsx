/**
 * WeeklyConsistencyBar.tsx — Widget settimanale stile Apple Fitness.
 *
 * Mostra i 7 giorni della settimana corrente (Lunedì - Domenica)
 * evidenziando con anello pieno arancione i giorni in cui l'utente si è allenato.
 * Il giorno odierno, se non ancora allenato, mostra un bordo neutro e discreto
 * per non ingannare l'utente facendogli credere che la sessione sia già completata.
 *
 * Cliccando sulla card si apre la vista modale del calendario mensile completo.
 */
import React, { useMemo } from 'react';
import { Check, Calendar } from 'lucide-react';
import { hapticLight } from '../utils/haptics';

interface WeeklyConsistencyBarProps {
  /** Array di date ISO locali (YYYY-MM-DD) in cui c'è stato un workout completato */
  activeDates?: string[];
  /** Callback per aprire il calendario mensile in modale fluttuante */
  onOpenCalendar?: () => void;
}

const DAYS_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

const toLocalDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const WeeklyConsistencyBar: React.FC<WeeklyConsistencyBarProps> = ({
  activeDates = [],
  onOpenCalendar,
}) => {
  const activeSet = useMemo(() => new Set(activeDates), [activeDates]);

  // Calcola i 7 giorni della settimana corrente (da lunedì a domenica) in orario locale
  const weekDays = useMemo(() => {
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0 = Domenica, 1 = Lunedì, ...
    // Distanza da Lunedì (Lunedì = 0, Domenica = 6)
    const diffToMonday = (currentDayOfWeek + 6) % 7;

    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const todayIso = toLocalDateString(today);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = toLocalDateString(d);
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
    return weekDays.filter((d) => d.hasWorkout).length;
  }, [weekDays]);

  const handleClick = () => {
    void hapticLight();
    onOpenCalendar?.();
  };

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className="w-full bg-[#1C1C1E]/90 hover:bg-[#1C1C1E] backdrop-blur-xl border border-white/10 hover:border-brand-orange/40 rounded-3xl p-4 shadow-lg flex flex-col gap-3 cursor-pointer transition-all active:scale-[0.99] select-none group"
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5 group-hover:text-brand-orange transition-colors">
          <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
          Costanza Settimanale
          <Calendar size={13} className="text-brand-orange/70 group-hover:text-brand-orange transition-colors ml-0.5" />
        </span>
        <span className="text-[11px] font-semibold text-brand-grey/60 flex items-center gap-1">
          <strong className="text-brand-orange">{completedCount}</strong>/7 sessioni
          <span className="text-[10px] text-brand-orange/70 font-bold ml-1 hidden sm:inline">Tocca per calendario</span>
        </span>
      </div>

      {/* Griglia a 7 cerchi */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day) => {
          return (
            <div
              key={day.iso}
              className="flex flex-col items-center gap-1.5 select-none"
            >
              <span className={`text-[10px] font-bold ${day.isToday ? 'text-brand-orange' : 'text-brand-grey/50'}`}>
                {day.letter}
              </span>

              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all ${
                  day.hasWorkout
                    ? 'bg-brand-orange text-black font-black shadow-[0_0_12px_rgba(255,94,0,0.4)]'
                    : day.isToday
                    ? 'bg-white/10 border-2 border-white/30 text-white font-bold'
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
