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
 * Funzione principale esportata: `parseDbExerciseRows(rows)`
 */
export type UiExerciseType = 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface UiSubExercise {
  id?: string;
  name: string;
  type: 'reps' | 'isometry';
  reps: number;
  duration_seconds: number;
  weight_kg?: number | null;
  instruction_note?: string | null;
}

export interface UiPyramidStep {
  reps: number;
  rest_seconds: number;
  weight_kg?: number | null;
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
}

const toSafeInt = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const toSafeDecimal = (value: unknown, fallback: number | null) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
};

const toOptionalNote = (value: unknown) => {
  const note = String(value || '').trim();
  return note.length > 0 ? note : null;
};

const extractNoteMeta = (rawNote: unknown): { note: string | null; meta: any } => {
  const str = String(rawNote || '').trim();
  const metaIdx = str.indexOf('@@@meta:');
  if (metaIdx === -1) {
    return { note: str.length > 0 ? str : null, meta: {} };
  }
  const notePart = str.substring(0, metaIdx).trim();
  const metaStr = str.substring(metaIdx + 8).trim();
  let meta = {};
  try {
    meta = JSON.parse(metaStr);
  } catch {}
  return { note: notePart.length > 0 ? notePart : null, meta };
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
  const grouped = new Map<string, { ex: UiExercise; order: number; subs: Array<{ idx: number; item: UiSubExercise }>; steps: Array<{ idx: number; item: UiPyramidStep }> }>();
  const output: UiExercise[] = [];

  ordered.forEach((row, idx) => {
    const dictNameRaw = String(row?.esercizi?.nome || '');
    const dictName = stripStorageMeta(dictNameRaw);
    const jsonPayload = parseJsonIfAny(dictNameRaw);
    const orderIndex = Math.max(0, toSafeInt(row.ordine, 1) - 1);
    const sets = Math.max(1, toSafeInt(row.set_num, 1));
    const restSeconds = Math.max(0, toSafeInt(row.rest_secondi, 0));
    const transitionRestSeconds = Math.max(0, toSafeInt(row.rest_tra_esercizi, 0));
    const rowType = String(row.tipo || '').toUpperCase() === 'ISOMETRIA' ? 'isometry' : 'reps';

    if (row.id_superset) {
      const key = `superset:${row.id_superset}`;
      const noteMeta = extractNoteMeta(row.note_esercizio);
      const isCircuitFromMeta =
        noteMeta.meta?.groupCategory === 'circuit' ||
        String(row?.superset?.tipo_gruppo || row?.tipo_gruppo || '').toLowerCase() === 'circuit' ||
        (jsonPayload && (jsonPayload.group_category === 'circuit' || jsonPayload.type === 'circuit'));

      if (!grouped.has(key)) {
        const blockType: UiExerciseType = isCircuitFromMeta ? 'circuit' : 'superset';
        grouped.set(key, {
          ex: {
            id: String(row.id_superset),
            type: blockType,
            group_category: isCircuitFromMeta ? 'circuit' : 'superset',
            tracking_mode: isCircuitFromMeta ? 'stopwatch' : 'reps_load',
            name: isCircuitFromMeta ? 'Circuito' : 'Superset',
            sets: Math.max(1, toSafeInt(row?.superset?.round_totali, sets)),
            reps: 0,
            duration_seconds: 0,
            rest_seconds: restSeconds,
            transition_rest_seconds: transitionRestSeconds,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            order_index: orderIndex,
            subExercises: [],
            instruction_note: noteMeta.note,
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
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
      if (isCircuitFromMeta && (!g.ex.rest_seconds || g.ex.rest_seconds <= 0)) {
        g.ex.rest_seconds = 60;
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
        if (!g.ex.instruction_note) {
          g.ex.instruction_note = noteMeta.note;
        }
        g.subs.push({
          idx,
          item: {
            name: dictName,
            type: rowType,
            reps: Math.max(0, toSafeInt(row.reps, 0)),
            duration_seconds: Math.max(0, toSafeInt(row.durata_secondi, 0)),
            weight_kg: toSafeDecimal(row.peso_kg, null),
            instruction_note: noteMeta.note,
          },
        });
      }
      return;
    }

    if (row.id_emom) {
      const key = `emom:${row.id_emom}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ex: {
            id: String(row.id_emom),
            type: 'emom',
            name: 'EMOM Circuit',
            sets,
            reps: 0,
            duration_seconds: Math.max(1, toSafeInt(row?.emom?.durata_round_secondi, 60)),
            rest_seconds: restSeconds,
            transition_rest_seconds: transitionRestSeconds,
            weight_kg: toSafeDecimal(row.peso_kg, null),
            order_index: orderIndex,
            emom_rounds: Math.max(1, toSafeInt(row?.emom?.round_totali, 1)),
            emom_round_duration: Math.max(1, toSafeInt(row?.emom?.durata_round_secondi, 60)),
            subExercises: [],
            instruction_note: toOptionalNote(row.note_esercizio),
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
        if (!g.ex.instruction_note) {
          g.ex.instruction_note = toOptionalNote(row.note_esercizio);
        }
        g.subs.push({
          idx: Math.max(0, toSafeInt(row.stepindex_emom, idx + 1)),
          item: {
            name: dictName,
            type: rowType,
            reps: Math.max(0, toSafeInt(row.reps, 0)),
            duration_seconds: Math.max(0, toSafeInt(row.durata_secondi, 0)),
            weight_kg: toSafeDecimal(row.peso_kg, null),
            instruction_note: toOptionalNote(row.note_esercizio),
          },
        });
      }
      return;
    }

    if (row.id_piramide) {
      const key = `pyramid:${row.id_piramide}`;
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
            instruction_note: toOptionalNote(row.note_esercizio),
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

      if (jsonPayload?.steps && Array.isArray(jsonPayload.steps)) {
        const payloadWeight = toSafeDecimal((jsonPayload as { weight_kg?: unknown }).weight_kg, null);
        g.ex.pyramid_steps = (jsonPayload.steps as Array<{ reps?: unknown; rest_seconds?: unknown; weight_kg?: unknown }>).map((step) => ({
          reps: Math.max(1, toSafeInt(step.reps, 1)),
          rest_seconds: Math.max(0, toSafeInt(step.rest_seconds, 0)),
          weight_kg: toSafeDecimal(step.weight_kg, payloadWeight),
        }));
        g.ex.name = jsonPayload.name || g.ex.name;
        g.ex.weight_kg = payloadWeight;
        g.ex.instruction_note = toOptionalNote((jsonPayload as { instruction_note?: unknown }).instruction_note) || g.ex.instruction_note;
      } else {
        if (!g.ex.name && dictName) g.ex.name = dictName;
        if (g.ex.weight_kg == null) {
          g.ex.weight_kg = toSafeDecimal(row.peso_kg, null);
        }
        if (!g.ex.instruction_note) {
          g.ex.instruction_note = toOptionalNote(row.note_esercizio);
        }
        g.steps.push({
          idx: Math.max(0, toSafeInt(row.stepindex_piramide, g.steps.length + 1)),
          item: {
            reps: Math.max(1, toSafeInt(row.reps, 1)),
            rest_seconds: Math.max(0, toSafeInt(row.rest_secondi, 0)),
            weight_kg: toSafeDecimal(row.peso_kg, null),
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
      reps: Math.max(0, toSafeInt(row.reps, 0)),
      duration_seconds: Math.max(0, toSafeInt(row.durata_secondi, 0)),
      rest_seconds: restSeconds,
      transition_rest_seconds: transitionRestSeconds,
      weight_kg: toSafeDecimal(row.peso_kg, null),
      order_index: orderIndex,
      instruction_note: noteData.note,
      auto_count_type: noteData.meta?.autoCountType || null,
    });
  });

  grouped.forEach((g) => {
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
