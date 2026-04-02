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

export const parseDbExerciseRows = (rows: any[]): UiExercise[] => {
  return [...(rows || [])]
    .sort((a, b) => toSafeInt(a.ordine, 1) - toSafeInt(b.ordine, 1))
    .map((row) => {
      const dictName = row?.esercizi?.nome || '';
      const orderIndex = Math.max(0, toSafeInt(row.ordine, 1) - 1);
      const sets = Math.max(1, toSafeInt(row.set_num, 1));
      const restSeconds = Math.max(0, toSafeInt(row.rest_secondi, 0));

      if (row.id_superset) {
        let parsedSubs: UiSubExercise[] = [];
        try {
          const parsed = JSON.parse(dictName);
          if (Array.isArray(parsed)) parsedSubs = parsed;
        } catch {
          parsedSubs = [];
        }

        return {
          id: String(row.id_esecuzione),
          type: 'superset',
          name: 'Superset Circuit',
          sets: Math.max(1, toSafeInt(row?.superset?.round_totali, sets)),
          reps: 0,
          duration_seconds: 0,
          rest_seconds: restSeconds,
          order_index: orderIndex,
          subExercises: parsedSubs,
        };
      }

      if (row.id_emom) {
        let payload: any = null;
        let parsedSubs: UiSubExercise[] = [];
        try {
          payload = JSON.parse(dictName);
          if (Array.isArray(payload)) parsedSubs = payload;
          else if (payload?.subExercises) parsedSubs = payload.subExercises;
        } catch {
          payload = null;
        }

        return {
          id: String(row.id_esecuzione),
          type: 'emom',
          name: 'EMOM Circuit',
          sets,
          reps: 0,
          duration_seconds: 0,
          rest_seconds: restSeconds,
          order_index: orderIndex,
          emom_rounds: Math.max(1, toSafeInt(row?.emom?.round_totali ?? payload?.emom_rounds, 1)),
          emom_round_duration: Math.max(1, toSafeInt(row?.emom?.durata_round_secondi ?? payload?.emom_round_duration, 60)),
          subExercises: parsedSubs,
        };
      }

      if (row.id_piramide) {
        let payload: any = null;
        try {
          payload = JSON.parse(dictName);
        } catch {
          payload = null;
        }

        return {
          id: String(row.id_esecuzione),
          type: 'pyramid',
          name: payload?.name || 'Pyramid',
          sets: 1,
          reps: 0,
          duration_seconds: 0,
          rest_seconds: 0,
          order_index: orderIndex,
          pyramid_steps: Array.isArray(payload?.steps) ? payload.steps : [],
        };
      }

      const isIsometry = String(row.tipo || '').toUpperCase() === 'ISOMETRIA';
      return {
        id: String(row.id_esecuzione),
        type: isIsometry ? 'isometry' : 'reps',
        name: dictName,
        sets,
        reps: Math.max(0, toSafeInt(row.reps, 0)),
        duration_seconds: Math.max(0, toSafeInt(row.durata_secondi, 0)),
        rest_seconds: restSeconds,
        order_index: orderIndex,
      };
    });
};
