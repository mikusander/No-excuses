/**
 * BottomNavigation.tsx — Barra di navigazione inferiore stile Apple (glassmorphism).
 *
 * Mostra una floating tab bar con quattro voci: Home, Gym Card, History, Settings.
 * La voce attiva viene evidenziata con glow animato, label che appare e indicatore
 * a pill nella parte inferiore dell'icona (liquid dot indicator).
 *
 * Props:
 *  - hidden (bool, default false): se true il componente non viene renderizzato,
 *    utile nelle schermate a schermo intero come il workout attivo.
 *
 * Note stilistiche:
 *  - backdrop-blur + saturate per l'effetto vetro smerigliato
 *  - z-50 per stare sopra tutti gli altri elementi
 *  - pointer-events-none sul container esterno + pointer-events-auto sulla pill
 *    per non bloccare i click nelle aree trasparenti intorno alla barra
 */
import { Home, Folder, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hapticLight } from '../utils/haptics';

/**
 * Stile CSS-in-JS per l'icona "History" che usa una maschera CSS con immagine custom.
 * Il colore viene ereditato da `currentColor` così l'icona risponde ai cambii di colore
 * delle classi Tailwind (es. text-brand-orange quando attiva).
 */
const historyIconMaskStyle = {
  WebkitMaskImage: "url('/images/icons8-passato-100.png')",
  maskImage: "url('/images/icons8-passato-100.png')",
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  backgroundColor: 'currentColor',
};

interface BottomNavigationProps {
  /** Se true, la barra non viene renderizzata (utile nelle schermate fullscreen) */
  hidden?: boolean;
}

const BottomNavigation = ({ hidden = false }: BottomNavigationProps) => {
  // Uscita anticipata: non renderizza nulla se la barra è nascosta
  if (hidden) return null;

  const navigate = useNavigate();
  const location = useLocation();

  /** Verifica se il path corrente corrisponde esattamente al path della voce */
  const isActive = (path: string) => location.pathname === path;

  // Calcola lo stato attivo per ogni voce
  const isHomeActive = isActive('/');
  const isGymCardActive = isActive('/gym-card');
  // History è attiva sia sulla lista che sul dettaglio (startsWith per match parziale)
  const isHistoryActive = location.pathname.startsWith('/workout-history');
  const isSettingsActive = isActive('/settings');

  const handleNavigate = (path: string, currentlyActive: boolean) => {
    if (!currentlyActive) {
      void hapticLight();
    }
    navigate(path);
  };

  return (
    <div
      className="fixed left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none transition-all duration-300"
      style={{
        bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))',
      }}
    >
      {/* Container della Tab Bar stile Apple (Blur & Glassmorphism) */}
      <div className="flex items-center pointer-events-auto">

        {/* Main Pill Menu - Liquid Glassmorphism */}
        <div className="bg-[#1C1C1E]/85 backdrop-blur-[32px] saturate-[1.8] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.18)] rounded-full flex items-center p-1.5 space-x-1 relative overflow-hidden">

          {/* Subtle liquid glow layer inside the bar */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-40 pointer-events-none" />

          <NavItem
            icon={<Home size={22} strokeWidth={isHomeActive ? 2.5 : 2} />}
            label="Home"
            active={isHomeActive}
            onClick={() => handleNavigate('/', isHomeActive)}
          />
          <NavItem
            icon={<Folder size={22} strokeWidth={isGymCardActive ? 2.5 : 2} />}
            label="Schede"
            active={isGymCardActive}
            onClick={() => handleNavigate('/gym-card', isGymCardActive)}
          />
          <NavItem
            icon={<span className="block w-5.5 h-5.5" style={historyIconMaskStyle} />}
            label="Storico"
            active={isHistoryActive}
            onClick={() => handleNavigate('/workout-history', isHistoryActive)}
          />
          <NavItem
            icon={<Settings size={22} strokeWidth={isSettingsActive ? 2.5 : 2} />}
            label="Opzioni"
            active={isSettingsActive}
            onClick={() => handleNavigate('/settings', isSettingsActive)}
          />
        </div>
      </div>
    </div>
  );
};

/** Props del singolo elemento di navigazione */
interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * NavItem — Singolo pulsante della tab bar.
 */
const NavItem = ({ icon, label, active, onClick }: NavItemProps) => {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center w-[70px] sm:w-[80px] h-[58px] rounded-full transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] z-10 overflow-hidden cursor-pointer select-none active:scale-95 ${
        active
          ? 'bg-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
          : 'hover:bg-white/5'
      }`}
    >
      {/* Animated Glow Behind Icon — visibile solo quando attivo */}
      <div
        className={`absolute inset-0 bg-brand-orange/20 blur-lg transition-all duration-500 ease-out rounded-full pointer-events-none ${
          active ? 'opacity-100 scale-125' : 'opacity-0 scale-50'
        }`}
      />

      {/* Icona */}
      <div
        className={`relative z-10 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          active
            ? 'text-brand-orange -translate-y-2 scale-105 drop-shadow-[0_0_10px_rgba(255,94,0,0.6)]'
            : 'text-brand-grey/60 hover:text-white/90'
        }`}
      >
        {icon}
      </div>

      {/* Label: compare con slide-up quando la voce è attiva */}
      <span
        className={`absolute bottom-1.5 text-[9px] font-extrabold tracking-wide whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          active
            ? 'text-brand-orange opacity-100 translate-y-0 drop-shadow-[0_0_8px_rgba(255,94,0,0.4)]'
            : 'text-brand-grey/40 opacity-0 translate-y-3'
        }`}
      >
        {label}
      </span>

      {/* Liquid Dot Indicator — pill arancione nella parte inferiore */}
      <div
        className={`absolute bottom-0.5 w-4 h-0.5 rounded-full bg-brand-orange transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_0_8px_rgba(255,94,0,0.9)] ${
          active ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
        }`}
      />
    </button>
  );
};

export default BottomNavigation;
