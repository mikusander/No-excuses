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

  return (
    <div className="fixed bottom-6 left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none">

      {/* Container della Tab Bar stile Apple (Blur & Glassmorphism) */}
      <div className="flex items-center space-x-3 pointer-events-auto">

        {/* Main Pill Menu - Liquid Glassmorphism */}
        <div className="bg-[#1C1C1E]/60 backdrop-blur-[32px] saturate-[1.5] border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] rounded-full flex items-center px-2 py-1.5 space-x-1 relative overflow-hidden">

          {/* Subtle liquid glow layer inside the bar */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-50 pointer-events-none" />

          <NavItem
            icon={<Home size={24} strokeWidth={isHomeActive ? 2.5 : 2} />}
            label="Home"
            active={isHomeActive}
            onClick={() => navigate('/')}
          />
          <NavItem
            icon={<Folder size={24} strokeWidth={isGymCardActive ? 2.5 : 2} />}
            label="Gym Card"
            active={isGymCardActive}
            onClick={() => navigate('/gym-card')}
          />
          <NavItem
            icon={<span className="block w-6 h-6" style={historyIconMaskStyle} />}
            label="History"
            active={isHistoryActive}
            onClick={() => navigate('/workout-history')}
          />
          <NavItem
            icon={<Settings size={24} strokeWidth={isSettingsActive ? 2.5 : 2} />}
            label="Settings"
            active={isSettingsActive}
            onClick={() => navigate('/settings')}
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
 *
 * Quando è attivo:
 *  - L'icona sale di ~10px con effetto spring (cubic-bezier)
 *  - Appare un glow arancione dietro l'icona
 *  - Compare la label in basso
 *  - Appare un indicatore pill arancione nella parte inferiore
 *
 * Le animazioni sono tutte CSS transition con durata 500ms per un feel "liquido".
 */
const NavItem = ({ icon, label, active, onClick }: NavItemProps) => {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center w-[72px] sm:w-[84px] h-[64px] rounded-3xl transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] z-10 overflow-hidden ${active ? 'bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]' : 'hover:bg-white/5'}`}
    >
      {/* Animated Glow Behind Icon — visibile solo quando attivo */}
      <div
        className={`absolute inset-0 bg-brand-orange/20 blur-xl transition-all duration-700 ease-out rounded-full 
        ${active ? 'opacity-100 scale-150' : 'opacity-0 scale-50'}`}
      />

      {/* Icona: sale verso l'alto e diventa arancione quando attiva */}
      <div className={`relative z-10 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'text-brand-orange -translate-y-2.5 scale-110 drop-shadow-[0_0_12px_rgba(255,107,0,0.6)]' : 'text-brand-grey/60 hover:text-white/90'}`}>
        {icon}
      </div>

      {/* Label: compare con slide-up quando la voce è attiva */}
      <span
        className={`absolute bottom-2 text-[9px] font-black uppercase tracking-wide whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] 
        ${active ? 'text-brand-orange opacity-100 translate-y-0 drop-shadow-[0_0_8px_rgba(255,107,0,0.4)]' : 'text-brand-grey/40 opacity-0 translate-y-4'}`}
      >
        {label}
      </span>

      {/* Liquid Dot Indicator — pill arancione nella parte inferiore, slide-up quando attivo */}
      <div
        className={`absolute bottom-0 w-6 h-1 rounded-t-full bg-brand-orange transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_0_10px_rgba(255,107,0,1)] 
        ${active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      />
    </button>
  );
};

export default BottomNavigation;
