/**
 * BottomNavigation.tsx — Barra di navigazione stile Instagram (Liquid Glass Floating Pill).
 *
 * Ispirata al design Liquid Glass di Instagram:
 *  - Capsula fluttuante a pillola (rounded-full) in vetro fumé traslucido (smoked glass)
 *  - Backdrop blur e saturazione elevata con riflesso speculare sul bordo superiore
 *  - Zero label testuali (solo icone essenziali, pulite e moderne)
 *  - Bolla/pillola attiva satinata grigio-chiaro (frosted glass bubble) che avvolge l'icona selezionata
 *  - Icone piene (solid white) per la tab attiva e outline per le inattive
 *  - Feedback aptico nativo al tocco (hapticLight)
 *
 * Props:
 *  - hidden (bool, default false): se true il componente non viene renderizzato,
 *    utile nelle schermate a schermo intero come il workout attivo.
 */
import React from 'react';
import { Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hapticLight } from '../utils/haptics';

/**
 * Icone Home custom identiche a quelle della barra Instagram:
 * - FilledHomeIcon: sagoma piena per lo stato attivo (esattamente come nello screenshot)
 * - OutlineHomeIcon: contorno nitido per lo stato inattivo
 */
const FilledHomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2.4L2.5 10.4V20C2.5 20.8284 3.17157 21.5 4 21.5H9.5C10.0523 21.5 10.5 21.0523 10.5 20.5V15C10.5 14.1716 11.1716 13.5 12 13.5C12.8284 13.5 13.5 14.1716 13.5 15V20.5C13.5 21.0523 13.9477 21.5 14.5 21.5H20C20.8284 21.5 21.5 20.8284 21.5 20V10.4L12 2.4Z" />
  </svg>
);

const OutlineHomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 2.5L21 9.5V20C21 20.8284 20.3284 21.5 19.5 21.5H15C14.1716 21.5 13.5 20.8284 13.5 20V15C13.5 14.1716 12.8284 13.5 12 13.5C11.1716 13.5 10.5 14.1716 10.5 15V20C10.5 20.8284 9.82843 21.5 9 21.5H4.5C3.67157 21.5 3 20.8284 3 20V9.5Z" />
  </svg>
);

/**
 * Icone Schede (Folder/Workouts) in versione piena e contorno
 */
const FilledFolderIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6H12L10 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6Z" />
  </svg>
);

const OutlineFolderIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6H12L10 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6Z" />
  </svg>
);

/**
 * Stile CSS-in-JS per l'icona "History" con maschera CSS
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
      className="fixed left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none select-none transition-all duration-300"
      style={{
        bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.6rem))',
      }}
    >
      <div className="w-full max-w-[360px] pointer-events-auto">
        {/* Instagram Liquid Glass Floating Capsule */}
        <div
          className="relative w-full h-[58px] rounded-full p-1.5 flex items-center justify-between"
          style={{
            backgroundColor: 'rgba(20, 20, 24, 0.82)',
            backdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
            WebkitBackdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow:
              '0 18px 40px -4px rgba(0, 0, 0, 0.75), 0 6px 14px -2px rgba(0, 0, 0, 0.5), inset 0 1px 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Sottile bagliore speculare sul bordo superiore (top rim sheen) */}
          <div
            className="absolute top-0 inset-x-8 h-[1px] pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 50%, transparent 100%)',
            }}
          />

          {/* 1. Home */}
          <InstagramTabItem
            active={isHomeActive}
            icon={isHomeActive ? <FilledHomeIcon /> : <OutlineHomeIcon />}
            ariaLabel="Home"
            onClick={() => handleNavigate('/', isHomeActive)}
          />

          {/* 2. Schede */}
          <InstagramTabItem
            active={isGymCardActive}
            icon={isGymCardActive ? <FilledFolderIcon /> : <OutlineFolderIcon />}
            ariaLabel="Schede"
            onClick={() => handleNavigate('/gym-card', isGymCardActive)}
          />

          {/* 3. Storico */}
          <InstagramTabItem
            active={isHistoryActive}
            icon={
              <span
                className={`block w-[23px] h-[23px] transition-colors ${
                  isHistoryActive ? 'bg-white' : 'bg-white/85'
                }`}
                style={historyIconMaskStyle}
              />
            }
            ariaLabel="Storico"
            onClick={() => handleNavigate('/workout-history', isHistoryActive)}
          />

          {/* 4. Opzioni */}
          <InstagramTabItem
            active={isSettingsActive}
            icon={
              <Settings
                size={23}
                strokeWidth={isSettingsActive ? 2.5 : 2}
                className={isSettingsActive ? 'text-white fill-white/20' : 'text-white/85'}
              />
            }
            ariaLabel="Opzioni"
            onClick={() => handleNavigate('/settings', isSettingsActive)}
          />
        </div>
      </div>
    </nav>
  );
};

interface InstagramTabItemProps {
  icon: React.ReactNode;
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
}

/**
 * InstagramTabItem — Singolo tab item stile Instagram:
 * - Se attivo: avvolto da una bolla a pillola satinata grigio chiaro (frosted bubble)
 * - Se inattivo: icona bianca pulita a contorno su sfondo trasparente
 */
const InstagramTabItem = ({ icon, active, ariaLabel, onClick }: InstagramTabItemProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`relative flex-1 h-full flex items-center justify-center rounded-full cursor-pointer transition-all duration-150 active:scale-95 group ${
        !active ? 'hover:bg-white/[0.08]' : ''
      }`}
    >
      {/* Bolla a pillola frosted per la tab attiva (stile esatto Instagram) */}
      {active && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none transition-all duration-300"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.20)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            boxShadow:
              'inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35), 0 3px 10px rgba(0, 0, 0, 0.3)',
          }}
        />
      )}

      {/* Icona */}
      <div
        className={`relative z-10 flex items-center justify-center transition-all duration-200 ${
          active ? 'text-white scale-105 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]' : 'text-white/85 group-hover:text-white'
        }`}
      >
        {icon}
      </div>
    </button>
  );
};

export default BottomNavigation;
