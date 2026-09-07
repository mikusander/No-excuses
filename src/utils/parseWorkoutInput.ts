/**
 * parseWorkoutInput.ts — Motore di parsing fitness con Modality-First Extraction.
 *
 * Supporta i 6 tipi nativi della web app:
 *  - 'reps'     : Serie e ripetizioni standard (con peso/chili e recupero)
 *  - 'isometry' : Isometria a tempo
 *  - 'superset' : Superset composto da più esercizi in successione
 *  - 'circuit'  : Circuito a giri / stazioni
 *  - 'emom'     : EMOM a round / minuto
 *  - 'pyramid'  : Piramide con step a scalare o a salire
 *
 * Caratteristiche chiave:
 *  1. Tolleranza ai refusi (Fuzzy Matching con Levenshtein) su modalità e termini di controllo (es. "pyramis" -> "pyramid")
 *  2. Bilinguismo completo Italiano / Inglese (es. piramide/pyramid, serie/sets, chili/kg, recupero/rest)
 *  3. Rimozione fisica dei token di controllo dal testo per isolare il nome pulito dell'esercizio (es. "EMOM push up 4 round" -> 4 round rimossi, nome "Push Up")
 *  4. Default standard a 'reps' con serie, reps, chili e recupero quando non è specificata una modalità speciale.
 */

export type WorkoutModality = 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface ParsedExerciseConfig {
  modality: WorkoutModality;
  name: string;
  setsOrRounds: number;
  repsTarget?: string;           // es. "8", "10-12", "max", "cedimento"
  weightKg?: number | null;      // es. 60, 75.5, 80 (chili / sovraccarico)
  durationSeconds?: number;      // Per isometria (es. "30s plank" -> 30)
  intervalSeconds?: number;      // Per EMOM (default: 60s per round)
  restSeconds: number;           // Tempo di recupero tra serie/round
  pyramidSteps?: { reps: number; restSeconds: number; weightKg?: number | null }[];
  subExercises?: { name: string; type: 'reps' | 'isometry'; reps: number; duration_seconds: number; weight_kg?: number | null }[];
  rawInput: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNZIONI AUSILIARIE DI DISTANZA E SIMILARITÀ (LEVENSHTEIN)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola la distanza di Levenshtein classica tra due stringhe
 */
export function levenshteinDistance(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  const row = Array.from({ length: s2.length + 1 }, (_, i) => i);

  for (let i = 1; i <= s1.length; i++) {
    let prev = i;
    for (let j = 1; j <= s2.length; j++) {
      const val = s1[i - 1] === s2[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[s2.length] = prev;
  }

  return row[s2.length];
}

/**
 * Calcola la similarità normalizzata da 0.0 a 1.0
 */
export function stringSimilarity(strA: string, strB: string): number {
  const maxLen = Math.max(strA.length, strB.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(strA, strB);
  return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Verifica se una parola corrisponde a una lista di candidati con tolleranza d'errore
 */
function fuzzyMatchWord(word: string, candidates: string[]): string | null {
  const w = word.toLowerCase().trim();
  if (!w) return null;

  for (const cand of candidates) {
    const c = cand.toLowerCase();
    if (w === c) return cand;

    // Se l'iniziale è diversa, evita falsi positivi incrociati
    if (w[0] !== c[0]) {
      continue;
    }

    // Prefisso lungo (es. piramid... o isometr...)
    if (w.length >= 6 && c.length >= 6) {
      if (w.startsWith(c.slice(0, 5)) || c.startsWith(w.slice(0, 5))) {
        return cand;
      }
    }

    const dist = levenshteinDistance(w, c);
    let maxAllowedDist = 0;
    if (c.length >= 8) {
      maxAllowedDist = 2;
    } else if (c.length >= 4) {
      maxAllowedDist = 1;
    } else {
      maxAllowedDist = 0;
    }

    if (dist <= maxAllowedDist) {
      return cand;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIZIONARI BILINGUE (ITALIANO / INGLESE) E ALIAS
// ─────────────────────────────────────────────────────────────────────────────

const MODALITY_KEYWORDS: Record<Exclude<WorkoutModality, 'reps'>, string[]> = {
  pyramid: [
    'piramide', 'piramidale', 'piramidali', 'piramides', 'piramde',
    'pyramid', 'pyramidal', 'pyramids', 'pyramis'
  ],
  emom: [
    'emom', 'emmo', 'every minute on the minute', 'al minuto'
  ],
  circuit: [
    'circuito', 'circuiti', 'circuto', 'circut',
    'circuit', 'circuits'
  ],
  superset: [
    'superset', 'supersets', 'supersett', 'superserie', 'super serie', 'super-serie', 'suprs', 'ss'
  ],
  isometry: [
    'isometria', 'isometrie', 'isometia', 'isometri', 'isometrico', 'isometrica', 'isometrici',
    'isometry', 'isometric', 'isometrics', 'isometic', 'tenuta isometrica'
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// PARSER TEMPO (SECONDI / MINUTI)
// ─────────────────────────────────────────────────────────────────────────────

export function parseRestTimeString(timeStr: string, defaultSeconds = 90): number {
  if (!timeStr) return defaultSeconds;
  const cleaned = timeStr.trim().toLowerCase();

  // Formato combinato es: 1m30s oppure 1'30"
  const comboMatch = cleaned.match(/^(\d+)(?:m|'|min)\s*(\d+)?(?:s|"|sec)?$/i);
  if (comboMatch) {
    const mins = parseInt(comboMatch[1], 10) || 0;
    const secs = parseInt(comboMatch[2] || '0', 10) || 0;
    return mins * 60 + secs;
  }

  // Formato minuti: 2m, 2min, 2', 2 minuti
  const minMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|'|minuti|minuto)$/i);
  if (minMatch) {
    return Math.round(parseFloat(minMatch[1]) * 60);
  }

  // Formato secondi: 90s, 90sec, 90", 90 secondi
  const secMatch = cleaned.match(/^(\d+)\s*(?:s|sec|"|secondi|secondo)$/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }

  // Numero puro
  const num = parseInt(cleaned, 10);
  if (!Number.isNaN(num) && num > 0) {
    if (num <= 5 && !timeStr.includes('s')) {
      return num * 60;
    }
    return num;
  }

  return defaultSeconds;
}

// ─────────────────────────────────────────────────────────────────────────────
// PULIZIA DEL NOME E STOPWORDS
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_WORDS_REGEX = /\b(?:fai|fare|esegui|eseguire|allenati|metti|inserisci|do|perform|poi|and|e)\b/gi;
const EDGE_PREPOSITIONS_REGEX = /^(?:di|da|per|con|del|della|delle|degli|dei|in|su|a|of|for|with|to)\s+|\s+(?:di|da|per|con|del|della|delle|degli|dei|in|su|a|of|for|with|to)$/gi;

function cleanExerciseTitle(raw: string): string {
  let clean = raw
    .replace(/^[\s\-–—:•,;+/'"]+|[\s\-–—:•,;+/'"]+$/g, '')
    .trim();

  // Rimuovi verbi di comando ovunque
  clean = clean.replace(COMMAND_WORDS_REGEX, ' ');

  // Rimuovi preposizioni orfane in testa o in coda (ripeti per combinazioni come "di da")
  let prev = '';
  while (prev !== clean) {
    prev = clean;
    clean = clean.replace(EDGE_PREPOSITIONS_REGEX, ' ').trim();
  }

  // Normalizza gli spazi
  clean = clean.replace(/\s{2,}/g, ' ').trim();

  if (clean.length === 0) return '';

  // Title Case: prima lettera di ogni parola maiuscola
  return clean
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNZIONE PRINCIPALE: parseWorkoutInput
// ─────────────────────────────────────────────────────────────────────────────

export function parseWorkoutInput(input: string, fallbackRest = 60): ParsedExerciseConfig {
  const rawInput = (input || '').trim();

  if (!rawInput) {
    return {
      modality: 'reps',
      name: '',
      setsOrRounds: 3,
      repsTarget: '10',
      weightKg: null,
      restSeconds: fallbackRest,
      rawInput: '',
    };
  }

  let workingText = rawInput;

  // ─── FASE 1: RICONOSCIMENTO MODALITÀ (MODALITY-FIRST) ──────────────────────
  let detectedModality: WorkoutModality = 'reps';
  let modalityMatchToken: string | null = null;

  // 1.1 Controlla sequenza numerica piramidale (es. 12-10-8-6 o 15/12/10/8)
  const isDate = /\b(?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}|(?:19|20)\d{2}[/-]\d{1,2}[/-]\d{1,2})\b/.test(workingText);
  const pyramidSeqMatch = !isDate ? workingText.match(/(\d+(?:[-/]\d+){1,})/i) : null;
  const hasPyramidSeq = Boolean(
    pyramidSeqMatch &&
    pyramidSeqMatch[1].split(/[-/]/).length >= 2 &&
    pyramidSeqMatch[1].split(/[-/]/).every(n => parseInt(n, 10) > 0 && parseInt(n, 10) <= 60)
  );

  // 1.2 Cerca parole chiave delle modalità nel testo con tolleranza fuzzy
  const words = workingText.split(/[\s,;:\-–—+()]+/).filter(w => w.length > 0);

  for (const word of words) {
    // Check Pyramid
    if (fuzzyMatchWord(word, MODALITY_KEYWORDS.pyramid)) {
      detectedModality = 'pyramid';
      modalityMatchToken = word;
      break;
    }
    // Check EMOM
    if (fuzzyMatchWord(word, MODALITY_KEYWORDS.emom)) {
      detectedModality = 'emom';
      modalityMatchToken = word;
      break;
    }
    // Check Circuit
    if (fuzzyMatchWord(word, MODALITY_KEYWORDS.circuit)) {
      detectedModality = 'circuit';
      modalityMatchToken = word;
      break;
    }
    // Check Superset
    if (fuzzyMatchWord(word, MODALITY_KEYWORDS.superset)) {
      detectedModality = 'superset';
      modalityMatchToken = word;
      break;
    }
    // Check Isometry
    if (fuzzyMatchWord(word, MODALITY_KEYWORDS.isometry)) {
      detectedModality = 'isometry';
      modalityMatchToken = word;
      break;
    }
  }

  // Se è presente una sequenza piramidale esplicita (es. 12-10-8-6), è piramide anche senza parola chiave
  if (hasPyramidSeq && (detectedModality === 'reps' || detectedModality === 'pyramid')) {
    detectedModality = 'pyramid';
  }

  // Se è presente sets x secondi (es. 3x30s o 4x45sec) e non è piramide/emom/circuito, è isometria
  const hasIsoPattern = /\b(\d+)\s*(?:[x*X×])\s*(\d+)\s*(?:s|sec|"|'')\b/i.test(workingText);
  if (hasIsoPattern && detectedModality === 'reps') {
    detectedModality = 'isometry';
  }

  // Se contiene '+' tra due o più segmenti e non è circuito né emom, è superset
  if (detectedModality === 'reps' && workingText.includes('+')) {
    detectedModality = 'superset';
  }

  // Rimuovi il token della modalità trovato dal testo
  if (modalityMatchToken) {
    workingText = workingText.replace(new RegExp(`\\b${modalityMatchToken}\\b`, 'i'), ' ');
  }

  // Rimuovi anche eventuali sinonimi o residui della modalità dal testo
  const allModalitySynonyms = [
    ...MODALITY_KEYWORDS.pyramid,
    ...MODALITY_KEYWORDS.emom,
    ...MODALITY_KEYWORDS.circuit,
    ...MODALITY_KEYWORDS.superset,
    ...MODALITY_KEYWORDS.isometry
  ];
  for (const syn of allModalitySynonyms) {
    if (syn.length >= 3) {
      workingText = workingText.replace(new RegExp(`\\b${syn}\\b`, 'gi'), ' ');
    }
  }

  // ─── FASE 2: ESTRAZIONE PARAMETRI DI CONTROLLO & RIMOZIONE TOKEN ───────────

  let weightKg: number | null = null;
  let restSeconds: number = fallbackRest;
  let setsOrRounds: number = detectedModality === 'circuit' ? 3 : detectedModality === 'emom' ? 10 : 3;
  let repsTarget: string | undefined = undefined;
  let durationSeconds: number | undefined = undefined;
  let intervalSeconds: number | undefined = detectedModality === 'emom' ? 60 : undefined;
  let pyramidSteps: { reps: number; restSeconds: number; weightKg?: number | null }[] | undefined = undefined;

  // 2.1 ESTRAZIONE PESO / CHILI (weightKg)
  // Esempi: "80kg", "80 kg", "75.5kg", "peso 60", "con 100 chili", "50 kili"
  const weightRegex1 = /(?:(?:con|\+|peso|carico|sovraccarico)\s*(?:di|da|:)?\s*)?(\d+(?:[.,]\d+)?)\s*(?:kg|chili|chilo|kili|kilo)\b/i;
  const weightMatch1 = workingText.match(weightRegex1);
  if (weightMatch1) {
    const val = parseFloat(weightMatch1[1].replace(',', '.'));
    if (!Number.isNaN(val) && val > 0) {
      weightKg = Math.round(val * 100) / 100;
      workingText = workingText.replace(weightMatch1[0], ' ');
    }
  } else {
    // Esempio: "peso 80", "carico 75"
    const weightRegex2 = /\b(?:peso|carico)\s*(?:di|da|:)?\s*(\d+(?:[.,]\d+)?)\b/i;
    const weightMatch2 = workingText.match(weightRegex2);
    if (weightMatch2) {
      const val = parseFloat(weightMatch2[1].replace(',', '.'));
      if (!Number.isNaN(val) && val > 0) {
        weightKg = Math.round(val * 100) / 100;
        workingText = workingText.replace(weightMatch2[0], ' ');
      }
    }
  }

  // 2.2 ESTRAZIONE RECUPERO / REST (restSeconds)
  // Esempi: "90s rest", "recupero 2m", "pausa 60s", "recupreo 90s", "rec 90s", "60s" in coda
  const restRegex1 = /(?:(?:con|e)\s+)?(?:recupero|rest|pausa|pause|recup|rec|reucpero|recupreo)\s*(?:di|da|:)?\s*(\d+\s*(?:s|sec|"|m|min|'|secondi|minuti)?)\b/i;
  const restMatch1 = workingText.match(restRegex1);
  if (restMatch1 && restMatch1[1]) {
    restSeconds = parseRestTimeString(restMatch1[1], fallbackRest);
    workingText = workingText.replace(restMatch1[0], ' ');
  } else {
    const restRegex2 = /(?:(?:con|e)\s+)?(\d+\s*(?:s|sec|"|m|min|'|secondi|minuti))\s*(?:di|da)?\s*(?:recupero|rest|pausa|pause|recup|rec|reucpero|recupreo)\b/i;
    const restMatch2 = workingText.match(restRegex2);
    if (restMatch2 && restMatch2[1]) {
      restSeconds = parseRestTimeString(restMatch2[1], fallbackRest);
      workingText = workingText.replace(restMatch2[0], ' ');
    } else {
      // Controllo tempo in coda alla stringa (es. "... 90s" o "... 2m")
      const trailingRestMatch = workingText.match(/\s+(\d+\s*(?:s|sec|"|m|min|'))\s*$/i);
      if (trailingRestMatch && trailingRestMatch[1]) {
        restSeconds = parseRestTimeString(trailingRestMatch[1], fallbackRest);
        workingText = workingText.slice(0, workingText.length - trailingRestMatch[0].length);
      }
    }
  }

  // 2.3 ESTRAZIONE INTERVALLO / CADENZA (EMOM / Tabata)
  if (detectedModality === 'emom') {
    const intervalMatch = workingText.match(/\b(?:round\s+da|cadenza\s*(?:di)?|ogni|intervallo)\s*(\d+\s*(?:s|sec|"|m|min|')?)\b/i);
    if (intervalMatch && intervalMatch[1]) {
      intervalSeconds = parseRestTimeString(intervalMatch[1], 60);
      workingText = workingText.replace(intervalMatch[0], ' ');
    }
  }

  // 2.4 ESTRAZIONE SEQUENZA PIRAMIDALE (Pyramid)
  if (detectedModality === 'pyramid') {
    const seqMatch = workingText.match(/(\d+(?:[-/]\d+){1,})/i);
    if (seqMatch) {
      const repsArray = seqMatch[1]
        .split(/[-/]/)
        .map(n => parseInt(n, 10))
        .filter(n => !Number.isNaN(n) && n > 0);

      if (repsArray.length >= 2) {
        setsOrRounds = repsArray.length;
        repsTarget = repsArray.join('-');
        pyramidSteps = repsArray.map(r => ({
          reps: r,
          restSeconds,
          weightKg: weightKg ?? null,
        }));
        workingText = workingText.replace(seqMatch[0], ' ');
      }
    }
  }

  // 2.5a ESTRAZIONE SERIE x DURATA ISOMETRIA (es. 3x30s, 4x45sec)
  const isoSetsMatch2 = workingText.match(/\b(\d+)\s*(?:[x*X×])\s*(\d+)\s*(?:s|sec|"|'')\b/i);
  if (isoSetsMatch2) {
    setsOrRounds = parseInt(isoSetsMatch2[1], 10) || 3;
    durationSeconds = parseInt(isoSetsMatch2[2], 10) || 30;
    workingText = workingText.replace(isoSetsMatch2[0], ' ');
  }

  // 2.5b ESTRAZIONE SERIE / ROUNDS (setsOrRounds)
  // Pattern: "4 round", "4 rounds", "4roound", "4 giri", "4 serie", "4 sets", "4r"
  const roundsRegex1 = /\b(\d+)\s*(?:round|rounds|roound|rund|giri|giro|serie|sets?|set|sett|r)\b/i;
  const roundsMatch1 = workingText.match(roundsRegex1);
  if (roundsMatch1) {
    setsOrRounds = parseInt(roundsMatch1[1], 10) || setsOrRounds;
    workingText = workingText.replace(roundsMatch1[0], ' ');
  } else {
    // Pattern invertito: "round 4", "serie 4", "giri 3"
    const roundsRegex2 = /\b(?:round|rounds|roound|rund|giri|giro|serie|sets?|set|sett)\s*(?:di|da|num|n°)?\s*(\d+)\b/i;
    const roundsMatch2 = workingText.match(roundsRegex2);
    if (roundsMatch2) {
      setsOrRounds = parseInt(roundsMatch2[1], 10) || setsOrRounds;
      workingText = workingText.replace(roundsMatch2[0], ' ');
    }
  }

  // 2.6 ESTRAZIONE SERIE x RIPETIZIONI (es. 4x8, 4*10, 4x10-12, 4x max)
  const setsRepsRegex = /\b(\d+)\s*(?:[x*X×])\s*(\d+(?:-\d+)?|max|cedimento)?\b/i;
  const setsRepsMatch = workingText.match(setsRepsRegex);
  if (setsRepsMatch) {
    setsOrRounds = parseInt(setsRepsMatch[1], 10) || setsOrRounds;
    if (setsRepsMatch[2]) {
      repsTarget = setsRepsMatch[2].toLowerCase();
    }
    workingText = workingText.replace(setsRepsMatch[0], ' ');
  }

  // 2.6b ESTRAZIONE SERIE e RIPETIZIONI TABELLARI (es. "4 8", "3 10", "5 5", "4 max")
  if (!repsTarget && detectedModality === 'reps') {
    const tableSetsRepsRegex = /\b([1-9]|1[0-9]|20)\s+([1-9]|[1-9][0-9]|max|cedimento)\b/i;
    const tableSetsRepsMatch = workingText.match(tableSetsRepsRegex);
    if (tableSetsRepsMatch) {
      setsOrRounds = parseInt(tableSetsRepsMatch[1], 10);
      repsTarget = tableSetsRepsMatch[2].toLowerCase();
      workingText = workingText.replace(tableSetsRepsMatch[0], ' ');
    }
  }

  // 2.7 ESTRAZIONE RIPETIZIONI SPECIFICHE (repsTarget)
  if (!repsTarget) {
    // Pattern: "8 reps", "da 10 reps", "10-12 ripetizioni", "max reps", "cedimento"
    const repsRegex1 = /(?:\b(?:da|di|per)\s+)?(\d+(?:-\d+)?|max|cedimento)\s*(?:reps?|ripetizioni|ripetizione|rip)\b/i;
    const repsMatch1 = workingText.match(repsRegex1);
    if (repsMatch1) {
      repsTarget = repsMatch1[1].toLowerCase();
      workingText = workingText.replace(repsMatch1[0], ' ');
    } else {
      // Pattern: "reps: 10", "ripetizioni da 12"
      const repsRegex2 = /\b(?:reps?|ripetizioni|ripetizione|rip)\s*(?:di|da|:)?\s*(\d+(?:-\d+)?|max|cedimento)\b/i;
      const repsMatch2 = workingText.match(repsRegex2);
      if (repsMatch2) {
        repsTarget = repsMatch2[1].toLowerCase();
        workingText = workingText.replace(repsMatch2[0], ' ');
      }
    }
  }

  // 2.8 ESTRAZIONE DURATA ISOMETRIA (durationSeconds)
  if (detectedModality === 'isometry') {
    if (durationSeconds === undefined) {
      const isoDurationMatch = workingText.match(/\b(\d+)\s*(?:s|sec|"|'')\b/i);
      if (isoDurationMatch) {
        durationSeconds = parseInt(isoDurationMatch[1], 10) || 30;
        workingText = workingText.replace(isoDurationMatch[0], ' ');
      } else {
        durationSeconds = 30;
      }
    }
  }

  // 2.9 Gestione EMOM minuti formato "10'" o "10m" o "10 min"
  if (detectedModality === 'emom') {
    const emomMinsMatch = workingText.match(/\b(\d+)\s*(?:'|m|min|minuti|minuto)\b/i);
    if (emomMinsMatch) {
      setsOrRounds = parseInt(emomMinsMatch[1], 10) || setsOrRounds;
      workingText = workingText.replace(emomMinsMatch[0], ' ');
    }
  }

  // 2.10 Controlla se c'è un numero isolato in testa o in coda al nome (es. "10 push up" o "push up 10")
  if (!repsTarget && detectedModality !== 'pyramid' && detectedModality !== 'isometry') {
    const leadNumMatch = workingText.match(/^\s*(\d+)\s+([a-zA-Z].+)$/);
    if (leadNumMatch) {
      repsTarget = leadNumMatch[1];
      workingText = leadNumMatch[2];
    } else {
      const trailNumMatch = workingText.match(/^(.+?)\s+(\d+)\s*$/);
      if (trailNumMatch) {
        repsTarget = trailNumMatch[2];
        workingText = trailNumMatch[1];
      }
    }
  }

  // Default repsTarget per modalità standard 'reps'
  if (!repsTarget && detectedModality === 'reps') {
    repsTarget = '10';
  }

  // ─── FASE 3: ISOLAMENTO DEL NOME E PULIZIA STOPWORDS ──────────────────────

  let cleanName = cleanExerciseTitle(workingText);

  // Se è superset o circuito e il nome contiene '+' o è vuoto, usa il nome standard
  if (detectedModality === 'superset' && (!cleanName || cleanName.includes('+'))) {
    cleanName = 'Superset';
  } else if (detectedModality === 'circuit' && (!cleanName || cleanName.includes('+'))) {
    cleanName = 'Circuito';
  } else if (!cleanName) {
    switch (detectedModality) {
      case 'pyramid':
        cleanName = 'Piramide';
        break;
      case 'emom':
        cleanName = `EMOM ${setsOrRounds} Round`;
        break;
      case 'circuit':
        cleanName = 'Circuito';
        break;
      case 'superset':
        cleanName = 'Superset';
        break;
      case 'isometry':
        cleanName = 'Isometria';
        break;
      default:
        cleanName = 'Esercizio';
    }
  }

  // ─── FASE 4: SUB-EXERCISES PER SUPERSET / CIRCUITO / EMOM ─────────────────
  let subExercises: ParsedExerciseConfig['subExercises'] = undefined;

  if (detectedModality === 'superset' || detectedModality === 'circuit' || rawInput.includes('+')) {
    const rawSegments = rawInput
      .replace(new RegExp(`\\b(?:circuito|circuit|superset|ss)\\b`, 'gi'), '')
      .split(/\s*\+\s*|\s*,\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (rawSegments.length > 1) {
      subExercises = rawSegments.map(seg => {
        const subParsed = parseWorkoutInput(seg, restSeconds);
        const isIso = subParsed.modality === 'isometry' || Boolean(subParsed.durationSeconds);
        return {
          name: subParsed.name || 'Esercizio',
          type: (isIso ? 'isometry' : 'reps') as 'reps' | 'isometry',
          reps: isIso ? 0 : parseInt(subParsed.repsTarget || '10', 10) || 10,
          duration_seconds: isIso ? (subParsed.durationSeconds || 30) : 0,
          weight_kg: subParsed.weightKg ?? null,
        };
      });
    }
  }

  if (detectedModality === 'emom' && (!subExercises || subExercises.length <= 1)) {
    const isIso = cleanName.toLowerCase().includes('plank') || Boolean(durationSeconds);
    subExercises = [
      {
        name: cleanName,
        type: (isIso ? 'isometry' : 'reps') as 'reps' | 'isometry',
        reps: isIso ? 0 : parseInt(repsTarget || '10', 10) || 10,
        duration_seconds: isIso ? (durationSeconds || 30) : 0,
        weight_kg: weightKg ?? null,
      }
    ];
  }

  return {
    modality: detectedModality,
    name: cleanName,
    setsOrRounds,
    repsTarget,
    weightKg,
    durationSeconds,
    intervalSeconds,
    restSeconds,
    pyramidSteps,
    subExercises,
    rawInput,
  };
}
