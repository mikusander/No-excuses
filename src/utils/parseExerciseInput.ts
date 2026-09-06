/**
 * parseExerciseInput.ts — Smart String Parser Inline per l'inserimento rapido di esercizi.
 *
 * Permette all'utente di digitare una singola riga di testo libero ed estrarre
 * automaticamente parametri numerici, tempi di recupero e configurazioni complesse:
 *  - Esercizi standard (reps): "spinte brutte 4x8 90s", "panca piana 5x5", "trazioni 4xMax 120s"
 *  - Isometria: "plank 3x45s 60s", "hollow body 4x30s 90s"
 *  - Piramide: "piramide panca piana 12-10-8-6 90s", "squat 15/12/10/8 2m"
 *  - Superset: "superset 4x 10 trazioni + 12 dip 90s", "trazioni 4x8 + dip 4x10 90s"
 *  - Circuito: "circuito 3 giri 90s: 10 piegamenti + 15 squat + 30s plank"
 *  - EMOM: "EMOM 10' 10 push up + 5 pull up", "EMOM 12m 90s: 12 burpees + 15 squat"
 */

export type ParsedExerciseType = 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface ParsedSubExercise {
  name: string;
  type: 'reps' | 'isometry';
  reps: number;
  duration_seconds: number;
  weight_kg?: number | null;
  instruction_note?: string;
}

export interface ParsedPyramidStep {
  reps: number;
  rest_seconds: number;
  weight_kg?: number | null;
}

export interface ParsedWorkoutItem {
  matched: boolean;
  type: ParsedExerciseType;
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  isMaxReps?: boolean;
  emom_rounds?: number;
  emom_round_duration?: number;
  subExercises?: ParsedSubExercise[];
  pyramid_steps?: ParsedPyramidStep[];
  rawInput: string;
  confidence?: 'high' | 'medium';
}

/**
 * Converte una stringa di tempo (es. "90s", "2m", "1m30s", "1'30\"", "90") in secondi.
 */
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

  // Formato minuti: 2m, 2min, 2'
  const minMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|')$/i);
  if (minMatch) {
    return Math.round(parseFloat(minMatch[1]) * 60);
  }

  // Formato secondi: 90s, 90sec, 90"
  const secMatch = cleaned.match(/^(\d+)\s*(?:s|sec|")$/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }

  // Numero puro
  const num = parseInt(cleaned, 10);
  if (!Number.isNaN(num) && num > 0) {
    // Se è un numero piccolo (es. <= 5), probabilmente sono minuti
    if (num <= 5 && !timeStr.includes('s')) {
      return num * 60;
    }
    return num;
  }

  return defaultSeconds;
}

/**
 * Estrae nome e ripetizioni/durata di un singolo sub-esercizio da una stringa
 * Esempi: "10 push up", "push up 10", "30s plank", "plank 45s", "pull up 4x8"
 */
export function parseSubExerciseString(segment: string): ParsedSubExercise {
  const trimmed = segment.trim();

  // Pattern isometrico: "30s plank" o "plank 30s" o "45sec hollow body"
  const isoLeadMatch = trimmed.match(/^(\d+)\s*(?:s|sec|"|'')\s+(.+)$/i);
  if (isoLeadMatch) {
    return {
      name: cleanExerciseTitle(isoLeadMatch[2]),
      type: 'isometry',
      reps: 0,
      duration_seconds: parseInt(isoLeadMatch[1], 10),
      weight_kg: null,
    };
  }

  const isoTrailMatch = trimmed.match(/^(.+?)\s+(\d+)\s*(?:s|sec|"|'')$/i);
  if (isoTrailMatch) {
    return {
      name: cleanExerciseTitle(isoTrailMatch[1]),
      type: 'isometry',
      reps: 0,
      duration_seconds: parseInt(isoTrailMatch[2], 10),
      weight_kg: null,
    };
  }

  // Pattern reps con formato 4x10 o 10 reps
  const setsRepsMatch = trimmed.match(/^(.+?)\s+(\d+)\s*(?:x|\*)\s*(\d+|max|cedimento)$/i);
  if (setsRepsMatch) {
    const repsRaw = setsRepsMatch[3].toLowerCase();
    const isMax = repsRaw === 'max' || repsRaw === 'cedimento';
    return {
      name: cleanExerciseTitle(setsRepsMatch[1]),
      type: 'reps',
      reps: isMax ? 0 : parseInt(repsRaw, 10) || 10,
      duration_seconds: 0,
      weight_kg: null,
    };
  }

  // Pattern "10 push up" (numero all'inizio)
  const numLeadMatch = trimmed.match(/^(\d+|max|cedimento)\s+(.+)$/i);
  if (numLeadMatch) {
    const rawReps = numLeadMatch[1].toLowerCase();
    const isMax = rawReps === 'max' || rawReps === 'cedimento';
    return {
      name: cleanExerciseTitle(numLeadMatch[2]),
      type: 'reps',
      reps: isMax ? 0 : parseInt(rawReps, 10) || 10,
      duration_seconds: 0,
      weight_kg: null,
    };
  }

  // Pattern "push up 10" (numero alla fine)
  const numTrailMatch = trimmed.match(/^(.+?)\s+(\d+|max|cedimento)$/i);
  if (numTrailMatch) {
    const rawReps = numTrailMatch[2].toLowerCase();
    const isMax = rawReps === 'max' || rawReps === 'cedimento';
    return {
      name: cleanExerciseTitle(numTrailMatch[1]),
      type: 'reps',
      reps: isMax ? 0 : parseInt(rawReps, 10) || 10,
      duration_seconds: 0,
      weight_kg: null,
    };
  }

  // Fallback: solo nome
  return {
    name: cleanExerciseTitle(trimmed),
    type: 'reps',
    reps: 10,
    duration_seconds: 0,
    weight_kg: null,
  };
}

/**
 * Pulisce e capitalizza la prima lettera del titolo dell'esercizio
 */
function cleanExerciseTitle(title: string): string {
  let clean = title.trim().replace(/^[-:,\s]+|[-:,\s]+$/g, '');
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER SPECIFICI PER TIPO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Parser EMOM
 * Esempio:
 *  - "EMOM 10' 10 push up + 5 pull up"
 *  - "EMOM 12 round 1m: 10 push up + 8 dip"
 *  - "EMOM 10x: 12 burpees"
 *  - "emom 8r: 10 push up + 10 squat"
 */
function tryParseEmom(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  const emomRegex = /^\s*emom\b\s*(.*)$/i;
  const match = input.match(emomRegex);
  if (!match) return null;

  let remainder = match[1].trim();

  let rounds = 10;
  let duration = 60; // default 1 minute

  // Estrai rounds es: "10'", "10m", "10 round", "10 rounds", "10r", "10x", "10 giri"
  const roundsMatch = remainder.match(/^(\d+)\s*(?:['’]|m(?:in)?|rounds?|giri|r|x)?(?:\s+(?:da|di)?\s*(\d+\s*(?:s|sec|m|min)?))?\s*[:\-]?\s*(.*)$/i);
  if (roundsMatch) {
    const rawRounds = parseInt(roundsMatch[1], 10);
    if (!Number.isNaN(rawRounds) && rawRounds > 0) {
      rounds = rawRounds;
    }

    if (roundsMatch[2]) {
      duration = parseRestTimeString(roundsMatch[2], 60);
    }

    remainder = (roundsMatch[3] || '').trim();
  }

  // Rimuovi eventuale ":" o quote residue all'inizio
  remainder = remainder.replace(/^['"’:\-\s]+/, '').trim();

  // Spezza i sub-esercizi separati da "+" o virgola
  const subSegments = remainder ? remainder.split(/\s*\+\s*|\s*,\s*/) : [];
  const subExercises = subSegments.map(parseSubExerciseString).filter(s => s.name.length > 0);

  if (subExercises.length === 0) {
    subExercises.push({
      name: 'Exercise 1',
      type: 'reps',
      reps: 10,
      duration_seconds: 0,
      weight_kg: null,
    });
  }

  return {
    matched: true,
    type: 'emom',
    name: `EMOM ${rounds}'`,
    sets: rounds,
    reps: 0,
    duration_seconds: 0,
    rest_seconds: fallbackRest,
    emom_rounds: rounds,
    emom_round_duration: duration,
    subExercises,
    rawInput: input,
    confidence: 'high',
  };
}

/**
 * 2. Parser Piramide
 * Esempio:
 *  - "piramide panca piana 12-10-8-6 90s"
 *  - "panca 12/10/8/6 90s"
 *  - "squat piramide 15-12-10-8 2m"
 *  - "12-10-8-6 stacco"
 */
function tryParsePyramid(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  // Cerca pattern tipo 12-10-8-6 o 15/12/10/8 (almeno 3 numeri o 2 se preceduto da piramide)
  const isExplicitPyramid = /\b(?:piramide|pyramid|piramidale)\b/i.test(input);

  // Pattern sequenza numerica: (\d+(?:[-/]\d+){2,}) oppure se esplicito {1,}
  const minSteps = isExplicitPyramid ? 1 : 2;
  const seqRegex = new RegExp(`(\\d+(?:[-/]\\d+){${minSteps},})`, 'i');
  const seqMatch = input.match(seqRegex);

  if (!seqMatch) return null;

  // Evita che date reali (es. 10/10/2026) vengano scambiate per piramidi
  const isDate = /\b(?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}|(?:19|20)\d{2}[/-]\d{1,2}[/-]\d{1,2})\b/.test(input);
  if (isDate) return null;

  const stepsStr = seqMatch[1];
  const repsArray = stepsStr.split(/[-/]/).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n) && n > 0);

  if (repsArray.length < 2 || repsArray.some(n => n > 60)) return null;

  // Trova eventuale recupero alla fine (es. "90s", "2m", "60sec")
  let restSeconds = fallbackRest;
  let restPart = '';
  const restMatch = input.match(/(\d+\s*(?:s|sec|"|m|min|'))\s*$/i);
  if (restMatch) {
    restSeconds = parseRestTimeString(restMatch[1], fallbackRest);
    restPart = restMatch[0];
  }

  // Rimuovi la sequenza, il recupero e i token "piramide" dal nome
  let rawName = input
    .replace(stepsStr, '')
    .replace(/\b(?:piramide|pyramid|piramidale)\b/gi, '')
    .trim();

  if (restPart) {
    rawName = rawName.replace(new RegExp(`${restPart.trim()}$`, 'i'), '').trim();
  }

  const name = cleanExerciseTitle(rawName) || 'Pyramid Exercise';

  const pyramidSteps = repsArray.map(reps => ({
    reps,
    rest_seconds: restSeconds,
    weight_kg: null,
  }));

  return {
    matched: true,
    type: 'pyramid',
    name,
    sets: 1,
    reps: repsArray[0] || 10,
    duration_seconds: 0,
    rest_seconds: 0, // In una piramide il riposo risiede nei singoli step
    pyramid_steps: pyramidSteps,
    rawInput: input,
    confidence: 'high',
  };
}

/**
 * 3. Parser Circuito
 * Esempio:
 *  - "circuito 3 giri 90s: 10 piegamenti + 15 squat + 30s plank"
 *  - "circuito core 4x: crunch 20 + leg raise 15 + 45s plank 60s"
 *  - "circuit 3 round 2m: trazioni 8 + dip 10 + push up 15"
 */
function tryParseCircuit(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  const circuitRegex = /^\s*(?:circuito|circuit)\b\s*(.*)$/i;
  const match = input.match(circuitRegex);
  if (!match) return null;

  let remainder = match[1].trim();
  let rounds = 3;
  let restSeconds = Math.max(60, fallbackRest);
  let circuitName = '';

  // Controlla se c'è un nome o parametri prima dei ":"
  const colonParts = remainder.split(/\s*:\s*/);
  const header = colonParts[0];
  const body = colonParts.length > 1 ? colonParts.slice(1).join(':') : '';

  // Cerca rounds nell'header: "3 giri", "3 round", "4x", "3"
  const roundsMatch = header.match(/(\d+)\s*(?:giri|giro|rounds?|r|x)\b/i);
  if (roundsMatch) {
    rounds = parseInt(roundsMatch[1], 10) || 3;
  }

  // Se c'è un body (dopo i due punti), usa quello per gli esercizi, altrimenti analizza il resto
  let exercisesText = body.length > 0 ? body : (header.includes('+') ? header : '');

  // Cerca eventuale recupero finale alla fine di exercisesText (es. "... + 45s plank 60s")
  const trailingRestMatch = exercisesText.match(/\s+(\d+\s*(?:s|sec|"|m|min|'))\s*$/i);
  if (trailingRestMatch) {
    restSeconds = parseRestTimeString(trailingRestMatch[1], restSeconds);
    exercisesText = exercisesText.slice(0, exercisesText.length - trailingRestMatch[0].length).trim();
  } else {
    // Altrimenti controlla se c'è rest nell'header (es. "circuito 3 giri 90s:")
    const headerRestMatch = header.match(/(\d+\s*(?:s|sec|"|m|min|'))(?:\s*(?:rest|recupero|pausa))?/i);
    if (headerRestMatch) {
      restSeconds = parseRestTimeString(headerRestMatch[1], restSeconds);
    }
  }

  // Estrai eventuale nome personalizzato del circuito
  let cleanHeader = header
    .replace(/(\d+)\s*(?:giri|giro|rounds?|r|x)\b/gi, '')
    .replace(/(\d+\s*(?:s|sec|"|m|min|'))(?:\s*(?:rest|recupero|pausa))?/gi, '')
    .trim();

  if (cleanHeader.length > 0 && !cleanHeader.includes('+')) {
    circuitName = cleanExerciseTitle(cleanHeader);
  }

  const subSegments = exercisesText ? exercisesText.split(/\s*\+\s*|\s*,\s*/) : [];
  const subExercises = subSegments.map(parseSubExerciseString).filter(s => s.name.length > 0);

  if (subExercises.length === 0) {
    subExercises.push(
      { name: 'Exercise 1', type: 'reps', reps: 10, duration_seconds: 0, weight_kg: null },
      { name: 'Exercise 2', type: 'reps', reps: 10, duration_seconds: 0, weight_kg: null }
    );
  }

  return {
    matched: true,
    type: 'circuit',
    name: circuitName || 'Circuit',
    sets: rounds,
    reps: 0,
    duration_seconds: 0,
    rest_seconds: restSeconds,
    subExercises,
    rawInput: input,
    confidence: 'high',
  };
}

/**
 * 4. Parser Superset
 * Esempio:
 *  - "superset 4x 10 trazioni + 12 dip 90s"
 *  - "superset: panca piana 4x8 + croci manubri 4x12 90s"
 *  - "trazioni 4x8 + dip 4x10 90s"
 *  - "trazioni + dip 4x10 90s"
 */
function tryParseSuperset(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  const isExplicitSuperset = /^\s*(?:superset|ss:)\b/i.test(input);
  const hasPlus = input.includes('+');

  if (!isExplicitSuperset && !hasPlus) {
    return null;
  }

  let text = input.replace(/^\s*(?:superset|ss:)\s*/i, '').trim();

  // Estrai recupero finale se presente (es. "90s", "2m")
  let restSeconds = fallbackRest;
  const restMatch = text.match(/(\d+\s*(?:s|sec|"|m|min|'))\s*$/i);
  if (restMatch) {
    restSeconds = parseRestTimeString(restMatch[1], fallbackRest);
    text = text.substring(0, text.length - restMatch[0].length).trim();
  }

  // Estrai serie se all'inizio (es. "4x ...")
  let sets = 3;
  const leadSetsMatch = text.match(/^(\d+)\s*(?:x|\*|serie)\s*[:\-]?\s*(.*)$/i);
  if (leadSetsMatch) {
    sets = parseInt(leadSetsMatch[1], 10) || 3;
    text = leadSetsMatch[2].trim();
  }

  // Spezza per "+"
  const parts = text.split(/\s*\+\s*/);
  if (parts.length < 2 && !isExplicitSuperset) {
    return null;
  }

  const subExercises: ParsedSubExercise[] = [];
  for (const part of parts) {
    const parsedSub = parseSubExerciseString(part);
    if (parsedSub.name) {
      // Se un sub-esercizio specificava serie es. "4x8", prendi 4 come sets comune se non già impostato
      const subSetsMatch = part.match(/\b(\d+)\s*(?:x|\*)\s*(\d+|max)/i);
      if (subSetsMatch && leadSetsMatch == null) {
        sets = parseInt(subSetsMatch[1], 10) || sets;
      }
      subExercises.push(parsedSub);
    }
  }

  if (subExercises.length < 2) {
    return null;
  }

  return {
    matched: true,
    type: 'superset',
    name: 'Superset',
    sets,
    reps: 0,
    duration_seconds: 0,
    rest_seconds: restSeconds,
    subExercises,
    rawInput: input,
    confidence: 'high',
  };
}

/**
 * 5. Parser Isometria Singola
 * Esempio:
 *  - "plank 3x45s 60s"
 *  - "hollow body 4x30s 90s"
 *  - "wall sit 3x60s"
 */
function tryParseIsometry(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  // Cerca pattern: <nome> <sets>x<duration>s <rest>?
  const isoRegex = /^(.+?)\s+(\d+)\s*(?:x|\*)\s*(\d+)\s*(?:s|sec|"|'')(?:\s+(\d+\s*(?:s|sec|"|m|min|')?))?$/i;
  const match = input.match(isoRegex);
  if (!match) return null;

  const rawName = match[1].trim();
  const sets = parseInt(match[2], 10);
  const duration = parseInt(match[3], 10);
  const restStr = match[4];
  const restSeconds = restStr ? parseRestTimeString(restStr, fallbackRest) : fallbackRest;

  return {
    matched: true,
    type: 'isometry',
    name: cleanExerciseTitle(rawName),
    sets: Math.max(1, sets || 3),
    reps: 0,
    duration_seconds: Math.max(1, duration || 30),
    rest_seconds: restSeconds,
    rawInput: input,
    confidence: 'high',
  };
}

/**
 * 6. Parser Singolo Esercizio Standard (Reps)
 * Esempio:
 *  - "spinte brutte 4x8 90s"
 *  - "circuito gambe 3x12 2m"
 *  - "trazioni alla sbarra 4xMax 120s"
 *  - "panca piana 5x5"
 *  - "dip 3*10 1m30s"
 */
function tryParseStandardReps(input: string, fallbackRest: number): ParsedWorkoutItem | null {
  // Regex: <nome> <sets>x<reps> <rest>?
  // reps può essere numero o "max" o "cedimento"
  const repsRegex = /^(.+?)\s+(\d+)\s*(?:[x*X×])\s*(\d+|max|cedimento)(?:\s+(.+))?$/i;
  const match = input.match(repsRegex);
  if (!match) return null;

  const rawName = match[1].trim();
  const sets = parseInt(match[2], 10);
  const repsRaw = match[3].trim().toLowerCase();
  const restRaw = match[4]?.trim();

  const isMaxReps = repsRaw === 'max' || repsRaw === 'cedimento';
  const reps = isMaxReps ? 0 : (parseInt(repsRaw, 10) || 10);
  const restSeconds = restRaw ? parseRestTimeString(restRaw, fallbackRest) : fallbackRest;

  return {
    matched: true,
    type: 'reps',
    name: cleanExerciseTitle(rawName),
    sets: Math.max(1, sets || 3),
    reps,
    duration_seconds: 0,
    rest_seconds: restSeconds,
    isMaxReps,
    rawInput: input,
    confidence: 'high',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNZIONE PRINCIPALE EXPORTATA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Funzione principale del parser inline.
 * Tenta in ordine gerarchico di riconoscere:
 *  1. EMOM
 *  2. Circuito
 *  3. Piramide
 *  4. Superset
 *  5. Isometria
 *  6. Singolo standard (reps)
 *
 * Se nessun pattern viene riconosciuto, restituisce un oggetto con `matched: false`,
 * preservando il testo inserito come `name` pulito e i default neutri.
 */
export function parseExerciseInput(rawInput: string, fallbackRest = 90): ParsedWorkoutItem {
  const trimmed = (rawInput || '').trim();

  if (!trimmed) {
    return {
      matched: false,
      type: 'reps',
      name: '',
      sets: 3,
      reps: 10,
      duration_seconds: 0,
      rest_seconds: fallbackRest,
      rawInput: '',
    };
  }

  // 1. EMOM
  const emomResult = tryParseEmom(trimmed, fallbackRest);
  if (emomResult) return emomResult;

  // 2. Circuito
  const circuitResult = tryParseCircuit(trimmed, fallbackRest);
  if (circuitResult) return circuitResult;

  // 3. Piramide
  const pyramidResult = tryParsePyramid(trimmed, fallbackRest);
  if (pyramidResult) return pyramidResult;

  // 4. Superset
  const supersetResult = tryParseSuperset(trimmed, fallbackRest);
  if (supersetResult) return supersetResult;

  // 5. Isometria
  const isometryResult = tryParseIsometry(trimmed, fallbackRest);
  if (isometryResult) return isometryResult;

  // 6. Singolo standard
  const standardResult = tryParseStandardReps(trimmed, fallbackRest);
  if (standardResult) return standardResult;

  // Fallback: non è stata riconosciuta alcuna sintassi inline
  return {
    matched: false,
    type: 'reps',
    name: trimmed,
    sets: 3,
    reps: 10,
    duration_seconds: 0,
    rest_seconds: fallbackRest,
    rawInput: trimmed,
  };
}
