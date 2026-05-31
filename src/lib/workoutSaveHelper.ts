import { supabase } from './supabase';

export interface SaveExercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
  }[];
}

const normalizeExerciseName = (name: string) => name.replace(/@@@meta:.*$/, '').trim();

const toDbWeight = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

const ensureExerciseDictionaryId = async (name: string) => {
  const normalized = normalizeExerciseName(name);
  const { data: existing, error: existingError } = await supabase
    .from('esercizi')
    .select('id_esercizio')
    .eq('nome', normalized)
    .order('id_esercizio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id_esercizio) return existing.id_esercizio;

  const { data: inserted, error: insertError } = await supabase
    .from('esercizi')
    .insert([{ nome: normalized }])
    .select('id_esercizio')
    .single();

  if (!insertError && inserted?.id_esercizio) return inserted.id_esercizio;

  const { data: afterRace, error: raceReadError } = await supabase
    .from('esercizi')
    .select('id_esercizio')
    .eq('nome', normalized)
    .order('id_esercizio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (raceReadError || !afterRace?.id_esercizio) throw insertError || raceReadError;
  return afterRace.id_esercizio;
};

export const saveExercisesToDb = async (schedaId: number, exercises: SaveExercise[]): Promise<void> => {
  // Delete old exercises
  const { error: deleteError } = await supabase
    .from('esecuzioni')
    .delete()
    .eq('id_scheda', schedaId);
  if (deleteError) throw deleteError;

  const rowsToInsert: any[] = [];
  let orderCounter = 1;

  for (let idx = 0; idx < exercises.length; idx += 1) {
    const ex = exercises[idx];
    const transitionRestToPersist =
      idx < exercises.length - 1 && (ex.transition_rest_seconds || 0) > 0
        ? Math.max(0, Math.trunc(ex.transition_rest_seconds || 0))
        : null;

    if (ex.type === 'superset') {
      const { data, error: supersetError } = await supabase
        .from('superset')
        .insert([{ round_totali: Math.max(1, ex.sets) }])
        .select('id_superset')
        .single();
      if (supersetError) throw supersetError;

      for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
        const sub = ex.subExercises![subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isIso = sub.type === 'isometry';

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: String(sub.instruction_note || '').trim() || null,
          tipo: isIso ? 'ISOMETRIA' : 'REPS',
          reps: isIso ? null : Math.max(0, sub.reps ?? 0),
          durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
          id_superset: data.id_superset,
          id_piramide: null,
          stepindex_piramide: null,
          id_emom: null,
          stepindex_emom: null,
        });

        orderCounter += 1;
      }

      continue;
    }

    if (ex.type === 'emom') {
      const { data, error: emomError } = await supabase
        .from('emom')
        .insert([{ round_totali: Math.max(1, ex.emom_rounds || 1), durata_round_secondi: Math.max(1, ex.emom_round_duration || 60) }])
        .select('id_emom')
        .single();
      if (emomError) throw emomError;

      for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
        const sub = ex.subExercises![subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isIso = sub.type === 'isometry';

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: String(sub.instruction_note || '').trim() || null,
          tipo: isIso ? 'ISOMETRIA' : 'REPS',
          reps: isIso ? null : Math.max(0, sub.reps ?? 0),
          durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
          id_superset: null,
          id_piramide: null,
          stepindex_piramide: null,
          id_emom: data.id_emom,
          stepindex_emom: subIdx + 1,
        });

        orderCounter += 1;
      }

      continue;
    }

    if (ex.type === 'pyramid') {
      const { data, error: piramideError } = await supabase
        .from('piramide')
        .insert([{}])
        .select('id_piramide')
        .single();
      if (piramideError) throw piramideError;

      for (let stepIdx = 0; stepIdx < (ex.pyramid_steps || []).length; stepIdx += 1) {
        const step = ex.pyramid_steps![stepIdx];
        const idEsercizio = await ensureExerciseDictionaryId(ex.name);

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: 1,
          rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(step.weight_kg),
          note_esercizio: String(ex.instruction_note || '').trim() || null,
          tipo: 'REPS',
          reps: Math.max(0, step.reps ?? 0),
          durata_secondi: null,
          id_superset: null,
          id_piramide: data.id_piramide,
          stepindex_piramide: stepIdx + 1,
          id_emom: null,
          stepindex_emom: null,
        });

        orderCounter += 1;
      }

      continue;
    }

    const idEsercizio = await ensureExerciseDictionaryId(ex.name);
    const isIsometry = ex.type === 'isometry';

    let noteToSave = String(ex.instruction_note || '').trim();
    if (ex.auto_count_type) {
      noteToSave += (noteToSave ? ' ' : '') + `@@@meta:${JSON.stringify({ autoCountType: ex.auto_count_type })}`;
    }

    rowsToInsert.push({
      id_scheda: schedaId,
      id_esercizio: idEsercizio,
      ordine: orderCounter,
      set_num: Math.max(1, ex.sets || 1),
      rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
      rest_tra_esercizi: transitionRestToPersist,
      peso_kg: toDbWeight(ex.weight_kg),
      note_esercizio: noteToSave || null,
      tipo: isIsometry ? 'ISOMETRIA' : 'REPS',
      reps: isIsometry ? null : Math.max(0, ex.reps ?? 0),
      durata_secondi: isIsometry ? Math.max(0, ex.duration_seconds ?? 0) : null,
      id_superset: null,
      id_piramide: null,
      stepindex_piramide: null,
      id_emom: null,
      stepindex_emom: null,
    });

    orderCounter += 1;
  }

  const { error: exercisesError } = await supabase
    .from('esecuzioni')
    .insert(rowsToInsert);

  if (exercisesError) throw exercisesError;
};
