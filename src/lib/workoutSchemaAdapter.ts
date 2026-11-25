/**
 * workoutSchemaAdapter.ts — Adattatore tra il formato DB (righe piatte Supabase) e il formato UI.
 *
 * Il database memorizza gli esercizi come righe denormalizzate nella tabella `esecuzioni`.
 * Gli esercizi composti (superset, EMOM, piramide) sono suddivisi in più righe
 * collegate tramite id_superset / id_emom / id_piramide.
 *
 * Questo modulo si occupa di:
 *  1. Leggere le righe ordinate per `ordine`
 *  2. Raggruppare le righe appartenenti allo stesso superset/EMOM/piramide
 *  3. Estrarre e normalizzare i metadati inline (`@@@meta:` nel campo note_esercizio)
 *  4. Restituire un array di `UiExercise` pronti per il rendering nei componenti
 *
 * Struttura dati UI esportata:
 *  - UiExercise        : esercizio generico (contiene i campi di tutti i tipi)
 *  - UiSubExercise     : sub-esercizio di un superset o EMOM
 *  - UiPyramidStep     : step di una piramide (reps/rest/peso)
 *  - UiExerciseType    : unione dei tipi supportati
 *
 * Helper interni:
 *  - toSafeInt/toSafeDecimal : conversione sicura da DB (unknown) a number
 *  - toOptionalNote          : normalizza le note testuali (stringa vuota → null)
 *  - extractNoteMeta         : split del campo note_esercizio tra testo e @@@meta:
 *  - stripStorageMeta        : rimuove il suffisso @@@meta: dal nome esercizio
 *  - parseJsonIfAny          : tenta il parse JSON del nome esercizio (per payload legacy)
 *
 * Funzioni principali esportate:
 *  - `parseDbExerciseRows(rows)` : converte righe piatte `esecuzioni` del DB in `UiExercise[]`
 *  - `toSnapshotExercises(raw)`  : deserializza e normalizza JSON snapshot (`exercises_snapshot`) in `UiExercise[]`
 */
export type UiExerciseType = 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface UiSubExercise {
  id?: string;
  name: string;
  type: 'reps' | 'isometry' | 'cardio';
  reps: number;
  duration_seconds: number;
  weight_kg?: number | null;
  instruction_note?: string | null;
}

export interface UiPyramidStep {
  reps: number;
  rest_seconds: number;
  weight_kg?: number | null;
  instruction_note?: string | null;
}

export interface UiExercise {
  id: string;
  type: UiExerciseType;
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  order_index: number;
  group_category?: 'superset' | 'circuit';
  tracking_mode?: 'reps_load' | 'stopwatch';
  lap_durations_seconds?: number[];
  total_circuit_duration_seconds?: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: UiPyramidStep[];
  subExercises?: UiSubExercise[];
  instruction_note?: string | null;
  auto_count_type?: 'pushups' | 'pullups' | null;
  completed_sets_records?: (number | null)[];
  completed_sets_reps?: (number | null)[];
}

const toSafeInt = (value: unknown, fallback: number) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const toSafeDecimal = (value: unknown, fallback: number | null) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
};

const toOptionalNote = (value: unknown) => {
  const note = String(value || '').trim();
  return note.length > 0 ? note : null;
};

export const extractNoteMeta = (
  rawNote: unknown
): { note: string | null; meta: Record<string, any> | null } => {
  const str = String(rawNote ?? '').trim();
  const metaIdx = str.indexOf('@@@meta:');
  if (metaIdx === -1) {
    return { note: str.length > 0 ? str : null, meta: null };
  }
  const notePart = str.substring(0, metaIdx).trim();
  const metaStr = str.substring(metaIdx + 8).trim();
  let meta: Record<string, any> | null = null;
  try {
    const parsed = JSON.parse(metaStr);
    if (parsed && typeof parsed === 'object') {
      meta = parsed as Record<string, any>;
    }
  } catch {
    meta = null;
  }
  return { note: notePart.length > 0 ? notePart : null, meta };
};

export const encodeNoteWithMeta = (
  note?: string | null,
  meta?: Record<string, unknown> | null
): string | null => {
  const cleanNote = String(note ?? '').replace(/\s*@@@meta:[\s\S]*$/, '').trim();
  const cleanMetaEntries = Object.entries(meta ?? {}).filter(([, value]) => value !== undefined);
  if (cleanMetaEntries.length === 0) {
    return cleanNote.length > 0 ? cleanNote : null;
  }
  const metaSuffix = `@@@meta:${JSON.stringify(Object.fromEntries(cleanMetaEntries))}`;
  return cleanNote.length > 0 ? `${cleanNote} ${metaSuffix}` : metaSuffix;
};

const stripStorageMeta = (name: string) => name.replace(/@@@meta:.*$/, '').trim();

const parseJsonIfAny = (raw: string) => {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

export const parseDbExerciseRows = (rows: any[]): UiExercise[] => {
  const ordered = [...(rows || [])].sort((a, b) => toSafeInt(a.ordine, 1) - toSafeInt(b.ordine, 1));
  const grouped = new Map<
    string,
    {
      ex: UiExercise;
      order: number;
      zeroRest?: boolean;
      subs: Array<{ idx: number; item: UiSubExercise }>;
      steps: Array<{ idx: number; item: UiPyramidStep }>;
    }
  >();
  const output: UiExercise[] = [];

  ordered.forEach((row, idx) => {
    const dictNameRaw = String(row?.esercizi?.nome || '');
    const dictName = stripStorageMeta(dictNameRaw);
    const jsonPayload = parseJsonIfAny(dictNameRaw);
    const orderIndex = Math.max(0, toSafeInt(row.ordine, 1) - 1);
    const sets = Math.max(1, toSafeInt(row.set_num, 1));
    const restSeconds = Math.max(0, toSafeInt(row.rest_secondi, 0));
    const transitionRestSeconds = Math.max(0, toSafeInt(row.rest_tra_esercizi, 0));
    const noteMeta = extractNoteMeta(row.note_esercizio);
    const isExplicitCardio =
      String(row.tipo || '').toUpperCase() === 'CARDIO' ||
      noteMeta.meta?.exerciseType === 'cardio' ||
      jsonPayload?.type === 'cardio';
    const isExplicitIso = String(row.tipo || '').toUpperCase() === 'ISOMETRIA';
    const rowType: UiExerciseType = isExplicitCardio ? 'cardio' : (isExplicitIso ? 'isometry' : 'reps');

    if (row.id_superset) {
      const key = `superset:${row.id_superset}`;
      const supersetRecord = Array.isArray(row.superset) ? row.superset[0] : row.superset;
      const supersetSets = Math.max(1, toSafeInt(supersetRecord?.round_totali, sets));
      const isCircuitFromMeta =
        noteMeta.meta?.groupCategory === 'circuit' ||
        String(supersetRecord?.tipo_gruppo || row?.tipo_gruppo || '').toLowerCase() === 'circuit' ||
        (jsonPayload && (jsonPayload.group_category === 'circuit' || jsonPayload.type === 'circuit'));
      const metaBlockName =
        typeof noteMeta.meta?.blockName === 'string' && noteMeta.meta.blockName.trim()
          ? noteMeta.meta.blockName.trim()
          : '';
      const metaParentNote =
        typeof noteMeta.meta?.parentNote === 'string' && noteMeta.meta.parentNote.trim()
          ? noteMeta.meta.parentNote.trim()
          : '';

      if (!grouped.has(key)) {
        const blockType: UiExerciseType = isCircuitFromMeta ? 'circuit' : 'superset';
        grouped.set(key, {
          ex: {
            id: String(row.id_superset),
            type: blockType,
            group_category: isCircuitFromMeta ? 'circuit' : 'superset',
            tracking_mode: isCircuitFromMeta ? 'stopwatch' : 'reps_load',
            name: metaBlockName || (isCircuitFromMeta ? 'Circuito' : 'Superset'),
            sets: supersetSets,
            reps: 0,
            duration_seconds: 0,
            rest_seconds: restSeconds,
            transition_rest_seconds: transitionRestSeconds,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            order_index: orderIndex,
            subExercises: [],
            instruction_note: metaParentNote || null,
          },
          order: orderIndex,
          zeroRest: noteMeta.meta?.zeroRest === true,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      if (supersetRecord?.round_totali) {
        g.ex.sets = Math.max(g.ex.sets || 1, toSafeInt(supersetRecord.round_totali, 1));
      }
      if (noteMeta.meta?.zeroRest === true) {
        g.zeroRest = true;
      }
      if (metaBlockName) {
        g.ex.name = metaBlockName;
      }
      if (metaParentNote) {
        g.ex.instruction_note = metaParentNote;
      }
      if (isCircuitFromMeta) {
        g.ex.type = 'circuit';
        g.ex.group_category = 'circuit';
        g.ex.tracking_mode = 'stopwatch';
        if (g.ex.name === 'Superset') g.ex.name = 'Circuito';
      }
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;
      g.ex.transition_rest_seconds = Math.max(0, Math.max(g.ex.transition_rest_seconds || 0, transitionRestSeconds));
      if (restSeconds > 0) {
        g.ex.rest_seconds = Math.max(g.ex.rest_seconds || 0, restSeconds);
      }

      if (Array.isArray(jsonPayload)) {
        g.ex.subExercises = (jsonPayload as UiSubExercise[]).map((item) => ({
          ...item,
          weight_kg: toSafeDecimal((item as { weight_kg?: unknown }).weight_kg, null),
          instruction_note: toOptionalNote((item as { instruction_note?: unknown }).instruction_note),
        }));
      } else if (jsonPayload?.subExercises && Array.isArray(jsonPayload.subExercises)) {
        g.ex.subExercises = (jsonPayload.subExercises as UiSubExercise[]).map((item) => ({
          ...item,
          weight_kg: toSafeDecimal((item as { weight_kg?: unknown }).weight_kg, null),
          instruction_note: toOptionalNote((item as { instruction_note?: unknown }).instruction_note),
        }));
        if (jsonPayload.name) g.ex.name = jsonPayload.name;
        if (jsonPayload.lap_durations_seconds) g.ex.lap_durations_seconds = jsonPayload.lap_durations_seconds;
        if (jsonPayload.total_circuit_duration_seconds) g.ex.total_circuit_duration_seconds = jsonPayload.total_circuit_duration_seconds;
      } else {
        g.subs.push({
          idx,
          item: {
            name: dictName,
            type: rowType,
            reps: rowType === 'reps' ? Math.max(0, toSafeInt(row.reps, 0)) : 0,
            duration_seconds: rowType !== 'reps' ? Math.max(0, toSafeInt(row.durata_secondi, 0)) : 0,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            instruction_note: noteMeta.note,
          },
        });
      }
      return;
    }

    if (row.id_emom) {
      const key = `emom:${row.id_emom}`;
      const emomRecord = Array.isArray(row.emom) ? row.emom[0] : row.emom;
      const totalRounds = Math.max(1, toSafeInt(emomRecord?.round_totali, sets));
      const roundDuration = Math.max(1, toSafeInt(emomRecord?.durata_round_secondi, 60));
      const metaBlockName =
        typeof noteMeta.meta?.blockName === 'string' && noteMeta.meta.blockName.trim()
          ? noteMeta.meta.blockName.trim()
          : '';
      const metaParentNote =
        typeof noteMeta.meta?.parentNote === 'string' && noteMeta.meta.parentNote.trim()
          ? noteMeta.meta.parentNote.trim()
          : '';

      if (!grouped.has(key)) {
        grouped.set(key, {
          ex: {
            id: String(row.id_emom),
            type: 'emom',
            name: metaBlockName || 'EMOM Circuit',
            sets,
            reps: 0,
            duration_seconds: roundDuration,
            rest_seconds: restSeconds,
            transition_rest_seconds: transitionRestSeconds,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            order_index: orderIndex,
            emom_rounds: totalRounds,
            emom_round_duration: roundDuration,
            subExercises: [],
            instruction_note: metaParentNote || null,
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      if (emomRecord?.round_totali) {
        g.ex.emom_rounds = Math.max(g.ex.emom_rounds || 1, toSafeInt(emomRecord.round_totali, 1));
      }
      if (emomRecord?.durata_round_secondi) {
        g.ex.emom_round_duration = Math.max(g.ex.emom_round_duration || 60, toSafeInt(emomRecord.durata_round_secondi, 60));
        g.ex.duration_seconds = g.ex.emom_round_duration;
      }
      if (metaBlockName) {
        g.ex.name = metaBlockName;
      }
      if (metaParentNote) {
        g.ex.instruction_note = metaParentNote;
      }
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;
      g.ex.transition_rest_seconds = Math.max(0, Math.max(g.ex.transition_rest_seconds || 0, transitionRestSeconds));

      if (Array.isArray(jsonPayload)) {
        g.ex.subExercises = (jsonPayload as UiSubExercise[]).map((item) => ({
          ...item,
          weight_kg: toSafeDecimal((item as { weight_kg?: unknown }).weight_kg, null),
          instruction_note: toOptionalNote((item as { instruction_note?: unknown }).instruction_note),
        }));
      } else if (jsonPayload?.subExercises && Array.isArray(jsonPayload.subExercises)) {
        g.ex.subExercises = (jsonPayload.subExercises as UiSubExercise[]).map((item) => ({
          ...item,
          weight_kg: toSafeDecimal((item as { weight_kg?: unknown }).weight_kg, null),
          instruction_note: toOptionalNote((item as { instruction_note?: unknown }).instruction_note),
        }));
        g.ex.emom_rounds = Math.max(1, toSafeInt(jsonPayload.emom_rounds, g.ex.emom_rounds || 1));
        g.ex.emom_round_duration = Math.max(1, toSafeInt(jsonPayload.emom_round_duration, g.ex.emom_round_duration || 60));
        g.ex.duration_seconds = g.ex.emom_round_duration;
        g.ex.instruction_note = toOptionalNote((jsonPayload as { instruction_note?: unknown }).instruction_note) || g.ex.instruction_note;
      } else {
        g.subs.push({
          idx: Math.max(0, toSafeInt(row.stepindex_emom, idx + 1)),
          item: {
            name: dictName,
            type: rowType,
            reps: rowType === 'reps' ? Math.max(0, toSafeInt(row.reps, 0)) : 0,
            duration_seconds: rowType !== 'reps' ? Math.max(0, toSafeInt(row.durata_secondi, 0)) : 0,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            instruction_note: noteMeta.note,
          },
        });
      }
      return;
    }

    if (row.id_piramide) {
      const key = `pyramid:${row.id_piramide}`;
      const metaParentNote =
        typeof noteMeta.meta?.parentNote === 'string' && noteMeta.meta.parentNote.trim()
          ? noteMeta.meta.parentNote.trim()
          : '';
      if (!grouped.has(key)) {
        grouped.set(key, {
          ex: {
            id: String(row.id_piramide),
            type: 'pyramid',
            name: dictName || 'Pyramid',
            sets: 1,
            reps: 0,
            duration_seconds: 0,
            rest_seconds: 0,
            transition_rest_seconds: transitionRestSeconds,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            order_index: orderIndex,
            pyramid_steps: [],
            instruction_note: metaParentNote || null,
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;
      g.ex.transition_rest_seconds = Math.max(0, Math.max(g.ex.transition_rest_seconds || 0, transitionRestSeconds));
      if (metaParentNote) {
        g.ex.instruction_note = metaParentNote;
      }

      if (jsonPayload?.steps && Array.isArray(jsonPayload.steps)) {
        const payloadWeight = toSafeDecimal((jsonPayload as { weight_kg?: unknown }).weight_kg, null);
        g.ex.pyramid_steps = (
          jsonPayload.steps as Array<{
            reps?: unknown;
            rest_seconds?: unknown;
            weight_kg?: unknown;
            instruction_note?: unknown;
          }>
        ).map((step) => ({
          reps: Math.max(0, toSafeInt(step.reps, 0)),
          rest_seconds: Math.max(0, toSafeInt(step.rest_seconds, 0)),
          weight_kg: toSafeDecimal(step.weight_kg, payloadWeight),
          instruction_note: toOptionalNote(step.instruction_note),
        }));
        g.ex.name = jsonPayload.name || g.ex.name;
        g.ex.weight_kg = payloadWeight;
        g.ex.instruction_note = toOptionalNote((jsonPayload as { instruction_note?: unknown }).instruction_note) || g.ex.instruction_note;
      } else {
        if (!g.ex.name && dictName) g.ex.name = dictName;
        if (g.ex.weight_kg == null) {
          g.ex.weight_kg = toSafeDecimal(row.peso_kg, null);
        }
        g.steps.push({
          idx: Math.max(0, toSafeInt(row.stepindex_piramide, g.steps.length + 1)),
          item: {
            reps: Math.max(0, toSafeInt(row.reps, 0)),
            rest_seconds: Math.max(0, toSafeInt(row.rest_secondi, 0)),
            weight_kg: toSafeDecimal(row.peso_kg, null),
            instruction_note: noteMeta.note,
          },
        });
      }
      return;
    }

    const noteData = extractNoteMeta(row.note_esercizio);
    output.push({
      id: String(row.id_esecuzione),
      type: rowType,
      name: dictName,
      sets,
      reps: rowType === 'reps' ? Math.max(0, toSafeInt(row.reps, 0)) : 0,
      duration_seconds: rowType !== 'reps' ? Math.max(0, toSafeInt(row.durata_secondi, 0)) : 0,
      rest_seconds: restSeconds,
      transition_rest_seconds: transitionRestSeconds,
      weight_kg: toSafeDecimal(row.peso_kg, null),
      order_index: orderIndex,
      instruction_note: noteData.note,
      auto_count_type: noteData.meta?.autoCountType || null,
    });
  });

  grouped.forEach((g) => {
    if (g.ex.type === 'circuit' && !g.zeroRest && (!g.ex.rest_seconds || g.ex.rest_seconds <= 0)) {
      g.ex.rest_seconds = 60;
    }
    if ((!g.ex.subExercises || g.ex.subExercises.length === 0) && g.subs.length > 0) {
      g.ex.subExercises = g.subs.sort((a, b) => a.idx - b.idx).map((s) => s.item);
    }
    if ((!g.ex.pyramid_steps || g.ex.pyramid_steps.length === 0) && g.steps.length > 0) {
      g.ex.pyramid_steps = g.steps.sort((a, b) => a.idx - b.idx).map((s) => s.item);
    }
    output.push(g.ex);
  });

  return output.sort((a, b) => a.order_index - b.order_index);
};

const toNullableRecordNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toPositiveSnapshotWeight = (value: unknown): number | null => {
  const dec = toSafeDecimal(value, null);
  return dec != null && dec > 0 ? dec : null;
};

const normalizeSnapshotExerciseType = (rawType: unknown): UiExerciseType => {
  const typeRaw = String(rawType || 'reps').toLowerCase().trim();
  if (
    typeRaw === 'isometry' ||
    typeRaw === 'cardio' ||
    typeRaw === 'superset' ||
    typeRaw === 'circuit' ||
    typeRaw === 'emom' ||
    typeRaw === 'pyramid'
  ) {
    return typeRaw;
  }
  return 'reps';
};

export const toSnapshotExercises = (raw: unknown): UiExercise[] => {
  let parsedRaw = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsedRaw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsedRaw)) return [];

  return parsedRaw
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))
    )
    .map((item, idx) => {
      const type = normalizeSnapshotExerciseType(item.type);

      const groupCategoryRaw = String(item.group_category || '').toLowerCase().trim();
      const group_category: 'superset' | 'circuit' | undefined =
        groupCategoryRaw === 'circuit' || type === 'circuit'
          ? 'circuit'
          : groupCategoryRaw === 'superset' || type === 'superset'
            ? 'superset'
            : undefined;

      const trackingModeRaw = String(item.tracking_mode || '').toLowerCase().trim();
      const tracking_mode: 'reps_load' | 'stopwatch' | undefined =
        trackingModeRaw === 'stopwatch'
          ? 'stopwatch'
          : trackingModeRaw === 'reps_load'
            ? 'reps_load'
            : undefined;

      const subExercises = Array.isArray(item.subExercises)
        ? item.subExercises
            .filter(
              (sub): sub is Record<string, unknown> =>
                Boolean(sub && typeof sub === 'object' && !Array.isArray(sub))
            )
            .map((sub) => {
              const subTypeRaw = String(sub.type || 'reps').toLowerCase().trim();
              const subType: UiSubExercise['type'] =
                subTypeRaw === 'cardio'
                  ? 'cardio'
                  : subTypeRaw === 'isometry'
                    ? 'isometry'
                    : 'reps';

              const normalizedSub: UiSubExercise = {
                name: String(sub.name || ''),
                type: subType,
                reps: Math.max(0, toSafeInt(sub.reps, 0)),
                duration_seconds: Math.max(0, toSafeInt(sub.duration_seconds, 0)),
                weight_kg: toPositiveSnapshotWeight(sub.weight_kg ?? sub.peso_kg ?? sub.weight),
                instruction_note: toOptionalNote(sub.instruction_note),
              };
              if (sub.id !== undefined && sub.id !== null && String(sub.id).trim() !== '') {
                normalizedSub.id = String(sub.id);
              }
              return normalizedSub;
            })
        : undefined;

      const pyramidSteps = Array.isArray(item.pyramid_steps)
        ? item.pyramid_steps
            .filter(
              (step): step is Record<string, unknown> =>
                Boolean(step && typeof step === 'object' && !Array.isArray(step))
            )
            .map((step) => ({
              reps: Math.max(0, toSafeInt(step.reps, 0)),
              rest_seconds: Math.max(0, toSafeInt(step.rest_seconds, 0)),
              weight_kg: toPositiveSnapshotWeight(step.weight_kg ?? step.peso_kg ?? step.weight),
              instruction_note: toOptionalNote(step.instruction_note),
            } satisfies UiPyramidStep))
        : undefined;

      const rawRecords = Array.isArray(item.completed_sets_records)
        ? item.completed_sets_records
        : Array.isArray(item.completed_sets_reps)
          ? item.completed_sets_reps
          : null;
      const completed_sets_records = rawRecords ? rawRecords.map(toNullableRecordNumber) : undefined;

      const lapDurations = Array.isArray(item.lap_durations_seconds)
        ? item.lap_durations_seconds.map((v) => Math.max(0, toSafeInt(v, 0)))
        : undefined;

      const rawTotalCircuitDuration = toNullableRecordNumber(item.total_circuit_duration_seconds);
      const total_circuit_duration_seconds =
        rawTotalCircuitDuration !== null
          ? Math.max(0, Math.trunc(rawTotalCircuitDuration))
          : undefined;

      const rawEmomRounds = toNullableRecordNumber(item.emom_rounds);
      const emom_rounds =
        rawEmomRounds !== null && rawEmomRounds > 0
          ? Math.max(1, Math.trunc(rawEmomRounds))
          : type === 'emom'
            ? Math.max(1, toSafeInt(item.sets, 1))
            : undefined;

      const rawEmomRoundDuration = toNullableRecordNumber(item.emom_round_duration);
      const emom_round_duration =
        rawEmomRoundDuration !== null && rawEmomRoundDuration > 0
          ? Math.max(1, Math.trunc(rawEmomRoundDuration))
          : type === 'emom'
            ? Math.max(1, toSafeInt(item.duration_seconds, 60))
            : undefined;

      const autoCountRaw = item.auto_count_type;
      const auto_count_type: 'pushups' | 'pullups' | null =
        autoCountRaw === 'pushups' || autoCountRaw === 'pullups' ? autoCountRaw : null;

      return {
        id: String(item.id || `snapshot-${idx}`),
        type,
        name: String(item.name || `Esercizio ${idx + 1}`),
        sets: Math.max(1, toSafeInt(item.sets, 1)),
        reps: Math.max(0, toSafeInt(item.reps, 0)),
        duration_seconds: Math.max(0, toSafeInt(item.duration_seconds, 0)),
        rest_seconds: Math.max(0, toSafeInt(item.rest_seconds, 0)),
        transition_rest_seconds: Math.max(0, toSafeInt(item.transition_rest_seconds, 0)),
        weight_kg: toPositiveSnapshotWeight(item.weight_kg ?? item.peso_kg ?? item.weight),
        order_index: Math.max(0, toSafeInt(item.order_index, idx)),
        group_category,
        tracking_mode,
        lap_durations_seconds: lapDurations,
        total_circuit_duration_seconds,
        emom_rounds,
        emom_round_duration,
        pyramid_steps: pyramidSteps,
        subExercises,
        instruction_note: toOptionalNote(item.instruction_note),
        auto_count_type,
        completed_sets_records,
        completed_sets_reps: completed_sets_records,
      } satisfies UiExercise;
    })
    .sort((a, b) => a.order_index - b.order_index);
};
