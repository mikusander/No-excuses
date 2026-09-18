/**
 * AppHeader.tsx — Intestazione superiore unificata stile Apple (iOS Human Interface Guidelines).
 *
 * Caratteristiche:
 *  - Safe Area Top nativa: il background satinato/vetro si estende dietro la status bar / Dynamic Island,
 *    mentre il contenuto (titolo, pulsanti) rispetta la safe area.
 *  - Back button touch con feedback aptico automatico.
 *  - Supporto per azioni a destra (pulsanti, icone, badge).
 *  - Supporto per sottotitolo o badge integrato.
 */
import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { hapticLight } from '../utils/haptics';

export interface AppHeaderProps {
  /** Titolo principale della schermata */
  title: React.ReactNode;
  /** Sottotitolo descrittivo opzionale */
  subtitle?: string;
  /** Badge opzionale accanto al titolo (es. contatore elementi) */
  badge?: React.ReactNode;
  /** Se fornito, mostra il pulsante Indietro stile iOS */
  onBack?: () => void;
  /** Testo opzionale per il tasto indietro (default solo icona chevron) */
  backLabel?: string;
  /** Elementi/pulsanti azione posizionati a destra */
  rightActions?: React.ReactNode;
  /** Classe CSS aggiuntiva per il container */
  className?: string;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  subtitle,
  badge,
  onBack,
  backLabel,
  rightActions,
  className = '',
}) => {
  const handleBackClick = () => {
    if (onBack) {
      void hapticLight();
      onBack();
    }
  };

  return (
    <header
      className={`sticky top-0 z-30 w-full bg-black/75 backdrop-blur-2xl border-b border-white/5 transition-all duration-200 ${className}`}
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.35rem)',
      }}
    >
      <div className="max-w-3xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between gap-3">
        {/* Sinistra: Tasto Indietro (se presente) oppure placeholder bilanciato */}
        <div className="flex items-center min-w-[44px]">
          {onBack ? (
            <button
              type="button"
              onClick={handleBackClick}
              className="flex items-center gap-1 -ml-2 px-2.5 py-1.5 rounded-full text-brand-orange hover:text-brand-lightOrange active:bg-white/5 transition-colors cursor-pointer select-none group"
              title={backLabel || 'Torna indietro'}
            >
              <ChevronLeft size={24} className="stroke-[2.5] transition-transform group-active:-translate-x-0.5" />
              {backLabel && (
                <span className="text-sm font-semibold tracking-tight">{backLabel}</span>
              )}
            </button>
          ) : (
            <div className="w-1" />
          )}
        </div>

        {/* Centro: Titolo & Sottotitolo */}
        <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0 px-2">
          <div className="flex items-center gap-2 max-w-full">
            {typeof title === 'string' ? (
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                {title}
              </h1>
            ) : (
              title
            )}
            {badge && <div className="shrink-0">{badge}</div>}
          </div>

          {subtitle && (
            <p className="text-[11px] font-medium text-brand-grey/60 tracking-normal truncate max-w-full">
              {subtitle}
            </p>
          )}
        </div>

        {/* Destra: Azioni opzionali o placeholder bilanciato */}
        <div className="flex items-center justify-end min-w-[44px] gap-2">
          {rightActions || <div className="w-1" />}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
