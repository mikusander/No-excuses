/**
 * BottomNavigation.tsx — Barra di navigazione stile Instagram (Liquid Glass Floating Pill)
 * con animazioni native iOS avanzate:
 *
 * Funzionalità esclusive per l'app nativa iPhone (isIosNativeApp):
 *  1. Transizione fluida e scorrevole della bolla: la pillola attiva non scatta,
 *     ma scivola morbidamente lungo la traccia da una tab all'altra con fisica Apple spring.
 *  2. Long-press & Drag: tenendo premuto sulla bolla, la tab bar si ingrandisce;
 *     trascinando il dito, la bolla segue il movimento 1:1 e produce micro-click aptici (hapticSelection).
 *     Rilasciando il dito, la barra scatta sulla tab selezionata e naviga alla schermata.
 *  3. Scroll-responsive scale: scorrendo verso il basso la barra si rimpicciolisce (scale-down),
 *     mentre scorrendo verso l'alto torna alla dimensione piena.
 *
 * Props:
 *  - hidden (bool, default false): se true il componente non viene renderizzato,
 *    utile nelle schermate a schermo intero come il workout attivo.
 */
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../utils/haptics';
import { isIosNativeApp } from '../utils/platform';

/**
 * Icone Home custom identiche a quelle della barra Instagram:
 * - FilledHomeIcon: sagoma piena per lo stato attivo
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

/** Configurazione delle 4 tab dell'applicazione */
const TAB_CONFIG = [
  { path: '/', label: 'Home' },
  { path: '/gym-card', label: 'Schede' },
  { path: '/workout-history', label: 'Storico', matchPrefix: true },
  { path: '/settings', label: 'Opzioni' },
] as const;

interface BottomNavigationProps {
  /** Se true, la barra non viene renderizzata (utile nelle schermate fullscreen) */
  hidden?: boolean;
}

// Memoria globale dell'ultimo indice attivo tra i montaggi delle pagine
let globalLastActiveIndex = -1;

const BottomNavigation = ({ hidden = false }: BottomNavigationProps) => {
  if (hidden) return null;

  const navigate = useNavigate();
  const location = useLocation();

  // Rileva se stiamo girando sull'app nativa iPhone (o preview ?ios_glass=1)
  const isIosNative = useMemo(() => isIosNativeApp(), []);

  // Calcola l'indice della tab attiva corrente (0: Home, 1: Schede, 2: Storico, 3: Opzioni)
  const activeIndex = useMemo(() => {
    if (location.pathname === '/') return 0;
    if (location.pathname === '/gym-card') return 1;
    if (location.pathname.startsWith('/workout-history')) return 2;
    if (location.pathname === '/settings') return 3;
    return -1;
  }, [location.pathname]);

  // Posizione visiva della bolla per l'animazione fluida tra schermate
  const [visualIndex, setVisualIndex] = useState(() => {
    if (isIosNative && globalLastActiveIndex >= 0 && globalLastActiveIndex !== activeIndex) {
      return globalLastActiveIndex;
    }
    return activeIndex;
  });

  useEffect(() => {
    if (activeIndex < 0) return;

    if (isIosNative) {
      if (visualIndex !== activeIndex) {
        const raf = requestAnimationFrame(() => {
          setVisualIndex(activeIndex);
        });
        return () => cancelAnimationFrame(raf);
      }
    } else {
      setVisualIndex(activeIndex);
    }

    // Salva l'indice attuale come precedente quando si lascia la pagina
    return () => {
      if (activeIndex >= 0) {
        globalLastActiveIndex = activeIndex;
      }
    };
  }, [activeIndex, isIosNative, visualIndex]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SCROLL-DIRECTION RESPONSIVE SCALE (Solo App Nativa iOS)
  // ─────────────────────────────────────────────────────────────────────────────
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    if (!isIosNative) return;

    const handleScroll = () => {
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;
      const diff = currentY - lastScrollYRef.current;

      // Ignora micro-movimenti sotto 10px per evitare jitter
      if (Math.abs(diff) < 10) return;

      if (currentY > 60 && diff > 0) {
        // Scorrimento verso il basso -> tab bar rimpicciolita
        setIsScrollingDown(true);
      } else if (diff < 0 || currentY < 30) {
        // Scorrimento verso l'alto o inizio pagina -> tab bar a grandezza piena
        setIsScrollingDown(false);
      }

      lastScrollYRef.current = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isIosNative]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. GESTURE: LONG-PRESS & DRAG DELLA BOLLA (Solo App Nativa iOS)
  // ─────────────────────────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressActiveRef = useRef(false);
  const dragHoverIndexRef = useRef<number | null>(null);
  dragHoverIndexRef.current = dragHoverIndex;

  const updateDragPosition = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const innerWidth = rect.width - 12; // 6px padding a sinistra e destra (p-1.5)
    const slotWidth = innerWidth / 4;

    // Posiziona il centro della bolla esattamente sotto il dito
    const relativeX = clientX - (rect.left + 6) - slotWidth / 2;
    const clampedX = Math.max(0, Math.min(innerWidth - slotWidth, relativeX));
    setDragX(clampedX);

    // Calcola l'indice della tab più vicina
    const nearestIndex = Math.max(0, Math.min(3, Math.round(clampedX / slotWidth)));
    if (nearestIndex !== dragHoverIndexRef.current) {
      dragHoverIndexRef.current = nearestIndex;
      setDragHoverIndex(nearestIndex);
      void hapticSelection();
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isIosNative) return;

    // Cancella eventuali timer pendenti
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const innerWidth = rect.width - 12;
    const slotWidth = innerWidth / 4;
    const touchX = e.clientX - (rect.left + 6);
    const touchedSlot = Math.floor(touchX / slotWidth);

    // Il long-press si attiva solo premendo sulla bolla della pagina corrente
    if (touchedSlot !== activeIndex) {
      return;
    }

    const clientX = e.clientX;
    const targetElement = e.currentTarget;
    const pointerId = e.pointerId;
    isLongPressActiveRef.current = false;

    // Avvia il timer di long-press (220ms)
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      setIsDragging(true);

      // Cattura il puntatore per tracciamento continuo
      try {
        targetElement.setPointerCapture(pointerId);
      } catch {
        // Fallback silenzioso
      }

      void hapticMedium();
      updateDragPosition(clientX);
    }, 220);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isIosNative) return;

    if (isLongPressActiveRef.current) {
      updateDragPosition(e.clientX);
    } else if (longPressTimerRef.current) {
      // Se il dito si sposta prima del timeout, l'utente intendeva scorrere
      if (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Fallback silenzioso
    }

    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      setIsDragging(false);
      setDragX(null);

      const targetIdx = dragHoverIndexRef.current;
      setDragHoverIndex(null);

      if (targetIdx != null && targetIdx >= 0 && targetIdx < TAB_CONFIG.length) {
        void hapticSuccess();
        globalLastActiveIndex = targetIdx;
        setVisualIndex(targetIdx);
        navigate(TAB_CONFIG[targetIdx].path);
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Fallback silenzioso
    }

    isLongPressActiveRef.current = false;
    setIsDragging(false);
    setDragX(null);
    setDragHoverIndex(null);
  };

  const handleNavigate = (path: string, currentlyActive: boolean, targetIdx: number) => {
    if (isLongPressActiveRef.current) return;
    if (!currentlyActive) {
      void hapticLight();
    }
    if (isIosNative) {
      setVisualIndex(targetIdx);
      globalLastActiveIndex = targetIdx;
    }
    navigate(path);
  };

  // Indice visivo effettivo (mentre trascini mostra l'icona attiva sotto il dito)
  const effectiveActiveIndex = isDragging && dragHoverIndex != null ? dragHoverIndex : visualIndex;

  // Stile di scala dinamico
  const containerScaleClass = isIosNative
    ? isDragging
      ? 'scale-[1.08] shadow-2xl shadow-black/90'
      : isScrollingDown
        ? 'scale-[0.86] opacity-80 translate-y-2'
        : 'scale-100 opacity-100 translate-y-0'
    : 'scale-100 opacity-100';

  return (
    <nav
      aria-label="Navigazione principale"
      className="fixed left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none select-none transition-all duration-300"
      style={{
        bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.6rem))',
      }}
    >
      <div
        className={`w-full max-w-[360px] pointer-events-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${containerScaleClass}`}
      >
        {/* Instagram Liquid Glass Floating Capsule */}
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="relative w-full h-[58px] rounded-full p-1.5 flex items-center justify-between touch-none"
          style={{
            backgroundColor: 'rgba(20, 20, 24, 0.82)',
            backdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
            WebkitBackdropFilter: 'blur(36px) saturate(190%) contrast(105%)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow: isDragging
              ? '0 24px 50px -4px rgba(0, 0, 0, 0.9), 0 8px 18px -2px rgba(0, 0, 0, 0.7), inset 0 1px 1px 0 rgba(255, 255, 255, 0.3)'
              : '0 18px 40px -4px rgba(0, 0, 0, 0.75), 0 6px 14px -2px rgba(0, 0, 0, 0.5), inset 0 1px 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.4)',
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

          {/* ─────────────────────────────────────────────────────────────────── */}
          {/* 3. SLIDING BUBBLE INDICATOR: Scivola fluidamente tra le tab       */}
          {/* ─────────────────────────────────────────────────────────────────── */}
          {effectiveActiveIndex >= 0 && (
            <div
              className={`absolute top-1.5 bottom-1.5 left-1.5 rounded-full pointer-events-none ${
                isDragging
                  ? ''
                  : isIosNative
                    ? 'transition-transform duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)]'
                    : 'transition-none'
              }`}
              style={{
                width: 'calc((100% - 12px) / 4)',
                transform:
                  isDragging && dragX != null
                    ? `translateX(${dragX}px)`
                    : `translateX(calc(${effectiveActiveIndex} * 100%))`,
                backgroundColor: 'rgba(255, 255, 255, 0.20)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                boxShadow:
                  'inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35), 0 3px 10px rgba(0, 0, 0, 0.3)',
              }}
            />
          )}

          {/* ─────────────────────────────────────────────────────────────────── */}
          {/* 4 ICON BUTTONS                                                     */}
          {/* ─────────────────────────────────────────────────────────────────── */}

          {/* 1. Home */}
          <InstagramTabButton
            active={effectiveActiveIndex === 0}
            icon={effectiveActiveIndex === 0 ? <FilledHomeIcon /> : <OutlineHomeIcon />}
            ariaLabel="Home"
            onClick={() => handleNavigate('/', effectiveActiveIndex === 0, 0)}
          />

          {/* 2. Schede */}
          <InstagramTabButton
            active={effectiveActiveIndex === 1}
            icon={effectiveActiveIndex === 1 ? <FilledFolderIcon /> : <OutlineFolderIcon />}
            ariaLabel="Schede"
            onClick={() => handleNavigate('/gym-card', effectiveActiveIndex === 1, 1)}
          />

          {/* 3. Storico */}
          <InstagramTabButton
            active={effectiveActiveIndex === 2}
            icon={
              <span
                className={`block w-[23px] h-[23px] transition-colors ${
                  effectiveActiveIndex === 2 ? 'bg-white' : 'bg-white/80 group-hover:text-white'
                }`}
                style={historyIconMaskStyle}
              />
            }
            ariaLabel="Storico"
            onClick={() => handleNavigate('/workout-history', effectiveActiveIndex === 2, 2)}
          />

          {/* 4. Opzioni */}
          <InstagramTabButton
            active={effectiveActiveIndex === 3}
            icon={
              <Settings
                size={23}
                strokeWidth={effectiveActiveIndex === 3 ? 2.5 : 2}
                className={effectiveActiveIndex === 3 ? 'text-white fill-white/20' : 'text-white/80 group-hover:text-white'}
              />
            }
            ariaLabel="Opzioni"
            onClick={() => handleNavigate('/settings', effectiveActiveIndex === 3, 3)}
          />
        </div>
      </div>
    </nav>
  );
};

interface InstagramTabButtonProps {
  icon: React.ReactNode;
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
}

/**
 * InstagramTabButton — Singolo pulsante della tab bar.
 * Le icone si trovano sopra la bolla scorrevole e reagiscono al tocco o hover.
 */
const InstagramTabButton = ({ icon, active, ariaLabel, onClick }: InstagramTabButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`relative flex-1 h-full flex items-center justify-center rounded-full cursor-pointer transition-all duration-150 active:scale-95 group z-10 ${
        !active ? 'hover:bg-white/[0.08]' : ''
      }`}
    >
      {/* Icona */}
      <div
        className={`flex items-center justify-center transition-all duration-200 ${
          active
            ? 'text-white scale-105 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]'
            : 'text-white/80 group-hover:text-white'
        }`}
      >
        {icon}
      </div>
    </button>
  );
};

export default BottomNavigation;
