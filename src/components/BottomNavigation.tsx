/**
 * BottomNavigation.tsx — Barra di navigazione inferiore.
 *
 * Supporta due modalità visive coerenti con la piattaforma:
 *  1. Native iOS Liquid Glass: Attiva SOLO sull'applicazione nativa per iPhone (Capacitor iOS),
 *     con ottica Liquid Glass ultra-raffinata, rifrazione frosted glass, specular highlight rim,
 *     lente a goccia per la tab attiva ed ergonomia adatta al Safe Area / Home Indicator di iOS.
 *  2. Standard Web/PWA: Design glassmorphism standard per browser desktop e PWA.
 *
 * Props:
 *  - hidden (bool, default false): se true il componente non viene renderizzato,
 *    utile nelle schermate a schermo intero come il workout attivo.
 */
import { useMemo } from 'react';
import { Home, Folder, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hapticLight } from '../utils/haptics';
import { isIosNativeApp } from '../utils/platform';

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

  // Rileva se stiamo girando sull'app nativa iPhone (o preview ?ios_glass=1)
  const isIosNative = useMemo(() => isIosNativeApp(), []);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MODALITÀ NATIVA IPHONE: LIQUID GLASS TAB BAR
  // ─────────────────────────────────────────────────────────────────────────────
  if (isIosNative) {
    return (
      <nav
        aria-label="Navigazione principale iOS"
        className="fixed left-0 w-full flex justify-center items-center px-3.5 z-50 pointer-events-none transition-all duration-300"
        style={{
          bottom: 'max(0.85rem, calc(env(safe-area-inset-bottom, 0px) + 0.35rem))',
        }}
      >
        <div className="w-full max-w-[380px] pointer-events-auto">
          {/* iOS Liquid Glass Capsule */}
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
            <IosGlassNavItem
              icon={<Home size={21} strokeWidth={isHomeActive ? 2.5 : 1.9} />}
              label="Home"
              active={isHomeActive}
              onClick={() => handleNavigate('/', isHomeActive)}
            />
            <IosGlassNavItem
              icon={<Folder size={21} strokeWidth={isGymCardActive ? 2.5 : 1.9} />}
              label="Schede"
              active={isGymCardActive}
              onClick={() => handleNavigate('/gym-card', isGymCardActive)}
            />
            <IosGlassNavItem
              icon={<span className="block w-5 h-5" style={historyIconMaskStyle} />}
              label="Storico"
              active={isHistoryActive}
              onClick={() => handleNavigate('/workout-history', isHistoryActive)}
            />
            <IosGlassNavItem
              icon={<Settings size={21} strokeWidth={isSettingsActive ? 2.5 : 1.9} />}
              label="Opzioni"
              active={isSettingsActive}
              onClick={() => handleNavigate('/settings', isSettingsActive)}
            />
          </div>
        </div>
      </nav>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. MODALITÀ STANDARD WEB / PWA
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <nav
      aria-label="Navigazione principale"
      className="fixed left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none transition-all duration-300"
      style={{
        bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))',
      }}
    >
      {/* Container della Tab Bar stile Apple (Blur & Glassmorphism standard) */}
      <div className="flex items-center pointer-events-auto">
        <div className="bg-[#1C1C1E]/85 backdrop-blur-[32px] saturate-[1.8] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.18)] rounded-full flex items-center p-1.5 space-x-1 relative overflow-hidden">
          {/* Subtle liquid glow layer inside the bar */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-40 pointer-events-none" />

          <StandardNavItem
            icon={<Home size={22} strokeWidth={isHomeActive ? 2.5 : 2} />}
            label="Home"
            active={isHomeActive}
            onClick={() => handleNavigate('/', isHomeActive)}
          />
          <StandardNavItem
            icon={<Folder size={22} strokeWidth={isGymCardActive ? 2.5 : 2} />}
            label="Schede"
            active={isGymCardActive}
            onClick={() => handleNavigate('/gym-card', isGymCardActive)}
          />
          <StandardNavItem
            icon={<span className="block w-5.5 h-5.5" style={historyIconMaskStyle} />}
            label="Storico"
            active={isHistoryActive}
            onClick={() => handleNavigate('/workout-history', isHistoryActive)}
          />
          <StandardNavItem
            icon={<Settings size={22} strokeWidth={isSettingsActive ? 2.5 : 2} />}
            label="Opzioni"
            active={isSettingsActive}
            onClick={() => handleNavigate('/settings', isSettingsActive)}
          />
        </div>
      </div>
    </nav>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTI PULSANTI (ITEM)
// ─────────────────────────────────────────────────────────────────────────────

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * IosGlassNavItem — Tab item per l'applicazione nativa iPhone con ottica Liquid Glass.
 * Dotato di lente a goccia frosted, specular highlights, glow radiale arancione e micro-dot liquid.
 */
const IosGlassNavItem = ({ icon, label, active, onClick }: NavItemProps) => {
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

      {/* Label iOS con tipografia SF Pro compatta */}
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

/**
 * StandardNavItem — Tab item per la versione Web / PWA standard.
 */
const StandardNavItem = ({ icon, label, active, onClick }: NavItemProps) => {
  return (
    <button
      type="button"
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
