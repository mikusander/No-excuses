export type UiExerciseType = 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';

export interface UiSubExercise {
  name: string;
  type: 'reps' | 'isometry';
  reps: number;
  duration_seconds: number;
}

export interface UiPyramidStep {
  reps: number;
  rest_seconds: number;
}

export interface UiExercise {
  id: string;
  type: UiExerciseType;
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  order_index: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: UiPyramidStep[];
  subExercises?: UiSubExercise[];
}

const toSafeInt = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
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
    const rowType = String(row.tipo || '').toUpperCase() === 'ISOMETRIA' ? 'isometry' : 'reps';

    if (row.id_superset) {
      const key = `superset:${row.id_superset}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ex: {
            id: String(row.id_superset),
            type: 'superset',
            name: 'Superset Circuit',
            sets: Math.max(1, toSafeInt(row?.superset?.round_totali, sets)),
            reps: 0,
            duration_seconds: 0,
            rest_seconds: restSeconds,
            order_index: orderIndex,
            subExercises: [],
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;

      if (Array.isArray(jsonPayload)) {
        g.ex.subExercises = jsonPayload as UiSubExercise[];
      } else {
        g.subs.push({
          idx,
          item: {
            name: dictName,
            type: rowType,
            reps: Math.max(1, toSafeInt(row.reps, 1)),
            duration_seconds: Math.max(1, toSafeInt(row.durata_secondi, 1)),
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
            order_index: orderIndex,
            emom_rounds: Math.max(1, toSafeInt(row?.emom?.round_totali, 1)),
            emom_round_duration: Math.max(1, toSafeInt(row?.emom?.durata_round_secondi, 60)),
            subExercises: [],
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;

      if (Array.isArray(jsonPayload)) {
        g.ex.subExercises = jsonPayload as UiSubExercise[];
      } else if (jsonPayload?.subExercises && Array.isArray(jsonPayload.subExercises)) {
        g.ex.subExercises = jsonPayload.subExercises as UiSubExercise[];
        g.ex.emom_rounds = Math.max(1, toSafeInt(jsonPayload.emom_rounds, g.ex.emom_rounds || 1));
        g.ex.emom_round_duration = Math.max(1, toSafeInt(jsonPayload.emom_round_duration, g.ex.emom_round_duration || 60));
        g.ex.duration_seconds = g.ex.emom_round_duration;
      } else {
        g.subs.push({
          idx: Math.max(0, toSafeInt(row.stepindex_emom, idx + 1)),
          item: {
            name: dictName,
            type: rowType,
            reps: Math.max(1, toSafeInt(row.reps, 1)),
            duration_seconds: Math.max(1, toSafeInt(row.durata_secondi, 1)),
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
            order_index: orderIndex,
            pyramid_steps: [],
          },
          order: orderIndex,
          subs: [],
          steps: [],
        });
      }
      const g = grouped.get(key)!;
      g.order = Math.min(g.order, orderIndex);
      g.ex.order_index = g.order;

      if (jsonPayload?.steps && Array.isArray(jsonPayload.steps)) {
        g.ex.pyramid_steps = jsonPayload.steps as UiPyramidStep[];
        g.ex.name = jsonPayload.name || g.ex.name;
      } else {
        if (!g.ex.name && dictName) g.ex.name = dictName;
        g.steps.push({
          idx: Math.max(0, toSafeInt(row.stepindex_piramide, g.steps.length + 1)),
          item: {
            reps: Math.max(1, toSafeInt(row.reps, 1)),
            rest_seconds: Math.max(0, toSafeInt(row.rest_secondi, 0)),
          },
        });
      }
      return;
    }

    output.push({
      id: String(row.id_esecuzione),
      type: rowType,
      name: dictName,
      sets,
      reps: Math.max(0, toSafeInt(row.reps, 0)),
      duration_seconds: Math.max(0, toSafeInt(row.durata_secondi, 0)),
      rest_seconds: restSeconds,
      order_index: orderIndex,
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
