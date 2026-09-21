/**
 * BottomNavigation.tsx — Barra di navigazione inferiore stile Apple Liquid Glass.
 *
 * Utilizza un'ottica Liquid Glass ultra-raffinata condivisa sia su Web/PWA che sull'app nativa iPhone:
 *  - Rifrazione frosted glass con backdrop blur elevato e saturazione avanzata
 *  - Hairline speculare superiore (specular rim light) e rifrazione convessa ad arco
 *  - Lente interna a goccia (liquid droplet lens) per la voce attiva con bagliore arancione atletico
 *  - Indicatore micro-dot liquid e tipografia compatta SF Pro
 *  - Piena compatibilità con le Safe Area di iOS e i margini desktop
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
      aria-label="Navigazione principale"
      className="fixed left-0 w-full flex justify-center items-center px-3.5 z-50 pointer-events-none transition-all duration-300"
      style={{
        bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.45rem))',
      }}
    >
      <div className="w-full max-w-[385px] pointer-events-auto">
        {/* Apple Liquid Glass Capsule */}
        <div
          className="relative w-full rounded-[28px] p-1.5 flex items-center justify-between overflow-hidden"
          style={{
            backgroundColor: 'rgba(20, 20, 24, 0.68)',
            backdropFilter: 'blur(44px) saturate(210%) contrast(104%)',
            WebkitBackdropFilter: 'blur(44px) saturate(210%) contrast(104%)',
            borderTop: '1px solid rgba(255, 255, 255, 0.32)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
            borderRight: '1px solid rgba(255, 255, 255, 0.12)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow:
              '0 20px 48px -4px rgba(0, 0, 0, 0.8), 0 8px 18px -2px rgba(0, 0, 0, 0.55), inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.5), inset 0 0 16px 0 rgba(255, 255, 255, 0.03)',
          }}
        >
          {/* Convex Liquid Glass Top Specular Sheen */}
          <div
            className="absolute top-0 inset-x-0 h-1/2 pointer-events-none rounded-t-[28px]"
            style={{
              background:
                'linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.03) 65%, transparent 100%)',
            }}
          />

          {/* Tab items */}
          <LiquidGlassNavItem
            icon={<Home size={21} strokeWidth={isHomeActive ? 2.5 : 1.9} />}
            label="Home"
            active={isHomeActive}
            onClick={() => handleNavigate('/', isHomeActive)}
          />
          <LiquidGlassNavItem
            icon={<Folder size={21} strokeWidth={isGymCardActive ? 2.5 : 1.9} />}
            label="Schede"
            active={isGymCardActive}
            onClick={() => handleNavigate('/gym-card', isGymCardActive)}
          />
          <LiquidGlassNavItem
            icon={<span className="block w-5 h-5" style={historyIconMaskStyle} />}
            label="Storico"
            active={isHistoryActive}
            onClick={() => handleNavigate('/workout-history', isHistoryActive)}
          />
          <LiquidGlassNavItem
            icon={<Settings size={21} strokeWidth={isSettingsActive ? 2.5 : 1.9} />}
            label="Opzioni"
            active={isSettingsActive}
            onClick={() => handleNavigate('/settings', isSettingsActive)}
          />
        </div>
      </div>
    </nav>
  );
};

interface LiquidGlassNavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * LiquidGlassNavItem — Tab item con ottica Liquid Glass.
 * Include lente a goccia frosted, specular highlights, glow radiale arancione e micro-dot liquid.
 */
const LiquidGlassNavItem = ({ icon, label, active, onClick }: LiquidGlassNavItemProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex-1 flex flex-col items-center justify-center h-[56px] rounded-[22px] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] select-none cursor-pointer active:scale-95 group"
    >
      {/* Liquid Droplet Lens Highlight per la voce attiva */}
      {active && (
        <div
          className="absolute inset-0 rounded-[22px] pointer-events-none transition-all duration-300"
          style={{
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.05) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            boxShadow:
              'inset 0 1px 1px 0 rgba(255, 255, 255, 0.45), 0 3px 12px 0 rgba(0, 0, 0, 0.35)',
          }}
        >
          {/* Sfumatura radiale arancione atletico morbido dietro la tab attiva */}
          <div
            className="absolute inset-0 rounded-[22px]"
            style={{
              background:
                'radial-gradient(circle at 50% 38%, rgba(255, 94, 0, 0.28) 0%, rgba(255, 94, 0, 0.06) 55%, transparent 80%)',
            }}
          />
        </div>
      )}

      {/* Icona tab con bloom speculare per l'attivo */}
      <div
        className={`relative z-10 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          active
            ? 'text-brand-orange scale-105 drop-shadow-[0_2px_8px_rgba(255,94,0,0.65)]'
            : 'text-[#98989E] group-hover:text-white/80'
        }`}
      >
        {icon}
      </div>

      {/* Label con tipografia SF Pro compatta */}
      <span
        className={`relative z-10 text-[10.5px] tracking-tight transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] mt-0.5 ${
          active
            ? 'text-brand-orange font-bold drop-shadow-[0_1px_4px_rgba(255,94,0,0.45)]'
            : 'text-[#8E8E93] font-medium group-hover:text-white/70'
        }`}
      >
        {label}
      </span>

      {/* Indicatore Liquid Dot inferiore */}
      <div
        className={`absolute bottom-1 w-2.5 h-[2.5px] rounded-full bg-brand-orange transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_0_8px_rgba(255,94,0,0.9)] ${
          active ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
        }`}
      />
    </button>
  );
};

export default BottomNavigation;
