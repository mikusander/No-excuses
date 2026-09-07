/**
 * userCorrectionsManager.ts — Active Feedback Loop & Dizionario di Correzioni Dinamico.
 *
 * Permette al sistema OCR e al parser di allenamento di apprendere dalle correzioni manuali
 * dell'utente, memorizzando regole personalizzate in localStorage (offline-first, per utente)
 * e applicandole in Short-Circuit Cache prima delle euristiche standard.
 */

export interface UserCorrectionRule {
  id: string;
  rawInputSignature: string;      // Stringa grezza ripulita (lowercase, spazi collassati, rimozione punteggiatura ai bordi)
  correctedResult: {
    name: string;                 // Nome corretto (es. "Spinte Su Panca Inclinata Con Manubri")
    modality: 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';
    setsOrRounds: number;         // Serie o round corretti
    repsTarget?: string;          // Ripetizioni target corrette
    weightKg?: number | null;     // Carico in kg
    durationSeconds?: number;     // Durata isometria
    restSeconds: number;          // Tempo di recupero
    subExercises?: Array<{
      name: string;
      type: 'reps' | 'isometry';
      reps: number;
      duration_seconds: number;
      weight_kg?: number | null;
    }>;
    pyramidSteps?: Array<{
      reps: number;
      restSeconds: number;
      weightKg?: number | null;
    }>;
    muscleGroup?: string;
  };
  hitCount: number;               // Numero di volte in cui la regola è stata riapplicata
  createdAt: string;              // ISO timestamp
  lastUsedAt: string;             // ISO timestamp
}

const STORAGE_PREFIX = 'no_excuses_user_corrections_';

/**
 * Normalizza una stringa per creare una firma univoca e stabile:
 * - Minuscolo
 * - Rimozione punteggiatura superflua ai bordi e normalizzazione separatori
 * - Collassamento degli spazi multipli
 */
export function normalizeSignature(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/^[\s\-–—:•,;+/'"]+|[\s\-–—:•,;+/'"]+$/g, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ottiene la chiave di archiviazione specifica per l'utente (o 'guest').
 */
function getStorageKey(userId?: string): string {
  return `${STORAGE_PREFIX}${userId && userId.trim() ? userId.trim() : 'guest'}`;
}

/**
 * Carica tutte le regole di correzione per l'utente specificato.
 */
export function loadCorrectionRules(userId?: string): UserCorrectionRule[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as UserCorrectionRule[];
  } catch (err) {
    console.warn('Errore durante la lettura delle correzioni utente:', err);
    return [];
  }
}

/**
 * Salva l'elenco delle regole di correzione per l'utente specificato.
 */
export function saveCorrectionRules(rules: UserCorrectionRule[], userId?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(rules));
  } catch (err) {
    console.warn('Errore durante il salvataggio delle correzioni utente:', err);
  }
}

/**
 * Cerca una regola corrispondente per l'input specificato.
 * Effettua prima un match esatto sulla firma normalizzata.
 * In subordine, valuta match flessibili se l'input contiene la firma registrata.
 */
export function findMatchingCorrection(input: string, userId?: string): UserCorrectionRule | null {
  const sig = normalizeSignature(input);
  if (!sig || sig.length < 2) return null;

  const rules = loadCorrectionRules(userId);
  if (rules.length === 0) return null;

  // 1. Match esatto sulla firma normalizzata
  const exact = rules.find(r => r.rawInputSignature === sig);
  if (exact) return exact;

  // 2. Match parziale se la firma salvata è sufficientemente lunga ed è contenuta
  for (const rule of rules) {
    if (rule.rawInputSignature.length >= 5 && sig === rule.rawInputSignature) {
      return rule;
    }
  }

  return null;
}

/**
 * Registra una nuova regola o aggiorna una regola esistente se viene rilevata
 * una reale discrepanza tra il valore prodotto dal parser e la versione confermata dall'utente.
 */
export function recordCorrection(
  rawInput: string,
  corrected: UserCorrectionRule['correctedResult'],
  originalParsed?: {
    name?: string;
    type?: string;
    sets?: number;
    reps?: number;
    weight_kg?: number | null;
    rest_seconds?: number;
  } | null,
  userId?: string
): UserCorrectionRule | null {
  const sig = normalizeSignature(rawInput);
  if (!sig || sig.length < 2 || !corrected.name.trim()) {
    return null;
  }

  // Verifica se c'è una reale discrepanza rispetto all'output automatico
  if (originalParsed) {
    const isNameSame = normalizeSignature(originalParsed.name || '') === normalizeSignature(corrected.name);
    const isTypeSame = !originalParsed.type || originalParsed.type === corrected.modality;
    const isSetsSame = originalParsed.sets === undefined || originalParsed.sets === corrected.setsOrRounds;
    const isRepsSame = originalParsed.reps === undefined || String(originalParsed.reps) === String(corrected.repsTarget || '');
    const isWeightSame = (originalParsed.weight_kg ?? null) === (corrected.weightKg ?? null);
    const isRestSame = originalParsed.rest_seconds === undefined || originalParsed.rest_seconds === corrected.restSeconds;

    // Se tutti i parametri coincidono già, non serve creare una regola di sovrascrittura
    if (isNameSame && isTypeSame && isSetsSame && isRepsSame && isWeightSame && isRestSame) {
      return null;
    }
  }

  const rules = loadCorrectionRules(userId);
  const now = new Date().toISOString();

  const existingIdx = rules.findIndex(r => r.rawInputSignature === sig);

  let updatedRule: UserCorrectionRule;

  if (existingIdx >= 0) {
    // Aggiorna regola esistente
    updatedRule = {
      ...rules[existingIdx],
      correctedResult: { ...corrected },
      hitCount: rules[existingIdx].hitCount + 1,
      lastUsedAt: now,
    };
    rules[existingIdx] = updatedRule;
  } else {
    // Crea nuova regola
    updatedRule = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      rawInputSignature: sig,
      correctedResult: { ...corrected },
      hitCount: 1,
      createdAt: now,
      lastUsedAt: now,
    };
    rules.unshift(updatedRule);
  }

  // Mantieni al massimo le ultime 200 regole per non saturare localStorage
  if (rules.length > 200) {
    rules.length = 200;
  }

  saveCorrectionRules(rules, userId);
  return updatedRule;
}

/**
 * Incrementa il contatore di utilizzo (hitCount) quando una regola viene riapplicata dalla Short-Circuit Cache.
 */
export function incrementCorrectionHit(ruleId: string, userId?: string): void {
  const rules = loadCorrectionRules(userId);
  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx >= 0) {
    rules[idx].hitCount += 1;
    rules[idx].lastUsedAt = new Date().toISOString();
    saveCorrectionRules(rules, userId);
  }
}

/**
 * Rimuove una singola regola di correzione.
 */
export function deleteCorrectionRule(ruleId: string, userId?: string): void {
  const rules = loadCorrectionRules(userId);
  const next = rules.filter(r => r.id !== ruleId);
  saveCorrectionRules(next, userId);
}

/**
 * Svuota tutte le regole memorizzate per l'utente.
 */
export function clearAllCorrectionRules(userId?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch (err) {
    console.warn('Errore durante cancellazione correzioni utente:', err);
  }
}
