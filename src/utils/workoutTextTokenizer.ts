/**
 * workoutTextTokenizer.ts — Motore di tokenizzazione e normalizzazione del parlato e OCR.
 *
 * Converte sia il parlato naturale in italiano (Web Speech API) sia il testo
 * multilinea estratto da scansioni ottiche (Tesseract OCR) in un array strutturato
 * di esercizi, riconoscendo automaticamente sia esercizi singoli che composti
 * (EMOM, Piramide, Superset, Circuito, Isometria).
 */

import { parseExerciseInput, type ParsedWorkoutItem } from './parseExerciseInput.ts';

// Mappatura numeri in lettere italiani in cifre arabe
const ITALIAN_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
  venti: 20,
  ventuno: 21,
  ventidue: 22,
  ventitre: 23,
  ventitré: 23,
  ventiquattro: 24,
  venticinque: 25,
  ventisei: 26,
  ventisette: 27,
  ventotto: 28,
  ventinove: 29,
  trenta: 30,
  trentacinque: 35,
  quaranta: 40,
  quarantacinque: 45,
  cinquanta: 50,
  cinquantacinque: 55,
  sessanta: 60,
  settanta: 70,
  ottanta: 80,
  novanta: 90,
  cento: 100,
  centoventi: 120,
  centocinquanta: 150,
  centottanta: 180,
};

/**
 * Normalizza il testo vocale in italiano convertendo parole numeriche in cifre,
 * normalizzando i tempi e identificando le congiunzioni per i complessi.
 */
export function normalizeItalianVoiceText(rawText: string): string {
  if (!rawText) return '';

  let text = rawText.toLowerCase();

  // 1. Normalizzazione espressioni di tempo composte e speciali
  text = text
    .replace(/\bun\s+minuto\s+e\s+(?:mezzo|trenta|30)\b/gi, '90s')
    .replace(/\b1\s*m\s*(?:e\s*)?(?:mezzo|30)\b/gi, '90s')
    .replace(/\bdue\s+minuti\s+e\s+(?:mezzo|trenta|30)\b/gi, '150s')
    .replace(/\bdue\s+minuti\b/gi, '120s')
    .replace(/\b2\s+minuti\b/gi, '120s')
    .replace(/\btre\s+minuti\b/gi, '180s')
    .replace(/\b3\s+minuti\b/gi, '180s')
    .replace(/\bun\s+minuto\b/gi, '60s')
    .replace(/\b1\s+minuto\b/gi, '60s')
    .replace(/\bmezzo\s+minuto\b/gi, '30s')
    .replace(/\bfino\s+al\s+cedimento\b/gi, 'max')
    .replace(/\bal\s+cedimento\b/gi, 'max')
    .replace(/\ba\s+cedimento\b/gi, 'max')
    .replace(/\bmassimo\s+ripetizioni\b/gi, 'max')
    .replace(/\bmassimale\b/gi, 'max');

  // 2. Sostituzione numeri in parole singole con cifre
  for (const [word, num] of Object.entries(ITALIAN_NUMBER_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    text = text.replace(regex, String(num));
  }

  // 3. Normalizzazione tempi di recupero e pause
  text = text
    .replace(/\b(?:recupero|pausa|riposo)\s+(\d+)\s*(?:secondi?|sec|s)\b/gi, '$1s')
    .replace(/\b(?:recupero|pausa|riposo)\s+(\d+)\s*(?:minuti?|min|m)\b/gi, '$1m')
    .replace(/\b(?:recupero|pausa|riposo)\s+(\d+s)\b/gi, '$1')
    .replace(/\b(?:recupero|pausa|riposo)\s+(\d+m)\b/gi, '$1')
    .replace(/\b(\d+)\s+secondi\b/gi, '$1s')
    .replace(/\b(\d+)\s+minuti\b/gi, '$1m');

  // 4. Normalizzazione isometrie parlate (es. "30s di plank" -> "30s plank")
  text = text.replace(/(\d+s)\s+di\s+/gi, '$1 ');

  // 5. Normalizzazione serie x reps parlate:
  // "4 serie da 8" -> "4x8"
  // "4 serie al cedimento" -> "4xMax"
  text = text
    .replace(/\b(\d+)\s*(?:serie|set)\s*(?:da|per|x|\*|\s+al\s+|\s+a\s+)?\s*(max|cedimento)\b/gi, '$1xMax')
    .replace(/\b(\d+)\s*(?:serie|set)\s*(?:da|per|x|\*)\s*(\d+)\b/gi, '$1x$2')
    .replace(/\b(\d+)\s*(?:serie|set)\s+e\s+(\d+|max)\b/gi, '$1x$2')
    .replace(/\b(\d+)\s+da\s+(\d+|max)\b/gi, '$1x$2');

  // 6. Normalizzazione superset parlati e congiunzione "più":
  text = text
    .replace(/\b(?:in\s+)?superset\s+con\b/gi, '+')
    .replace(/\b(?:in\s+)?super\s+set\s+con\b/gi, '+')
    .replace(/\bcon\s+in\s+superset\b/gi, '+')
    .replace(/(?:^|\s+)(?:più|piu)(?=\s+|$)/gi, ' + ');

  // Serie x reps dette in ordine inverso (es. "10 colpi 3 serie" -> "3x10") o rimozione colpi
  text = text.replace(/(\d+)\s*(?:colpi|ripetizioni|rip)?\s+(\d+)\s*(?:serie|set)\b/gi, '$2x$1');
  text = text.replace(/\b(\d+)\s*(?:colpi|ripetizioni|rip)\b/gi, '$1');

  // Riconoscimento comando vocale per tipologie complesse (es. "facciamo superset", "ora circuito")
  text = text.replace(/\b(?:facciamo|mettiamo|inserisci|ora|adesso)\s+(superset|circuito|emom|piramide)\b/gi, '$1');

  // 7. Normalizzazione header EMOM e Circuito parlati:
  text = text.replace(/\bemom\s+(\d+)\s*(?:round|giri|r|x)?\s*(?:da|di)?\s*(\d+s|\d+m)\b/gi, 'emom $1 round $2:');
  text = text.replace(/\bemom\s+(\d+)\s*(?:round|giri|r|x)?(?!\s*round|\s*\d+s|\s*:)\b/gi, 'emom $1 round:');
  text = text.replace(/\bcircuito\s+(\d+)\s*(?:giri|round|x)\s+(\d+s|\d+m)\b/gi, 'circuito $1 giri $2:');
  text = text.replace(/\bcircuito\s+(\d+)\s*(?:giri|round|x)?(?!\s*giri|\s*\d+s|\s*:)\b/gi, 'circuito $1 giri:');

  // 8. Normalizzazione sequenze piramidali parlate:
  text = text.replace(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\b/g, '$1-$2-$3-$4');
  text = text.replace(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\b/g, (match, a, b, c) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    const nc = parseInt(c, 10);
    if ((na > nb && nb > nc) || (na < nb && nb < nc)) {
      return `${a}-${b}-${c}`;
    }
    return match;
  });

  // 9. Normalizzazione congiunzioni interne per circuiti ed EMOM:
  if (/\b(?:circuito|circuit|emom|superset)\b/i.test(text)) {
    text = text.replace(/(\d+(?:x\d+|s)?\s+[a-z\s]+?)\s+e\s+(\d+)/gi, '$1 + $2');
  }

  // Rimuove filler iniziali parlati
  text = text.replace(/^(?:allora|facciamo|mettiamo|inserisci|ora|adesso)\s+/i, '');

  return text.trim();
}

/**
 * Tokenizza il testo del parlato continuo, suddividendolo in segmenti
 * basati sui separatori naturali della lingua italiana ("poi", "dopo", "prossimo", ecc.)
 */
export function splitSpokenWorkoutSegments(normalizedText: string): string[] {
  if (!normalizedText) return [];

  // Separatori vocali tipici tra esercizi
  const separatorRegex = /\b(?:e\s+poi|poi|dopo|prossimo(?:\s+esercizio)?|invece|a\s+seguire|successivo|quindi|ed\s+infine|infine|per\s+finire|in\s+conclusione)\b|[;\n]+/gi;

  const rawSegments = normalizedText.split(separatorRegex);

  return rawSegments
    .map(s => s.replace(/^(?:allora|facciamo|mettiamo|inserisci|ora|adesso|ed\s+infine|infine)\s+/i, '').trim())
    .filter(s => s.length > 2);
}

/**
 * Converte una stringa di parlato continuo in un array di ParsedWorkoutItem
 */
export function parseSpokenWorkout(spokenText: string, fallbackRest = 90, userId?: string): ParsedWorkoutItem[] {
  const normalized = normalizeItalianVoiceText(spokenText);
  const segments = splitSpokenWorkoutSegments(normalized);

  const results: ParsedWorkoutItem[] = [];

  for (const segment of segments) {
    const parsed = parseExerciseInput(segment, fallbackRest, userId);
    // Accetta sia elementi parsati con successo sia elementi con solo nome
    if (parsed.name.trim().length > 0) {
      results.push(parsed);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER MULTILINEA PER OCR (SCANSIONE IMMAGINI / TABELLE)
// ─────────────────────────────────────────────────────────────────────────────

// Parole di intestazione o rumore tipico dei fogli di allenamento da escludere
const OCR_NOISE_LINE_REGEX = /^(?:scheda.*|allenamento.*|programma.*|giorno\s+[a-z0-9]|day\s+[a-z0-9]|fase.*|settimana.*|workout.*|data[\s\:\.\-_0-9\/]+|date[\s\:\.\-_0-9\/]+|atleta.*|istruttore.*|palestra.*|gym.*|tabella.*|note\s+generali.*|riscaldamento.*|warm[\s\-]?up.*|cooldown.*|defaticamento.*|esercizio\s*\|\s*serie.*|exercise\s*\|\s*sets.*|reps\s*\|\s*rest.*)[\s\:\.\-_]*$/i;

// Regex per righe isolate che indicano solo recupero (es. "recupero 2 min", "rest 90s")
const OCR_STANDALONE_REST_REGEX = /^(?:recupero|riposo|rest|pausa)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?\s*(?:min|m|sec|s|\')?)$/i;

/**
 * Pulisce e filtra il testo grezzo estratto da Tesseract OCR,
 * raggruppa eventuali notazioni superset (es. A1 / A2, o elenchi puntati sotto circuito) e analizza riga per riga.
 */
export function parseOcrWorkoutLines(rawOcrText: string, fallbackRest = 90, userId?: string): ParsedWorkoutItem[] {
  if (!rawOcrText) return [];

  const rawLines = rawOcrText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const cleanLines: string[] = [];
  let currentCompoundGroup: { type: 'superset' | 'circuit'; header: string; items: string[] } | null = null;
  let currentSupersetPairGroup: { code: string; lines: string[] } | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Ignora intestazioni spazzatura e righe data pura
    if (OCR_NOISE_LINE_REGEX.test(line) || /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(line)) {
      continue;
    }

    // Gestione righe recupero isolate (es. "recupero 2 min", "rest 60s")
    const standaloneRestMatch = line.match(OCR_STANDALONE_REST_REGEX);
    if (standaloneRestMatch) {
      const restToken = standaloneRestMatch[1];
      if (cleanLines.length > 0) {
        cleanLines[cleanLines.length - 1] = `${cleanLines[cleanLines.length - 1]} ${restToken}`;
      }
      continue;
    }

    // Riconoscimento notazione Superset tipo "A1. Panca piana 4x8" e "A2. Croci manubri 4x12"
    const supersetPairMatch = line.match(/^([A-Z])([1-9])[\.\:\)\-\s]+(.+)$/i);
    if (supersetPairMatch) {
      const groupCode = supersetPairMatch[1].toUpperCase();
      let exerciseContent = supersetPairMatch[3].trim();
      if (exerciseContent.includes('|')) {
        exerciseContent = exerciseContent.split('|').map(c => c.trim()).filter(c => c.length > 0).join(' ');
      }

      if (currentSupersetPairGroup && currentSupersetPairGroup.code === groupCode) {
        currentSupersetPairGroup.lines.push(exerciseContent);
        continue;
      } else {
        if (currentSupersetPairGroup && currentSupersetPairGroup.lines.length >= 2) {
          cleanLines.push(`superset: ${currentSupersetPairGroup.lines.join(' + ')}`);
        } else if (currentSupersetPairGroup) {
          cleanLines.push(...currentSupersetPairGroup.lines);
        }
        currentSupersetPairGroup = { code: groupCode, lines: [exerciseContent] };
        continue;
      }
    } else if (currentSupersetPairGroup) {
      if (currentSupersetPairGroup.lines.length >= 2) {
        cleanLines.push(`superset: ${currentSupersetPairGroup.lines.join(' + ')}`);
      } else {
        cleanLines.push(...currentSupersetPairGroup.lines);
      }
      currentSupersetPairGroup = null;
    }

    // Gestione righe bullet o elenco sotto un circuito o superset
    const isBulletItem = /^[-•*]\s*(.+)$/.test(line);
    if (isBulletItem && currentCompoundGroup) {
      const bulletContent = line.replace(/^[-•*]\s*/, '').trim();
      currentCompoundGroup.items.push(bulletContent);
      continue;
    } else if (currentCompoundGroup) {
      // Se non è più un bullet, chiudiamo il gruppo compound
      if (currentCompoundGroup.items.length > 0) {
        cleanLines.push(`${currentCompoundGroup.header} ${currentCompoundGroup.items.join(' + ')}`);
      } else {
        cleanLines.push(currentCompoundGroup.header);
      }
      currentCompoundGroup = null;
    }

    // Controllo se questa riga apre un compound group (es. "Circuito 3 rounds:" o "Superset 4x:")
    const compoundHeaderMatch = line.match(/^(?:\d+[\.\)\-\:\s]+\s*)?((?:circuito|circuit|superset)\b[^:]*[:\-]?)$/i);
    if (compoundHeaderMatch && i + 1 < rawLines.length && /^[-•*]/.test(rawLines[i + 1])) {
      const isCirc = /circuit/i.test(compoundHeaderMatch[1]);
      currentCompoundGroup = {
        type: isCirc ? 'circuit' : 'superset',
        header: compoundHeaderMatch[1].endsWith(':') ? compoundHeaderMatch[1] : `${compoundHeaderMatch[1]}:`,
        items: [],
      };
      continue;
    }

    // Gestione colonne divise da pipe "|", slash o tabulazione
    let formattedLine = line;
    if (formattedLine.includes('|')) {
      const cols = formattedLine.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cols.length >= 2) {
        // Se la riga ha formato tabellare: [Nome] | [Sets] | [Reps] ... (es: "Panca piana | 4 | 8 | 90s")
        if (cols.length >= 3 && /^\d+$/.test(cols[1]) && /^(\d+|max|cedimento)$/i.test(cols[2])) {
          formattedLine = `${cols[0]} ${cols[1]}x${cols[2]} ${cols.slice(3).join(' ')}`;
        } else {
          // es: "Panca piana | 4x8 | 90s" -> "Panca piana 4x8 90s"
          formattedLine = cols.join(' ');
        }
      }
    }

    // Rimuove numeri ordinali a inizio riga (es. "1. Squat", "2) Stacco", "3 - Panca")
    formattedLine = formattedLine.replace(/^\d+[\.\)\-\:\s]+\s*/, '');

    // Se la riga è un bullet generico isolato
    if (/^[-•*]\s*/.test(formattedLine)) {
      formattedLine = formattedLine.replace(/^[-•*]\s*/, '');
    }

    if (formattedLine.trim().length >= 2) {
      cleanLines.push(formattedLine.trim());
    }
  }

  // Chiusura eventuali gruppi pendenti in fondo
  if (currentCompoundGroup) {
    if (currentCompoundGroup.items.length > 0) {
      cleanLines.push(`${currentCompoundGroup.header} ${currentCompoundGroup.items.join(' + ')}`);
    } else {
      cleanLines.push(currentCompoundGroup.header);
    }
  }

  if (currentSupersetPairGroup) {
    if (currentSupersetPairGroup.lines.length >= 2) {
      cleanLines.push(`superset: ${currentSupersetPairGroup.lines.join(' + ')}`);
    } else {
      cleanLines.push(...currentSupersetPairGroup.lines);
    }
  }

  const results: ParsedWorkoutItem[] = [];

  for (const line of cleanLines) {
    const parsed = parseExerciseInput(line, fallbackRest, userId);
    if (parsed.name.trim().length > 0) {
      results.push(parsed);
    }
  }

  return results;
}
