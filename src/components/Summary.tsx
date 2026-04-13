import React from 'react';
import { Trophy, Home } from 'lucide-react';
import type { WorkoutConfig } from '../types';

interface Props {
  config: WorkoutConfig;
  onRestart: () => void;
}

const Summary: React.FC<Props> = ({ config, onRestart }) => {


  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 p-10 rounded-3xl shadow-2xl text-center">
        <div className="inline-flex p-4 bg-green-500/20 rounded-full mb-6">
          <Trophy className="w-12 h-12 text-green-500" />
        </div>
        
        <h1 className="text-3xl font-black text-white mb-2">Workout Completato!</h1>
        <p className="text-white/50 mb-8">Ottimo lavoro, hai raggiunto tutti i tuoi obiettivi.</p>

        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Trazioni</p>
            <p className="text-2xl font-black text-white">
              {config.pullupsCount === Infinity ? '∞' : config.pullupsCount}
            </p>
          </div>
          <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Flessioni</p>
            <p className="text-2xl font-black text-white">
              {config.pushupsCount === Infinity ? '∞' : config.pushupsCount}
            </p>
          </div>
          <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Squat</p>
            <p className="text-2xl font-black text-white">
              {config.squatsCount === Infinity ? '∞' : config.squatsCount}
            </p>
          </div>
        </div>

        <button
          onClick={onRestart}
          className="w-full bg-white text-black font-bold py-5 rounded-2xl flex items-center justify-center gap-3 text-lg hover:bg-white/90 transition-all active:scale-[0.98]"
        >
          <Home className="w-6 h-6" />
          Torna alla Home
        </button>
      </div>
    </div>
  );
};

export default Summary;
