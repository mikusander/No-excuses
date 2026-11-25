/**
 * periodicReportEngine.ts — Motore di calcolo analitico, aggregazione delle metriche,
 * ripartizione per gruppi muscolari, dossier sintetico delle note per esercizio
 * e separazione netta tra Macro Dashboard (Salute, Tempo, Hard Sets) e Micro Dettaglio (TUT, Sovraccarico, PR).
 */

import { matchExercise, calculateStringSimilarity, type MuscleGroup } from './exerciseClassifier';
import { toSnapshotExercises, type UiExercise } from '../lib/workoutSchemaAdapter';

export { toSnapshotExercises };

export type ReportPeriodType = 'week' | 'month' | 'quarter' | 'semester' | 'year' | 'custom';

export interface CustomDateRange {
  startDate: string | Date;
  endDate: string | Date;
}

export interface ReportPeriodInfo {
  type: ReportPeriodType;
  label: string;
  days: number;
  startDate: Date;
  endDate: Date;
}

export interface RawWorkoutSession {
  id: string;
  workoutName: string;
  executedAt: string;
  totalDurationSeconds?: number | null;
  exercises: UiExercise[];
  notes: Array<{
    text: string;
    createdAt?: string;
  }>;
}

const toSafeNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const isCardioExercise = (_name: string, type?: string): boolean => {
  return String(type || '').toLowerCase() === 'cardio';
};

/**
 * Rileva in modo intelligente se un esercizio è una tenuta isometrica o skill di calisthenics
 * (es. planche, front lever, human flag, hollow body, l-sit, plank, ecc.)
 */
export const isIsometricExercise = (
  name: string,
  type?: string,
  durationSeconds?: number,
  reps?: number
): boolean => {
  const normalizedType = String(type || '').toLowerCase();
  if (normalizedType === 'cardio') return false;
  if (normalizedType === 'isometry') return true;
  // Un esercizio esplicitamente 'reps' con ripetizioni > 0 (es. "Planche Push Up", "Front Lever Pull") è dinamico, non isometrico
  if (normalizedType === 'reps' && reps != null && reps > 0) return false;
  if (durationSeconds && durationSeconds > 0 && (!reps || reps <= 1)) return true;

  const normalized = (name || '').toLowerCase();
  const isometricKeywords = [
    'planche',
    'front lever',
    'back lever',
    'human flag',
    'bandiera',
    'hollow body',
    'hollow hold',
    'hollow rock',
    'arch body',
    'superman hold',
    'l-sit',
    'v-sit',
    'manna',
    'plank',
    'side plank',
    'wall sit',
    'dead hang',
    'active hang',
    'sospensione',
    'isometria',
    'isometric',
    'hold',
    'tenuta',
  ];

  return isometricKeywords.some((kw) => normalized.includes(kw));
};

/**
 * Formatta i secondi in durata leggibile (ore/minuti o minuti)
 */
export const formatDurationHuman = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
};

/**
 * Formatta i secondi di TUT in minuti e secondi (es. 240s -> 4m 00s, 45s -> 45s)
 */
export const formatTUTHold = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
};

export interface MuscleGroupSummary {
  group: MuscleGroup;
  volumeKg: number;
  volumePercent: number;
  setsCount: number;
  setsPercent: number;
  repsCount: number;
  exerciseCount: number;
  topExercises: Array<{
    displayName: string;
    volumeKg: number;
    sets: number;
    reps: number;
    durationSeconds?: number;
  }>;
}

// ─── MODELLO DOMINIO ANALITICO MACRO & MICRO ─────────────────────────

export interface ExerciseHistoryPoint {
  date: string;
  formattedDate: string;
  workoutName: string;
  reps: number;
  durationSeconds: number;
  sets: number;
  weightKg: number;
  estimated1RMKg?: number;
  metricValue: number;
  metricLabel: string;
}

export interface PersonalRecordInfo {
  type: 'isometric_tut' | 'weight_load' | 'reps_volume' | 'cardio_time';
  value: number;
  formatted: string;
  details?: string;
  estimated1RMKg?: number;
}

export interface WeeklyProgressionDelta {
  percentChange: number | null;
  direction: 'up' | 'down' | 'stable' | 'new';
  comparisonLabel: string;
}

export interface MicroExerciseDetail {
  canonicalId: string;
  displayName: string;
  muscleGroup: MuscleGroup;
  isCanonical: boolean;
  isIsometric: boolean;
  isCardio?: boolean;

  // Volume specifico
  totalReps: number;
  totalDurationSeconds: number; // TUT in secondi
  formattedTUT: string;
  totalVolumeKg: number; // Tonnellaggio
  averageWeightKg: number;
  totalSets: number; // Hard sets per questo esercizio
  totalHardSets: number;
  sessionsCount: number;

  // Personal Record
  pr: PersonalRecordInfo;

  // Progressione
  progression: WeeklyProgressionDelta;
  trend: 'up' | 'down' | 'stable' | 'new';
  percentChange: number | null;

  // Punti storici per grafico SVG
  historyPoints: ExerciseHistoryPoint[];
  dates: string[];
}

export type ExerciseReportItem = MicroExerciseDetail;

export interface MacroDashboardStats {
  totalDurationSeconds: number;
  formattedTotalDuration: string;
  averageDurationSeconds: number;
  formattedAverageDuration: string;
  totalCompletedSessions: number;
  weeklyFrequency: number;
  totalHardSets: number;
  averageHardSetsPerSession: number;
}

export interface CategorizedNoteEntry {
  date: string;
  formattedDate: string;
  workoutName: string;
  text: string;
  categories: Array<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale'>;
}

export interface ExerciseNotesDossier {
  canonicalId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  totalNotes: number;
  chronologicalNotes: CategorizedNoteEntry[];
  dominantThemes: Array<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale'>;
  writtenSynthesis: string;
}

export interface PeriodicReportResult {
  period: ReportPeriodInfo;
  macro: MacroDashboardStats;
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  totalWorkouts: number;
  averageVolumePerWorkout: number;
  averageSetsPerWorkout: number;
  muscleGroups: MuscleGroupSummary[];
  exercises: MicroExerciseDetail[];
  notesDossiers: ExerciseNotesDossier[];
  allNotesCount: number;
}

/**
 * Calcola l'intervallo temporale in base al periodo selezionato.
 */
export const parseSafeDate = (dateVal: unknown): Date | null => {
  if (!dateVal) return null;
  if (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())) return dateVal;
  const str = String(dateVal).trim();
  if (!str) return null;
  // Date-only 'YYYY-MM-DD' deve essere interpretata come mezzanotte locale (non UTC, che shiftava di 1 giorno a ovest)
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month - 1, day);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }
  // Sostituisce lo spazio con 'T' per compatibilità con il parser Date di iOS WebKit/Safari
  const isoStr = str.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
  const d = new Date(isoStr);
  if (!Number.isNaN(d.getTime())) return d;
  const fallback = new Date(str);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

export const formatSafeDate = (dateVal: unknown): string => {
  const d = parseSafeDate(dateVal);
  if (!d) return typeof dateVal === 'string' ? dateVal : '';
  try {
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return d.toISOString().split('T')[0];
  }
};

export const formatShortDate = (dateVal: unknown): string => {
  const d = parseSafeDate(dateVal);
  if (!d) return '';
  try {
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  } catch {
    return d.toISOString().split('T')[0];
  }
};

const GENERAL_SESSION_NOTE_TAGS = new Set([
  'scheda',
  'generale',
  'general',
  'workout',
  'sessione',
  'note generali',
]);

export const getPeriodInfo = (
  periodType: ReportPeriodType,
  customRange?: CustomDateRange
): ReportPeriodInfo => {
  const now = new Date();
  const endDate = new Date(now);
  let days = 30;
  let label = 'Ultimi 30 Giorni (Mensile)';

  if (periodType === 'custom') {
    const rawStart = customRange?.startDate ? parseSafeDate(customRange.startDate) : null;
    const rawEnd = customRange?.endDate ? parseSafeDate(customRange.endDate) : null;

    const defaultStart = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    const parsedStart = rawStart || defaultStart;
    const parsedEnd = rawEnd || now;

    const validStart = parsedStart <= parsedEnd ? parsedStart : parsedEnd;
    const validEnd = parsedStart <= parsedEnd ? parsedEnd : parsedStart;

    const startDate = new Date(validStart);
    startDate.setHours(0, 0, 0, 0);

    const adjustedEndDate = new Date(validEnd);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const diffMs = Math.max(0, adjustedEndDate.getTime() - startDate.getTime());
    days = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));

    const startStr = formatSafeDate(startDate);
    const endStr = formatSafeDate(adjustedEndDate);
    label = `Dal ${startStr} al ${endStr} (${days} ${days === 1 ? 'giorno' : 'giorni'})`;

    return {
      type: 'custom',
      label,
      days,
      startDate,
      endDate: adjustedEndDate,
    };
  }

  switch (periodType) {
    case 'week':
      days = 7;
      label = 'Ultimi 7 Giorni (Settimanale)';
      break;
    case 'month':
      days = 30;
      label = 'Ultimi 30 Giorni (Mensile)';
      break;
    case 'quarter':
      days = 90;
      label = 'Ultimi 3 Mesi (Trimestrale)';
      break;
    case 'semester':
      days = 180;
      label = 'Ultimi 6 Mesi (Semestrale)';
      break;
    case 'year':
      days = 365;
      label = 'Ultimo Anno (Annuale)';
      break;
  }

  const startDate = new Date(now.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);

  return {
    type: periodType,
    label,
    days,
    startDate,
    endDate,
  };
};

/**
 * Estrae il nome dell'esercizio e il testo pulito da una nota memorizzata nel DB.
 */
export const parseNoteContext = (rawText: unknown): { exerciseName: string | null; body: string } => {
  if (rawText == null) return { exerciseName: null, body: '' };
  const str = typeof rawText === 'string' ? rawText : String(rawText);
  const trimmed = str.trim();
  if (!trimmed) return { exerciseName: null, body: '' };

  const match = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
  if (!match) {
    return { exerciseName: null, body: trimmed };
  }

  const tag = match[1].trim();
  const body = match[2].trim();

  const nameWithoutPrefix = tag.replace(/^\d+[\.\)]\s*/, '').trim();
  const normalizedTag = nameWithoutPrefix.toLowerCase();
  if (!nameWithoutPrefix || GENERAL_SESSION_NOTE_TAGS.has(normalizedTag)) {
    return {
      exerciseName: null,
      body,
    };
  }

  return {
    exerciseName: nameWithoutPrefix,
    body,
  };
};

/**
 * Categorizza tematicamente il testo di una nota usando parole chiave.
 */
export const categorizeNoteText = (text: unknown): Array<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale'> => {
  if (text == null) return ['Generale'];
  const lower = (typeof text === 'string' ? text : String(text)).toLowerCase();
  const categories: Array<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale'> = [];

  if (/aument|caric|peso|pr|facile|legger|kg|chius|miglior|record|progred/.test(lower)) {
    categories.push('Progresso');
  }
  if (/fatic|cediment|dur|pesant|rpe|brucior|stanc|difficil|sfin|moll/.test(lower)) {
    categories.push('Fatica');
  }
  if (/dolor|fastidi|male|infiammaz|tendin|articolaz|spalla|gomito|polso|ginocchi|schiena|fitt/.test(lower)) {
    categories.push('Fastidio');
  }
  if (/tecnic|presa|posizion|rom|arco|assett|setup|bilancier|manubr|cavo|traiettori/.test(lower)) {
    categories.push('Tecnica');
  }

  if (categories.length === 0) {
    categories.push('Generale');
  }

  return categories;
};

/**
 * Genera una sintesi testuale narrativa italiana per un dossier di note su un determinato esercizio.
 */
const composeExerciseNotesNarrative = (
  exerciseName: string,
  notes: CategorizedNoteEntry[],
  dominantThemes: Array<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale'>
): string => {
  if (notes.length === 0) {
    return `Nessuna osservazione registrata per ${exerciseName} in questo periodo.`;
  }

  const count = notes.length;
  const noteWord = count === 1 ? '1 osservazione' : `${count} osservazioni`;

  const highlights: string[] = [];

  if (dominantThemes.includes('Progresso')) {
    highlights.push('un incremento dei carichi o un miglioramento della facilità esecutiva');
  }
  if (dominantThemes.includes('Fastidio')) {
    highlights.push('la segnalazione di fastidi articolari o punti di attenzione fisica da monitorare');
  }
  if (dominantThemes.includes('Fatica')) {
    highlights.push('un elevato impegno muscolare con raggiungimento del cedimento o sensazione di lavoro pesante');
  }
  if (dominantThemes.includes('Tecnica')) {
    highlights.push('accorgimenti su assetto, presa o traiettoria del movimento');
  }

  let narrative = `Nel periodo selezionato hai registrato ${noteWord} su ${exerciseName}. `;

  if (highlights.length > 0) {
    narrative += `Nelle tue note emerge principalmente ${highlights.join(', con ')}. `;
  } else {
    narrative += `Le note registrano sensazioni generali di tenuta e ritmo delle serie. `;
  }

  const latestNote = notes[notes.length - 1];
  if (latestNote && latestNote.text) {
    const preview = latestNote.text.length > 90 ? `${latestNote.text.slice(0, 90)}...` : latestNote.text;
    narrative += `Ultima annotazione del ${latestNote.formattedDate}: "${preview}"`;
  }

  return narrative;
};

export interface UnpackedExerciseItem {
  name: string;
  sets: number;
  reps: number;
  weightKg: number;
  durationSeconds: number;
  volumeKg: number;
  parentType?: string;
  isIsometric: boolean;
  isCardio?: boolean;
  repsPerSet: number;
  durationPerSet: number;
  maxRepsInSingleSet?: number;
  maxHoldInSingleSet?: number;
  estimated1RMKg?: number;
  weightedSetsCount?: number;
  weightedSumKg?: number;
}

const computeEpley1RM = (weightKg: number, reps: number): number => {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
};

/**
 * Spacchetta un esercizio complesso (EMOM, Circuito, Superset, Piramidale) nei suoi sotto-esercizi effettivi,
 * distinguendo accuratamente movimenti dinamici, isometrici, MAX e cardio.
 */
export const unpackExercise = (rawEx: UiExercise): UnpackedExerciseItem[] => {
  if (!rawEx || typeof rawEx !== 'object') {
    return [];
  }

  const isComplex =
    rawEx.type === 'emom' ||
    rawEx.type === 'circuit' ||
    rawEx.type === 'superset' ||
    rawEx.group_category === 'circuit' ||
    rawEx.group_category === 'superset' ||
    (Array.isArray(rawEx.subExercises) && rawEx.subExercises.length > 0);

  // Blocco composto con sub-esercizi definiti
  if (isComplex && Array.isArray(rawEx.subExercises) && rawEx.subExercises.length > 0) {
    const parentSets =
      rawEx.type === 'emom'
        ? Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1))) *
          Math.max(1, Math.trunc(toSafeNumber(rawEx.emom_rounds, 1)))
        : Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1)));

    const validSubs = (rawEx.subExercises as Array<unknown>).filter(
      (sub): sub is Record<string, unknown> => Boolean(sub && typeof sub === 'object')
    );

    if (validSubs.length > 0) {
      return validSubs.map((sub) => {
        const subName = String(sub.name || rawEx.name || 'Esercizio');
        const subTypeStr = String(sub.type || '');
        const rawDuration = Math.max(0, Math.trunc(toSafeNumber(sub.duration_seconds, 0)));
        const rawReps = Math.max(0, Math.trunc(toSafeNumber(sub.reps, 0)));
        const subIsCardio = isCardioExercise(subName, subTypeStr);
        const isIso = !subIsCardio && isIsometricExercise(subName, subTypeStr, rawDuration, rawReps);
        const isTimeBased = isIso || subIsCardio;

        const subReps = isTimeBased ? 0 : rawReps;
        const totalRepsForSub = subReps * parentSets;
        const rawWeight =
          sub.weight_kg != null && String(sub.weight_kg).trim() !== ''
            ? Number(sub.weight_kg)
            : NaN;
        const subWeight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
        const durationPerSet = isTimeBased ? rawDuration : 0;
        const subDuration = durationPerSet * parentSets;
        const volumeKg = !isTimeBased ? Math.round(totalRepsForSub * subWeight * 100) / 100 : 0;
        const e1rm = !isTimeBased ? computeEpley1RM(subWeight, subReps) : 0;

        return {
          name: subName,
          sets: parentSets,
          reps: totalRepsForSub,
          weightKg: subWeight,
          durationSeconds: subDuration,
          volumeKg,
          parentType: rawEx.type,
          isIsometric: isIso,
          isCardio: subIsCardio,
          repsPerSet: subReps,
          durationPerSet,
          maxRepsInSingleSet: subReps,
          maxHoldInSingleSet: durationPerSet,
          estimated1RMKg: e1rm,
          weightedSetsCount: subWeight > 0 ? parentSets : 0,
          weightedSumKg: subWeight > 0 ? subWeight * parentSets : 0,
        };
      });
    }
  }

  // Blocco piramidale
  if (rawEx.type === 'pyramid' && Array.isArray(rawEx.pyramid_steps) && rawEx.pyramid_steps.length > 0) {
    const validSteps = (rawEx.pyramid_steps as Array<unknown>).filter(
      (step): step is Record<string, unknown> => Boolean(step && typeof step === 'object')
    );

    if (validSteps.length > 0) {
      let totalReps = 0;
      let totalVolume = 0;
      let maxWeight = 0;
      let maxStepReps = 0;
      let bestE1rm = 0;
      let weightedStepsCount = 0;
      let weightedStepsSum = 0;

      validSteps.forEach((step) => {
        const stepReps = Math.max(0, Math.trunc(toSafeNumber(step.reps, 0)));
        const rawW =
          step.weight_kg != null && String(step.weight_kg).trim() !== ''
            ? Number(step.weight_kg)
            : NaN;
        const w = Number.isFinite(rawW) ? Math.max(0, rawW) : 0;
        totalReps += stepReps;
        totalVolume += stepReps * w;
        maxWeight = Math.max(maxWeight, w);
        maxStepReps = Math.max(maxStepReps, stepReps);
        if (w > 0) {
          weightedStepsCount += 1;
          weightedStepsSum += w;
          bestE1rm = Math.max(bestE1rm, computeEpley1RM(w, stepReps));
        }
      });

      return [
        {
          name: String(rawEx.name || 'Esercizio Piramidale'),
          sets: validSteps.length,
          reps: totalReps,
          weightKg: maxWeight,
          durationSeconds: 0,
          volumeKg: Math.round(totalVolume * 100) / 100,
          parentType: 'pyramid',
          isIsometric: false,
          isCardio: false,
          repsPerSet: maxStepReps,
          durationPerSet: 0,
          maxRepsInSingleSet: maxStepReps,
          maxHoldInSingleSet: 0,
          estimated1RMKg: bestE1rm,
          weightedSetsCount,
          weightedSumKg: weightedStepsSum,
        },
      ];
    }
  }

  // Esercizio standard (reps, isometria o cardio)
  const exName = String(rawEx.name || 'Esercizio');
  const plannedSets = Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1)));
  const rawDuration = Math.max(0, Math.trunc(toSafeNumber(rawEx.duration_seconds, 0)));
  const rawReps = Math.max(0, Math.trunc(toSafeNumber(rawEx.reps, 0)));
  const isCardio = isCardioExercise(exName, rawEx.type);
  const isIso = !isCardio && isIsometricExercise(exName, rawEx.type, rawDuration, rawReps);
  const isTimeBased = isCardio || isIso;

  const completedRecords = Array.isArray(rawEx.completed_sets_records)
    ? rawEx.completed_sets_records
    : Array.isArray(rawEx.completed_sets_reps)
      ? rawEx.completed_sets_reps
      : null;

  const rawWeight =
    rawEx.weight_kg != null && String(rawEx.weight_kg).trim() !== ''
      ? Number(rawEx.weight_kg)
      : NaN;
  const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;

  let sets = plannedSets;
  let repsPerSet = isTimeBased ? 0 : rawReps;
  let totalReps = sets * repsPerSet;
  let durationPerSet = isTimeBased ? rawDuration : 0;
  let duration = durationPerSet * sets;
  let maxRepsInSingleSet = repsPerSet;
  let maxHoldInSingleSet = durationPerSet;

  if (completedRecords && completedRecords.length > 0) {
    const validNumbers = completedRecords
      .filter(
        (v): v is number =>
          v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0
      )
      .map(Number);

    if (validNumbers.length > 0) {
      sets = validNumbers.length;
      if (isTimeBased) {
        duration = validNumbers.reduce((a, b) => a + b, 0);
        maxHoldInSingleSet = Math.max(...validNumbers);
        durationPerSet = Math.round(duration / validNumbers.length);
      } else {
        totalReps = validNumbers.reduce((a, b) => a + b, 0);
        maxRepsInSingleSet = Math.max(...validNumbers);
        repsPerSet = Math.round(totalReps / validNumbers.length);
      }
    }
  }

  const volumeKg = !isTimeBased ? Math.round(totalReps * weight * 100) / 100 : 0;
  const e1rm = !isTimeBased ? computeEpley1RM(weight, maxRepsInSingleSet) : 0;

  return [
    {
      name: exName,
      sets,
      reps: totalReps,
      weightKg: weight,
      durationSeconds: duration,
      volumeKg,
      parentType: rawEx.type,
      isIsometric: isIso,
      isCardio,
      repsPerSet,
      durationPerSet,
      maxRepsInSingleSet,
      maxHoldInSingleSet,
      estimated1RMKg: e1rm,
      weightedSetsCount: weight > 0 ? sets : 0,
      weightedSumKg: weight > 0 ? weight * sets : 0,
    },
  ];
};

/**
 * Calcola il volume (kg) e le serie complessive di un esercizio o blocco (backward compatibility).
 */
export const computeExerciseMetrics = (ex: UiExercise): { volumeKg: number; sets: number; reps: number; maxWeightKg: number } => {
  const items = unpackExercise(ex);
  let volumeKg = 0;
  let sets = 0;
  let reps = 0;
  let maxWeightKg = 0;

  items.forEach((item) => {
    volumeKg += item.volumeKg;
    sets += item.sets;
    reps += item.reps;
    maxWeightKg = Math.max(maxWeightKg, item.weightKg);
  });

  return {
    volumeKg: Math.round(volumeKg * 100) / 100,
    sets,
    reps,
    maxWeightKg,
  };
};

/**
 * Fornisce un report vuoto ma coerente per stati iniziali o fallback da errore.
 */
export const getEmptyReport = (
  periodType: ReportPeriodType,
  customRange?: CustomDateRange
): PeriodicReportResult => {
  const period = getPeriodInfo(periodType, customRange);
  const ALL_GROUPS: MuscleGroup[] = ['Petto', 'Dorso', 'Gambe', 'Spalle', 'Braccia', 'Addome', 'Altro'];
  return {
    period,
    macro: {
      totalDurationSeconds: 0,
      formattedTotalDuration: '0m',
      averageDurationSeconds: 0,
      formattedAverageDuration: '0m',
      totalCompletedSessions: 0,
      weeklyFrequency: 0,
      totalHardSets: 0,
      averageHardSetsPerSession: 0,
    },
    totalVolumeKg: 0,
    totalSets: 0,
    totalReps: 0,
    totalWorkouts: 0,
    averageVolumePerWorkout: 0,
    averageSetsPerWorkout: 0,
    muscleGroups: ALL_GROUPS.map((g) => ({
      group: g,
      volumeKg: 0,
      volumePercent: 0,
      setsCount: 0,
      setsPercent: 0,
      repsCount: 0,
      exerciseCount: 0,
      topExercises: [],
    })),
    exercises: [],
    notesDossiers: [],
    allNotesCount: 0,
  };
};

/**
 * Motore Principale: Genera il Report Periodico Completo con separazione Macro e Micro.
 */
export const generatePeriodicReport = (
  workouts: RawWorkoutSession[],
  periodType: ReportPeriodType,
  customRange?: CustomDateRange
): PeriodicReportResult => {
  const period = getPeriodInfo(periodType, customRange);

  // Filtra le sessioni comprese nell'intervallo temporale
  const inRangeWorkouts = (workouts || []).filter((w) => {
    if (!w || typeof w !== 'object' || !w.executedAt) return false;
    const date = parseSafeDate(w.executedAt);
    return date !== null && date >= period.startDate && date <= period.endDate;
  });

  // Ordina cronologicamente le sessioni (dalla più vecchia alla più recente)
  inRangeWorkouts.sort((a, b) => {
    const timeA = parseSafeDate(a?.executedAt)?.getTime() || 0;
    const timeB = parseSafeDate(b?.executedAt)?.getTime() || 0;
    return timeA - timeB;
  });

  // Calcolo tempo complessivo effettivo o stimato per ciascuna sessione
  let totalDurationSeconds = 0;
  inRangeWorkouts.forEach((session) => {
    if (session.totalDurationSeconds != null && session.totalDurationSeconds > 0) {
      totalDurationSeconds += session.totalDurationSeconds;
    } else {
      let estimated = 0;
      (session.exercises || []).forEach((ex) => {
        const items = unpackExercise(ex);
        items.forEach((item) => {
          if (item.isIsometric || item.isCardio) {
            estimated += item.durationSeconds + item.sets * 45;
          } else {
            estimated += item.reps * 3 + item.sets * 60;
          }
        });
      });
      totalDurationSeconds += estimated > 0 ? estimated : 0;
    }
  });

  const averageDurationSeconds = inRangeWorkouts.length > 0 ? Math.round(totalDurationSeconds / inRangeWorkouts.length) : 0;
  const weeksInRange = Math.max(1, period.days / 7);
  const weeklyFrequency = Math.round((inRangeWorkouts.length / weeksInRange) * 10) / 10;

  let totalHardSets = 0;
  let totalVolumeKg = 0;
  let totalRepsAll = 0;

  // Strutture di aggregazione per Gruppi Muscolari
  const muscleMap = new Map<MuscleGroup, {
    volumeKg: number;
    setsCount: number;
    repsCount: number;
    exerciseSet: Set<string>;
    exerciseVolumes: Map<string, { displayName: string; volumeKg: number; sets: number; reps: number; durationSeconds: number }>;
  }>();

  const ALL_GROUPS: MuscleGroup[] = ['Petto', 'Dorso', 'Gambe', 'Spalle', 'Braccia', 'Addome', 'Altro'];
  ALL_GROUPS.forEach((g) => {
    muscleMap.set(g, {
      volumeKg: 0,
      setsCount: 0,
      repsCount: 0,
      exerciseSet: new Set(),
      exerciseVolumes: new Map(),
    });
  });

  interface ExerciseAggregator {
    canonicalId: string;
    displayName: string;
    muscleGroup: MuscleGroup;
    isCanonical: boolean;
    isoSetsCount: number;
    repsSetsCount: number;
    cardioSetsCount: number;
    totalVolumeKg: number;
    totalSets: number;
    totalReps: number;
    totalDurationSeconds: number;
    maxWeightKg: number;
    maxHoldSeconds: number;
    maxRepsPerSet: number;
    maxEstimated1RMKg: number;
    weightedSetsCount: number;
    sumWeightsForAverage: number;
    sessionsCount: number;
    sessionHistory: Map<string, {
      date: string;
      formattedDate: string;
      workoutName: string;
      reps: number;
      durationSeconds: number;
      sets: number;
      weightKg: number;
      estimated1RMKg: number;
    }>;
    dates: Set<string>;
  }

  const exerciseMap = new Map<string, ExerciseAggregator>();

  // Mappa per le note raggruppate per esercizio canonico
  const notesByCanonicalExercise = new Map<string, {
    canonicalId: string;
    exerciseName: string;
    muscleGroup: MuscleGroup;
    notes: CategorizedNoteEntry[];
  }>();

  let allNotesCount = 0;

  // Itera su ogni sessione di allenamento nel periodo
  inRangeWorkouts.forEach((session) => {
    const sessionDateStr = formatSafeDate(session.executedAt);
    const shortDateStr = formatShortDate(session.executedAt);

    // Traccia gli esercizi già incontrati in questa singola sessione per il conteggio sessioni
    const exercisesInThisSession = new Set<string>();

    // Calcolo gruppo dominante contestuale della sessione
    const sessionGroupCounts = new Map<MuscleGroup, number>();
    (session.exercises || []).forEach((rawEx) => {
      const items = unpackExercise(rawEx);
      items.forEach((item) => {
        if (!item || !item.name || item.isCardio) return;
        const prelim = matchExercise(item.name);
        if (prelim.muscleGroup !== 'Altro') {
          sessionGroupCounts.set(prelim.muscleGroup, (sessionGroupCounts.get(prelim.muscleGroup) || 0) + 1);
        }
      });
    });

    let sessionDominantGroup: MuscleGroup | undefined = undefined;
    let maxGroupCount = 0;
    for (const [grp, count] of sessionGroupCounts.entries()) {
      if (count > maxGroupCount) {
        maxGroupCount = count;
        sessionDominantGroup = grp;
      }
    }

    (session.exercises || []).forEach((rawEx) => {
      const items = unpackExercise(rawEx);

      items.forEach((item) => {
        if (!item) return;
        const isCardio = Boolean(item.isCardio);
        const isIso = !isCardio && Boolean(item.isIsometric);
        const classified = isCardio
          ? {
              id: `cardio_${item.name.toLowerCase().replace(/\s+/g, '_') || 'sessione'}`,
              displayName: item.name || 'Cardio',
              muscleGroup: 'Altro' as MuscleGroup,
              isCanonical: false,
            }
          : matchExercise(item.name, sessionDominantGroup);
        const itemReps = Math.max(0, Number(item.reps) || 0);
        const itemWeight = Math.max(0, Number(item.weightKg) || 0);
        const itemVolumeKg = Math.max(0, Number(item.volumeKg) || 0);
        const itemSets = Math.max(1, Number(item.sets) || 1);
        const itemDuration = Math.max(0, Number(item.durationSeconds) || 0);

        totalVolumeKg += itemVolumeKg;
        if (!isCardio) {
          totalHardSets += itemSets;
        }
        totalRepsAll += itemReps;

        let targetId = classified.id;
        let targetDisplayName = classified.displayName;
        let targetGroup = classified.muscleGroup;

        // Auto-clustering custom exercises
        if (!classified.isCanonical) {
          for (const existing of exerciseMap.values()) {
            if (!existing.isCanonical) {
              const sim = calculateStringSimilarity(existing.displayName, classified.displayName);
              if (sim >= 0.82) {
                targetId = existing.canonicalId;
                targetDisplayName = existing.displayName;
                if (existing.muscleGroup === 'Altro' && targetGroup !== 'Altro') {
                  // Migra lo storico muscolare accumulato da 'Altro' al gruppo muscolare identificato
                  const altroGroup = muscleMap.get('Altro');
                  const destGroup = muscleMap.get(targetGroup);
                  if (altroGroup && destGroup) {
                    const prevEntry = altroGroup.exerciseVolumes.get(existing.canonicalId);
                    if (prevEntry) {
                      altroGroup.volumeKg = Math.max(0, altroGroup.volumeKg - prevEntry.volumeKg);
                      altroGroup.setsCount = Math.max(0, altroGroup.setsCount - prevEntry.sets);
                      altroGroup.repsCount = Math.max(0, altroGroup.repsCount - prevEntry.reps);
                      altroGroup.exerciseSet.delete(existing.canonicalId);
                      altroGroup.exerciseVolumes.delete(existing.canonicalId);

                      destGroup.volumeKg += prevEntry.volumeKg;
                      destGroup.setsCount += prevEntry.sets;
                      destGroup.repsCount += prevEntry.reps;
                      destGroup.exerciseSet.add(existing.canonicalId);
                      const destExisting = destGroup.exerciseVolumes.get(existing.canonicalId);
                      if (destExisting) {
                        destExisting.volumeKg += prevEntry.volumeKg;
                        destExisting.sets += prevEntry.sets;
                        destExisting.reps += prevEntry.reps;
                        destExisting.durationSeconds += prevEntry.durationSeconds;
                      } else {
                        destGroup.exerciseVolumes.set(existing.canonicalId, prevEntry);
                      }
                    }
                  }
                  existing.muscleGroup = targetGroup;
                } else {
                  targetGroup = existing.muscleGroup;
                }
                break;
              }
            }
          }
        }

        // Aggregazione Gruppo Muscolare (solo esercizi di forza/isometria; esclude cardio dal conteggio Hard Sets)
        if (!isCardio) {
          const mGroup = muscleMap.get(targetGroup) || muscleMap.get('Altro')!;
          mGroup.volumeKg += itemVolumeKg;
          mGroup.setsCount += itemSets;
          mGroup.repsCount += itemReps;
          mGroup.exerciseSet.add(targetId);

          const existingExVol = mGroup.exerciseVolumes.get(targetId) || {
            displayName: targetDisplayName,
            volumeKg: 0,
            sets: 0,
            reps: 0,
            durationSeconds: 0,
          };
          existingExVol.volumeKg += itemVolumeKg;
          existingExVol.sets += itemSets;
          existingExVol.reps += itemReps;
          existingExVol.durationSeconds += itemDuration;
          mGroup.exerciseVolumes.set(targetId, existingExVol);
        }

        // Aggregazione Esercizio Micro
        let exAgg = exerciseMap.get(targetId);
        if (!exAgg) {
          exAgg = {
            canonicalId: targetId,
            displayName: targetDisplayName,
            muscleGroup: targetGroup,
            isCanonical: classified.isCanonical,
            isoSetsCount: 0,
            repsSetsCount: 0,
            cardioSetsCount: 0,
            totalVolumeKg: 0,
            totalSets: 0,
            totalReps: 0,
            totalDurationSeconds: 0,
            maxWeightKg: 0,
            maxHoldSeconds: 0,
            maxRepsPerSet: 0,
            maxEstimated1RMKg: 0,
            weightedSetsCount: 0,
            sumWeightsForAverage: 0,
            sessionsCount: 0,
            sessionHistory: new Map(),
            dates: new Set(),
          };
          exerciseMap.set(targetId, exAgg);
        }

        if (isCardio) {
          exAgg.cardioSetsCount += itemSets;
        } else if (isIso) {
          exAgg.isoSetsCount += itemSets;
        } else {
          exAgg.repsSetsCount += itemSets;
        }

        exAgg.totalVolumeKg += itemVolumeKg;
        exAgg.totalSets += itemSets;
        exAgg.totalReps += itemReps;
        exAgg.totalDurationSeconds += itemDuration;
        exAgg.maxWeightKg = Math.max(exAgg.maxWeightKg, itemWeight);
        const singleSetHold = item.maxHoldInSingleSet ?? item.durationPerSet;
        if (singleSetHold > 0) {
          exAgg.maxHoldSeconds = Math.max(exAgg.maxHoldSeconds, singleSetHold);
        }
        const singleSetReps = item.maxRepsInSingleSet ?? item.repsPerSet;
        if (singleSetReps > 0) {
          exAgg.maxRepsPerSet = Math.max(exAgg.maxRepsPerSet, singleSetReps);
        }
        if (item.estimated1RMKg && item.estimated1RMKg > 0) {
          exAgg.maxEstimated1RMKg = Math.max(exAgg.maxEstimated1RMKg, item.estimated1RMKg);
        }

        const weightedCount = item.weightedSetsCount ?? (itemWeight > 0 ? itemSets : 0);
        const weightedSum = item.weightedSumKg ?? (itemWeight > 0 ? itemWeight * itemSets : 0);
        if (weightedCount > 0 && weightedSum > 0) {
          exAgg.weightedSetsCount += weightedCount;
          exAgg.sumWeightsForAverage += weightedSum;
        }

        exAgg.dates.add(sessionDateStr);

        // Traccia cronologia di sessione per grafico SVG
        const sessionKey = `${session.id || session.executedAt}`;
        const currentHist = exAgg.sessionHistory.get(sessionKey) || {
          date: session.executedAt,
          formattedDate: shortDateStr,
          workoutName: session.workoutName,
          reps: 0,
          durationSeconds: 0,
          sets: 0,
          weightKg: 0,
          estimated1RMKg: 0,
        };
        currentHist.reps += itemReps;
        currentHist.durationSeconds += itemDuration;
        currentHist.sets += itemSets;
        currentHist.weightKg = Math.max(currentHist.weightKg, itemWeight);
        currentHist.estimated1RMKg = Math.max(currentHist.estimated1RMKg, item.estimated1RMKg || 0);
        exAgg.sessionHistory.set(sessionKey, currentHist);

        if (!exercisesInThisSession.has(targetId)) {
          exercisesInThisSession.add(targetId);
          exAgg.sessionsCount += 1;
        }
      });
    });

    // Elaborazione delle note qualitative della sessione
    (session.notes || []).forEach((noteObj) => {
      if (!noteObj || typeof noteObj !== 'object') return;
      const rawText = noteObj.text;
      if (rawText == null) return;
      const str = typeof rawText === 'string' ? rawText : String(rawText);
      if (!str.trim()) return;

      allNotesCount += 1;
      const { exerciseName: taggedExName, body } = parseNoteContext(str);
      const categories = categorizeNoteText(body);

      const allSessionItems: UnpackedExerciseItem[] = [];
      (session.exercises || []).forEach((ex) => {
        allSessionItems.push(...unpackExercise(ex));
      });

      let targetClassified = taggedExName ? matchExercise(taggedExName, sessionDominantGroup) : null;

      const isGenericTag =
        Boolean(taggedExName) &&
        (!targetClassified ||
          targetClassified.id === 'altro_non_classificato' ||
          /emom|circuit|superset/i.test(taggedExName || ''));

      if (isGenericTag && allSessionItems.length > 0) {
        const lowerText = str.toLowerCase();
        for (const item of allSessionItems) {
          if (!item || !item.name) continue;
          const match = matchExercise(item.name, sessionDominantGroup);
          const cleanItem = String(item.name).toLowerCase();
          if (lowerText.includes(cleanItem) || lowerText.includes(match.displayName.toLowerCase())) {
            targetClassified = match;
            break;
          }
        }
      }

      let canonicalKey = targetClassified ? targetClassified.id : 'generale_sessione';
      let displayName = targetClassified ? targetClassified.displayName : 'Note Generali Sessione';
      let group = targetClassified ? targetClassified.muscleGroup : 'Altro';

      if (targetClassified && !targetClassified.isCanonical) {
        for (const existing of exerciseMap.values()) {
          if (!existing.isCanonical) {
            const sim = calculateStringSimilarity(existing.displayName, targetClassified.displayName);
            if (sim >= 0.82) {
              canonicalKey = existing.canonicalId;
              displayName = existing.displayName;
              group = existing.muscleGroup;
              break;
            }
          }
        }
      }

      let dossierEntry = notesByCanonicalExercise.get(canonicalKey);
      if (!dossierEntry) {
        dossierEntry = {
          canonicalId: canonicalKey,
          exerciseName: displayName,
          muscleGroup: group,
          notes: [],
        };
        notesByCanonicalExercise.set(canonicalKey, dossierEntry);
      }

      dossierEntry.notes.push({
        date: session.executedAt,
        formattedDate: sessionDateStr,
        workoutName: session.workoutName,
        text: body,
        categories,
      });
    });
  });

  // Costruzione Gruppi Muscolari
  const muscleGroups: MuscleGroupSummary[] = [];
  ALL_GROUPS.forEach((groupName) => {
    const data = muscleMap.get(groupName) || {
      volumeKg: 0,
      setsCount: 0,
      repsCount: 0,
      exerciseSet: new Set<string>(),
      exerciseVolumes: new Map(),
    };
    const topExercises = Array.from(data.exerciseVolumes.values())
      .sort((a, b) => {
        if (b.volumeKg !== a.volumeKg) {
          return b.volumeKg - a.volumeKg;
        }
        if (b.sets !== a.sets) {
          return b.sets - a.sets;
        }
        return (b.reps + b.durationSeconds) - (a.reps + a.durationSeconds);
      })
      .slice(0, 3)
      .map((e) => ({
        displayName: String(e.displayName || 'Esercizio'),
        volumeKg: Math.round(Number(e.volumeKg) || 0),
        sets: Number(e.sets) || 0,
        reps: Number(e.reps) || 0,
        durationSeconds: Number(e.durationSeconds) || 0,
      }));

    muscleGroups.push({
      group: groupName,
      volumeKg: Math.round(data.volumeKg),
      volumePercent: totalVolumeKg > 0 ? Math.round((data.volumeKg / totalVolumeKg) * 100) : 0,
      setsCount: data.setsCount,
      setsPercent: totalHardSets > 0 ? Math.round((data.setsCount / totalHardSets) * 100) : 0,
      repsCount: data.repsCount,
      exerciseCount: data.exerciseSet.size,
      topExercises,
    });
  });

  muscleGroups.sort((a, b) => {
    if (b.setsCount !== a.setsCount) return b.setsCount - a.setsCount;
    return b.volumeKg - a.volumeKg;
  });

  // Costruzione Dettaglio Esercizi (Livello Micro)
  const exercises: MicroExerciseDetail[] = Array.from(exerciseMap.values()).map((ex) => {
    const isCardio =
      ex.cardioSetsCount > 0 &&
      ex.cardioSetsCount >= ex.repsSetsCount &&
      ex.cardioSetsCount >= ex.isoSetsCount;
    const isIsometric = !isCardio && ex.isoSetsCount > ex.repsSetsCount;
    const primaryMetricLabel = isCardio || isIsometric ? 's' : ex.maxWeightKg > 0 ? 'kg' : 'rip';

    // Punti storici ordinati cronologicamente
    const historyPoints: ExerciseHistoryPoint[] = Array.from(ex.sessionHistory.values())
      .sort((a, b) => (parseSafeDate(a.date)?.getTime() || 0) - (parseSafeDate(b.date)?.getTime() || 0))
      .map((pt) => {
        let metricValue = 0;
        let metricLabel = 'rip';

        if (isCardio || isIsometric) {
          metricValue = pt.durationSeconds;
          metricLabel = 's';
        } else if (ex.maxWeightKg > 0 && pt.weightKg > 0) {
          metricValue = pt.estimated1RMKg > 0 ? pt.estimated1RMKg : pt.weightKg;
          metricLabel = 'kg';
        } else {
          metricValue = pt.reps;
          metricLabel = 'rip';
        }

        return {
          date: pt.date,
          formattedDate: pt.formattedDate,
          workoutName: pt.workoutName,
          reps: pt.reps,
          durationSeconds: pt.durationSeconds,
          sets: pt.sets,
          weightKg: pt.weightKg,
          estimated1RMKg: pt.estimated1RMKg > 0 ? pt.estimated1RMKg : undefined,
          metricValue,
          metricLabel,
        };
      });

    // Calcolo Personal Record (PR)
    let pr: PersonalRecordInfo;
    if (isCardio) {
      const bestCardio = ex.maxHoldSeconds > 0 ? ex.maxHoldSeconds : ex.totalDurationSeconds;
      pr = {
        type: 'cardio_time',
        value: bestCardio,
        formatted: bestCardio > 0 ? formatTUTHold(bestCardio) : 'MAX',
        details: `Miglior intervallo/sessione (${formatTUTHold(ex.totalDurationSeconds)} totali)`,
      };
    } else if (isIsometric) {
      const maxTUT = ex.maxHoldSeconds > 0 ? ex.maxHoldSeconds : 0;
      pr = {
        type: 'isometric_tut',
        value: maxTUT,
        formatted: maxTUT > 0 ? `${maxTUT}s tenuta` : 'MAX',
        details:
          maxTUT > 0
            ? `Max tenuta su singola serie (${formatTUTHold(ex.totalDurationSeconds)} TUT totale)`
            : 'Tenuta a sfinimento senza cronometro registrato',
      };
    } else if (ex.maxWeightKg > 0) {
      const e1rmNote =
        ex.maxEstimated1RMKg > ex.maxWeightKg
          ? ` • 1RM stimato ~${ex.maxEstimated1RMKg} kg`
          : '';
      pr = {
        type: 'weight_load',
        value: ex.maxWeightKg,
        formatted: `${ex.maxWeightKg} kg`,
        details: `Carico massimo sollevato${e1rmNote}`,
        estimated1RMKg: ex.maxEstimated1RMKg > 0 ? ex.maxEstimated1RMKg : undefined,
      };
    } else {
      const maxReps = ex.maxRepsPerSet > 0 ? ex.maxRepsPerSet : 0;
      pr = {
        type: 'reps_volume',
        value: maxReps,
        formatted: maxReps > 0 ? `${maxReps} rip / serie` : 'MAX',
        details:
          maxReps > 0
            ? `Max ripetizioni su singola serie`
            : 'Serie a sfinimento senza ripetizioni registrate',
      };
    }

    // Calcolo Progressione (% Delta tra le ultime due sedute con unità omogenea)
    let trend: 'up' | 'down' | 'stable' | 'new' = 'stable';
    let percentChange: number | null = null;
    let comparisonLabel = 'Prima registrazione';

    const comparablePoints = historyPoints.filter(
      (p) => p.metricLabel === primaryMetricLabel && p.metricValue > 0
    );

    if (comparablePoints.length <= 1) {
      trend = 'new';
      percentChange = null;
      comparisonLabel = 'Nuovo nel periodo';
    } else {
      const lastPt = comparablePoints[comparablePoints.length - 1];
      const prevPt = comparablePoints[comparablePoints.length - 2];
      const baselineVal = prevPt.metricValue;
      const currentVal = lastPt.metricValue;

      if (baselineVal > 0) {
        const diff = currentVal - baselineVal;
        const pct = Math.round((diff / baselineVal) * 100);
        percentChange = pct;
        comparisonLabel =
          primaryMetricLabel === 'kg' ? '1RM / carico vs prec.' : 'vs sessione prec.';
        if (pct >= 3) trend = 'up';
        else if (pct <= -3) trend = 'down';
        else trend = 'stable';
      }
    }

    const averageWeightKg =
      ex.weightedSetsCount > 0
        ? Math.round((ex.sumWeightsForAverage / ex.weightedSetsCount) * 10) / 10
        : 0;

    return {
      canonicalId: String(ex.canonicalId || 'ex'),
      displayName: String(ex.displayName || 'Esercizio'),
      muscleGroup: ex.muscleGroup || 'Altro',
      isCanonical: Boolean(ex.isCanonical),
      isIsometric,
      isCardio,
      totalReps: Number(ex.totalReps) || 0,
      totalDurationSeconds: Number(ex.totalDurationSeconds) || 0,
      formattedTUT: formatTUTHold(Number(ex.totalDurationSeconds) || 0),
      totalVolumeKg: Math.round(Number(ex.totalVolumeKg) || 0),
      averageWeightKg,
      totalSets: Number(ex.totalSets) || 0,
      totalHardSets: isCardio ? 0 : Number(ex.totalSets) || 0,
      sessionsCount: Number(ex.sessionsCount) || 0,
      pr,
      progression: {
        percentChange,
        direction: trend,
        comparisonLabel,
      },
      trend,
      percentChange,
      historyPoints,
      dates: Array.from(ex.dates),
    };
  });

  // Ordinamento esercizi: prima per serie completate o tonnellaggio
  exercises.sort((a, b) => {
    if (b.totalHardSets !== a.totalHardSets) {
      return b.totalHardSets - a.totalHardSets;
    }
    if (b.totalVolumeKg !== a.totalVolumeKg) {
      return b.totalVolumeKg - a.totalVolumeKg;
    }
    if (b.totalReps !== a.totalReps) {
      return b.totalReps - a.totalReps;
    }
    return b.totalDurationSeconds - a.totalDurationSeconds;
  });

  // Costruzione Dossier delle Note (sincronizzando eventuali gruppi muscolari promossi)
  const notesDossiers: ExerciseNotesDossier[] = Array.from(notesByCanonicalExercise.values()).map((entry) => {
    const resolvedGroup = exerciseMap.get(entry.canonicalId)?.muscleGroup ?? entry.muscleGroup;
    const themeCounts = new Map<'Progresso' | 'Fatica' | 'Fastidio' | 'Tecnica' | 'Generale', number>();
    entry.notes.forEach((n) => {
      n.categories.forEach((cat) => {
        themeCounts.set(cat, (themeCounts.get(cat) || 0) + 1);
      });
    });

    const dominantThemes = Array.from(themeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);

    const writtenSynthesis = composeExerciseNotesNarrative(entry.exerciseName, entry.notes, dominantThemes);

    return {
      canonicalId: entry.canonicalId,
      exerciseName: entry.exerciseName,
      muscleGroup: resolvedGroup,
      totalNotes: entry.notes.length,
      chronologicalNotes: entry.notes,
      dominantThemes,
      writtenSynthesis,
    };
  });

  notesDossiers.sort((a, b) => b.totalNotes - a.totalNotes);

  const totalWorkouts = inRangeWorkouts.length;
  const averageVolumePerWorkout = totalWorkouts > 0 ? Math.round(totalVolumeKg / totalWorkouts) : 0;
  const averageSetsPerWorkout = totalWorkouts > 0 ? Math.round((totalHardSets / totalWorkouts) * 10) / 10 : 0;

  const macro: MacroDashboardStats = {
    totalDurationSeconds,
    formattedTotalDuration: formatDurationHuman(totalDurationSeconds),
    averageDurationSeconds,
    formattedAverageDuration: formatDurationHuman(averageDurationSeconds),
    totalCompletedSessions: totalWorkouts,
    weeklyFrequency,
    totalHardSets,
    averageHardSetsPerSession: averageSetsPerWorkout,
  };

  return {
    period,
    macro,
    totalVolumeKg: Math.round(totalVolumeKg),
    totalSets: totalHardSets,
    totalReps: totalRepsAll,
    totalWorkouts,
    averageVolumePerWorkout,
    averageSetsPerWorkout,
    muscleGroups,
    exercises,
    notesDossiers,
    allNotesCount,
  };
};

/**
 * Esporta il report sintetico formattato aderendo alla separazione Macro / Micro.
 */
export const exportReportSummaryText = (report: PeriodicReportResult): string => {
  const lines: string[] = [];

  lines.push(`📊 REPORT ANALITICO ALLENAMENTI — NO EXCUSES`);
  lines.push(`Periodo: ${report.period.label}`);
  lines.push(`----------------------------------------`);
  lines.push(`⏱️ DASHBOARD GENERALE (LIVELLO MACRO - SALUTE & ADERENZA):`);
  lines.push(`• Tempo totale di allenamento: ${report.macro.formattedTotalDuration}`);
  lines.push(`• Tempo medio per sessione: ${report.macro.formattedAverageDuration}`);
  lines.push(`• Sessioni completate: ${report.macro.totalCompletedSessions} workout (${report.macro.weeklyFrequency} a settimana)`);
  lines.push(`• Serie allenanti totali (Hard Sets): ${report.macro.totalHardSets} serie (media ${report.macro.averageHardSetsPerSession} / seduta)`);
  lines.push(``);

  lines.push(`💪 DISTRIBUZIONE CARICO SISTEMICO PER GRUPPI MUSCOLARI:`);
  report.muscleGroups
    .filter((mg) => mg.setsCount > 0 || mg.volumeKg > 0)
    .forEach((mg) => {
      const kgStr = mg.volumeKg > 0 ? ` | ${mg.volumeKg.toLocaleString('it-IT')} kg tonnellaggio` : '';
      lines.push(`• ${mg.group}: ${mg.setsCount} serie (${mg.setsPercent}%)${kgStr}`);
    });
  lines.push(``);

  lines.push(`🏋️ SCHEDA DETTAGLIO ESERCIZI (LIVELLO MICRO - SOVRACCARICO PROGRESSIVO):`);
  report.exercises.slice(0, 12).forEach((ex, idx) => {
    const trendIcon = ex.progression.direction === 'up'
      ? `(+${ex.progression.percentChange}% ↗️)`
      : ex.progression.direction === 'down'
        ? `(${ex.progression.percentChange}% ↘️)`
        : '';
    const volStr = ex.isCardio
      ? `${ex.formattedTUT} cardio in ${ex.totalSets} ${ex.totalSets === 1 ? 'sessione' : 'sessioni'}`
      : ex.isIsometric
        ? `${ex.formattedTUT} TUT in ${ex.totalHardSets} serie`
        : `${ex.totalReps} rip in ${ex.totalHardSets} serie${ex.totalVolumeKg > 0 ? ` (${ex.totalVolumeKg} kg)` : ' (corpo libero)'}`;

    lines.push(`${idx + 1}. ${ex.displayName} [${ex.muscleGroup}]: ${volStr} | 🏆 PR: ${ex.pr.formatted} ${trendIcon}`);
  });
  lines.push(``);

  if (report.notesDossiers.length > 0) {
    lines.push(`📋 RESOCONTO OSSERVAZIONI PER ESERCIZIO:`);
    report.notesDossiers.slice(0, 5).forEach((dossier) => {
      lines.push(`\n▶ ${dossier.exerciseName} (${dossier.totalNotes} note):`);
      lines.push(dossier.writtenSynthesis);
    });
  }

  return lines.join('\n');
};
