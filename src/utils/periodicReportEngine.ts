/**
 * periodicReportEngine.ts — Motore di calcolo analitico, aggregazione delle metriche,
 * ripartizione per gruppi muscolari, dossier sintetico delle note per esercizio
 * e separazione netta tra Macro Dashboard (Salute, Tempo, Hard Sets) e Micro Dettaglio (TUT, Sovraccarico, PR).
 */

import { matchExercise, calculateStringSimilarity, type MuscleGroup } from './exerciseClassifier';
import type { UiExercise, UiSubExercise } from '../lib/workoutSchemaAdapter';

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
  if (type === 'isometry') return true;
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

/**
 * Deserializza l'array raw di exercises_snapshot memorizzato nel database in UiExercise[]
 */
export const toSnapshotExercises = (raw: unknown): UiExercise[] => {
  if (!raw) return [];
  let parsedRaw = raw;
  if (typeof parsedRaw === 'string') {
    try {
      parsedRaw = JSON.parse(parsedRaw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsedRaw)) return [];

  return parsedRaw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((item, idx) => {
      const typeRaw = String(item.type || 'reps').toLowerCase();
      const type: UiExercise['type'] =
        typeRaw === 'isometry' || typeRaw === 'superset' || typeRaw === 'circuit' || typeRaw === 'emom' || typeRaw === 'pyramid'
          ? (typeRaw as UiExercise['type'])
          : 'reps';

      const subExercises = Array.isArray(item.subExercises)
        ? (item.subExercises as Array<unknown>)
          .filter((sub): sub is Record<string, unknown> => Boolean(sub && typeof sub === 'object'))
          .map((sub) => {
            const subType: UiSubExercise['type'] =
              String(sub.type || 'reps').toLowerCase() === 'isometry' ? 'isometry' : 'reps';
            return {
              name: String(sub.name || ''),
              type: subType,
              reps: Math.max(0, Math.trunc(toSafeNumber(sub.reps, 0))),
              duration_seconds: Math.max(0, Math.trunc(toSafeNumber(sub.duration_seconds, 0))),
              weight_kg: Number.isFinite(Number(sub.weight_kg)) ? Number(sub.weight_kg) : null,
            } satisfies UiSubExercise;
          })
        : undefined;

      const pyramidSteps = Array.isArray(item.pyramid_steps)
        ? (item.pyramid_steps as Array<unknown>)
          .filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object'))
          .map((step) => ({
            reps: Math.max(0, Math.trunc(toSafeNumber(step.reps, 0))),
            rest_seconds: Math.max(0, Math.trunc(toSafeNumber(step.rest_seconds, 0))),
            weight_kg: Number.isFinite(Number(step.weight_kg)) ? Number(step.weight_kg) : null,
          }))
        : undefined;

      return {
        id: String(item.id || `snapshot-${idx}`),
        type,
        name: String(item.name || `Exercise ${idx + 1}`),
        sets: Math.max(1, Math.trunc(toSafeNumber(item.sets, 1))),
        reps: Math.max(0, Math.trunc(toSafeNumber(item.reps, 0))),
        duration_seconds: Math.max(0, Math.trunc(toSafeNumber(item.duration_seconds, 0))),
        rest_seconds: Math.max(0, Math.trunc(toSafeNumber(item.rest_seconds, 0))),
        weight_kg: Number.isFinite(Number(item.weight_kg)) ? Number(item.weight_kg) : null,
        order_index: Math.max(0, Math.trunc(toSafeNumber(item.order_index, idx))),
        emom_rounds: item.emom_rounds == null ? undefined : Math.max(1, Math.trunc(toSafeNumber(item.emom_rounds, 1))),
        emom_round_duration:
          item.emom_round_duration == null ? undefined : Math.max(1, Math.trunc(toSafeNumber(item.emom_round_duration, 1))),
        pyramid_steps: pyramidSteps,
        subExercises,
      } satisfies UiExercise;
    })
    .sort((a, b) => a.order_index - b.order_index);
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
  metricValue: number;
  metricLabel: string;
}

export interface PersonalRecordInfo {
  type: 'isometric_tut' | 'weight_load' | 'reps_volume';
  value: number;
  formatted: string;
  details?: string;
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

    const defaultStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
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

  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
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

  const match = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) {
    return { exerciseName: null, body: trimmed };
  }

  const tag = match[1].trim();
  const body = match[2].trim();

  const nameWithoutPrefix = tag.replace(/^\d+[\.\)]\s*/, '').trim();
  return {
    exerciseName: nameWithoutPrefix.length > 0 ? nameWithoutPrefix : null,
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

  let narrative = `Nel periodo selezionato hai registrato ${noteWord} su **${exerciseName}**. `;

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
  parentType?: string;
  isIsometric: boolean;
  repsPerSet: number;
  durationPerSet: number;
}

/**
 * Spacchetta un esercizio complesso (EMOM, Circuito, Superset) nei suoi sotto-esercizi effettivi,
 * identificando accuratamente se ciascun movimento è dinamico o isometrico.
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
        ? Math.max(1, Math.trunc(toSafeNumber(rawEx.emom_rounds || rawEx.sets, 1)))
        : Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1)));

    const validSubs = (rawEx.subExercises as Array<unknown>).filter(
      (sub): sub is Record<string, unknown> => Boolean(sub && typeof sub === 'object')
    );

    if (validSubs.length > 0) {
      return validSubs.map((sub) => {
        const subName = String(sub.name || rawEx.name || 'Esercizio');
        const rawDuration = Math.max(0, Math.trunc(toSafeNumber(sub.duration_seconds, 0)));
        const rawReps = Math.max(0, Math.trunc(toSafeNumber(sub.reps, 0)));
        const isIso = isIsometricExercise(subName, String(sub.type || ''), rawDuration, rawReps);

        const subReps = isIso ? 0 : rawReps;
        const totalRepsForSub = subReps * parentSets;
        const rawWeight = Number(sub.weight_kg);
        const subWeight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
        const durationPerSet = isIso ? (rawDuration > 0 ? rawDuration : 15) : 0;
        const subDuration = durationPerSet * parentSets;

        return {
          name: subName,
          sets: parentSets,
          reps: totalRepsForSub,
          weightKg: subWeight,
          durationSeconds: subDuration,
          parentType: rawEx.type,
          isIsometric: isIso,
          repsPerSet: subReps,
          durationPerSet,
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
      let maxWeight = 0;
      validSteps.forEach((step) => {
        totalReps += Math.max(0, Math.trunc(toSafeNumber(step.reps, 0)));
        const rawW = Number(step.weight_kg);
        const w = Number.isFinite(rawW) ? Math.max(0, rawW) : 0;
        maxWeight = Math.max(maxWeight, w);
      });

      return [
        {
          name: String(rawEx.name || 'Esercizio Piramidale'),
          sets: validSteps.length,
          reps: totalReps,
          weightKg: maxWeight,
          durationSeconds: 0,
          isIsometric: false,
          repsPerSet: Math.round(totalReps / validSteps.length),
          durationPerSet: 0,
        },
      ];
    }
  }

  // Esercizio standard (reps o isometria)
  const exName = String(rawEx.name || 'Esercizio');
  const sets = Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1)));
  const rawDuration = Math.max(0, Math.trunc(toSafeNumber(rawEx.duration_seconds, 0)));
  const rawReps = Math.max(0, Math.trunc(toSafeNumber(rawEx.reps, 0)));
  const isIso = isIsometricExercise(exName, rawEx.type, rawDuration, rawReps);

  const repsPerSet = isIso ? 0 : rawReps;
  const totalReps = sets * repsPerSet;
  const rawWeight = Number(rawEx.weight_kg);
  const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
  const durationPerSet = isIso ? (rawDuration > 0 ? rawDuration : 20) : 0;
  const duration = durationPerSet * sets;

  return [
    {
      name: exName,
      sets,
      reps: totalReps,
      weightKg: weight,
      durationSeconds: duration,
      parentType: rawEx.type,
      isIsometric: isIso,
      repsPerSet,
      durationPerSet,
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
    volumeKg += item.reps * item.weightKg;
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
          if (item.isIsometric) {
            estimated += item.durationSeconds + item.sets * 45;
          } else {
            estimated += item.reps * 3 + item.sets * 60;
          }
        });
      });
      totalDurationSeconds += estimated > 0 ? estimated : 45 * 60;
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
    exerciseVolumes: Map<string, { displayName: string; volumeKg: number; sets: number; reps: number }>;
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
    isIsometric: boolean;
    totalVolumeKg: number;
    totalSets: number;
    totalReps: number;
    totalDurationSeconds: number;
    maxWeightKg: number;
    maxHoldSeconds: number;
    maxRepsPerSet: number;
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
        if (!item || !item.name) return;
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
        const classified = matchExercise(item.name, sessionDominantGroup);
        const itemReps = Math.max(0, Number(item.reps) || 0);
        const itemWeight = Math.max(0, Number(item.weightKg) || 0);
        const itemVolumeKg = Math.round(itemReps * itemWeight * 100) / 100;
        const itemSets = Math.max(1, Number(item.sets) || 1);
        const itemDuration = Math.max(0, Number(item.durationSeconds) || 0);
        const isIso = Boolean(item.isIsometric);

        totalVolumeKg += itemVolumeKg;
        totalHardSets += itemSets;
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
                  existing.muscleGroup = targetGroup;
                } else {
                  targetGroup = existing.muscleGroup;
                }
                break;
              }
            }
          }
        }

        // Aggregazione Gruppo Muscolare
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
        };
        existingExVol.volumeKg += itemVolumeKg;
        existingExVol.sets += itemSets;
        existingExVol.reps += itemReps;
        mGroup.exerciseVolumes.set(targetId, existingExVol);

        // Aggregazione Esercizio Micro
        let exAgg = exerciseMap.get(targetId);
        if (!exAgg) {
          exAgg = {
            canonicalId: targetId,
            displayName: targetDisplayName,
            muscleGroup: targetGroup,
            isCanonical: classified.isCanonical,
            isIsometric: isIso,
            totalVolumeKg: 0,
            totalSets: 0,
            totalReps: 0,
            totalDurationSeconds: 0,
            maxWeightKg: 0,
            maxHoldSeconds: 0,
            maxRepsPerSet: 0,
            weightedSetsCount: 0,
            sumWeightsForAverage: 0,
            sessionsCount: 0,
            sessionHistory: new Map(),
            dates: new Set(),
          };
          exerciseMap.set(targetId, exAgg);
        }

        if (isIso) {
          exAgg.isIsometric = true;
        }

        exAgg.totalVolumeKg += itemVolumeKg;
        exAgg.totalSets += itemSets;
        exAgg.totalReps += itemReps;
        exAgg.totalDurationSeconds += itemDuration;
        exAgg.maxWeightKg = Math.max(exAgg.maxWeightKg, itemWeight);
        if (item.durationPerSet > 0) {
          exAgg.maxHoldSeconds = Math.max(exAgg.maxHoldSeconds, item.durationPerSet);
        }
        if (item.repsPerSet > 0) {
          exAgg.maxRepsPerSet = Math.max(exAgg.maxRepsPerSet, item.repsPerSet);
        }

        if (itemWeight > 0) {
          exAgg.weightedSetsCount += itemSets;
          exAgg.sumWeightsForAverage += itemWeight * itemSets;
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
        };
        currentHist.reps += itemReps;
        currentHist.durationSeconds += itemDuration;
        currentHist.sets += itemSets;
        currentHist.weightKg = Math.max(currentHist.weightKg, itemWeight);
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
        !targetClassified ||
        targetClassified.id === 'altro_non_classificato' ||
        /emom|circuit|superset/i.test(taggedExName || '');

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
        return b.reps - a.reps;
      })
      .slice(0, 3)
      .map((e) => ({
        displayName: String(e.displayName || 'Esercizio'),
        volumeKg: Math.round(Number(e.volumeKg) || 0),
        sets: Number(e.sets) || 0,
        reps: Number(e.reps) || 0,
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
    // Punti storici ordinati cronologicamente
    const historyPoints: ExerciseHistoryPoint[] = Array.from(ex.sessionHistory.values())
      .sort((a, b) => (parseSafeDate(a.date)?.getTime() || 0) - (parseSafeDate(b.date)?.getTime() || 0))
      .map((pt) => {
        let metricValue = 0;
        let metricLabel = 'rip';

        if (ex.isIsometric) {
          // Per isometrici: TUT totale o tenuta media per set
          metricValue = pt.durationSeconds > 0 ? pt.durationSeconds : (pt.sets > 0 ? pt.sets * 20 : 20);
          metricLabel = 's';
        } else if (ex.maxWeightKg > 0 && pt.weightKg > 0) {
          metricValue = pt.weightKg;
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
          metricValue,
          metricLabel,
        };
      });

    // Calcolo Personal Record (PR)
    let pr: PersonalRecordInfo;
    if (ex.isIsometric) {
      const maxTUT = ex.maxHoldSeconds > 0 ? ex.maxHoldSeconds : (ex.totalDurationSeconds > 0 ? Math.round(ex.totalDurationSeconds / Math.max(1, ex.totalSets)) : 20);
      pr = {
        type: 'isometric_tut',
        value: maxTUT,
        formatted: `${maxTUT}s tenuta`,
        details: `Max tenuta su singola serie (${formatTUTHold(ex.totalDurationSeconds)} TUT totale)`,
      };
    } else if (ex.maxWeightKg > 0) {
      pr = {
        type: 'weight_load',
        value: ex.maxWeightKg,
        formatted: `${ex.maxWeightKg} kg`,
        details: `Carico massimo sollevato`,
      };
    } else {
      const maxReps = ex.maxRepsPerSet > 0 ? ex.maxRepsPerSet : (ex.totalReps > 0 ? Math.round(ex.totalReps / Math.max(1, ex.totalSets)) : 10);
      pr = {
        type: 'reps_volume',
        value: maxReps,
        formatted: `${maxReps} rip / serie`,
        details: `Max ripetizioni su singola serie`,
      };
    }

    // Calcolo Progressione Settimanale (% Delta WoW o vs sessione precedente)
    let trend: 'up' | 'down' | 'stable' | 'new' = 'stable';
    let percentChange: number | null = null;
    let comparisonLabel = 'Prima registrazione';

    if (historyPoints.length <= 1) {
      trend = 'new';
      percentChange = null;
      comparisonLabel = 'Nuovo nel periodo';
    } else {
      const lastPt = historyPoints[historyPoints.length - 1];
      const prevPt = historyPoints[historyPoints.length - 2];
      const baselineVal = prevPt.metricValue;
      const currentVal = lastPt.metricValue;

      if (baselineVal > 0) {
        const diff = currentVal - baselineVal;
        const pct = Math.round((diff / baselineVal) * 100);
        percentChange = pct;
        comparisonLabel = 'vs sessione prec.';
        if (pct >= 3) trend = 'up';
        else if (pct <= -3) trend = 'down';
        else trend = 'stable';
      }
    }

    const averageWeightKg = ex.weightedSetsCount > 0 ? Math.round((ex.sumWeightsForAverage / ex.weightedSetsCount) * 10) / 10 : 0;

    return {
      canonicalId: String(ex.canonicalId || 'ex'),
      displayName: String(ex.displayName || 'Esercizio'),
      muscleGroup: ex.muscleGroup || 'Altro',
      isCanonical: Boolean(ex.isCanonical),
      isIsometric: ex.isIsometric,
      totalReps: Number(ex.totalReps) || 0,
      totalDurationSeconds: Number(ex.totalDurationSeconds) || 0,
      formattedTUT: formatTUTHold(Number(ex.totalDurationSeconds) || 0),
      totalVolumeKg: Math.round(Number(ex.totalVolumeKg) || 0),
      averageWeightKg,
      totalSets: Number(ex.totalSets) || 0,
      totalHardSets: Number(ex.totalSets) || 0,
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
    return b.totalReps - a.totalReps;
  });

  // Costruzione Dossier delle Note
  const notesDossiers: ExerciseNotesDossier[] = Array.from(notesByCanonicalExercise.values()).map((entry) => {
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
      muscleGroup: entry.muscleGroup,
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
    const volStr = ex.isIsometric
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
