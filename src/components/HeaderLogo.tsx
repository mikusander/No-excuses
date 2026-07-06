/**
 * HeaderLogo.tsx — Componente header con il logo dell'applicazione.
 *
 * Mostra il logo "No Excuses" come immagine base64 inline (importata da assets/logoBase64).
 * L'uso del base64 evita un round-trip HTTP e garantisce che il logo sia disponibile
 * immediatamente senza dipendere dalla cache del browser o dal CDN.
 *
 * Il logo è centrato orizzontalmente con padding verticale generoso per creare
 * lo spazio di "respiro" tipico del design mobile-first.
 */
import React from 'react';
import { logoBase64 } from '../assets/logoBase64';

const HeaderLogo: React.FC = () => {
  return (
    <header className="w-full flex justify-center items-center py-6 mt-4">
      <div className="relative">
        {/* We use the logo image directly since it matches the mockup perfectly */}
        <img 
          src={logoBase64} 
          alt="No Excuses Logo" 
          className="h-20 md:h-24 rounded-2xl border-2 border-white object-contain"
        />
      </div>
    </header>
  );
};

export default HeaderLogo;
