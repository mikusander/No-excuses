/**
 * HomeHeader.tsx — Intestazione superiore moderna stile iOS 18 per la Home.
 *
 * Caratteristiche:
 *  - Safe Area Top nativa per Dynamic Island e notch.
 *  - Mini logo brand satinato "NO EXCUSES".
 *  - Badge Streak con icona fiamma arancione (giorni di costanza).
 *  - Saluto contestuale (Buongiorno / Buon pomeriggio / Buonasera) con nome utente.
 *  - Data odierna in italiano con tipografia Apple SF Pro.
 */
import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { logoBase64 } from '../assets/logoBase64';
import { hapticLight } from '../utils/haptics';

interface HomeHeaderProps {
  userName?: string;
  streakDays?: number;
}

const HomeHeader: React.FC<HomeHeaderProps> = ({ userName, streakDays = 0 }) => {
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const refreshTime = () => setNowTick(Date.now());
    const intervalId = setInterval(refreshTime, 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshTime();
      }
    };
    window.addEventListener('focus', refreshTime);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', refreshTime);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const currentDate = new Date(nowTick);
  const hour = currentDate.getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? 'Buongiorno'
      : hour >= 12 && hour < 18
        ? 'Buon pomeriggio'
        : 'Buonasera';

  // Data odierna formattata in italiano (es. "MARTEDÌ 22 SETTEMBRE")
  const formattedDate = currentDate
    .toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    .toUpperCase();

  const displayName = userName?.trim() ? userName.trim() : 'Atleta';

  const handleStreakClick = () => {
    void hapticLight();
  };

  return (
    <header
      className="w-full max-w-md mx-auto px-4 pt-2 pb-3 flex flex-col gap-3"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
      }}
    >
      {/* Barra Superiore: Brand Logo + Streak Pill */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={logoBase64}
            alt="No Excuses"
            className="h-9 w-9 rounded-xl border border-white/20 object-contain shadow-md"
          />
          <span className="text-sm font-black tracking-wider text-white uppercase drop-shadow-sm">
            NO EXCUSES
          </span>
        </div>

        {/* Badge Streak (Fiamma) */}
        <button
          type="button"
          onClick={handleStreakClick}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C1C1E] border border-white/10 shadow-sm active:scale-95 transition-transform cursor-pointer"
          title={`Streak: ${streakDays} giorni di allenamento consecutivi`}
        >
          <Flame size={16} className="text-brand-orange fill-brand-orange drop-shadow-[0_0_8px_rgba(255,94,0,0.5)] animate-pulse" />
          <span className="text-xs font-bold text-white tracking-tight">
            {streakDays} <span className="text-brand-grey/60 font-medium text-[10px]">gg</span>
          </span>
        </button>
      </div>

      {/* Saluto Personale & Data */}
      <div className="flex flex-col">
        <span className="text-[11px] font-semibold text-brand-grey/60 tracking-wider">
          {formattedDate}
        </span>
        <h1 className="text-2xl font-black text-white tracking-tight leading-tight">
          {greeting}, <span className="text-brand-orange">{displayName}</span>
        </h1>
      </div>
    </header>
  );
};

export default React.memo(HomeHeader);
