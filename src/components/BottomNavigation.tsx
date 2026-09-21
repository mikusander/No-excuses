/**
 * BottomNavigation.tsx — Standard Native iOS Tab Bar (Translucent Frosted/Liquid Glass).
 *
 * Implementa fedelmente lo standard ufficiale Apple UITabBar delle applicazioni iOS:
 *  - Ancorata al fondo dello schermo (full-width inset-x-0 bottom-0)
 *  - Materiale di sistema Apple Frosted Glass con backdrop blur e saturazione ottica
 *  - Contenuti della pagina che scorrono e si sfocano in trasparenza dietro la barra
 *  - Hairline separator superiore da 0.5px sottile e nitido stile iOS Retina
 *  - Altezza nativa Apple da 49pt con padding per l'Home Indicator (Safe Area)
 *  - Icona e label centrate con tipografia SF Pro e feedback aptico nativo al tocco
 *  - Tint arancione atletico (#FF5E00) per la voce attiva e grigio di sistema (#8E8E93) per le inattive
 *
 * Props:
 *  - hidden (bool, default false): se true il componente non viene renderizzato,
 *    utile nelle schermate a schermo intero come il workout attivo.
 */
import { Home, Folder, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hapticLight } from '../utils/haptics';

/**
 * Stile CSS-in-JS per l'icona "History" che usa una maschera CSS con immagine custom.
 * Il colore viene ereditato da `currentColor` così l'icona risponde ai cambi di colore
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
    <nav
      aria-label="Navigazione principale iOS"
      className="fixed inset-x-0 bottom-0 z-50 w-full select-none"
      style={{
        backgroundColor: 'rgba(18, 18, 20, 0.82)',
        backdropFilter: 'blur(30px) saturate(190%)',
        WebkitBackdropFilter: 'blur(30px) saturate(190%)',
        borderTop: '0.5px solid rgba(255, 255, 255, 0.14)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around h-[49px] px-2">
        <IosTabItem
          icon={<Home size={23} strokeWidth={isHomeActive ? 2.3 : 1.8} />}
          label="Home"
          active={isHomeActive}
          onClick={() => handleNavigate('/', isHomeActive)}
        />
        <IosTabItem
          icon={<Folder size={23} strokeWidth={isGymCardActive ? 2.3 : 1.8} />}
          label="Schede"
          active={isGymCardActive}
          onClick={() => handleNavigate('/gym-card', isGymCardActive)}
        />
        <IosTabItem
          icon={<span className="block w-[22px] h-[22px]" style={historyIconMaskStyle} />}
          label="Storico"
          active={isHistoryActive}
          onClick={() => handleNavigate('/workout-history', isHistoryActive)}
        />
        <IosTabItem
          icon={<Settings size={23} strokeWidth={isSettingsActive ? 2.3 : 1.8} />}
          label="Opzioni"
          active={isSettingsActive}
          onClick={() => handleNavigate('/settings', isSettingsActive)}
        />
      </div>
    </nav>
  );
};

interface IosTabItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * IosTabItem — Singola tab in autentico stile Apple UITabBar.
 * Icona centrata con label sottostante, feedback nativo di pressione e sfumatura di colore.
 */
const IosTabItem = ({ icon, label, active, onClick }: IosTabItemProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-opacity duration-150 active:opacity-50 ${
        active ? 'text-brand-orange' : 'text-[#8E8E93] hover:text-[#AEAEB2]'
      }`}
    >
      {/* Icona */}
      <div className="flex items-center justify-center">
        {icon}
      </div>

      {/* Label compatta con tipografia SF Pro */}
      <span
        className={`text-[10px] tracking-tight leading-none ${
          active ? 'font-semibold' : 'font-medium'
        }`}
      >
        {label}
      </span>
    </button>
  );
};

export default BottomNavigation;
