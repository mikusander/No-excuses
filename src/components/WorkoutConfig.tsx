import React, { useState } from 'react';
import { Dumbbell, Play, Info, Volume2 } from 'lucide-react';
import { speak } from '../utils/voice';
import { playErrorSound } from '../utils/audio';
import type { WorkoutConfig as IWorkoutConfig } from '../types';

interface Props {
  onStart: (config: IWorkoutConfig) => void;
}

const WorkoutConfig: React.FC<Props> = ({ onStart }) => {
  const [pullups, setPullups] = useState(10);
  const [pushups, setPushups] = useState(20);
  const [squats, setSquats] = useState(30);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-auto bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary/20 rounded-2xl">
            <Dumbbell className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Configura Workout</h1>
            <p className="text-white/50 text-sm">Imposta i tuoi obiettivi per oggi</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <label className="text-sm font-medium text-white/70">Trazioni (Pull-ups)</label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={pullups === Infinity}
                  onChange={(e) => setPullups(e.target.checked ? Infinity : 10)}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary/50"
                />
                <span className="text-[10px] uppercase tracking-wider text-white/40 group-hover:text-white/60 transition-colors">Senza limiti</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="number"
                disabled={pullups === Infinity}
                value={pullups === Infinity ? '' : pullups}
                onChange={(e) => setPullups(parseInt(e.target.value) || 0)}
                className={`w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-xl font-semibold text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${pullups === Infinity ? 'opacity-50 cursor-not-allowed placeholder:text-primary/50' : ''}`}
                placeholder={pullups === Infinity ? '∞ RIPETIZIONI' : 'Inserisci numero'}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <label className="text-sm font-medium text-white/70">Flessioni (Push-ups)</label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={pushups === Infinity}
                  onChange={(e) => setPushups(e.target.checked ? Infinity : 20)}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary/50"
                />
                <span className="text-[10px] uppercase tracking-wider text-white/40 group-hover:text-white/60 transition-colors">Senza limiti</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="number"
                disabled={pushups === Infinity}
                value={pushups === Infinity ? '' : pushups}
                onChange={(e) => setPushups(parseInt(e.target.value) || 0)}
                className={`w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-xl font-semibold text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${pushups === Infinity ? 'opacity-50 cursor-not-allowed placeholder:text-primary/50' : ''}`}
                placeholder={pushups === Infinity ? '∞ RIPETIZIONI' : 'Inserisci numero'}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <label className="text-sm font-medium text-white/70">Squat</label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={squats === Infinity}
                  onChange={(e) => setSquats(e.target.checked ? Infinity : 30)}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary/50"
                />
                <span className="text-[10px] uppercase tracking-wider text-white/40 group-hover:text-white/60 transition-colors">Senza limiti</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="number"
                disabled={squats === Infinity}
                value={squats === Infinity ? '' : squats}
                onChange={(e) => setSquats(parseInt(e.target.value) || 0)}
                className={`w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-xl font-semibold text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${squats === Infinity ? 'opacity-50 cursor-not-allowed placeholder:text-primary/50' : ''}`}
                placeholder={squats === Infinity ? '∞ RIPETIZIONI' : 'Inserisci numero'}
              />
            </div>
          </div>

          <div className="pt-4">
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  playErrorSound();
                  speak("Prova audio completata. Il volume e la voce sono configurati correttamente.");
                }}
                className="w-full mb-4 flex items-center justify-center gap-2 py-3 bg-white/5 border border-white/10 rounded-xl text-white/50 text-sm hover:bg-white/10 transition-all font-medium"
              >
                <Volume2 className="w-4 h-4" />
                Prova Audio e Voce
              </button>

              <button
                onClick={() => onStart({ pullupsCount: pullups, pushupsCount: pushups, squatsCount: squats })}
                className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 text-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
              >
                <Play className="w-6 h-6 fill-current" />
                Inizia Allenamento
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 p-4 bg-white/5 rounded-2xl flex gap-3 items-start">
          <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-white/40 leading-relaxed">
            Assicurati che l'intera figura sia visibile nella fotocamera. Il sistema conterà automaticamente le ripetizioni basate sui tuoi movimenti.
          </p>
        </div>
      </div>
    </div>
  );
};

export default WorkoutConfig;
