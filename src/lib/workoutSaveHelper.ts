/**
 * workoutSaveHelper.ts — Funzioni per il salvataggio degli esercizi di una scheda su Supabase.
 *
 * Gestisce la persistenza delle schede di allenamento nel database con supporto
 * a tutti i tipi di esercizio: reps semplici, isometrie, superset, EMOM e piramidi.
 *
 * Schema database (tabelle Supabase):
 *  - `esercizi`   : dizionario globale degli esercizi (nome univoco → id)
 *  - `esecuzioni` : righe esercizio collegate a una scheda (id_scheda)
 *  - `superset`   : metadati dei circuit superset (round_totali)
 *  - `emom`       : metadati EMOM (round_totali, durata_round_secondi)
 *  - `piramide`   : metadati piramide (id, senza dati aggiuntivi)
 *
 * Flusso principale di `saveExercisesToDb`:
 *  1. Cancella tutti gli esercizi esistenti della scheda (delete + re-insert)
 *  2. Per ogni esercizio, risolve (o crea) l'id nel dizionario `esercizi`
 *  3. Inserisce le righe in `esecuzioni` con i riferimenti ai gruppi (superset/emom/piramide)
 *  4. Esegue un bulk insert finale di tutte le righe costruite
 *
 * Nota sui metadati inline:
 *  I campi `auto_count_type` (pushups/pullups) vengono serializzati come
 *  `@@@meta:{...}` in coda al campo `note_esercizio` per retrocompatibilità
 *  con schemi DB che non hanno colonne dedicate per questi metadati.
 */
import { supabase } from './supabase';
import { encodeNoteWithMeta } from './workoutSchemaAdapter';

/**
 * Rappresentazione di un esercizio da salvare nel database.
 * Corrisponde alla struttura UI normalizzata prima della persistenza.
 */
export interface SaveExercise {
  id: string;
  type: 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string | null;
  /** Tipo di esercizio per il conteggio automatico (MediaPipe/accelerometro) */
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  /** Riposo tra questo esercizio e il successivo (transizione) */
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  /** Sub-esercizi per superset, circuiti ed EMOM */
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry' | 'cardio';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string | null;
  }[];
  /** Step della piramide (ogni step ha reps/rest/peso/nota propri) */
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string | null;
  }[];
}

/**
 * Rimuove il suffisso `@@@meta:...` dal nome dell'esercizio prima di salvarlo
 * nel dizionario (il dizionario deve contenere solo il nome pulito).
 */
const normalizeExerciseName = (name: string) => name.replace(/@@@meta:.*$/, '').trim();

/**
 * Converte un valore peso in formato DB (2 decimali, null se non valido/negativo).
 * Rifiuta valori non finiti, NaN, e pesi ≤ 0 (nessun peso inserito).
 */
const toDbWeight = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

/**
 * `ensureExerciseDictionaryId` — Risolve o crea l'id dell'esercizio nel dizionario globale.
 *
 * Implementa un pattern "upsert sicuro" per ambienti multi-utente:
 *  1. Cerca il nome normalizzato nella tabella `esercizi`
 *  2. Se non esiste, tenta l'insert
 *  3. Se l'insert fallisce per race condition (altro utente ha inserito nel frattempo),
 *     esegue una seconda lettura per recuperare l'id appena inserito da un altro client
 *
 * @param name - Nome dell'esercizio (può contenere suffisso @@@meta: che viene rimosso)
 * @returns id_esercizio dell'esercizio nel dizionario
 */
const ensureExerciseDictionaryId = async (name: string) => {
  const normalized = normalizeExerciseName(name);

  // Tentativo 1: leggi se esiste già
  const { data: existing, error: existingError } = await supabase
    .from('esercizi')
    .select('id_esercizio')
    .eq('nome', normalized)
    .order('id_esercizio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id_esercizio) return existing.id_esercizio;

  // Tentativo 2: inserisci il nuovo esercizio
  const { data: inserted, error: insertError } = await supabase
    .from('esercizi')
    .insert([{ nome: normalized }])
    .select('id_esercizio')
    .single();

  if (!insertError && inserted?.id_esercizio) return inserted.id_esercizio;

  // Tentativo 3: race condition — un altro client ha inserito prima di noi, rileggi
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

/**
 * `saveExercisesToDb` — Salva (o aggiorna) l'elenco degli esercizi di una scheda.
 *
 * Strategia: delete + re-insert (non update singolo) per semplicità e coerenza.
 * Elimina prima tutti gli esercizi esistenti della scheda, poi ricostruisce
 * tutte le righe da zero inserendole in un unico bulk insert.
 *
 * Il campo `ordine` (orderCounter) determina la sequenza di esecuzione degli esercizi.
 * Per esercizi composti (superset/EMOM/piramide) ogni sub-esercizio/step occupa
 * una posizione separata con lo stesso `ordine` per il gruppo padre o un indice crescente.
 *
 * @param schedaId  - ID della scheda da aggiornare
 * @param exercises - Lista degli esercizi nella loro struttura UI normalizzata
 */
export const saveExercisesToDb = async (schedaId: number, exercises: SaveExercise[]): Promise<void> => {
  const defaultBlockNames = new Set(['superset', 'circuito', 'circuit', 'emom', 'emom circuit']);
  const toNonNegInt = (value: unknown, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
  };
  const toPositiveInt = (value: unknown, fallback = 1) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : fallback;
  };

  // Pre-sanificazione nomi prima di toccare il DB per evitare violazioni su ck_esercizi_nome_not_blank
  const sanitizedExercises: SaveExercise[] = exercises.map((ex, idx) => {
    const cleanName = normalizeExerciseName(String(ex.name || ''));
    const fallbackExName =
      ex.type === 'circuit'
        ? 'Circuito'
        : ex.type === 'superset'
          ? 'Superset'
          : ex.type === 'emom'
            ? 'EMOM Circuit'
            : `Esercizio ${idx + 1}`;
    return {
      ...ex,
      name: cleanName || fallbackExName,
      subExercises: ex.subExercises?.map((sub, subIdx) => ({
        ...sub,
        name: normalizeExerciseName(String(sub.name || '')) || (ex.type === 'circuit' ? `Stazione ${subIdx + 1}` : `Esercizio ${subIdx + 1}`),
      })),
    };
  });

  // Raccoglie eventuali container esistenti prima della sostituzione per pulizia orfani best-effort
  const { data: existingExecRows } = await supabase
    .from('esecuzioni')
    .select('id_superset, id_emom, id_piramide')
    .eq('id_scheda', schedaId);

  const oldSupersetIds = new Set<number>();
  const oldEmomIds = new Set<number>();
  const oldPiramideIds = new Set<number>();
  for (const row of existingExecRows || []) {
    if (row.id_superset != null) oldSupersetIds.add(Number(row.id_superset));
    if (row.id_emom != null) oldEmomIds.add(Number(row.id_emom));
    if (row.id_piramide != null) oldPiramideIds.add(Number(row.id_piramide));
  }

  // Costruisce tutte le righe e i nuovi container PRIMA di cancellare le vecchie esecuzioni
  const rowsToInsert: any[] = [];
  let orderCounter = 1;

  for (let idx = 0; idx < sanitizedExercises.length; idx += 1) {
    const ex = sanitizedExercises[idx];
    const transitionRestToPersist =
      idx < sanitizedExercises.length - 1 && (ex.transition_rest_seconds || 0) > 0
        ? toNonNegInt(ex.transition_rest_seconds, 0)
        : null;
    const trimmedParentNote = String(ex.instruction_note || '').trim();
    const customBlockName =
      ex.name.trim() && !defaultBlockNames.has(ex.name.trim().toLowerCase()) ? ex.name.trim() : undefined;

    // ── SUPERSET & CIRCUITO (Gruppi Esercizi) ──────────────────────────────
    if (ex.type === 'superset' || ex.type === 'circuit') {
      const isCircuit = ex.type === 'circuit';
      const safeRounds = toPositiveInt(ex.sets, 1);
      const restSeconds = toNonNegInt(ex.rest_seconds, 0);

      const { data, error: supersetError } = await supabase
        .from('superset')
        .insert([{ round_totali: safeRounds }])
        .select('id_superset')
        .single();
      if (supersetError) throw supersetError;

      const subs = ex.subExercises || [];
      for (let subIdx = 0; subIdx < subs.length; subIdx += 1) {
        const sub = subs[subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isCardio = sub.type === 'cardio';
        const isDuration = sub.type === 'isometry' || isCardio;

        const subMeta: Record<string, unknown> = {};
        if (isCardio) {
          subMeta.exerciseType = 'cardio';
        }
        if (subIdx === 0) {
          if (isCircuit) {
            subMeta.groupCategory = 'circuit';
            subMeta.trackingMode = 'stopwatch';
            if (restSeconds === 0) {
              subMeta.zeroRest = true;
            }
          }
          if (customBlockName) {
            subMeta.blockName = customBlockName;
          }
          if (trimmedParentNote) {
            subMeta.parentNote = trimmedParentNote;
          }
        }

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: safeRounds,
          rest_secondi: restSeconds > 0 ? restSeconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: encodeNoteWithMeta(sub.instruction_note, subMeta),
          tipo: isDuration ? 'ISOMETRIA' : 'REPS',
          reps: isDuration ? null : toNonNegInt(sub.reps, 0),
          durata_secondi: isDuration ? toNonNegInt(sub.duration_seconds, 0) : null,
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

    // ── EMOM (Every Minute On the Minute) ───────────────────────────────────
    if (ex.type === 'emom') {
      const safeEmomRounds = toPositiveInt(ex.emom_rounds ?? ex.sets, 1);
      const safeEmomDuration = toPositiveInt(ex.emom_round_duration, 60);
      const restSeconds = toNonNegInt(ex.rest_seconds, 0);

      const { data, error: emomError } = await supabase
        .from('emom')
        .insert([{ round_totali: safeEmomRounds, durata_round_secondi: safeEmomDuration }])
        .select('id_emom')
        .single();
      if (emomError) throw emomError;

      const subs = ex.subExercises || [];
      for (let subIdx = 0; subIdx < subs.length; subIdx += 1) {
        const sub = subs[subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isCardio = sub.type === 'cardio';
        const isDuration = sub.type === 'isometry' || isCardio;

        const subMeta: Record<string, unknown> = {};
        if (isCardio) {
          subMeta.exerciseType = 'cardio';
        }
        if (subIdx === 0) {
          if (customBlockName) {
            subMeta.blockName = customBlockName;
          }
          if (trimmedParentNote) {
            subMeta.parentNote = trimmedParentNote;
          }
        }

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: safeEmomRounds,
          rest_secondi: restSeconds > 0 ? restSeconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: encodeNoteWithMeta(sub.instruction_note, subMeta),
          tipo: isDuration ? 'ISOMETRIA' : 'REPS',
          reps: isDuration ? null : toNonNegInt(sub.reps, 0),
          durata_secondi: isDuration ? toNonNegInt(sub.duration_seconds, 0) : null,
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

    // ── PIRAMIDE ─────────────────────────────────────────────────────────────
    if (ex.type === 'pyramid') {
      const { data, error: piramideError } = await supabase
        .from('piramide')
        .insert([{}])
        .select('id_piramide')
        .single();
      if (piramideError) throw piramideError;

      const idEsercizio = await ensureExerciseDictionaryId(ex.name);
      const steps = ex.pyramid_steps || [];
      for (let stepIdx = 0; stepIdx < steps.length; stepIdx += 1) {
        const step = steps[stepIdx];
        const stepRest = toNonNegInt(step.rest_seconds, 0);
        const stepMeta: Record<string, unknown> = {};
        if (stepIdx === 0 && trimmedParentNote) {
          stepMeta.parentNote = trimmedParentNote;
        }

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: 1,
          rest_secondi: stepRest > 0 ? stepRest : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(step.weight_kg),
          note_esercizio: encodeNoteWithMeta(step.instruction_note, stepMeta),
          tipo: 'REPS',
          reps: toNonNegInt(step.reps, 0),
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

    // ── ESERCIZIO SEMPLICE (reps, isometry o cardio) ─────────────────────────
    const idEsercizio = await ensureExerciseDictionaryId(ex.name);
    const isCardio = ex.type === 'cardio';
    const isIsometry = ex.type === 'isometry';
    const isDurationBased = isIsometry || isCardio;
    const restSeconds = toNonNegInt(ex.rest_seconds, 0);

    const metaObj: Record<string, unknown> = {};
    if (ex.auto_count_type) {
      metaObj.autoCountType = ex.auto_count_type;
    }
    if (isCardio) {
      metaObj.exerciseType = 'cardio';
    }

    rowsToInsert.push({
      id_scheda: schedaId,
      id_esercizio: idEsercizio,
      ordine: orderCounter,
      set_num: toPositiveInt(ex.sets, 1),
      rest_secondi: restSeconds > 0 ? restSeconds : null,
      rest_tra_esercizi: transitionRestToPersist,
      peso_kg: toDbWeight(ex.weight_kg),
      note_esercizio: encodeNoteWithMeta(ex.instruction_note, metaObj),
      tipo: isDurationBased ? 'ISOMETRIA' : 'REPS',
      reps: isDurationBased ? null : toNonNegInt(ex.reps, 0),
      durata_secondi: isDurationBased ? toNonNegInt(ex.duration_seconds, 0) : null,
      id_superset: null,
      id_piramide: null,
      stepindex_piramide: null,
      id_emom: null,
      stepindex_emom: null,
    });

    orderCounter += 1;
  }

  // Elimina le vecchie esecuzioni solo dopo aver preparato tutto il nuovo payload
  const { error: deleteError } = await supabase
    .from('esecuzioni')
    .delete()
    .eq('id_scheda', schedaId);
  if (deleteError) throw deleteError;

  if (rowsToInsert.length > 0) {
    const { error: exercisesError } = await supabase
      .from('esecuzioni')
      .insert(rowsToInsert);
    if (exercisesError) throw exercisesError;
  }

  // Cleanup best-effort dei container orfani precedenti
  try {
    if (oldSupersetIds.size > 0) {
      await supabase.from('superset').delete().in('id_superset', Array.from(oldSupersetIds));
    }
    if (oldEmomIds.size > 0) {
      await supabase.from('emom').delete().in('id_emom', Array.from(oldEmomIds));
    }
    if (oldPiramideIds.size > 0) {
      await supabase.from('piramide').delete().in('id_piramide', Array.from(oldPiramideIds));
    }
  } catch {
    // Cleanup best-effort: eventuali policy RLS sui container non invalidano il salvataggio
  }
};
