/**
 * periodicReportEngine.ts — Motore di calcolo analitico, aggregazione delle metriche,
 * ripartizione per gruppi muscolari e dossier sintetico delle note per esercizio.
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

export interface ExerciseReportItem {
  canonicalId: string;
  displayName: string;
  muscleGroup: MuscleGroup;
  isCanonical: boolean;
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  maxWeightKg: number;
  sessionsCount: number;
  trend: 'up' | 'down' | 'stable' | 'new';
  percentChange: number | null;
  dates: string[];
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
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  totalWorkouts: number;
  averageVolumePerWorkout: number;
  averageSetsPerWorkout: number;
  muscleGroups: MuscleGroupSummary[];
  exercises: ExerciseReportItem[];
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

    // Assicura che startDate <= endDate
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
 * Supporta formati come `[1. Panca Piana] Ottimo feeling...` o testo semplice.
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

  // Rimuove eventuale prefisso numerico "1. " o "2. "
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

  // Aggiunge un estratto dall'ultima nota cronologica
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
}

/**
 * Spacchetta un esercizio complesso (EMOM, Circuito, Superset) nei suoi sotto-esercizi effettivi.
 * Se l'esercizio è singolo o piramidale, restituisce un array con un solo elemento.
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

  // Se è un blocco composto con sub-esercizi definiti
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
        const subReps = Math.max(0, Math.trunc(toSafeNumber(sub.reps, 0)));
        const totalRepsForSub = subReps * parentSets;
        const rawWeight = Number(sub.weight_kg);
        const subWeight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
        const subDuration = Math.max(0, Math.trunc(toSafeNumber(sub.duration_seconds, 0))) * parentSets;

        return {
          name: String(sub.name || rawEx.name || 'Esercizio'),
          sets: parentSets,
          reps: totalRepsForSub,
          weightKg: subWeight,
          durationSeconds: subDuration,
          parentType: rawEx.type,
        };
      });
    }
  }

  // Se è una piramide con step
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
        },
      ];
    }
  }

  // Esercizio standard (reps o isometria)
  const sets = Math.max(1, Math.trunc(toSafeNumber(rawEx.sets, 1)));
  const repsPerSet = Math.max(0, Math.trunc(toSafeNumber(rawEx.reps, 0)));
  const totalReps = sets * repsPerSet;
  const rawWeight = Number(rawEx.weight_kg);
  const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
  const duration = Math.max(0, Math.trunc(toSafeNumber(rawEx.duration_seconds, 0))) * sets;

  return [
    {
      name: String(rawEx.name || 'Esercizio'),
      sets,
      reps: totalReps,
      weightKg: weight,
      durationSeconds: duration,
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
 * Motore Principale: Genera il Report Periodico Completo.
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

  // Punto mediano per calcolare il trend di progressione
  const midTimestamp = period.startDate.getTime() + (period.endDate.getTime() - period.startDate.getTime()) / 2;

  let totalVolumeKg = 0;
  let totalSets = 0;
  let totalReps = 0;

  // Strutture di aggregazione
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
    totalVolumeKg: number;
    totalSets: number;
    totalReps: number;
    maxWeightKg: number;
    sessionsCount: number;
    firstHalfVolume: number;
    secondHalfVolume: number;
    firstHalfReps: number;
    secondHalfReps: number;
    firstHalfSessions: number;
    secondHalfSessions: number;
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
    const sessionDate = parseSafeDate(session.executedAt) || new Date();
    const isSecondHalf = sessionDate.getTime() >= midTimestamp;
    const sessionDateStr = formatSafeDate(session.executedAt);

    // Traccia gli esercizi già incontrati in questa singola sessione per il conteggio sessioni
    const exercisesInThisSession = new Set<string>();

    // ─── EURISTICA CONTESTUALE DELLA SESSIONE ─────────────────────────────────
    // Calcola la frequenza dei gruppi muscolari noti presenti nella seduta.
    // Il gruppo dominante "presta" la sua classificazione agli esercizi non riconosciuti.
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
      // Spacchetta gli esercizi complessi (EMOM, circuiti, superset) nei sotto-esercizi effettivi
      const items = unpackExercise(rawEx);

      items.forEach((item) => {
        if (!item) return;
        // Classificazione con euristica contestuale della sessione
        const classified = matchExercise(item.name, sessionDominantGroup);
        const itemReps = Math.max(0, Number(item.reps) || 0);
        const itemWeight = Math.max(0, Number(item.weightKg) || 0);
        const itemVolumeKg = Math.round(itemReps * itemWeight * 100) / 100;
        const itemSets = Math.max(1, Number(item.sets) || 1);
        const itemMaxWeight = itemWeight;

        totalVolumeKg += itemVolumeKg;
        totalSets += itemSets;
        totalReps += itemReps;

        // ─── AUTO-DEDUPLICAZIONE & CLUSTERING DINAMICO PER ESERCIZI CUSTOM ─────
        // Se l'esercizio è personalizzato/sconosciuto, controlla se esiste già
        // un altro esercizio custom con grafia molto simile (refuso di battitura)
        let targetId = classified.id;
        let targetDisplayName = classified.displayName;
        let targetGroup = classified.muscleGroup;

        if (!classified.isCanonical) {
          for (const existing of exerciseMap.values()) {
            if (!existing.isCanonical) {
              const sim = calculateStringSimilarity(existing.displayName, classified.displayName);
              if (sim >= 0.82) {
                targetId = existing.canonicalId;
                targetDisplayName = existing.displayName;
                // Se l'esistente era 'Altro' e il nuovo ha un gruppo dedotto, aggiorna l'esistente
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

        // Aggregazione Gruppo Muscolare (con fallback sicuro su Altro)
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

        // Aggregazione Esercizio Canonico o Clusterizzato
        let exAgg = exerciseMap.get(targetId);
        if (!exAgg) {
          exAgg = {
            canonicalId: targetId,
            displayName: targetDisplayName,
            muscleGroup: targetGroup,
            isCanonical: classified.isCanonical,
            totalVolumeKg: 0,
            totalSets: 0,
            totalReps: 0,
            maxWeightKg: 0,
            sessionsCount: 0,
            firstHalfVolume: 0,
            secondHalfVolume: 0,
            firstHalfReps: 0,
            secondHalfReps: 0,
            firstHalfSessions: 0,
            secondHalfSessions: 0,
            dates: new Set(),
          };
          exerciseMap.set(targetId, exAgg);
        }

        exAgg.totalVolumeKg += itemVolumeKg;
        exAgg.totalSets += itemSets;
        exAgg.totalReps += itemReps;
        exAgg.maxWeightKg = Math.max(exAgg.maxWeightKg, itemMaxWeight);
        exAgg.dates.add(sessionDateStr);

        if (!exercisesInThisSession.has(targetId)) {
          exercisesInThisSession.add(targetId);
          exAgg.sessionsCount += 1;
          if (isSecondHalf) {
            exAgg.secondHalfSessions += 1;
          } else {
            exAgg.firstHalfSessions += 1;
          }
        }

        if (isSecondHalf) {
          exAgg.secondHalfVolume += itemVolumeKg;
          exAgg.secondHalfReps += itemReps;
        } else {
          exAgg.firstHalfVolume += itemVolumeKg;
          exAgg.firstHalfReps += itemReps;
        }
      });
    });

    // Elaborazione delle note qualitative lasciate nella sessione
    (session.notes || []).forEach((noteObj) => {
      if (!noteObj || typeof noteObj !== 'object') return;
      const rawText = noteObj.text;
      if (rawText == null) return;
      const str = typeof rawText === 'string' ? rawText : String(rawText);
      if (!str.trim()) return;

      allNotesCount += 1;
      const { exerciseName: taggedExName, body } = parseNoteContext(str);
      const categories = categorizeNoteText(body);

      // Raccoglie tutti i sotto-esercizi svolti nella sessione per eventuale abbinamento
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

      // Se non è collegabile a un esercizio specifico, finisce sotto le note generali di sessione
      let canonicalKey = targetClassified ? targetClassified.id : 'generale_sessione';
      let displayName = targetClassified ? targetClassified.displayName : 'Note Generali Sessione';
      let group = targetClassified ? targetClassified.muscleGroup : 'Altro';

      // Se l'esercizio è custom, controlla se è stato unificato a un cluster esistente
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

  // Costruisce i risultati dei Gruppi Muscolari
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
      setsPercent: totalSets > 0 ? Math.round((data.setsCount / totalSets) * 100) : 0,
      repsCount: data.repsCount,
      exerciseCount: data.exerciseSet.size,
      topExercises,
    });
  });

  // Ordina i gruppi muscolari per volume decrescente (o per ripetizioni se volume 0)
  muscleGroups.sort((a, b) => {
    if (b.volumeKg !== a.volumeKg) return b.volumeKg - a.volumeKg;
    return b.repsCount - a.repsCount;
  });

  // Costruisce i risultati per Esercizio Canonico
  const exercises: ExerciseReportItem[] = Array.from(exerciseMap.values()).map((ex) => {
    // Calcola il trend tra prima e seconda metà del periodo
    // Se l'esercizio ha volume carico (>0), usa il volume. Se è a corpo libero (0kg), usa le ripetizioni!
    const usesVolume = ex.totalVolumeKg > 0;
    const firstAvg = ex.firstHalfSessions > 0
      ? (usesVolume ? ex.firstHalfVolume : ex.firstHalfReps) / ex.firstHalfSessions
      : 0;
    const secondAvg = ex.secondHalfSessions > 0
      ? (usesVolume ? ex.secondHalfVolume : ex.secondHalfReps) / ex.secondHalfSessions
      : 0;

    let trend: 'up' | 'down' | 'stable' | 'new' = 'stable';
    let percentChange: number | null = null;

    if (ex.firstHalfSessions === 0 && ex.secondHalfSessions > 0) {
      trend = 'new';
    } else if (firstAvg > 0 && secondAvg > 0) {
      const diff = secondAvg - firstAvg;
      const pct = Math.round((diff / firstAvg) * 100);
      percentChange = pct;
      if (pct >= 4) trend = 'up';
      else if (pct <= -4) trend = 'down';
      else trend = 'stable';
    }

    return {
      canonicalId: String(ex.canonicalId || 'ex'),
      displayName: String(ex.displayName || 'Esercizio'),
      muscleGroup: ex.muscleGroup || 'Altro',
      isCanonical: Boolean(ex.isCanonical),
      totalVolumeKg: Math.round(Number(ex.totalVolumeKg) || 0),
      totalSets: Number(ex.totalSets) || 0,
      totalReps: Number(ex.totalReps) || 0,
      maxWeightKg: Number(ex.maxWeightKg) || 0,
      sessionsCount: Number(ex.sessionsCount) || 0,
      trend,
      percentChange,
      dates: Array.from(ex.dates),
    };
  });

  // Ordina gli esercizi: prioritariamente per ripetizioni totali o volume carico
  exercises.sort((a, b) => {
    if (b.totalVolumeKg > 0 && a.totalVolumeKg > 0 && b.totalVolumeKg !== a.totalVolumeKg) {
      return b.totalVolumeKg - a.totalVolumeKg;
    }
    if (b.totalReps !== a.totalReps) {
      return b.totalReps - a.totalReps;
    }
    return b.totalSets - a.totalSets;
  });

  // Costruisce i Dossier delle Note per Esercizio
  const notesDossiers: ExerciseNotesDossier[] = Array.from(notesByCanonicalExercise.values()).map((entry) => {
    // Calcola i temi dominanti
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

  // Ordina i dossier delle note: prima quelli con più note
  notesDossiers.sort((a, b) => b.totalNotes - a.totalNotes);

  const totalWorkouts = inRangeWorkouts.length;
  const averageVolumePerWorkout = totalWorkouts > 0 ? Math.round(totalVolumeKg / totalWorkouts) : 0;
  const averageSetsPerWorkout = totalWorkouts > 0 ? Math.round((totalSets / totalWorkouts) * 10) / 10 : 0;

  return {
    period,
    totalVolumeKg: Math.round(totalVolumeKg),
    totalSets,
    totalReps,
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
 * Esporta il report in un formato testo/markdown sintetico pronto per essere copiato negli appunti.
 */
export const exportReportSummaryText = (report: PeriodicReportResult): string => {
  const lines: string[] = [];

  lines.push(`📊 REPORT PERIODICO ALLENAMENTI — NO EXCUSES`);
  lines.push(`Periodo: ${report.period.label}`);
  lines.push(`----------------------------------------`);
  lines.push(`🏋️ METRICHE GENERALI:`);
  lines.push(`• Volume totale carico: ${report.totalVolumeKg.toLocaleString('it-IT')} kg (${(report.totalVolumeKg / 1000).toFixed(2)} t)`);
  lines.push(`• Volume totale ripetizioni: ${report.totalReps.toLocaleString('it-IT')} rip.`);
  lines.push(`• Serie totali completate: ${report.totalSets}`);
  lines.push(`• Sessioni di allenamento: ${report.totalWorkouts}`);
  lines.push(`• Media ripetizioni a seduta: ${report.totalWorkouts > 0 ? Math.round(report.totalReps / report.totalWorkouts).toLocaleString('it-IT') : 0} rip.`);
  lines.push(`• Media serie a seduta: ${report.averageSetsPerWorkout}`);
  lines.push(``);

  lines.push(`💪 DISTRIBUZIONE PER GRUPPI MUSCOLARI:`);
  report.muscleGroups
    .filter((mg) => mg.volumeKg > 0 || mg.setsCount > 0 || mg.repsCount > 0)
    .forEach((mg) => {
      const kgStr = mg.volumeKg > 0 ? `${mg.volumeKg.toLocaleString('it-IT')} kg (${mg.volumePercent}%) | ` : '';
      lines.push(`• ${mg.group}: ${kgStr}${mg.repsCount.toLocaleString('it-IT')} rip. in ${mg.setsCount} serie (${mg.setsPercent}%)`);
    });
  lines.push(``);

  lines.push(`🏆 DETTAGLIO ESERCIZI (VOLUME & PROGRESSI):`);
  report.exercises.slice(0, 10).forEach((ex, idx) => {
    const trendIcon = ex.trend === 'up' ? `(+${ex.percentChange}% ↗️)` : ex.trend === 'down' ? `(${ex.percentChange}% ↘️)` : '';
    const loadStr = ex.totalVolumeKg > 0 ? `, ${ex.totalVolumeKg.toLocaleString('it-IT')} kg` : ' (a corpo libero)';
    const maxStr = ex.maxWeightKg > 0 ? `Max ${ex.maxWeightKg} kg` : 'Bodyweight';
    lines.push(`${idx + 1}. ${ex.displayName} [${ex.muscleGroup}]: ${ex.totalReps.toLocaleString('it-IT')} rip. (${ex.totalSets} serie${loadStr}, ${maxStr}) ${trendIcon}`);
  });
  lines.push(``);

  if (report.notesDossiers.length > 0) {
    lines.push(`📋 RESOCONTO OSSERVAZIONI PER ESERCIZIO:`);
    report.notesDossiers.forEach((dossier) => {
      lines.push(`\n▶ ${dossier.exerciseName} (${dossier.totalNotes} note):`);
      lines.push(dossier.writtenSynthesis);
    });
  }

  return lines.join('\n');
};
