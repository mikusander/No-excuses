/**
 * BentoGrid.tsx — Griglia 2x2 in stile Bento Apple.
 *
 * Le 4 tessere modulari:
 *  1. Scegli Scheda (Allenati) -> /select-workout
 *  2. Free Mode (Contatore)    -> /reps-count
 *  3. Attività (Storico)       -> /workout-history
 *  4. Nuova Scheda             -> /new-train
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, Zap, History, PlusCircle, ChevronRight } from 'lucide-react';
import { hapticLight } from '../utils/haptics';

interface BentoGridProps {
  schedeCount?: number;
}

const BentoGrid: React.FC<BentoGridProps> = ({ schedeCount }) => {
  const navigate = useNavigate();

  const handleNav = (to: string) => {
    void hapticLight();
    navigate(to);
  };

  return (
    <div className="w-full grid grid-cols-2 gap-3.5 select-none">
      {/* 1. Scegli Scheda / Allenamento Guidato */}
      <div
        onClick={() => handleNav('/select-workout')}
        className="group relative bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 hover:border-brand-orange/50 active:scale-[0.97] transition-all rounded-3xl p-4.5 flex flex-col justify-between min-h-[145px] cursor-pointer shadow-lg overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-brand-orange/10 rounded-full blur-xl pointer-events-none" />
        
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-2xl bg-brand-orange/20 border border-brand-orange/40 flex items-center justify-center text-brand-orange shadow-inner">
            <Dumbbell size={20} />
          </div>
          <ChevronRight size={16} className="text-brand-grey/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
        </div>

        <div className="flex flex-col gap-0.5 mt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-orange">
            {schedeCount !== undefined && schedeCount > 0 ? `${schedeCount} pronte` : 'Programma'}
          </span>
          <h3 className="text-base font-bold text-white tracking-tight group-hover:text-brand-orange transition-colors">
            Scegli Scheda
          </h3>
          <p className="text-[11px] font-medium text-brand-grey/60">
            Allenamento guidato
          </p>
        </div>
      </div>

      {/* 2. Free Mode (Contatore Reps & Recupero) */}
      <div
        onClick={() => handleNav('/reps-count')}
        className="group relative bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 hover:border-amber-400/50 active:scale-[0.97] transition-all rounded-3xl p-4.5 flex flex-col justify-between min-h-[145px] cursor-pointer shadow-lg overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
            <Zap size={20} fill="currentColor" />
          </div>
          <ChevronRight size={16} className="text-brand-grey/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
        </div>

        <div className="flex flex-col gap-0.5 mt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            Libero
          </span>
          <h3 className="text-base font-bold text-white tracking-tight group-hover:text-amber-300 transition-colors">
            Free Mode
          </h3>
          <p className="text-[11px] font-medium text-brand-grey/60">
            Contatore & recupero
          </p>
        </div>
      </div>

      {/* 3. Storico & Attività */}
      <div
        onClick={() => handleNav('/workout-history')}
        className="group relative bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 hover:border-blue-400/50 active:scale-[0.97] transition-all rounded-3xl p-4.5 flex flex-col justify-between min-h-[145px] cursor-pointer shadow-lg overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-inner">
            <History size={20} />
          </div>
          <ChevronRight size={16} className="text-brand-grey/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
        </div>

        <div className="flex flex-col gap-0.5 mt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
            Sessioni
          </span>
          <h3 className="text-base font-bold text-white tracking-tight group-hover:text-blue-300 transition-colors">
            Storico
          </h3>
          <p className="text-[11px] font-medium text-brand-grey/60">
            Registro & progressi
          </p>
        </div>
      </div>

      {/* 4. Nuova Scheda */}
      <div
        onClick={() => handleNav('/new-train')}
        className="group relative bg-[#1C1C1E]/90 backdrop-blur-xl border border-white/10 hover:border-emerald-400/50 active:scale-[0.97] transition-all rounded-3xl p-4.5 flex flex-col justify-between min-h-[145px] cursor-pointer shadow-lg overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner">
            <PlusCircle size={20} />
          </div>
          <ChevronRight size={16} className="text-brand-grey/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
        </div>

        <div className="flex flex-col gap-0.5 mt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Crea
          </span>
          <h3 className="text-base font-bold text-white tracking-tight group-hover:text-emerald-300 transition-colors">
            Nuova Scheda
          </h3>
          <p className="text-[11px] font-medium text-brand-grey/60">
            Editor allenamenti
          </p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(BentoGrid);
