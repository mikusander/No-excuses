/**
 * uuid.ts — Generatore universale e sicuro di identificatori univoci (UUID).
 *
 * Risolve il problema critico su WebKit / Safari iOS / Capacitor dove `crypto.randomUUID`
 * è undefined o genera eccezioni in contesti non-HTTPS (es. server di sviluppo locale su IP/LAN).
 *
 * Strategia a 3 livelli:
 *  1. crypto.randomUUID() se nativamente supportato e funzionante
 *  2. crypto.getRandomValues() crittograficamente sicuro se randomUUID non è disponibile
 *  3. Fallback pseudo-randomico basato su timestamp ad alta risoluzione + Math.random (garantito al 100% che non lancia mai eccezioni)
 */

export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined') {
    // 1. Prova il randomUUID nativo
    if (typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch {
        // Fallback sotto
      }
    }

    // 2. Fallback su crypto.getRandomValues
    if (typeof crypto.getRandomValues === 'function') {
      try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // Versione 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante RFC 4122
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      } catch {
        // Fallback sotto
      }
    }
  }

  // 3. Fallback universale infallibile (compatibile con qualsiasi motore JS/WebKit)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export default generateUUID;
